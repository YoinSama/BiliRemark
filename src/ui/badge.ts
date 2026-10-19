import { getSettings } from '../core/config'
import { store } from '../core/store'
import type { SceneKey, UserRecord } from '../core/types'
import { h } from '../util/dom'
import { icon } from './icons'
import { openEditor } from './editor'
import { ensureShadowStyle, getTheme } from './theme'

export interface BadgeOptions {
  showTags: boolean
  showColorDot: boolean
  maxTags: number
  showOnHoverOnly: boolean
  scene?: SceneKey
}

const pencilBound = new WeakSet<Element>()

function badgeSelector(mid: string): string {
  return `.brmk-badge[data-brmk-mid="${mid}"]`
}

function findNextBadge(anchor: Element): HTMLElement | null {
  let node: Element | null = anchor.nextElementSibling
  let guard = 0
  while (node && guard++ < 4) {
    if (node.classList.contains('brmk-badge')) return node as HTMLElement
    node = node.nextElementSibling
  }
  return null
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

/** 幂等渲染：已有就更新内容，没有就插在锚点后面 */
export function renderBadge(anchor: Element, record: UserRecord, options: BadgeOptions): HTMLElement | null {
  if (!record.remark && !record.tags.length) {
    removeBadge(record.mid)
    return null
  }
  if (!anchor.isConnected) return null

  const rootNode = anchor.getRootNode()
  if (rootNode instanceof ShadowRoot) ensureShadowStyle(rootNode)

  let badge = findNextBadge(anchor)
  if (!badge) {
    badge = h('span', 'brmk-badge')
    badge.setAttribute('data-brmk-mid', record.mid)
    badge.setAttribute('role', 'button')
    badge.tabIndex = 0
    badge.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      openEditor({
        mid: record.mid,
        record: store.get(record.mid) ?? record,
        anchor: badge,
        nickname: record.nickSnapshot,
        scene: options.scene,
      })
    })
    badge.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        badge?.click()
      }
    })
    anchor.insertAdjacentElement('afterend', badge)
  }

  badge.setAttribute('data-brmk-mid', record.mid)
  badge.style.setProperty('--brmk-c', record.color ?? getTheme().color)
  badge.classList.toggle('brmk-hover-only', !!options.showOnHoverOnly)

  // 内容没变就不重建 DOM，避免每轮巡检都产生无意义的节点抖动
  const signature = [
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
  if (badge.dataset.brmkSig !== signature) {
    buildBadgeContent(badge, record, options)
    badge.dataset.brmkSig = signature
  }

  // 已经备注了就不需要铅笔入口
  let sibling: Element | null = anchor.nextElementSibling
  let guard = 0
  while (sibling && guard++ < 4) {
    const next: Element | null = sibling.nextElementSibling
    if (sibling.classList.contains('brmk-pencil')) sibling.remove()
    sibling = next
  }
  return badge
}

export function removeBadge(mid: string): void {
  for (const el of Array.from(document.querySelectorAll(badgeSelector(mid)))) el.remove()
}

/**
 * 未备注用户的 hover 铅笔入口：只在锚点 hover 时出现，不占视觉空间。
 * 注意：铅笔是昵称的兄弟节点，鼠标从昵称移到铅笔会先触发 mouseleave，
 * 所以这里用「延迟隐藏 + 铅笔自身 hover 取消隐藏」避免按钮点不到。
 */
export function ensurePencil(anchor: Element, mid: string, nickname: string, scene?: SceneKey): void {
  if (!anchor.isConnected) return
  const existing = findNextBadge(anchor)
  if (existing) return

  const HIDE_DELAY = 220
  const timers = new WeakMap<Element, number>()

  const pencilOf = (): HTMLElement | null => {
    const next = anchor.nextElementSibling
    return next && next.classList.contains('brmk-pencil') ? (next as HTMLElement) : null
  }
  const cancelHide = (): void => {
    const timer = timers.get(anchor)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.delete(anchor)
    }
  }
  const show = (): void => {
    cancelHide()
    pencilOf()?.classList.add('brmk-pencil-on')
  }
  const scheduleHide = (): void => {
    cancelHide()
    const timer = window.setTimeout(() => {
      timers.delete(anchor)
      pencilOf()?.classList.remove('brmk-pencil-on')
    }, HIDE_DELAY)
    timers.set(anchor, timer)
  }

  let pencil = pencilOf()
  if (!pencil) {
    const btn = h('button', 'brmk-pencil')
    btn.type = 'button'
    btn.title = '给 TA 加备注'
    btn.setAttribute('aria-label', '给 TA 加备注')
    btn.appendChild(icon('pencil', 9))
    btn.addEventListener('mouseenter', show)
    btn.addEventListener('mouseleave', scheduleHide)
    btn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      openEditor({ mid, anchor: btn, nickname, scene })
    })
    anchor.insertAdjacentElement('afterend', btn)
    pencil = btn
  }

  if (!pencilBound.has(anchor)) {
    pencilBound.add(anchor)
    anchor.addEventListener('mouseenter', show)
    anchor.addEventListener('mouseleave', scheduleHide)
    anchor.addEventListener('focus', show)
    anchor.addEventListener('blur', scheduleHide)
    // 父容器内移动也保持可见（部分页面的昵称与等级是分开的兄弟节点）
    anchor.parentElement?.addEventListener('mouseleave', scheduleHide)
  }
}

/** 数据变更后清理孤儿徽标（记录被删掉的情况） */
export function pruneBadges(): void {
  for (const el of Array.from(document.querySelectorAll('.brmk-badge[data-brmk-mid]'))) {
    const mid = el.getAttribute('data-brmk-mid') ?? ''
    const rec = store.get(mid)
    if (!rec || (!rec.remark && !rec.tags.length)) el.remove()
  }
}

/** 当前页面上已注入的徽标数量（体检用） */
export function badgeCount(): number {
  return document.querySelectorAll('.brmk-badge[data-brmk-mid]').length
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
