/** DOM 小工具：全部只读操作，除自身节点插入外不触碰页面既有节点。 */

export function qs<T extends Element = Element>(sel: string, root: ParentNode = document): T | null {
  try {
    return root.querySelector<T>(sel)
  } catch {
    return null
  }
}

export function qsa<T extends Element = Element>(sel: string, root: ParentNode = document): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(sel))
  } catch {
    return []
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 只写 textContent，绝不拼 innerHTML */
export function setText(node: Element, text: string): void {
  node.textContent = text
}

export function truncate(text: string, max: number): string {
  const s = text ?? ''
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, wait)
  }
}

export function throttle<T extends (...args: never[]) => void>(fn: T, wait: number): (...args: Parameters<T>) => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    const now = Date.now()
    const remain = wait - (now - last)
    if (remain <= 0) {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      last = now
      fn(...args)
    } else if (timer === null) {
      timer = setTimeout(() => {
        last = Date.now()
        timer = null
        fn(...args)
      }, remain)
    }
  }
}

export function isVisible(el: Element | null): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  if (r.width <= 0 && r.height <= 0) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none'
}

/** 跨 Shadow 边界向上查找最近匹配元素 */
export function closestDeep(node: Node | null, selector: string): Element | null {
  let cur: Node | null = node
  let guard = 0
  while (cur && guard++ < 64) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const hit = (cur as Element).closest(selector)
      if (hit) return hit
    }
    const parent: Node | null = cur.parentNode
    if (parent) {
      cur = parent
      continue
    }
    const host = (cur as ShadowRoot).host
    cur = host ?? null
  }
  return null
}

export interface DeepQueryOptions {
  maxDepth?: number
  limit?: number
}

/** 递归下钻 shadowRoot 的查询（含 root 自身） */
export function queryDeepAll(root: ParentNode, selector: string, opts: DeepQueryOptions = {}): Element[] {
  const maxDepth = opts.maxDepth ?? 8
  const limit = opts.limit ?? 500
  const out: Element[] = []
  const seen = new Set<ShadowRoot>()

  const walk = (scope: ParentNode, depth: number): void => {
    if (out.length >= limit || depth > maxDepth) return
    out.push(...qsa(selector, scope))
    if (out.length >= limit) return
    const elems = qsa('*', scope)
    for (const el of elems) {
      if (out.length >= limit) break
      const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot
      if (sr && !seen.has(sr)) {
        seen.add(sr)
        walk(sr, depth + 1)
      }
    }
  }

  walk(root, 0)
  return out.slice(0, limit)
}

/** 收集节点所在的 shadow root 链（用于样式注入） */
export function shadowRootsOf(node: Node): ShadowRoot[] {
  const roots: ShadowRoot[] = []
  let cur: Node | null = node
  let guard = 0
  while (cur && guard++ < 64) {
    if (cur instanceof ShadowRoot) roots.push(cur)
    const parent: Node | null = cur.parentNode
    if (parent) {
      cur = parent
      continue
    }
    cur = (cur as ShadowRoot).host ?? null
  }
  return roots
}

export function rectOf(el: Element): DOMRect {
  return el.getBoundingClientRect()
}

/** 简单事件委托封装，返回解绑函数；始终非捕获、不阻断冒泡 */
export function listen<K extends keyof DocumentEventMap>(
  target: Document | Window | HTMLElement,
  type: K,
  handler: (ev: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler as EventListener, options)
  return () => target.removeEventListener(type, handler as EventListener, options)
}
