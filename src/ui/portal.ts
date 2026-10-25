/**
 * 页面内浮层（portal）：徽标 / 铅笔全部挂在 body 下的 #brmk-layer 里，
 * 用绝对定位贴到目标元素旁边 —— 一个节点都不插进 B 站自己的容器。
 *
 * 为什么必须这么做：B 站视频页是 Vue 2，且部分代码按 nextSibling / childNodes
 * 下标定位兄弟节点。往容器里插一个兄弟节点会让它的 patch 落到错位的节点上
 * （实测把 <i> appendChild 到一段空白文本节点，抛 HierarchyRequestError，
 * 整条更新链中断 → 评论区 / 推荐封面 / 头像全部不挂载）。浮层方案从根上避开这类风险。
 */

export type Slot = 'badge' | 'pencil'

const SLOTS: Slot[] = ['badge', 'pencil']
/** 与锚点的间距 */
const GAP = 6
/** 还能显示点东西的最小宽度，比这窄就换位置 */
const MIN_W = 60
/** 行内挂法的底线宽度（圆点 + 约两字）：主人拍板行内永不落下方，满行极端时右对齐贴尾 */
const INLINE_MIN_W = 34
/** 离视口边缘的安全距离 */
const MARGIN = 4
/**
 * 浮层层级：必须压在正文之上、B 站自家 UI 之下（2026-10-25 真机探针 probe-nav-z/scroll/midz）：
 * 空间页吸顶导航 div.nav-bar z=99（nav-bar__main 的层叠上下文）、全局顶栏
 * .bili-header__bar z=1002（www/t fixed、space absolute）——层取 98 恰好整条线以下，
 * 徽标滚到导航栏底下时被盖住（主人要求的视觉逻辑）；10≤z≤98 区间只有播放器内部
 * 元素（bpx-player ≤91，与昵称行永不共处），正文没有更低的层需要避让。
 * 不再跟 manager.zIndex 挂钩：那是管理面板（遮罩级 UI）的层级，徽标是正文级标注。
 */
const LAYER_Z = 98
/** 布局会随图片加载 / 异步渲染变化，没有 mutation 也得重新定位 */
const POLL_MS = 200

interface AnchorSlots {
  badge: HTMLElement | null
  pencil: HTMLElement | null
}

const byAnchor = new Map<Element, AnchorSlots>()
const byEl = new WeakMap<HTMLElement, { anchor: Element; slot: Slot }>()
const lastPos = new WeakMap<HTMLElement, string>()
/** 最近一次测得的文档坐标（主文档滚动时用它做零开销可见性刷新，不重新测量） */
const docRect = new WeakMap<HTMLElement, { x: number; y: number; w: number; h: number; ok: boolean }>()

let layer: HTMLElement | null = null
let rafId = 0
let pollTimer: number | null = null
let bound = false

function ensureLayer(): HTMLElement | null {
  if (layer && layer.isConnected) return layer
  if (!document.body) return null
  let el = document.getElementById('brmk-layer')
  if (!el) {
    el = document.createElement('div')
    el.id = 'brmk-layer'
    document.body.appendChild(el)
  }
  el.style.zIndex = String(LAYER_Z)
  layer = el
  return layer
}

function onViewportChange(): void {
  schedule()
}

/**
 * 滚动分两类：
 *  - 主文档滚动：徽标的文档坐标不变，只按缓存位置刷新可见性。
 *    绝不能重新测量 + 写回定位 —— 那比滚动本身慢一帧，徽标看起来在「飘」。
 *  - 页面内部滚动容器（评论区等）：锚点的文档坐标变了，走全量重排。
 */
function onScroll(ev: Event): void {
  const t = ev.target
  if (!t || t === document || t === document.documentElement) {
    refreshVisibility()
    return
  }
  schedule()
}

/** 主文档滚动时的廉价可见性刷新：零布局读、零定位写 */
function refreshVisibility(): void {
  const sx = window.scrollX
  const sy = window.scrollY
  const vw = document.documentElement.clientWidth || window.innerWidth
  const vh = window.innerHeight
  for (const slots of byAnchor.values()) {
    for (const slot of SLOTS) {
      const el = slots[slot]
      if (!el || !el.isConnected) continue
      const c = docRect.get(el)
      if (!c || !c.ok) continue
      const off =
        c.y + c.h < sy - 8 || c.y > sy + vh + 8 || c.x + c.w < sx - 8 || c.x > sx + vw + 8
      if (off) hide(el)
      else show(el)
    }
  }
}

