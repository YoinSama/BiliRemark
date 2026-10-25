import { getSettings } from '../core/config'
import { midFromHref, pageDocument, pageState, snapshotNickname } from '../core/midResolver'
import { faceOf, rememberFace, rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import { badgeOptions, clearPencilsOfScene, ensurePencil, renderBadge, showPencil } from '../ui/badge'
import { isVisible, qs, qsa } from '../util/dom'

/**
 * 动态页（S4，两个分支按容器特征分流，互不触碰）：
 *
 * 第 1 期 opus（v1.2.0）：www.bilibili.com/opus/<id> 图文动态。作者模块 light DOM，
 * mid 走 __INITIAL_STATE__.detail.modules[]（jump_url 字符串优先）。徽标 / 铅笔走 portal 浮层。
 *
 * 第 2 期 dyn（v1.7.0）：t.bilibili.com 全域（关注流 feed / dyn 详情 / 转发动态）与空间动态列表
 * （space.bilibili.com/<mid>/dynamic）是同一新版 dyn 应用（Vue 2，2026-10-24 登录态六轮探针）：
 * 卡片 .bili-dyn-item 挂 __vue__ expando，卡内零 <a> 链接、零 __INITIAL_STATE__——mid 唯一链路
 * = el.__vue__.data.modules.module_author（jump_url 字符串优先，15/16 位 mid 均无精度问题）；
 * 转发动态双锚点 = 转发者 .bili-dyn-title__text + 原作者 .dyn-orig-author__name（源卡引用区，
 * 右侧是关注按钮），双 mid 来自 data 与 data.orig 两份 module_author；自转发两锚点同一备注。
 * 隔离世界里元素 expando 挂在页面世界的包装对象上，卡片必须经 pageDocument() 枚举（见 midResolver）。
 */
const AUTHOR_CANDIDATES = ['.opus-module-author__name']

const DYN_CARD = '.bili-dyn-item'
const DYN_AUTHOR_ANCHOR = '.bili-dyn-title__text'
const DYN_ORIG_AUTHOR_ANCHOR = '.dyn-orig-author__name'

/** 空间动态列表路由（S3 侧栏卡与 S4 动态列表在此页共存，各归各的场景开关） */
const SPACE_DYN_PATH_RE = /^\/\d{1,20}\/dynamic\/?$/
/** 夹具标记：本地路由没有真实域名时的宿主判定（relation / im 同款惯例） */
const FIXTURE_ATTR = 'data-brmk-dyn-fixture'

/** opus 页结构上还承载评论区（bili-comments），comment 适配器按组件探测自动生效，本文件只管作者行 */
export function isDynamicPage(): boolean {
  if (document.documentElement.hasAttribute(FIXTURE_ATTR)) return true
  if (location.hostname === 't.bilibili.com') return true
  if (/\/opus\//i.test(location.pathname)) return true
  if (location.hostname === 'space.bilibili.com' && SPACE_DYN_PATH_RE.test(location.pathname)) return true
  return false
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
  // opus 分支（第 1 期）：页面上有 opus 作者模块就走原链路，行为不变
  if (qs(AUTHOR_CANDIDATES[0])) return scanOpus()
  return scanDyn()
}

function scanOpus(): SceneDiagnostic {
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

// ===== dyn 分支（第 2 期，v1.7.0）=====

interface DynAuthor {
  mid: string
  name: string
  face: string
}

function dynAuthorOf(m: unknown): DynAuthor | null {
  if (!m || typeof m !== 'object') return null
  const a = m as Record<string, unknown>
  const mid = midFromHref(typeof a.jump_url === 'string' ? a.jump_url : null) ?? midText(a.mid)
  if (!mid) return null
  return {
    mid,
    name: typeof a.name === 'string' ? a.name : '',
    face: typeof a.face === 'string' ? a.face : '',
  }
}

/**
 * dyn 卡数据面：读 card.__vue__.data（card 必须来自 pageDocument() 枚举——隔离世界里
 * 读不到页面世界写的 expando）。__vue__ 缺失 / data 非对象 / module_author 非法均返回
 * null 跳卡（骨架屏、数据未落定、结构改版），巡检会再试——任何异常不外泄。
 */
function dynDataOf(card: Element): { author: DynAuthor; orig: DynAuthor | null } | null {
  try {
    const data = (card as unknown as { __vue__?: { data?: unknown } }).__vue__?.data
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, any>
    const author = dynAuthorOf(d.modules?.module_author)
    if (!author) return null
    return { author, orig: dynAuthorOf(d.orig?.modules?.module_author) }
  } catch {
    return null
  }
}

/** 已绑过按需铅笔 hover 的锚点（feed 无限滚动卡量大，S5/S7 同款：首次 hover 才建铅笔，浮层不随滚动膨胀） */
const dynLazyBound = new WeakSet<Element>()

function bindDynPencil(anchor: Element, mid: string, nickname: string): void {
  if (dynLazyBound.has(anchor)) return
  dynLazyBound.add(anchor)
  anchor.addEventListener('mouseenter', () => {
    if (!anchor.isConnected) return
    ensurePencil(anchor, mid, nickname, 'dynamic')
    showPencil(anchor)
  })
}

/**
 * 目标收集：关注流 / dyn 详情 / 空间动态列表三面同构，逐卡两个潜在锚点——
 * 转发者（每卡一个）+ 原作者（仅转发卡，源卡引用区内）；同一卡两个锚点物理上不同层级
 * 不同行，portal 各自独立选址。自转发（orig.mid === 转发者 mid）不特判：两锚点各挂各的，显示同一份备注。
 */
function pickDynTargets(): { targets: DynamicTarget[]; hits: { selector: string; hits: number }[] } {
  const targets: DynamicTarget[] = []
  const doc = pageDocument()
  if (!doc) return { targets, hits: [] }

  const cards = Array.from(doc.querySelectorAll(DYN_CARD)).filter((el) => isVisible(el))
  let authorAnchors = 0
  let origAnchors = 0
  for (const card of cards) {
    const data = dynDataOf(card)
    if (!data) continue
    const anchor = card.querySelector(DYN_AUTHOR_ANCHOR)
    if (anchor && isVisible(anchor)) {
      authorAnchors++
      targets.push({
        anchor,
        mid: data.author.mid,
        nickname: data.author.name || snapshotNickname(anchor),
        face: data.author.face,
      })
    }
    if (data.orig) {
      const origAnchor = card.querySelector(DYN_ORIG_AUTHOR_ANCHOR)
      if (origAnchor && isVisible(origAnchor)) {
        origAnchors++
        targets.push({
          anchor: origAnchor,
          mid: data.orig.mid,
          nickname: data.orig.name || snapshotNickname(origAnchor),
          face: data.orig.face,
        })
      }
    }
  }
  return {
    targets,
    hits: [
      { selector: DYN_CARD, hits: cards.length },
      { selector: DYN_AUTHOR_ANCHOR, hits: authorAnchors },
      { selector: DYN_ORIG_AUTHOR_ANCHOR, hits: origAnchors },
    ],
  }
}

function injectDyn(targets: DynamicTarget[]): number {
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
      bindDynPencil(target.anchor, target.mid, target.nickname)
    }
  }
  return injected
}

function scanDyn(): SceneDiagnostic {
  const { targets, hits } = pickDynTargets()
  let injected = 0
  if (getSettings().scenes.dynamic && getSettings().enabled) {
    injected = injectDyn(targets)
  }
  const diag: SceneDiagnostic = {
    scene: 'dynamic',
    label: '动态页',
    selectors: hits,
    midResolved: targets.length,
    injected,
    notes: [],
  }
  if (!hits.length) {
    diag.notes.push('无法读取页面文档（unsafeWindow 不可用），dyn 分支未运行')
  } else if (!hits[0].hits) {
    diag.notes.push('未找到 .bili-dyn-item（可能尚未渲染完成、不是 dyn 页面或结构已变）')
  } else if (!targets.length) {
    diag.notes.push(
      `发现 ${hits[0].hits} 张 dyn 卡但 mid 数据 0 命中（__vue__ 数据面疑似失效，页面结构可能已改版）`,
    )
  }
  setDiagnostic(diag)
  return diag
}

/** 关闭场景时移除本场景的铅笔入口（按场景清理，不影响同页的评论区场景） */
export function clearDynamicPencils(): void {
  clearPencilsOfScene('dynamic')
}
