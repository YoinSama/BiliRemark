export type BusEvent =
  | 'data-changed'
  | 'settings-changed'
  | 'route-changed'
  | 'theme-changed'
  | 'request-manager'
  | 'request-doctor'
  | 'enabled-changed'
  | 'face-seen'

type Handler = (payload?: unknown) => void

const handlers = new Map<BusEvent, Set<Handler>>()

export function on(event: BusEvent, fn: Handler): () => void {
  let set = handlers.get(event)
  if (!set) {
    set = new Set()
    handlers.set(event, set)
  }
  set.add(fn)
  return () => {
    set?.delete(fn)
  }
}

export function emit(event: BusEvent, payload?: unknown): void {
  const set = handlers.get(event)
  if (!set) return
  for (const fn of Array.from(set)) {
    try {
      fn(payload)
    } catch (err) {
      console.warn('[BiliRemark] 事件处理异常', event, err)
    }
  }
}