function bind(): void {
  if (bound) return
  bound = true
  // capture 才能收到页面内部滚动容器（评论区等）的 scroll
  window.addEventListener('scroll', onScroll, { passive: true, capture: true })
  window.addEventListener('resize', onViewportChange, { passive: true })
  try {
    window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true })
  } catch {
    /* 老浏览器没有 visualViewport */
  }
}

function ensurePoll(): void {
  if (pollTimer !== null) return
  pollTimer = window.setInterval(() => {
    if (document.hidden) return
    sync()
  }, POLL_MS)
}

function stopPoll(): void {
  if (pollTimer === null) return
  window.clearInterval(pollTimer)
  pollTimer = null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function hide(el: HTMLElement): void {
  if (el.style.visibility === 'hidden') return
  el.style.visibility = 'hidden'
  el.style.pointerEvents = 'none'
  lastPos.delete(el)
}

function show(el: HTMLElement): void {
  if (el.style.visibility !== 'hidden') return
  el.style.visibility = 'visible'
  el.style.pointerEvents = ''
}

/** 同一父容器里锚点之后的元素是否会和候选矩形撞上 */
function blockedBySibling(anchor: Element, x: number, y: number, w: number, h: number): boolean {
  const parent = anchor.parentElement
  if (!parent) return false
  const right = x + w
  const bottom = y + h
  let checked = 0
  for (const sib of Array.from(parent.children)) {
    if (sib === anchor) continue
    if (sib.classList.contains('brmk-badge') || sib.classList.contains('brmk-pencil')) continue
    if (checked++ >= 8) break
    const s = sib.getBoundingClientRect()
    if (!s.width && !s.height) continue
    if (x < s.right && right > s.left && y < s.bottom && bottom > s.top) return true
  }
  return false
}

/** 同一父容器里所有子元素的最右边界（≈ 这一行的末尾） */
function rowRightOf(anchor: Element): number {
  const own = anchor.getBoundingClientRect()
  const parent = anchor.parentElement
  if (!parent) return own.right
  let right = own.right
  let n = 0
  for (const sib of Array.from(parent.children)) {
    if (n++ >= 12) break
    const s = sib.getBoundingClientRect()
    if (s.width || s.height) right = Math.max(right, s.right)
  }
  return right
}

/**
 * 锚点内文字的行片段矩形（行内挂法专用）。
 * 关系卡的昵称锚点是块级全宽元素（rect = 整列宽），元素右缘永远没有空间；
 * 贴文字放必须量文字本体——Range 的 client rects 每行一段，
 * 取最后一段 = 末行文字右缘（原生换行的超长昵称跟在末行后）。
 */
function lastTextRect(anchor: Element): { right: number; top: number; height: number } | null {
  try {
    const range = document.createRange()
    range.selectNodeContents(anchor)
    const rects = range.getClientRects()
    if (!rects.length) return null
    const last = rects[rects.length - 1]
    return { right: last.right, top: last.top, height: last.height }
  } catch {
    return null
  }
}

/**
 * 行内挂法的右界：默认父容器右缘−2；父容器若是「收缩到内容宽」的列（dyn 标题列：
 * 名字多宽列就多宽，右缘恒贴文字、父容器内永无行内空间），向上找真正有留白、且垂直
 * 方向仍包着锚点行文字的行级祖先（≤3 层，防爬到卡片/列表级把徽标放飞到容器右缘），
 * 并以该祖先内锚点行右侧第一个原生元素左缘−GAP 为界（关注按钮 / 装扮挂件自动避让）。
 */
function inlineBoundRight(
  anchor: Element,
  parent: Element,
  lineTop: number,
  lineBottom: number,
  x: number,
): number {
  /** host 内锚点行右侧第一个原生元素左缘−GAP；obstacle=行上真有原生元素（对所有更外层都成立） */
  const rightSib = (host: Element): { bound: number; obstacle: boolean } => {
    let bound = host.getBoundingClientRect().right - 2
    let obstacle = false
    let n = 0
    for (const sib of Array.from(host.children)) {
      if (n++ >= 12 || sib.contains(anchor) || anchor.contains(sib)) continue
      const sr = sib.getBoundingClientRect()
      if (!sr.width && !sr.height) continue
      if (sr.left >= x - 1 && sr.top < lineBottom - 1 && sr.bottom > lineTop + 1) {
        bound = Math.min(bound, sr.left - GAP)
        obstacle = true
      }
    }
    return { bound, obstacle }
  }

  let { bound, obstacle } = rightSib(parent)
  if (obstacle || bound - x >= INLINE_MIN_W) return bound
  let node: Element | null = parent
  for (let i = 0; i < 3 && node; i++) {
    node = node.parentElement
    if (!node) break
    const nr = node.getBoundingClientRect()
    // 只接受行级祖先（垂直方向包住锚点行文字），否则继续上爬
    if (nr.top > lineTop + 2 || nr.bottom < lineBottom - 2) continue
    // 障碍一旦出现立即定界：更外层看不见嵌套在中间层里的右缘元素，继续爬会放飞
    const res = rightSib(node)
    if (res.obstacle) return res.bound
    if (res.bound - x >= INLINE_MIN_W) return res.bound
  }
  return bound
}

/**
 * 选址优先级：
 *   0a. 锚点行下方（仅 data-brmk-place="below" 的徽标，如首页/搜索卡片：与锚点行
 *       左缘对齐、宽度受锚点父容器约束——卡片作者行是卡片信息区的整行，下方是留白）
 *   0b. 锚点文字右侧（仅 data-brmk-place="inline"：Range 量末行文字右缘 + GAP，
 *       徽标与文字行中线对齐、宽度收敛在父容器右缘——关系卡昵称行专用，
 *       空间不足按 tight→maxWidth 收缩，永不换行到下方）
 *   1. 锚点右侧（不压住同行任何兄弟）
 *   2. 整行末尾（不压住「发消息」之类同行按钮）
 *   3. 父容器下方
 * 都不合适时退回锚点右侧并夹进视口。
 */
function place(anchor: Element, el: HTMLElement, vw: number, vh: number, lrx: number, lry: number): void {
  const r = anchor.getBoundingClientRect()
  if (!r.width && !r.height) {
    hide(el)
    docRect.set(el, { x: 0, y: 0, w: 0, h: 0, ok: false })
    return
  }
  if (r.bottom < -8 || r.top > vh + 8 || r.right < -8 || r.left > vw + 8) {
    hide(el)
    docRect.set(el, { x: 0, y: 0, w: 0, h: 0, ok: false })
    return
  }

  // 先量自然尺寸，再决定放到哪
  el.removeAttribute('data-brmk-tight')
  if (el.style.maxWidth) el.style.maxWidth = ''
  let naturalW = el.offsetWidth
  const h = el.offsetHeight
  if (!naturalW || !h) {
    hide(el)
    return
  }

  const parent = anchor.parentElement
  const pr = parent ? parent.getBoundingClientRect() : null
  const limitRight = Math.min(vw - MARGIN * 2, pr ? Math.max(pr.right - 2, r.right + MIN_W) : vw - MARGIN * 2)
  const need = Math.min(naturalW, MIN_W)
  const centeredY = Math.round(r.top + (r.height - h) / 2)

  const rightX = Math.round(r.right + GAP)
  const rowX = Math.round(rowRightOf(anchor) + GAP)

  let x: number
  let y: number
  let maxW: number
  let fits = true
  /** 收缩底线：行内挂法更小（永不落下方，压到 34px 也保持可读的圆点+两字） */
  const floorW = el.getAttribute('data-brmk-place') === 'inline' ? INLINE_MIN_W : MIN_W

  const mode = el.getAttribute('data-brmk-place')
  const wantBelow = mode === 'below' && !!pr
  const wantInline = mode === 'inline' && !!pr
  if (wantBelow) {
    x = Math.max(MARGIN, Math.round(r.left))
    y = Math.round(r.bottom + 2)
    // 卡片作者行的父容器就是卡片信息区整行，徽标宽度以它为界（超出走下方收档逻辑）
    maxW = Math.round(pr!.right - 2) - x
    if (maxW < need) {
      fits = false
      maxW = Math.max(need, vw - MARGIN * 2 - x)
    }
  } else if (wantInline) {
    // 文字右缘（块级锚点的 rect 是整列宽，不能直接用）；量不到时退元素右缘
    const text = lastTextRect(anchor) ?? { right: r.right, top: r.top, height: r.height }
    x = Math.round(text.right + GAP)
    y = Math.round(text.top + (text.height - h) / 2)
    maxW = inlineBoundRight(anchor, parent!, text.top, text.top + text.height, x) - x
    if (maxW < INLINE_MIN_W) {
      // 极端满行（找不到任何有留白的行级祖先）：右对齐到父容器右缘，有界贴行尾，绝不落下方
      maxW = INLINE_MIN_W
      x = Math.round(pr!.right - 2) - maxW
    }
  } else if (limitRight - rightX >= need && !blockedBySibling(anchor, rightX, centeredY, naturalW, h)) {
    x = rightX
    y = centeredY
    maxW = limitRight - x
  } else if (limitRight - rowX >= need) {
    x = rowX
    y = centeredY
    maxW = limitRight - x
  } else if (pr) {
    x = Math.max(MARGIN, Math.round(r.left))
    y = Math.round(pr.bottom + 2)
    maxW = Math.min(vw - MARGIN * 2 - x, pr.right - x)
    if (maxW < need) {
      fits = false
      maxW = Math.max(need, vw - MARGIN * 2 - x)
    }
  } else {
    fits = false
    x = rightX
    y = centeredY
    maxW = vw - MARGIN * 2 - x
  }

  if (naturalW > maxW) {
    // 空间不够：先让元素自己收一档（徽标会隐藏标签胶囊），收完还放不下才截断
    el.setAttribute('data-brmk-tight', '1')
    naturalW = el.offsetWidth || naturalW
    if (naturalW > maxW) el.style.maxWidth = `${Math.max(floorW, Math.floor(maxW))}px`
  }

  const width = el.offsetWidth || naturalW
  if (!fits) {
    x = clamp(x, MARGIN, vw - MARGIN * 2 - width)
    y = clamp(y, MARGIN, vh - MARGIN * 2 - h)
  } else {
    x = Math.max(MARGIN, x)
    // y 绝不夹进视口：夹了会把「锚点半出视口」的徽标硬推进视口内，恰好发生在
    // 顶/底临界滚动窗口（200ms 轮询每次都重算）——徽标脱离锚点往下挪、压到下一行
    // （主人 2026-10-25 报障：视频页 UP 备注撞签名行）。正确行为是贴死锚点随页面
    // 滚出去，滚出视口由 refreshVisibility 隐藏；被顶栏盖住由层 z-index 负责。
  }

  // 定位必须走独立的 translate 属性而不是 transform：.brmk-badge 的 transition
  // 里有 transform（按压 scale 用的），若用 transform 定位，任何写回都会被过渡拖慢。
  // 坐标系：浮层本体钉在文档原点（absolute，随页面滚动），所以 translate 取
  // 「视口坐标 − 浮层视口偏移」＝文档坐标；主文档滚动时这里完全不被调用，
  // 徽标与页面同帧移动，不存在 JS 追帧造成的飘移。
  const docX = x + window.scrollX
  const docY = y + window.scrollY
  const sig = `${docX},${docY},${width}`
  if (lastPos.get(el) !== sig) {
    el.style.translate = `${x - lrx}px ${y - lry}px`
    lastPos.set(el, sig)
  }
  docRect.set(el, { x: docX, y: docY, w: width, h, ok: true })
  show(el)
}

function sync(): void {
  if (!byAnchor.size) {
    stopPoll()
    return
  }
  const vw = document.documentElement.clientWidth || window.innerWidth
  const vh = window.innerHeight
  // 浮层自己的视口位置（每轮量一次）：它钉在文档原点附近，视口偏移即滚动补偿
  const lr = layer?.getBoundingClientRect()
  const lrx = lr ? lr.left : 0
  const lry = lr ? lr.top : 0
  const dead: Element[] = []

  for (const [anchor, slots] of byAnchor) {
    if (!anchor.isConnected) {
      dead.push(anchor)
      continue
    }
    for (const slot of SLOTS) {
      const el = slots[slot]
      if (!el) continue
      if (!el.isConnected) {
        slots[slot] = null
        byEl.delete(el)
        continue
      }
      place(anchor, el, vw, vh, lrx, lry)
    }
  }

  for (const anchor of dead) dropAnchor(anchor)
  if (!byAnchor.size) stopPoll()
}

export function schedule(): void {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    sync()
  })
}

