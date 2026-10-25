import { getSettings } from '../core/config'
import { resolveFromElement, snapshotNickname } from '../core/midResolver'
import { faceOf, rememberFace, rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import { badgeOptions, clearPencilsOfScene, ensurePencil, renderBadge, showPencil } from '../ui/badge'
import { isVisible, qs, qsa } from '../util/dom'

/**
 * 关注 / 粉丝列表（S7）：space.bilibili.com/<mid>/relation/fans|follow 的行卡片。
 * 2026-10-25 登录态校准（见 tests/selectors.md「S7 登录态校准结果」）：
 * - 行 = .items > div.item > div.relation-card：a.relation-card-avatar（带 data-user-profile-id）
 *   + div.relation-card-info（a.relation-card-info__uname + __sign + __option）。
 * - 行内链接是协议相对形态 //space.bilibili.com/<mid>?spm_id_from=…（未登录探针发现的相对路径
 *   /<mid>/... 只出现在侧栏入口，卡片行不走）——mid 直接走现行 midFromHref，无需新链路。
 * - 昵称链接本身作锚点（三列卡片网格、卡宽有限，徽标贴昵称同行右侧；回退 = 卡内任一用户链接）。
 * - 24 行/页，铅笔按需创建（WeakSet + 首次 hover，与 card / im 同款）。
 * - 头像 img 在行内（bfs/face）写 faceSnapshot；页面无 __INITIAL_STATE__，纯 DOM 链路。
 * - 未登录整页是登录墙（.items 为空 + 「请先登入」空态）零目标零注入；列表不可见账户被
 *   重定向回空间主页，路由判定不命中。
 */

const SPACE_HOST_RE = /(^|\.)space\.bilibili\.com$/i
/** 本地夹具在 127.0.0.1 上跑同款路径，靠 html 标记放行（真实页面无此标记） */
const FIXTURE_ATTR = 'data-brmk-relation-fixture'
const RELATION_PATH_RE = /^\/\d{1,20}\/relation\/(?:fans|follow)\/?$/

/** 主候选：昵称链接（行内唯一带文本的用户链接，mid 在自身 href） */
const UNAME_SELECTOR = '.relation-content .items a.relation-card-info__uname'
/** 回退候选：昵称缺失时取卡内任一用户链接（头像链接） */
const CARD_LINK_SELECTOR = '.relation-content .items .relation-card a[href*="space.bilibili.com/"]'

export function isRelationPage(): boolean {
  const fixture = document.documentElement.hasAttribute(FIXTURE_ATTR)
  if (!fixture && !SPACE_HOST_RE.test(location.hostname)) return false
  if (!RELATION_PATH_RE.test(location.pathname)) return false
  // 路由 + 类名双条件（类名未登录也渲染；路由正则吃带不带 ?tagid= 的两种 URL）
  return !!qs('main.route_relationFans, main.route_relationFollow')
}

/** 头像快照：限定在行卡片内取第一张 bfs/face（页面别处没有头像，但仍按容器限定） */
function faceFromCard(anchor: Element): string {
  const card = anchor.closest('.relation-card') ?? anchor.closest('.items')
  return card?.querySelector('img[src*="/bfs/face/"]')?.getAttribute('src') ?? ''
}

interface RelationTarget {
  anchor: Element
  mid: string
  nickname: string
  face: string
}

function pickTargets(): { targets: RelationTarget[]; hits: { selector: string; hits: number }[] } {
  const unames = qsa(UNAME_SELECTOR).filter((el) => isVisible(el))
  const cardLinks = qsa(CARD_LINK_SELECTOR).filter((el) => isVisible(el))
  const hits = [
    { selector: UNAME_SELECTOR, hits: unames.length },
    { selector: CARD_LINK_SELECTOR, hits: cardLinks.length },
  ]

  const targets: RelationTarget[] = []
  const cardOf = (el: Element): Element | null => el.closest('.relation-card')
  const doneCards = new Set<Element>()

  for (const anchor of unames) {
    const resolved = resolveFromElement(anchor, { allowDescendant: false })
    if (!resolved) continue
    // 一张卡只出一个目标（昵称优先已保证）；跨卡同 mid 各自保留
    const card = cardOf(anchor)
    if (card && doneCards.has(card)) continue
    if (card) doneCards.add(card)
    targets.push({ anchor, mid: resolved.mid, nickname: snapshotNickname(anchor), face: faceFromCard(anchor) })
  }

  // 昵称缺失的卡（改版 / 异常态）：头像链接兜底，mid 同样来自 href
  for (const link of cardLinks) {
    const card = cardOf(link)
    if (card && doneCards.has(card)) continue
    const resolved = resolveFromElement(link, { allowDescendant: false })
    if (!resolved) continue
    if (card) doneCards.add(card)
    targets.push({ anchor: link, mid: resolved.mid, nickname: snapshotNickname(link), face: faceFromCard(link) })
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
    ensurePencil(anchor, mid, nickname, 'relation', true)
    showPencil(anchor)
  })
}

function inject(targets: RelationTarget[]): number {
  // 摆位（2026-10-25 主人拍板）：贴昵称文字右侧同行（portal inline 选址，
  // Range 量末行文字右缘 + 6px，宽度收敛信息列右缘、超长昵称内部省略，永不落下方）
  const opts = { ...badgeOptions(), scene: 'relation' as const, placeInline: true }
  let injected = 0
  for (const target of targets) {
    if (!target.anchor.isConnected) continue
    rememberNick(target.mid, target.nickname)
    if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face)
    const record = store.get(target.mid)
    if (record) {
      if (renderBadge(target.anchor, record, opts)) injected++
    } else {
      bindLazyPencil(target.anchor, target.mid, target.nickname)
    }
  }
  return injected
}

export function scanRelation(): SceneDiagnostic {
  const { targets, hits } = pickTargets()
  let injected = 0
  if (getSettings().scenes.relation && getSettings().enabled) {
    injected = inject(targets)
  }
  const diag: SceneDiagnostic = {
    scene: 'relation',
    label: '粉丝/关注',
    selectors: hits,
    midResolved: targets.length,
    injected,
    notes: [],
  }
  if (!targets.length) {
    diag.notes.push('未找到关系列表行（未登录登录墙 / 列表为空 / 非卡片壳或结构已变）')
  }
  setDiagnostic(diag)
  return diag
}

/** 关闭场景时移除本场景的铅笔入口（按场景清理，不影响同页的其它场景） */
export function clearRelationPencils(): void {
  clearPencilsOfScene('relation')
}
