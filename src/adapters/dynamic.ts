import { getSettings } from '../core/config'
import { midFromHref, pageState, snapshotNickname } from '../core/midResolver'
import { faceOf, rememberFace, rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import { badgeOptions, clearPencilsOfScene, ensurePencil, renderBadge } from '../ui/badge'
import { isVisible, qs, qsa } from '../util/dom'

/**
 * 动态页（S4 第 1 期）：opus 图文动态（bilibili.com/opus/<id>）。
 * 作者模块是 light DOM（2026-10-24 实测，见 tests/selectors.md「动态页」），
 * 徽标 / 铅笔照旧走 portal 浮层，不进 B 站容器。
 * 旧版 t.bilibili.com 详情页与转发动态未登录为登录墙，第 2 期登录态探针后在此文件补候选。
 */
const AUTHOR_CANDIDATES = ['.opus-module-author__name']

/** opus 页结构上还承载评论区（bili-comments），comment 适配器按组件探测自动生效，本文件只管作者行 */
export function isDynamicPage(): boolean {
  return /\/opus\//i.test(location.pathname) || location.hostname === 't.bilibili.com'
}

interface DynamicTarget {
  anchor: Element
  mid: string
  nickname: string
  face: string
}

interface OpusAuthorState {
  mid: string
  name: string
  face: string
}

function midText(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return /^\d{1,20}$/.test(s) && s !== '0' ? s : null
}

/**
 * L1（主链路）：__INITIAL_STATE__.detail.modules[] 按 module_type 特征找作者模块。
 * jump_url（//space.bilibili.com/<mid>）字符串解析优先——样本 mid 已 16 位，
 * 字符串链路彻底规避大数精度问题；mid 数字字段仅作兜底。
 */
function authorFromState(): OpusAuthorState | null {
  const s = pageState()
  if (!s) return null
  try {
    const modules = s.detail?.modules
    if (!Array.isArray(modules)) return null
    const m = modules.find((x) => x?.module_type === 'MODULE_TYPE_AUTHOR')?.module_author
    if (!m) return null
    const mid = midFromHref(typeof m.jump_url === 'string' ? m.jump_url : null) ?? midText(m.mid)
    if (!mid) return null
    return {
      mid,
      name: typeof m.name === 'string' ? m.name : '',
      face: typeof m.face === 'string' ? m.face : '',
    }
  } catch {
    return null
  }
}

/** L2 兜底：作者区容器内的 space 链接（未登录实测没有；登录态可能渲染出链接） */
function authorFromLink(container: Element): { mid: string; face: string } | null {
  const link = qs<HTMLAnchorElement>('a[href*="space.bilibili.com/"]', container)
  const mid = midFromHref(link?.getAttribute('href') ?? null)
  if (!mid) return null
  let face = ''
  for (const img of qsa('img', container)) {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? ''
    if (src.includes('/bfs/face/')) {
      face = src
      break
    }
  }
  return { mid, face }
}

function pickTargets(): { targets: DynamicTarget[]; hits: { selector: string; hits: number }[] } {
  const hits: { selector: string; hits: number }[] = []
  const targets: DynamicTarget[] = []

  for (const selector of AUTHOR_CANDIDATES) {
    const found = qsa(selector).filter((el) => isVisible(el))
    hits.push({ selector, hits: found.length })
    const anchor = found[0]
    if (!anchor) continue

    // 锚点直接用昵称元素：真机实测（tests/selectors.md「动态页」）opus 的 __name-row 是
    // 宽 flex 容器（432px，父级 __center 为 flex:1），portal 的 limitRight 随父容器宽度展开，
    // 徽标稳定落在昵称右侧。不要换成 __center / name-row——它们撑满整行，会把徽标挤到行尾兜底位。
    const container = anchor.closest('.opus-module-author')

    const state = authorFromState()
    if (state) {
      targets.push({
        anchor,
        mid: state.mid,
        nickname: state.name || snapshotNickname(anchor),
        face: state.face,
      })
      break
    }
    // 状态缺失时走链接兜底：容器取不到 mid 就不注入，诊断里说明
    const viaLink = container ? authorFromLink(container) : null
    if (viaLink) {
      targets.push({ anchor, mid: viaLink.mid, nickname: snapshotNickname(anchor), face: viaLink.face })
    }
    break
  }

  return { targets, hits }
}

function inject(targets: DynamicTarget[]): number {
  const opts = { ...badgeOptions(), scene: 'dynamic' as const }
  let injected = 0

  for (const target of targets) {
    if (!target.anchor.isConnected) continue
    rememberNick(target.mid, target.nickname)
    if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face)
    const record = store.get(target.mid)
    if (record) {
      if (renderBadge(target.anchor, record, opts)) injected++
    } else {
      ensurePencil(target.anchor, target.mid, target.nickname, 'dynamic')
    }
  }
  return injected
}

export function scanDynamic(): SceneDiagnostic {
  const { targets, hits } = pickTargets()
  let injected = 0
  if (getSettings().scenes.dynamic && getSettings().enabled) {
    injected = inject(targets)
  }
  const diag: SceneDiagnostic = {
    scene: 'dynamic',
    label: '动态页',
    selectors: hits,
    midResolved: targets.length,
    injected,
    notes: [],
  }
  if (!targets.length) {
    diag.notes.push('未找到动态作者锚点（可能尚未渲染完成、不是动态详情页或结构已变）')
  }
  setDiagnostic(diag)
  return diag
}

/** 关闭场景时移除本场景的铅笔入口（按场景清理，不影响同页的评论区场景） */
export function clearDynamicPencils(): void {
  clearPencilsOfScene('dynamic')
}