/** 立即重排一次（内容刚变、宽度还没量到时用） */
export function refresh(): void {
  sync()
}

function slotsOf(anchor: Element, create: boolean): AnchorSlots | null {
  let slots = byAnchor.get(anchor)
  if (!slots) {
    if (!create) return null
    slots = { badge: null, pencil: null }
    byAnchor.set(anchor, slots)
  }
  return slots
}

/** 把元素挂到锚点旁边（同 slot 旧元素会被替换） */
export function attach(anchor: Element, slot: Slot, el: HTMLElement): void {
  const root = ensureLayer()
  if (!root) return
  bind()
  const slots = slotsOf(anchor, true)
  if (!slots) return
  const old = slots[slot]
  if (old && old !== el) {
    old.remove()
    byEl.delete(old)
  }
  slots[slot] = el
  byEl.set(el, { anchor, slot })
  if (el.parentElement !== root) root.appendChild(el)
  ensurePoll()
  refresh()
}

export function get(anchor: Element, slot: Slot): HTMLElement | null {
  const slots = byAnchor.get(anchor)
  const el = slots ? slots[slot] : null
  return el && el.isConnected ? el : null
}

export function detach(anchor: Element, slot: Slot): void {
  const slots = byAnchor.get(anchor)
  if (!slots) return
  const el = slots[slot]
  if (!el) return
  slots[slot] = null
  byEl.delete(el)
  el.remove()
  if (!slots.badge && !slots.pencil) byAnchor.delete(anchor)
}

