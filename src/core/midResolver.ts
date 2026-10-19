import { closestDeep, queryDeepAll } from '../util/dom'
import { log } from '../util/log'

const MID_RE = /space\.bilibili\.com\/(\d{1,20})/

export type MidSource = 'attr' | 'href' | 'descendant' | 'state' | 'url'

export interface ResolvedMid {
  mid: string
  source: MidSource
}

export function midFromHref(href: string | null | undefined): string | null {
  if (!href) return null
  const m = MID_RE.exec(href)
  return m ? m[1] : null
}

export function isSpaceHref(href: string | null | undefined): boolean {
  return !!href && /(^|\/\/)space\.bilibili\.com\//.test(href)
}

const MID_ATTRS = ['data-mid', 'data-user-id', 'data-uid', 'data-userid']

/** 从元素自身属性取 mid（B 站部分组件会带 data-mid） */
function midFromAttrs(el: Element): string | null {
  for (const attr of MID_ATTRS) {
    const v = el.getAttribute(attr)
    if (v && /^\d{1,20}$/.test(v.trim()) && v.trim() !== '0') return v.trim()
  }
  return null
}

export interface ResolveOptions {
  /** 是否下钻子树找链接（对容器节点才需要，逐元素调用时关闭更省） */
  allowDescendant?: boolean
}

export function resolveFromElement(el: Element, opts: ResolveOptions = {}): ResolvedMid | null {
  const own = midFromAttrs(el)
  if (own) return { mid: own, source: 'attr' }

  const selfHref = el.getAttribute('href')
  const selfMid = midFromHref(selfHref)
  if (selfMid) return { mid: selfMid, source: 'href' }

  const link = closestDeep(el, 'a[href*="space.bilibili.com/"]')
  if (link) {
    const mid = midFromHref(link.getAttribute('href'))
    if (mid) return { mid, source: 'href' }
  }

  // 祖先上可能挂着 data-mid（如 bili-comment-renderer）
  const attrHost = closestDeep(el, '[data-mid], [data-user-id], [data-uid], [data-userid]')
  if (attrHost) {
    const mid = midFromAttrs(attrHost)
    if (mid) return { mid, source: 'attr' }
  }

  if (opts.allowDescendant !== false) {
    for (const a of queryDeepAll(el, 'a[href*="space.bilibili.com/"]', { maxDepth: 4, limit: 10 })) {
      const mid = midFromHref(a.getAttribute('href'))
      if (mid) return { mid, source: 'descendant' }
    }
  }

  return null
}

function pageWindow(): Record<string, any> | null {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow as unknown as Record<string, any>
  } catch {
    /* ignore */
  }
  try {
    return window as unknown as Record<string, any>
  } catch {
    return null
  }
}

function pickMid(value: unknown): string | null {
  if (typeof value === 'number') {
    const s = String(value)
    return /^\d{1,20}$/.test(s) && s !== '0' ? s : null
  }
  if (typeof value === 'string' && /^\d{1,20}$/.test(value.trim()) && value.trim() !== '0') return value.trim()
  return null
}

/** L1：页面全局状态里的 UP 主 mid（视频页 / 番剧页 / 空间页） */
export function pageUpMid(): string | null {
  const w = pageWindow()
  if (!w) return null
  try {
    const s = w.__INITIAL_STATE__
    if (!s || typeof s !== 'object') return null
    const candidates = [
      s.upData?.mid,
      s.upData?.midNum,
      s.videoData?.owner?.mid,
      s.videoData?.upInfo?.mid,
      s.mediaInfo?.up_info?.mid,
      s.epInfo?.up_info?.mid,
      s.upInfo?.mid,
    ]
    for (const c of candidates) {
      const mid = pickMid(c)
      if (mid) return mid
    }
  } catch (err) {
    log('读取页面状态失败', err)
  }
  return null
}

/** L1.5：页面状态里的 UP 主昵称（用于快照） */
export function pageUpName(): string {
  const w = pageWindow()
  if (!w) return ''
  try {
    const s = w.__INITIAL_STATE__
    const name =
      s?.upData?.name ?? s?.videoData?.owner?.name ?? s?.mediaInfo?.up_info?.uname ?? s?.epInfo?.up_info?.uname ?? ''
    return typeof name === 'string' ? name : ''
  } catch {
    return ''
  }
}

/** L2：URL 上的 mid（空间页） */
export function pageUrlMid(): string | null {
  return midFromHref(location.href)
}

/** 取锚点附近的昵称文本（快照用），只读 */
export function snapshotNickname(anchor: Element): string {
  const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 100)
}
