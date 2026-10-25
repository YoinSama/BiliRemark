import { getSettings } from '../core/config'
import { pageUpMid, pageUpName, resolveFromElement, snapshotNickname } from '../core/midResolver'
import { faceOf, rememberFace, rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import { badgeOptions, clearPencilsOfScene, ensurePencil, renderBadge } from '../ui/badge'
import { closestDeep, isVisible, qs, qsa } from '../util/dom'

/** 主 UP 主信息区容器：刻意不含推荐卡片，避免 M1 越界去改卡片场景（S5） */
const SCOPES = ['#v_upinfo', '.up-detail', '.video-info-meta', '.up-info--right', '.video-info-container']

/** 备选选择器，按优先级排列；改版时只需要动这里 */
const CANDIDATES = [
  '#v_upinfo .up-name',
  '.up-detail .up-name',
  '.video-info-meta .up-name',
  '.up-info--right .up-name',
  '.up-info .up-name',
  '#v_upinfo a[href*="space.bilibili.com/"]',
  '.up-detail a[href*="space.bilibili.com/"]',
]

export function isVideoPage(): boolean {
  return /^\/(video\/(BV|av)|list\/)/i.test(location.pathname)
}

interface UpTarget {
  anchor: Element
  mid: string
  nickname: string
  face: string
}

function inScope(el: Element): boolean {
  for (const scope of SCOPES) {
    if (el.closest(scope)) return true
  }
  return false
}

/** UP 主头像候选：优先真实头像（bfs/face），兜底取信息区内的头像位 img；data: URI 是夹具占位，不快照 */
const FACE_IMGS = [
  'img[src*="/bfs/face/"]',
  'img[data-src*="/bfs/face/"]',
  '.up-avatar-wrap img',
  '.up-avatar img',
  '.bili-avatar img',
]

function faceNear(el: Element): string {
  const container = closestDeep(el, SCOPES.join(','))
  if (!container) return ''
  for (const selector of FACE_IMGS) {
    const img = qs<HTMLImageElement>(selector, container)
    const src = img?.getAttribute('src') ?? img?.getAttribute('data-src') ?? ''
    if (src && !src.startsWith('data:')) return src
  }
  return ''
}

function pickTargets(): { targets: UpTarget[]; hits: { selector: string; hits: number }[] } {
  const hits: { selector: string; hits: number }[] = []
  const targets: UpTarget[] = []
  const seen = new Set<string>()

  for (const selector of CANDIDATES) {
    const found = qsa(selector).filter((el) => inScope(el))
    hits.push({ selector, hits: found.length })
    for (const el of found) {
      if (targets.length >= 3) continue
      const resolved = resolveFromElement(el, { allowDescendant: false })
      const mid = resolved?.mid ?? null
      if (!mid || seen.has(mid)) continue
      seen.add(mid)
      targets.push({
        anchor: el,
        mid,
        nickname: snapshotNickname(el) || (targets.length === 0 ? pageUpName() : ''),
        face: faceNear(el),
      })
    }
    if (targets.length) break
  }

  // 兜底：结构全变但页面状态里还有 mid → 找主区域里任意 space 链接
  if (!targets.length) {
    const mid = pageUpMid()
    if (mid) {
      for (const scope of SCOPES) {
        const container = qs(scope)
        if (!container) continue
        const link = qs<HTMLAnchorElement>('a[href*="space.bilibili.com/"]', container)
        if (link && isVisible(link)) {
          targets.push({ anchor: link, mid, nickname: pageUpName() || snapshotNickname(link), face: faceNear(link) })
          break
        }
      }
    }
  }

  return { targets, hits }
}

function inject(targets: UpTarget[]): number {
  const settings = getSettings()
  const opts = { ...badgeOptions(), scene: 'videoUp' as const }
  let injected = 0

  for (const target of targets) {
    if (!target.anchor.isConnected) continue
    rememberNick(target.mid, target.nickname)
    if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face)
    const record = store.get(target.mid)
    if (record) {
      if (renderBadge(target.anchor, record, opts)) injected++
    } else {
      ensurePencil(target.anchor, target.mid, target.nickname, settings.scenes.videoUp ? 'videoUp' : undefined)
    }
  }
  return injected
}

export function scanVideoUp(): SceneDiagnostic {
  const { targets, hits } = pickTargets()
  let injected = 0
  if (getSettings().scenes.videoUp && getSettings().enabled) {
    injected = inject(targets)
  }
  const diag: SceneDiagnostic = {
    scene: 'videoUp',
    label: '视频页 UP 主',
    selectors: hits,
    midResolved: targets.length,
    injected,
    notes: [],
  }
  if (!targets.length) diag.notes.push('未找到 UP 主锚点，页面结构可能已变')
  setDiagnostic(diag)
  return diag
}

/** 关闭场景或全局开关时，移除本场景注入的铅笔入口（徽标由全局清理） */
export function clearVideoUpPencils(): void {
  clearPencilsOfScene('videoUp')
}
