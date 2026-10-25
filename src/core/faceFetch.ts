import { on } from './bus'
import { log } from '../util/log'
import { faceOf } from './runtime'
import { store } from './store'

/**
 * 旧数据头像补全：faceSnapshot 是后加的字段，早期备注没有。两个来源：
 * - 主动（管理页）：对当前页缺头像的记录调 B 站公开接口，限速串行，失败进冷却避免反复打。
 * - 被动（浏览时）：适配器 rememberFace 学到的头像，延迟批量落库给已有备注补缺。
 * 隐私约束：只在 bilibili 域名页面下发起请求（夹具/调试环境不发），且只补已有备注的 mid。
 */

const CARD_API = 'https://api.bilibili.com/x/user/card'
const FAIL_COOLDOWN_MS = 10 * 60 * 1000
const QUEUE_GAP_MS = 300
const SEEN_FLUSH_MS = 2000

function onBilibili(): boolean {
  return /(^|\.)bilibili\.com$/i.test(location.hostname)
}

function gmGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 10000,
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText))
          } catch (err) {
            reject(err)
          }
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('请求超时')),
      })
      return
    }
    // 降级：bilibili 子域页面对 api.bilibili.com 的 GET 通常放行 CORS
    fetch(url, { credentials: 'include' })
      .then((res) => res.json())
      .then(resolve, reject)
  })
}

const inflight = new Map<string, Promise<string | null>>()
const failedAt = new Map<string, number>()

export async function fetchFace(mid: string): Promise<string | null> {
  if (!onBilibili()) return null
  const pending = inflight.get(mid)
  if (pending) return pending
  const lastFail = failedAt.get(mid)
  if (lastFail && Date.now() - lastFail < FAIL_COOLDOWN_MS) return null
  const task = (async () => {
    try {
      const json = (await gmGetJson(`${CARD_API}?mid=${encodeURIComponent(mid)}`)) as {
        code?: number
        data?: { face?: unknown }
      }
      if (json?.code !== 0) throw new Error(`接口返回 code=${json?.code}`)
      const face = typeof json.data?.face === 'string' ? json.data.face : ''
      if (!/^https?:\/\//.test(face)) throw new Error('返回无头像')
      failedAt.delete(mid)
      return face
    } catch (err) {
      failedAt.set(mid, Date.now())
      log(`头像补全失败 mid=${mid}`, err)
      return null
    } finally {
      inflight.delete(mid)
    }
  })()
  inflight.set(mid, task)
  return task
}

// ---- 主动补全队列（管理页懒加载） ----

const queue: string[] = []
let draining = false
const pendingPatch = new Map<string, string>()

function shouldBackfill(mid: string): boolean {
  const rec = store.get(mid)
  if (!rec || rec.faceSnapshot) return false
  if (inflight.has(mid)) return false
  const lastFail = failedAt.get(mid)
  return !(lastFail && Date.now() - lastFail < FAIL_COOLDOWN_MS)
}

/** 管理页懒加载入口：对本页缺头像的记录排队补全，队列清空后一次性落库触发刷新 */
export function requestFaceBackfill(mids: string[]): void {
  if (!onBilibili()) return
  let added = false
  for (const mid of mids) {
    if (!shouldBackfill(mid)) continue
    if (!queue.includes(mid)) {
      queue.push(mid)
      added = true
    }
  }
  if (added) void drainQueue()
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length) {
      const mid = queue.shift()!
      const face = await fetchFace(mid)
      if (face) pendingPatch.set(mid, face)
      if (queue.length) await new Promise((r) => setTimeout(r, QUEUE_GAP_MS))
    }
  } finally {
    draining = false
  }
  flushPendingPatch()
}

function flushPendingPatch(): void {
  if (!pendingPatch.size) return
  const map = new Map(pendingPatch)
  pendingPatch.clear()
  store.patchFaces(map)
}

// ---- 被动回填（浏览时） ----

const seenFaces = new Map<string, string>()
let seenTimer: ReturnType<typeof setTimeout> | null = null

/** boot 时调用：适配器每学到新头像（face-seen）就记账，停顿后批量补进已有备注 */
export function initFaceBackfill(): void {
  on('face-seen', (payload) => {
    const mid = (payload as { mid?: unknown } | undefined)?.mid
    if (typeof mid !== 'string') return
    if (!shouldBackfill(mid)) return
    const face = faceOf(mid)
    if (!face) return
    seenFaces.set(mid, face)
    if (seenTimer !== null) return
    seenTimer = setTimeout(() => {
      seenTimer = null
      const map = new Map(seenFaces)
      seenFaces.clear()
      store.patchFaces(map)
    }, SEEN_FLUSH_MS)
  })
}
