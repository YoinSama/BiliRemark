import { getSettings } from '../core/config'
import { resolveFromElement, snapshotNickname } from '../core/midResolver'
import { faceOf, rememberFace, rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import { badgeOptions, clearPencilsOfScene, ensurePencil, renderBadge, showPencil } from '../ui/badge'
import { isVisible, qs, qsa } from '../util/dom'

/**
 * 私信页（S8）：message.bilibili.com（#/whisper 会话列表 + 聊天窗头部）。
 * 2026-10-24 登录态校准（见 tests/selectors.md「S8 登录态校准结果」）：
 * - 会话行 div._SessionItem_<hash>_1 内零 <a> 链接（回调式点击），行 mid 走行容器
 *   data-id="contact_<mid>"（空间标题地面真值对账 8/10；group_* 前缀跳过；
 *   系统号 contact_<digits> 无空间但只有一根无害铅笔，不做硬编码排除）。
 * - 聊天头部 _ContactName_ 是纯 div 非链接、无 data 属性，mid 走 URL hash
 *   #/whisper/mid<mid>（route 自带 "mid" 命名）——仅头部锚点消费 URL，列表行永不消费。
 * - CSS modules 哈希尾巴随构建漂移：选择器一律 [class*="…"] 子串匹配；
 *   行容器用 /_SessionItem_[A-Za-z0-9]+_\d+/ 且不含 "SessionItem__" 区分真行与子块
 *   （子块形如 _SessionItem__Name_<hash>，修饰类形如 _SessionItemIsActive_<hash>）。
 * - 行内无时间戳、未读标在头像角；行头像 img src*="/bfs/face/" 写 faceSnapshot
 *   （头部无头像元素，face 只从行取）。
 */

const IM_HOST_RE = /(^|\.)message\.bilibili\.com$/i
/** 本地夹具在 127.0.0.1 上跑，靠 html 标记放行（真实 www/message 页无此标记） */
const FIXTURE_ATTR = 'data-brmk-im-fixture'
const MID_FROM_HASH_RE = /\/whisper\/mid(\d{1,20})/
/** 真行容器：_SessionItem_<hash>_<n>（不含双下划线子块；修饰类不含 "_SessionItem_" 段） */
const ROW_CONTAINER_RE = /(?:^|\s)_SessionItem_[A-Za-z0-9]+_\d+/

const ROW_SELECTOR = '[class*="SessionItem_"]'
const NAME_SELECTOR = '[class*="SessionItem__Name"]'
const TITLE_SELECTOR = '[class*="SessionItem__Title"]'
const CONTACT_SELECTOR = '[class*="ContactName"]'

export function isImPage(): boolean {
  if (document.documentElement.hasAttribute(FIXTURE_ATTR)) {
    return !!document.getElementById('message-pc-app')
  }
  if (!IM_HOST_RE.test(location.hostname)) return false
  // 应用只挂 root（未知路径是 404 静态页）；hash 路由不参与 pathname
  if (location.pathname !== '/') return false
  // 真机实证：裸 HTML 的 #message-pc-app 会在应用启动后被移除，UI 实际挂在 #app > .message-layout
  return !!qs('#app .message-layout') || !!document.getElementById('message-pc-app')
}

function isRowContainer(el: Element): boolean {
  const cls = typeof el.className === 'string' ? el.className : ''
  return ROW_CONTAINER_RE.test(cls) && !cls.includes('SessionItem__')
}

/** 行 mid：data-id="contact_<mid>"（contact_ 前缀 + 纯数字；group_* 等其它前缀返回 null） */
function midFromRow(row: Element): string | null {
  const dataId = row.getAttribute('data-id') ?? ''
  const m = /^contact_(\d{1,20})$/.exec(dataId)
  const mid = m?.[1]
  return mid && mid !== '0' ? mid : null
}

/** 行内锚点：昵称元素优先，昵称+标签窄父组次之，行容器兜底（portal 三级选址保证「有」再求「好」） */
function anchorOfRow(row: Element): Element {
  return qs(NAME_SELECTOR, row) ?? qs(TITLE_SELECTOR, row) ?? row
}

function faceFromRow(row: Element): string {
  return row.querySelector('img[src*="/bfs/face/"]')?.getAttribute('src') ?? ''
}

interface ImTarget {
  anchor: Element
  mid: string
  nickname: string
  face: string
  /** 会话行按需铅笔（首次 hover 才建）；聊天头部单锚点常驻 */
  lazy: boolean
}

function pickTargets(): { targets: ImTarget[]; hits: { selector: string; hits: number }[] } {
  const rows = qsa(ROW_SELECTOR).filter((el) => isRowContainer(el) && isVisible(el))
  const contacts = qsa(CONTACT_SELECTOR).filter((el) => isVisible(el))
  const hits = [
    { selector: ROW_SELECTOR, hits: rows.length },
    { selector: NAME_SELECTOR, hits: qsa(NAME_SELECTOR).length },
    { selector: CONTACT_SELECTOR, hits: contacts.length },
  ]

  const targets: ImTarget[] = []
  for (const row of rows) {
    const mid = midFromRow(row)
    if (!mid) continue
    const anchor = anchorOfRow(row)
    // 同一行嵌套链只保留一个锚点（anchorOfRow 已定），跨行/跨区域不同锚点各自保留
    if (targets.some((t) => t.mid === mid && (t.anchor.contains(anchor) || anchor.contains(t.anchor)))) continue
    targets.push({ anchor, mid, nickname: snapshotNickname(anchor), face: faceFromRow(row), lazy: true })
  }

  // 聊天头部：mid 只认 URL hash（#/whisper/mid<mid>），ContactName 本身无任何 mid 线索
  const hashMid = MID_FROM_HASH_RE.exec(location.hash)?.[1]
  if (hashMid && hashMid !== '0' && contacts.length) {
    const anchor = contacts[0]
    const dup = targets.some((t) => t.mid === hashMid && (t.anchor.contains(anchor) || anchor.contains(t.anchor)))
    // 列表行与头部是独立屏幕位置，同 mid 双目标各自渲染（S1 / S3 跨区域先例）——仅容器嵌套才去重
    if (!dup) targets.push({ anchor, mid: hashMid, nickname: snapshotNickname(anchor), face: '', lazy: false })
  }

  // 行内链接兜底（若 B 站改版恢复 <a>，href 形态由 resolveFromElement 现行正则吃掉；
  // data-id 链路失败且无链接的行自然跳过——宁缺毋滥）
  for (const row of rows) {
    if (midFromRow(row)) continue
    const resolved = resolveFromElement(anchorOfRow(row))
    if (resolved && !targets.some((t) => t.mid === resolved.mid)) {
      const anchor = anchorOfRow(row)
      targets.push({ anchor, mid: resolved.mid, nickname: snapshotNickname(anchor), face: faceFromRow(row), lazy: true })
    }
  }

  return { targets, hits }
}

/** 已绑过按需铅笔 hover 的锚点（WeakSet 记绑定状态，不往 B 站元素上写属性） */
const lazyBound = new WeakSet<Element>()

function bindLazyPencil(anchor: Element, mid: string, nickname: string): void {
  if (lazyBound.has(anchor)) return
  lazyBound.add(anchor)
  anchor.addEventListener('mouseenter', () => {
    if (!anchor.isConnected) return
    ensurePencil(anchor, mid, nickname, 'message')
    showPencil(anchor)
  })
}

function inject(targets: ImTarget[]): number {
  const opts = { ...badgeOptions(), scene: 'message' as const }
  let injected = 0
  for (const target of targets) {
    if (!target.anchor.isConnected) continue
    rememberNick(target.mid, target.nickname)
    if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face)
    const record = store.get(target.mid)
    if (record) {
      if (renderBadge(target.anchor, record, opts)) injected++
    } else if (target.lazy) {
      bindLazyPencil(target.anchor, target.mid, target.nickname)
    } else {
      ensurePencil(target.anchor, target.mid, target.nickname, 'message')
    }
  }
  return injected
}

export function scanIm(): SceneDiagnostic {
  const { targets, hits } = pickTargets()
  let injected = 0
  if (getSettings().scenes.message && getSettings().enabled) {
    injected = inject(targets)
  }
  const diag: SceneDiagnostic = {
    scene: 'message',
    label: '私信',
    selectors: hits,
    midResolved: targets.length,
    injected,
    notes: [],
  }
  if (!targets.length) {
    diag.notes.push('未找到会话行/联系人锚点（列表为空、未打开会话、结构已变或行 data-id 非 contact_ 前缀）')
  }
  setDiagnostic(diag)
  return diag
}

/** 关闭场景时移除本场景的铅笔入口（按场景清理） */
export function clearImPencils(): void {
  clearPencilsOfScene('message')
}
