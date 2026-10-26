import { getSettings } from '../core/config'
import { readableBadgeColor } from '../core/env'
import { store } from '../core/store'
import type { SceneKey, UserRecord } from '../core/types'
import { h } from '../util/dom'
import { icon } from './icons'
import { openEditor } from './editor'
import * as portal from './portal'
import { ensureShadowStyle, getTheme } from './theme'

export interface BadgeOptions {
  showTags: boolean
  showColorDot: boolean
  maxTags: number
  showOnHoverOnly: boolean
  scene?: SceneKey
  /** 徽标摆到锚点行下方、与锚点左缘对齐（首页/搜索卡片专用；portal 按 data-brmk-place 选址） */
  placeBelow?: boolean
  /** 徽标贴锚点文字右侧同行（关系卡专用：锚点是块级全宽元素，portal 用 Range 量末行文字右缘定位，
   *  宽度收敛在父容器右缘、永不落下方——空间不足按 tight → maxWidth 收缩） */
  placeInline?: boolean
  /** 内联徽标与锚点（昵称）的左边距 px；不传用主题 .brmk-inline 默认 5px（私信行 6px） */
  inlineGap?: number
}

interface PencilMeta {
  mid: string
  nickname: string
  scene?: SceneKey
}

const pencilMeta = new WeakMap<Element, PencilMeta>()
/** 已经绑过 hover 事件的目标元素（锚点），避免每轮巡检重复绑定 */
const anchorBound = new WeakSet<Element>()
/** 已经绑过事件的铅笔元素（节点可能被重建，所以要按元素而不是按锚点记） */
const pencilBound = new WeakSet<Element>()
const hideTimers = new WeakMap<Element, number>()
const HIDE_DELAY = 220

/**
 * 已终态锚点登记（代际 WeakMap）：已挂 portal 徽标 / 已绑按需铅笔的锚点，扫描时跳过其
 * isVisible 布局读与 mid 解析（长列表页每轮巡检省掉上百次强制布局查询）。
 * - 代际失效：data / settings / theme 任一变化会改变「该锚点什么表现」→ settleGen+1，
 *   全部旧登记作废、全量重估（WeakMap 无法 clear，用代际号比对实现 O(1) 重置）。
 * - 只登记 portal 挂法的锚点：浮层在我们自己的 #brmk-layer 里，B 站重渲染 wipe 不掉；
 *   内联进 B 站容器的徽标（评论区 / 私信行 / 侧栏行）会被页面重渲染挤掉，必须每轮
 *   巡检重申，一律不登记。锚点元素被页面替换时是新对象，天然不在登记里。
 */
let settleGen = 0
const settledAt = new WeakMap<Element, number>()

export function markSettled(anchor: Element): void {
  settledAt.set(anchor, settleGen)
}

export function isSettled(anchor: Element): boolean {
  return settledAt.get(anchor) === settleGen
}

export function resetSettledAnchors(): void {
  settleGen++
}

function buildBadgeContent(badge: HTMLElement, record: UserRecord, options: BadgeOptions): void {
  badge.textContent = ''
  if (options.showColorDot) {
    badge.appendChild(h('span', 'brmk-dot'))
  }
  if (record.remark) {
    const name = h('span', 'brmk-name', record.remark)
    badge.appendChild(name)
  }
  if (options.showTags && record.tags.length) {
    const wrap = h('span', 'brmk-tags')
    const shown = options.maxTags <= 0 ? [] : record.tags.slice(0, options.maxTags)
    for (const tag of shown) wrap.appendChild(h('span', 'brmk-tag', tag))
    if (record.tags.length > shown.length) {
      wrap.appendChild(h('span', 'brmk-more', `+${record.tags.length - shown.length}`))
    }
    badge.appendChild(wrap)
  }
  const titleParts = [record.remark || record.nickSnapshot || record.mid]
  if (record.nickSnapshot) titleParts.push(`昵称：${record.nickSnapshot}`)
  titleParts.push(`mid：${record.mid}`)
  if (record.note) titleParts.push(record.note.length > 300 ? record.note.slice(0, 300) + '…' : record.note)
  badge.title = titleParts.join('\n')
}

function createBadge(mid: string, options: BadgeOptions): HTMLElement {
  const badge = h('span', 'brmk-badge')
  badge.setAttribute('role', 'button')
  badge.tabIndex = 0
  if (options.placeBelow) badge.setAttribute('data-brmk-place', 'below')
  if (options.placeInline) badge.setAttribute('data-brmk-place', 'inline')
  badge.addEventListener('click', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    const id = badge.getAttribute('data-brmk-mid') || mid
    const current = store.get(id)
    if (!current) return
    openEditor({
      mid: id,
      record: current,
      anchor: badge,
      nickname: current.nickSnapshot,
      scene: options.scene,
    })
  })
  badge.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      badge.click()
    }
  })
  return badge
}

