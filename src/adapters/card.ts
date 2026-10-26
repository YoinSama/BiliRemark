import { getSettings } from '../core/config'
import type { UserRecord } from '../core/types'
import { resolveFromElement, snapshotNickname } from '../core/midResolver'
import { rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import {
  badgeOptions,
  badgeSignature,
  buildBadgeElement,
  clearPencilsOfScene,
  ensurePencil,
  isSettled,
  markSettled,
  renderBadge,
  showPencil,
  type BadgeOptions,
} from '../ui/badge'
import { h, isVisible, qs, qsa } from '../util/dom'

/**
 * 视频卡片（S5）：首页 feed / 搜索结果页 / 视频页右栏「接下来播放」。
 * 三类页面未登录实测（2026-10-24，见 tests/selectors.md「视频卡片」）：
 * 全部 light DOM；锚点 = 卡片内 a[href*="space.bilibili.com/"] 链接本身（首页/搜索是
 * a.bili-video-card__info--owner，侧栏是 .upname > a），卡片上没有 data-mid 属性，
 * 首页/搜索的 __INITIAL_STATE__ 为 null——纯 DOM 链路，不依赖页面状态。
 *
 * 铅笔按需创建：卡片页无限滚动只追加不移除锚点（与评论区的虚拟滚动相反），
 * 全量建铅笔会让浮层常驻条目与 rect 读取随滚动线性增长（portal 每条目每次 sync
 * 读锚点 + 父容器 + 最多 12 个兄弟的 rect）——未备注锚点首次 hover 才建。
 */
const CANDIDATES = [
  /** 首页 / 搜索网格卡：owner 链接本身作锚点。不选昵称 span——它的父容器是内容宽度的
   *  owner 链接，portal 三级选址会退到「父容器下方」（真机实测，见 tests/selectors.md）；
   *  用链接作锚点则父容器是宽排版行，徽标稳定落在日期右侧的同行空位。
   *  2026-10-25 提案通过：这类锚点的徽标改为「作者行下方、左缘对齐」（placeBelow），
   *  父容器（.bili-video-card__info--bottom）就是卡片信息区整行，正好做宽度界。 */
  'a.bili-video-card__info--owner',
  /** 视频页右栏「接下来播放」：.upname > a（父容器 .upname 是整行宽），同理选链接。
   *  横排小卡行密度高、昵称行下无留白，维持「昵称右侧同行」不参与 placeBelow。 */
  '.video-page-card-small .upname a[href*="space.bilibili.com/"]',
]

/** 宿主探测按容器结构而非路由（与 comment 适配器同款）：三类页面天然命中 */
export function hasCardHost(): boolean {
  return !!qs('.bili-video-card, .video-page-card-small .upname')
}

/** 视频页右栏「接下来播放」的卡片——S5 唯一允许徽标进卡片的子场景（§5.9 例外，探针实证后放开）。
 *  三行布局：备注行独立成行，夹在用户名与播放量之间（主人 2026-10-25 点头，先探针后实施）。 */
const SIDE_ITEM = '.video-page-card-small'
/**
 * 备注行的年龄门控：节点出现满 3s 且播放量数据已落定才插入。
 * 真机探针实证（tests/probe-side-inline.mjs）：挂载期 / 数据未落定时插入，B 站后续 re-patch
 * 会撞上多出来的这一行，抛 nextSibling / style 的 Vue patch TypeError（M1 同类锚点错位，
 * playinfo 数据门控单独使用无效）；满龄 + 数据落定后插入，稳态 / SPA 重渲染 / 挂载竞态全部
 * 零报错。3s 巡检天然提供这个节奏。
 */
const ROW_MIN_AGE_MS = 3000
const rowFirstSeen = new WeakMap<Element, number>()

function isSidebarAnchor(anchor: Element): boolean {
  return !!anchor.closest(SIDE_ITEM)
}

/** 侧栏三行布局：备注行插在 .upname 与 .playinfo 之间（只追加自有节点，不改不删既有节点） */
function ensureSidebarRow(anchor: Element, record: UserRecord, options: BadgeOptions): void {
  const upname = anchor.closest('.upname')
  const info = upname?.parentElement
  if (!upname || !info) return

  // 记录被清空 → 撤行（记录被删除的场景由 pruneSidebarRows 统一处理）
  if (!record.remark && !record.tags.length) {
    info.querySelector(':scope > .brmk-card-badge-row')?.remove()
    return
  }
  // 年龄门控：首次见到只登记时间戳，下一轮巡检（≥3s 后）才插
  const now = Date.now()
  const born = rowFirstSeen.get(upname)
  if (born === undefined) {
    rowFirstSeen.set(upname, now)
    return
  }
  if (now - born < ROW_MIN_AGE_MS) return
  // 数据门控：播放量行有内容说明该卡片的数据已落定
  const play = info.querySelector('.playinfo')
  if (!play || !play.textContent?.trim()) return

  const sig = badgeSignature(record, options)
  const existing = info.querySelector<HTMLDivElement>(':scope > .brmk-card-badge-row')
  if (!existing) {
    const row = h('div', 'brmk-card-badge-row')
    // 行自身必须带 mid：pruneSidebarRows 靠它对账，缺失会让每轮巡检把行删掉重建（闪烁，已修）
    row.setAttribute('data-brmk-mid', record.mid)
    row.appendChild(buildBadgeElement(record, options))
    const next = upname.nextElementSibling
    try {
      info.insertBefore(row, next)
    } catch {
      row.remove()
      return
    }
  } else if (existing.firstElementChild?.getAttribute('data-brmk-sig') !== sig) {
    const fresh = buildBadgeElement(record, options)
    const old = existing.firstElementChild
    if (old) existing.replaceChild(fresh, old)
    else existing.appendChild(fresh)
  }
}

/** 记录被删除后撤掉对应的备注行（行不在 portal 里，pruneBadges 管不到） */
function pruneSidebarRows(): void {
  for (const row of qsa('.brmk-card-badge-row')) {
    const rec = store.get(row.getAttribute('data-brmk-mid') ?? '')
    if (!rec || (!rec.remark && !rec.tags.length)) row.remove()
  }
}

/** 撤掉全部卡片内备注行（场景开关关闭 / 全局暂停时） */
function clearSidebarRows(): void {
  for (const row of qsa('.brmk-card-badge-row')) row.remove()
}

/** 昵称快照：锚点是链接，textContent 可能带日期尾巴，优先取内部纯昵称元素 */
function nicknameOf(anchor: Element): string {
  const inner = qs('span.bili-video-card__info--author, span.name', anchor)
  return snapshotNickname(inner ?? anchor)
}

interface CardTarget {
  anchor: Element
  mid: string
  nickname: string
  /** 首页/搜索网格卡：徽标摆到作者行下方（portal place=below）；右栏为 false */
  below: boolean
}

/** 已绑过按需铅笔 hover 的锚点（WeakSet 记绑定状态，与 badge.ts 的 anchorBound 同款；不往 B 站元素上写属性） */
const lazyBound = new WeakSet<Element>()

/** 未备注锚点的按需铅笔：首次 hover 才建（ensurePencil 幂等，徽标存在时自动 no-op） */
function bindLazyPencil(anchor: Element, mid: string, nickname: string): void {
  if (lazyBound.has(anchor)) return
  lazyBound.add(anchor)
  anchor.addEventListener('mouseenter', () => {
    if (!anchor.isConnected) return
    ensurePencil(anchor, mid, nickname, 'card')
    showPencil(anchor)
  })
}

function pickTargets(): {
  targets: CardTarget[]
  hits: { selector: string; hits: number }[]
  /** 页面上的候选锚点总数（含已终态跳过的）；doctor 判「页面没锚点」用原始数 */
  raw: number
  /** 本轮实际考察过的锚点数（排除终态跳过） */
  considered: number
} {
  const hits: { selector: string; hits: number }[] = []
  const targets: CardTarget[] = []
  const seen = new Set<Element>()
  let raw = 0
  let considered = 0

  for (let ci = 0; ci < CANDIDATES.length; ci++) {
    const selector = CANDIDATES[ci]
    const all = qsa(selector)
    raw += all.length
    hits.push({ selector, hits: all.length })
    for (const el of all) {
      if (isSettled(el)) continue
      considered++
      if (!isVisible(el) || seen.has(el)) continue
      seen.add(el)
      // 骨架卡 / 失效占位项没有 owner 链接 → resolve 返回 null 自然跳过，水合后由巡检补上
      const resolved = resolveFromElement(el)
      if (!resolved) continue
      // 同一 UP 的嵌套锚点只保留最内层（候选互斥之外的双保险）；不同卡片同 UP 各自保留
      const dup = targets.some(
        (t) => t.mid === resolved.mid && (t.anchor.contains(el) || el.contains(t.anchor)),
      )
      if (dup) continue
      targets.push({ anchor: el, mid: resolved.mid, nickname: nicknameOf(el), below: ci === 0 })
    }
  }

  return { targets, hits, raw, considered }
}

function inject(targets: CardTarget[]): number {
  const opts = { ...badgeOptions(), scene: 'card' as const }
  let injected = 0

  for (const target of targets) {
    if (!target.anchor.isConnected) continue
    rememberNick(target.mid, target.nickname)
    const record = store.get(target.mid)
    if (record) {
      // 同一 UP 的多张卡各自挂徽标（按锚点幂等），不做 mid 去重
      if (isSidebarAnchor(target.anchor)) {
        // 侧栏行内联进 B 站容器（会被重渲染 wipe），不登记终态，巡检每轮重申
        ensureSidebarRow(target.anchor, record, opts)
        injected++
      } else if (renderBadge(target.anchor, record, target.below ? { ...opts, placeBelow: true } : opts)) {
        markSettled(target.anchor)
        injected++
      }
    } else {
      bindLazyPencil(target.anchor, target.mid, target.nickname)
      markSettled(target.anchor)
    }
  }
  return injected
}

export function scanCards(): SceneDiagnostic {
  const { targets, hits, raw, considered } = pickTargets()
  let injected = 0
  if (getSettings().scenes.card && getSettings().enabled) {
    pruneSidebarRows()
    injected = inject(targets)
  }
  const diag: SceneDiagnostic = {
    scene: 'card',
    label: '视频卡片',
    selectors: hits,
    midResolved: targets.length,
    injected,
    notes: [],
  }
  // 页面全无锚点 → 结构变了；有锚点但全已终态 → 正常静止，不算异常
  if ((!raw || considered > 0) && !targets.length) {
    diag.notes.push('未找到卡片 UP 主锚点（可能尚未水合、不是卡片页或结构已变）')
  }
  setDiagnostic(diag)
  return diag
}

/** 关闭场景时移除本场景的铅笔与卡片内备注行（按场景清理，不影响同页的其它场景） */
export function clearCardPencils(): void {
  clearPencilsOfScene('card')
  clearSidebarRows()
}

/** 全局暂停（settings.enabled=false）时由 main.ts 调用：浮层由 clearAll 清，行在这里清 */
export function clearCardInline(): void {
  clearSidebarRows()
}