/** 移除某个元素（外部误删 / 记录被删时用） */
export function removeEl(el: Element): void {
  const info = byEl.get(el as HTMLElement)
  if (info) {
    detach(info.anchor, info.slot)
    return
  }
  el.remove()
}

function dropAnchor(anchor: Element): void {
  const slots = byAnchor.get(anchor)
  if (slots) {
    for (const slot of SLOTS) {
      const el = slots[slot]
      if (el) {
        byEl.delete(el)
        el.remove()
      }
    }
  }
  byAnchor.delete(anchor)
}

/** 清掉某个 slot 的全部元素 */
export function clearSlot(slot: Slot): void {
  for (const [anchor, slots] of Array.from(byAnchor)) {
    const el = slots[slot]
    if (!el) continue
    byEl.delete(el)
    el.remove()
    slots[slot] = null
    if (!slots.badge && !slots.pencil) byAnchor.delete(anchor)
  }
  stopPollIfEmpty()
}

/** 清空浮层（路由变化 / 关闭场景 / 卸载时用） */
export function clear(): void {
  for (const anchor of Array.from(byAnchor.keys())) dropAnchor(anchor)
  byAnchor.clear()
  if (layer) layer.textContent = ''
  stopPollIfEmpty()
}

function stopPollIfEmpty(): void {
  if (!byAnchor.size) stopPoll()
}

export function list(slot: Slot): HTMLElement[] {
  if (!layer) return []
  const cls = slot === 'badge' ? '.brmk-badge' : '.brmk-pencil'
  return Array.from(layer.querySelectorAll<HTMLElement>(cls))
}

export function count(slot: Slot): number {
  return list(slot).length
}

/** 卸载：断开监听与轮询（页面不会自动调用，调试用） */
export function dispose(): void {
  clear()
  stopPoll()
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (bound) {
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onViewportChange)
    try {
      window.visualViewport?.removeEventListener('resize', onViewportChange)
    } catch {
      /* ignore */
    }
    bound = false
  }
  layer?.remove()
  layer = null
}