/** 幂等渲染：徽标挂在浮层里贴着锚点，不进入页面容器 */
export function renderBadge(anchor: Element, record: UserRecord, options: BadgeOptions): HTMLElement | null {
  if (!record.remark && !record.tags.length) {
    removeBadge(record.mid)
    return null
  }
  if (!anchor.isConnected) return null

  let badge = portal.get(anchor, 'badge')
  if (!badge) {
    badge = createBadge(record.mid, options)
    portal.attach(anchor, 'badge', badge)
  }
  paintBadge(badge, record, options)

  // 已经备注了就不需要铅笔入口
  portal.detach(anchor, 'pencil')
  portal.refresh()
  return badge
}

/** 徽标内容签名（卡片内备注行用它判断巡检间是否需要重建 DOM） */
export function badgeSignature(record: UserRecord, options: BadgeOptions): string {
  return [
    record.remark,
    record.tags.join('\u0001'),
    record.color ?? '',
    record.note,
    record.nickSnapshot,
    options.showTags ? 1 : 0,
    options.showColorDot ? 1 : 0,
    options.maxTags,
    options.showOnHoverOnly ? 1 : 0,
    getTheme().color,
  ].join('\u0002')
}

/** 徽标内容与外观的公共部分（portal / 内联 / 卡片内备注行三种挂法共用） */
function paintBadge(badge: HTMLElement, record: UserRecord, options: BadgeOptions): void {
  badge.setAttribute('data-brmk-mid', record.mid)
  badge.style.setProperty('--brmk-c', readableBadgeColor(record.color ?? getTheme().color, getTheme().dark))
  badge.classList.toggle('brmk-hover-only', !!options.showOnHoverOnly)

  // 内容没变就不重建 DOM，避免每轮巡检都产生无意义的节点抖动
  const signature = badgeSignature(record, options)
  if (badge.dataset.brmkSig !== signature) {
    buildBadgeContent(badge, record, options)
    badge.dataset.brmkSig = signature
  }
}

/** 构造填好内容的徽标元素（不挂浮层、不进文档流）——S5 视频页右栏的「卡片内备注行」复用 */
export function buildBadgeElement(record: UserRecord, options: BadgeOptions): HTMLElement {
  const badge = createBadge(record.mid, options)
  paintBadge(badge, record, options)
  return badge
}

/**
 * 内联徽标：插到 reference 元素之后、随文档流排布（评论区「昵称和等级之间」专用）。
 * 必须进文档流：夹在两个原生元素之间靠文档流把后面的元素推开，浮层悬盖做不到。
 * 只进 user-info 的 shadow 树（Lit 组件对外来节点容忍），页面容器仍然零插入。
 */
const inlineBadges = new Set<HTMLElement>()

export function renderInlineBadge(reference: Element, record: UserRecord, options: BadgeOptions): HTMLElement | null {
  if (!record.remark && !record.tags.length) {
    removeBadge(record.mid)
    return null
  }
  const parent = reference.parentElement
  if (!parent || !reference.isConnected) return null
  const root = reference.getRootNode()
  if (root instanceof ShadowRoot) ensureShadowStyle(root)

  let badge = parent.querySelector<HTMLElement>(':scope > .brmk-badge')
  if (badge && badge.getAttribute('data-brmk-mid') !== record.mid) {
    badge.remove()
    inlineBadges.delete(badge)
    badge = null
  }
  if (!badge) {
    badge = createBadge(record.mid, options)
    badge.classList.add('brmk-inline')
    inlineBadges.add(badge)
  }
  // 被组件重渲染挤走时搬回原位；已在原位时不动（避免无意义的 mutation 自激扫描）
  if (badge.previousElementSibling !== reference) reference.after(badge)
  badge.style.marginLeft = options.inlineGap ? `${options.inlineGap}px` : ''
  paintBadge(badge, record, options)
  // 已经备注了就不需要铅笔入口（与 renderBadge 同规则；铅笔常锚在同一昵称元素上）
  portal.detach(reference, 'pencil')
  portal.refresh()
  return badge
}

export function removeBadge(mid: string): void {
  for (const el of portal.list('badge')) {
    if (el.getAttribute('data-brmk-mid') === mid) portal.removeEl(el)
  }
  for (const el of inlineBadges) {
    if (el.getAttribute('data-brmk-mid') === mid) {
      el.remove()
      inlineBadges.delete(el)
    }
  }
}

/** 显示锚点旁的铅笔（供 S5 卡片场景的按需铅笔在首次 hover 创建后立即显示） */
export function showPencil(anchor: Element): void {
  const timer = hideTimers.get(anchor)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    hideTimers.delete(anchor)
  }
  portal.get(anchor, 'pencil')?.classList.add('brmk-pencil-on')
}

