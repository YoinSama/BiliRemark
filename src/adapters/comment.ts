import { getSettings } from '../core/config'
import { midFromHref } from '../core/midResolver'
import { faceOf, rememberFace, rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import { badgeOptions, clearPencilsOfScene, ensurePencil, renderBadge, renderInlineBadge } from '../ui/badge'
import * as portal from '../ui/portal'
import { closestDeep, queryDeepAll, qs, qsa } from '../util/dom'

/**
 * 评论区（S2）：B 站新版评论是多层 shadow DOM，结构实测见 tests/selectors.md「评论区」。
 * mid 链路：bili-comment-user-info 的 shadowRoot 里取 a[href*="space.bilibili.com/"]
 * （2026-10-24 实测主楼 + 楼中楼 100% 命中，不依赖昵称文本）。
 * 楼中楼回复是 bili-comment-reply-renderer，但同样内含 bili-comment-user-info，
 * 所以发现入口统一瞄准 user-info，主楼与回复天然共用一条链路。
 *
 * 徽标挂法（2026-10-25 主人拍板「夹在昵称和等级之间」）：内联插进 user-info 的
 * shadow 树 div#info、#user-name 之后 —— 只有进文档流才能把等级图标和正文推开，
 * 浮层悬盖必然盖住其中一个。这是「评论区零插入」铁律的唯一例外：铅笔仍一律走
 * portal 浮层，徽标只进 user-info 的 shadow 树（Lit 容器，3s 巡检兜底重挂）。
 */
const HOST = 'bili-comments'
const USER_INFO = 'bili-comment-user-info'
const MID_LINK = 'a[href*="space.bilibili.com/"]'
const RENDERERS = 'bili-comment-renderer, bili-comment-reply-renderer'
/** 单轮扫描最多处理的评论者数量（一屏评论区几十条足够；真实大页面配合 scanNow 节流） */
const MAX_ANCHORS = 300

export function hasCommentHost(): boolean {
  return !!qs(HOST)
}

interface CommentTarget {
  /** 铅笔锚点：昵称+等级组（portal 浮层贴靠） */
  anchor: Element
  /** 徽标内联插入点：#user-name（徽标插它后面 = 夹在昵称和等级之间）；取不到时徽标退回 portal */
  badgeAnchor?: Element
  mid: string
  nickname: string
  face: string
}

/** 真实头像在 renderer 层的 bili-avatar 组件 shadow 里；user-info 自己的 img 是等级图标，用 /bfs/face/ 区分 */
function faceOfComment(renderer: Element | null): string {
  if (!renderer) return ''
  // 渲染树整体在 shadow 内：以 renderer 的 shadowRoot 为根下钻（queryDeepAll 不含元素自身的 shadowRoot）
  for (const img of queryDeepAll(renderer.shadowRoot ?? renderer, 'img', { maxDepth: 6, limit: 20 })) {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? ''
    if (src.includes('/bfs/face/')) return src
  }
  return ''
}

function pickTargets(): { targets: CommentTarget[]; hits: { selector: string; hits: number }[] } {
  const hosts = qsa(HOST)
  const hits = [{ selector: HOST, hits: hosts.length }]
  const targets: CommentTarget[] = []
  let userInfoHits = 0

  for (const host of hosts) {
    // 评论树整体在 bili-comments 的 shadowRoot 里：以它为根下钻（queryDeepAll 不含元素自身的 shadowRoot）
    const users = queryDeepAll(host.shadowRoot ?? host, USER_INFO, { maxDepth: 12, limit: MAX_ANCHORS })
    userInfoHits += users.length
    for (const ui of users) {
      if (targets.length >= MAX_ANCHORS) break
      const sr = ui.shadowRoot
      if (!sr) continue
      const link = sr.querySelector<HTMLAnchorElement>(MID_LINK)
      const mid = midFromHref(link?.getAttribute('href') ?? null)
      if (!mid) continue
      const nameEl = sr.querySelector('#user-name')
      const nickname = (nameEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
      // 锚点用「昵称+等级」组而不是 #user-name 本身：真机实测它的父容器只有 ~83px 宽，
      // 直接贴 #user-name 右侧放不下徽标，会落到「父容器下方」压住评论正文
      const anchor = nameEl?.parentElement ?? nameEl ?? ui
      // 徽标夹在昵称和等级之间：内联插到 #user-name 之后（真实结构 [slot, name, level]）
      const badgeAnchor = nameEl ?? undefined
      const renderer = closestDeep(ui, RENDERERS)
      // face 下钻要枚举整棵渲染子树（每条评论 O(子树)），已缓存过头像的 mid 直接跳过
      const face = faceOf(mid) ? '' : faceOfComment(renderer)
      targets.push({ anchor, badgeAnchor, mid, nickname, face })
    }
  }
  hits.push({ selector: USER_INFO, hits: userInfoHits })
  return { targets, hits }
}

function inject(targets: CommentTarget[]): number {
  // 评论区备注不显示 tag（2026-10-25 主人要求）：楼中楼正文与昵称同排，徽标越短越好
  const opts = { ...badgeOptions(), scene: 'comment' as const, showTags: false }
  let injected = 0

  for (const target of targets) {
    if (!target.anchor.isConnected) continue
    rememberNick(target.mid, target.nickname)
    // 头像快照只在首次解析到时入缓存（G1：保存备注时落入 faceSnapshot）
    if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face)
    const record = store.get(target.mid)
    if (record) {
      let ok: HTMLElement | null = null
      if (target.badgeAnchor) {
        ok = renderInlineBadge(target.badgeAnchor, record, opts)
        // 已备注：撤掉浮层里挂在昵称组上的铅笔
        portal.detach(target.anchor, 'pencil')
      } else {
        ok = renderBadge(target.anchor, record, opts)
      }
      if (ok) injected++
    } else {
      ensurePencil(target.anchor, target.mid, target.nickname, 'comment')
    }
  }
  return injected
}

let batchToken = 0

/** 评论区 host 的专用观察器：评论渲染在 bili-comments 的 shadow 树里，
 * body 级 MutationObserver 看不见 shadow 内变动，没有它新评论只能等 3s 巡检兜底，
 * 徽标会成批突然出现。挂上后徽标与评论近乎同帧出现。 */
let hostObserver: MutationObserver | null = null
let hostObserved: ShadowRoot | Element | null = null
let hostScanTimer: number | null = null

function watchHost(): void {
  const host = qs(HOST)
  const root = host?.shadowRoot
  if (!root) return
  if (hostObserved === root) return
  unwatchHost()
  hostObserved = root
  hostObserver = new MutationObserver(() => {
    if (hostScanTimer !== null) return
    hostScanTimer = window.setTimeout(() => {
      hostScanTimer = null
      const settings = getSettings()
      if (settings.enabled && settings.scenes.comment) scanComments()
    }, 50)
  })
  hostObserver.observe(root, { childList: true, subtree: true })
}

function unwatchHost(): void {
  hostObserver?.disconnect()
  hostObserver = null
  hostObserved = null
  if (hostScanTimer !== null) {
    window.clearTimeout(hostScanTimer)
    hostScanTimer = null
  }
}

/** 单次补扫：观察器只看得到 host shadow 树内的增删，渲染器自身 shadow 的
 * 异步填充（Lit 微任务渲染链）可能晚于扫描，扑空时补一枪再试；
 * 有上限（零评论的页面不会无限轮询，成功解析到目标后清零重来） */
let retryToken = 0
let retryCount = 0
const RETRY_MAX = 20

function scheduleRetryScan(): void {
  if (retryCount >= RETRY_MAX) return
  retryCount++
  const token = ++retryToken
  window.setTimeout(() => {
    if (token !== retryToken) return
    const settings = getSettings()
    if (settings.enabled && settings.scenes.comment && hasCommentHost()) scanComments()
  }, 250)
}

/**
 * 分批扫描：单帧只处理 maxNodesPerTick 个锚点（§5.5 约束 #7 的「单帧上限 + 长任务拆分」），
 * 剩余挪到下一帧；新一轮扫描 / 路由变化会让旧批次静默作废（token 校验）。
 */
export function scanComments(): void {
  const token = ++batchToken
  watchHost()
  const { targets, hits } = pickTargets()
  const diag: SceneDiagnostic = {
    scene: 'comment',
    label: '评论区',
    selectors: hits,
    midResolved: targets.length,
    injected: 0,
    notes: [],
  }
  if (!targets.length) {
    diag.notes.push('评论区组件存在但未解析到评论者（可能尚未加载完或结构已变）')
    setDiagnostic(diag)
    scheduleRetryScan()
    return
  }
  retryCount = 0
  setDiagnostic(diag)

  const size = Math.max(1, getSettings().advanced.maxNodesPerTick)
  let index = 0
  let injected = 0
  const step = (): void => {
    if (token !== batchToken) return // 已被新一轮扫描 / 路由变化接管
    const settings = getSettings()
    if (!settings.enabled || !settings.scenes.comment) return
    const slice = targets.slice(index, index + size)
    index += slice.length
    injected += inject(slice)
    if (index < targets.length) {
      window.setTimeout(step, 0)
    } else {
      diag.injected = injected
      setDiagnostic(diag)
    }
  }
  step()
}

/** 路由变化 / 关闭场景时作废未跑完的批次，避免向新页面注入旧内容 */
export function cancelCommentBatch(): void {
  batchToken++
  retryToken++
  unwatchHost()
}

/** 关闭场景时移除本场景的铅笔入口（按场景清理，不影响其它场景；徽标行为与视频页一致） */
export function clearCommentPencils(): void {
  cancelCommentBatch()
  clearPencilsOfScene('comment')
}
