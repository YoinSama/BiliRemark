import { getSettings } from '../core/config'
import { store } from '../core/store'
import type { SceneKey, UserRecord } from '../core/types'
import { h } from '../util/dom'
import { icon } from './icons'
import { openEditor } from './editor'
import * as portal from './portal'
import { getTheme } from './theme'

export interface BadgeOptions {
  showTags: boolean
  showColorDot: boolean
  maxTags: number
  showOnHoverOnly: boolean
  scene?: SceneKey
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
  portal.detach(anchor, 'pencil')
  portal.refresh()
  return badge
}

export function removeBadge(mid: string): void {
  for (const el of portal.list('badge')) {
    if (el.getAttribute('data-brmk-mid') === mid) portal.removeEl(el)
  }
}

function showPencil(anchor: Element): void {
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
 */
export function ensurePencil(anchor: Element, mid: string, nickname: string, scene?: SceneKey): void {
  if (!anchor.isConnected) return
  if (portal.get(anchor, 'badge')) return

  let pencil = portal.get(anchor, 'pencil')
  if (!pencil) {
    const btn = h('button', 'brmk-pencil')
    btn.type = 'button'
    btn.title = '给 TA 加备注'
    btn.setAttribute('aria-label', '给 TA 加备注')
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
}

/** 当前页面上已注入的徽标数量（体检用） */
export function badgeCount(): number {
  return portal.count('badge')
}

/** 清空所有注入的徽标与铅笔（路由变化 / 关闭场景） */
export function clearAll(): void {
  portal.clear()
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