function hidePencilSoon(anchor: Element): void {
  const timer = hideTimers.get(anchor)
  if (timer !== undefined) window.clearTimeout(timer)
  hideTimers.set(
    anchor,
    window.setTimeout(() => {
      hideTimers.delete(anchor)
      portal.get(anchor, 'pencil')?.classList.remove('brmk-pencil-on')
    }, HIDE_DELAY),
  )
}

/**
 * 未备注用户的 hover 铅笔入口：默认隐藏，锚点 hover 时出现在锚点旁边（浮层里）。
 * 鼠标从昵称移向铅笔会先触发 mouseleave，所以用「延迟隐藏 + 铅笔自身 hover 取消」。
 * placeInline（关系卡）：铅笔同样贴锚点文字右侧同行（portal inline 选址）。
 */
export function ensurePencil(
  anchor: Element,
  mid: string,
  nickname: string,
  scene?: SceneKey,
  placeInline = false,
): void {
  if (!anchor.isConnected) return
  if (portal.get(anchor, 'badge')) return

  let pencil = portal.get(anchor, 'pencil')
  if (!pencil) {
    const btn = h('button', 'brmk-pencil')
    btn.type = 'button'
    btn.title = '给 TA 加备注'
    btn.setAttribute('aria-label', '给 TA 加备注')
    if (placeInline) btn.setAttribute('data-brmk-place', 'inline')
    btn.appendChild(icon('pencil', 9))
    portal.attach(anchor, 'pencil', btn)
    pencil = btn
  }
  pencilMeta.set(pencil, { mid, nickname, scene })

  if (!pencilBound.has(pencil)) {
    pencilBound.add(pencil)
    pencil.addEventListener('mouseenter', () => showPencil(anchor))
    pencil.addEventListener('mouseleave', () => hidePencilSoon(anchor))
    pencil.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const meta = pencilMeta.get(pencil)
      if (!meta) return
      openEditor({ mid: meta.mid, anchor: pencil, nickname: meta.nickname, scene: meta.scene })
    })
  }

  if (!anchorBound.has(anchor)) {
    anchorBound.add(anchor)
    anchor.addEventListener('mouseenter', () => showPencil(anchor))
    anchor.addEventListener('mouseleave', () => hidePencilSoon(anchor))
    anchor.addEventListener('focus', () => showPencil(anchor))
    anchor.addEventListener('blur', () => hidePencilSoon(anchor))
    // 父容器内移动也保持可见（部分页面的昵称与等级是分开的兄弟节点）
    anchor.parentElement?.addEventListener('mouseleave', () => hidePencilSoon(anchor))
  }

  portal.refresh()
}

/** 数据变更后清理孤儿徽标（记录被删掉的情况） */
export function pruneBadges(): void {
  for (const el of portal.list('badge')) {
    const mid = el.getAttribute('data-brmk-mid') ?? ''
    const rec = store.get(mid)
    if (!rec || (!rec.remark && !rec.tags.length)) portal.removeEl(el)
  }
  for (const el of inlineBadges) {
    if (!el.isConnected) {
      inlineBadges.delete(el)
      continue
    }
    const mid = el.getAttribute('data-brmk-mid') ?? ''
    const rec = store.get(mid)
    if (!rec || (!rec.remark && !rec.tags.length)) {
      el.remove()
      inlineBadges.delete(el)
    }
  }
}

/**
 * 按场景清理铅笔入口（场景开关关闭时）。
 * 必须按 scene 区分：portal.clearSlot('pencil') 会把其它场景的铅笔一起清掉，
 * 多场景共存时（如 opus 页动态作者 + 评论区）会让巡检每轮删掉重建，hover 到一半铅笔消失。
 */
export function clearPencilsOfScene(scene: SceneKey): void {
  for (const el of portal.list('pencil')) {
    if (pencilMeta.get(el)?.scene === scene) portal.removeEl(el)
  }
}

/** 当前页面上已注入的徽标数量（体检用） */
export function badgeCount(): number {
  let count = portal.count('badge')
  for (const el of inlineBadges) {
    if (el.isConnected) count++
    else inlineBadges.delete(el)
  }
  return count
}

/** 清空所有注入的徽标与铅笔（路由变化 / 关闭场景） */
export function clearAll(): void {
  portal.clear()
  for (const el of inlineBadges) el.remove()
  inlineBadges.clear()
}

export function badgeOptions(): BadgeOptions {
  const s = getSettings().display
  return {
    showTags: s.showTags,
    showColorDot: s.showColorDot,
    maxTags: s.maxTags,
    showOnHoverOnly: s.showOnHoverOnly,
  }
}
