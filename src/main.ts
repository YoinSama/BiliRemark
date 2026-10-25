import { cancelCommentBatch, clearCommentPencils, hasCommentHost, scanComments } from './adapters/comment'
import { clearCardInline, clearCardPencils, hasCardHost, scanCards } from './adapters/card'
import { clearDynamicPencils, isDynamicPage, scanDynamic } from './adapters/dynamic'
import { clearVideoUpPencils, isVideoPage, scanVideoUp } from './adapters/videoUp'
import { clearImPencils, isImPage, scanIm } from './adapters/im'
import { clearRelationPencils, isRelationPage, scanRelation } from './adapters/relation'
import { clearSpaceAside, isSpacePage, scanSpaceAside } from './adapters/spaceAside'
import { getSettings, reloadSettings, updateSettings } from './core/config'
import { STORAGE } from './core/constants'
import { emit, on } from './core/bus'
import { refreshTheme, installStyles } from './ui/theme'
import { watchTheme } from './core/env'
import { store } from './core/store'
import { initFaceBackfill } from './core/faceFetch'
import { downloadText, stampForFile } from './util/format'
import { guard, log, warn } from './util/log'
import { openManager, closeManager, isManagerOpen, toggleManager } from './ui/manager'
import { mountFab } from './ui/floating'
import { openDoctor, closeDoctor, setDoctorRescan, isDoctorOpen, doctorEnabled } from './dev/doctor'
import { badgeCount, clearAll, pruneBadges } from './ui/badge'
import { toast } from './ui/toast'

const VERSION = '1.6.1'
const APP_NS = '__biliRemark__'

let observer: MutationObserver | null = null
let scanTimer: number | null = null
let patrolTimer: number | null = null
let urlTimer: number | null = null
let themeCleanup: (() => void) | null = null
let lastUrl = location.href
let started = false

/** 我们自己插入的节点，其变动不触发重新扫描（否则会自激） */
const OWN_SELECTOR =
  '#brmk-manager, #brmk-editor, #brmk-toast, #brmk-doctor, #brmk-fab, #brmk-space-card, #brmk-layer, .brmk-badge, .brmk-pencil, #brmk-style'

function isOwnNode(node: Node | null): boolean {
  if (!node) return false
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!el) return false
  try {
    return !!el.closest(OWN_SELECTOR)
  } catch {
    return false
  }
}

function mutationsAreOurs(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (!isOwnNode(record.target)) return false
    for (const node of Array.from(record.addedNodes)) if (!isOwnNode(node)) return false
    for (const node of Array.from(record.removedNodes)) if (!isOwnNode(node)) return false
  }
  return true
}

function scheduleScan(delay?: number): void {
  if (scanTimer !== null) window.clearTimeout(scanTimer)
  const wait = delay ?? getSettings().advanced.observerDebounceMs
  scanTimer = window.setTimeout(() => {
    scanTimer = null
    scanNow()
  }, wait)
}

function clearInjected(): void {
  clearAll()
}

function scanNow(): void {
  guard('scan', () => {
    const settings = getSettings()
    if (!settings.enabled) {
      cancelCommentBatch()
      clearInjected()
      clearSpaceAside()
      clearCardInline()
      return
    }
    pruneBadges()
    if (isVideoPage()) {
      if (settings.scenes.videoUp) scanVideoUp()
      else clearVideoUpPencils()
    } else {
      clearVideoUpPencils()
    }
    if (isSpacePage()) {
      if (settings.scenes.space) scanSpaceAside()
      else clearSpaceAside()
    } else {
      clearSpaceAside()
    }
    // 评论区按组件结构探测（视频页 / 动态 / 专栏都可能承载 bili-comments），不按路由硬编码
    if (hasCommentHost()) {
      if (settings.scenes.comment) scanComments()
      else clearCommentPencils()
    }
    // 动态页（opus 图文动态；旧版 t.bilibili.com 第 2 期接入）
    if (isDynamicPage()) {
      if (settings.scenes.dynamic) scanDynamic()
      else clearDynamicPencils()
    }
    // 视频卡片（首页 feed / 搜索结果 / 视频页右栏），按容器结构探测不按路由
    if (hasCardHost()) {
      if (settings.scenes.card) scanCards()
      else clearCardPencils()
    }
    // 私信页（message.bilibili.com/#/whisper，会话列表行 + 聊天窗头部）
    if (isImPage()) {
      if (settings.scenes.message) scanIm()
      else clearImPencils()
    }
    // 关注 / 粉丝列表（space.bilibili.com/<mid>/relation/*，行卡片昵称旁）
    if (isRelationPage()) {
      if (settings.scenes.relation) scanRelation()
      else clearRelationPencils()
    }
    log('扫描完成，徽标数', badgeCount())
  }, undefined)
}

function startObserver(): void {
  if (observer || !document.body) return
  observer = new MutationObserver((records) => {
    if (!records.length) return
    if (mutationsAreOurs(records)) return
    scheduleScan()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // 兜底巡检：虚拟滚动/组件复用会绕过 childList 观察
  patrolTimer = window.setInterval(() => {
    if (document.hidden) return
    scanNow()
  }, 3000)
}

function stopObserver(): void {
  observer?.disconnect()
  observer = null
  if (patrolTimer !== null) {
    window.clearInterval(patrolTimer)
    patrolTimer = null
  }
}

function onRouteChange(): void {
  log('路由变化', location.href)
  cancelCommentBatch()
  clearInjected()
  // 离开空间页时立刻移除模块，避免残留上一个用户的备注；空间页内切 tab 交给扫描幂等处理
  if (!isSpacePage()) clearSpaceAside()
  closeDoctor()
  scheduleScan(300)
}

function watchRoute(): void {
  const check = (): void => {
    if (document.hidden) return
    if (location.href !== lastUrl) {
      lastUrl = location.href
      onRouteChange()
    }
  }

  window.addEventListener('popstate', check)
  window.addEventListener('hashchange', check)

  // 只读包装：保持原行为、原异常传播，仅追加一次通知
  try {
    const origPush = history.pushState
    const origReplace = history.replaceState
    history.pushState = function (this: History, ...args: Parameters<History['pushState']>): void {
      const ret = origPush.apply(this, args)
      window.setTimeout(check, 0)
      return ret
    } as History['pushState']
    history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>): void {
      const ret = origReplace.apply(this, args)
      window.setTimeout(check, 0)
      return ret
    } as History['replaceState']
  } catch (err) {
    warn('包装 history 失败，改用轮询兜底', err)
  }

  urlTimer = window.setInterval(check, 1000)
}

interface HotkeySpec {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

function parseHotkey(spec: string): HotkeySpec {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase())
  const key = parts.pop() ?? 'r'
  return {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key,
  }
}

function matchesHotkey(ev: KeyboardEvent, spec: HotkeySpec): boolean {
  if (ev.ctrlKey !== spec.ctrl || ev.altKey !== spec.alt || ev.shiftKey !== spec.shift || ev.metaKey !== spec.meta) {
    return false
  }
  const key = ev.key.toLowerCase()
  if (spec.key.length === 1) return key === spec.key
  return key === spec.key || ev.code.toLowerCase() === spec.key
}

function bindHotkey(): void {
  document.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    const spec = parseHotkey(getSettings().editor.hotkey)
    if (matchesHotkey(ev, spec)) {
      ev.preventDefault()
      ev.stopPropagation()
      toggleManager()
    }
  })
}

function registerMenus(): void {
  const safe = (fn: () => void): (() => void) => () => guard('menu', fn, undefined)
  try {
    GM_registerMenuCommand('打开备注管理器', safe(() => openManager()))
    GM_registerMenuCommand('选择器体检', safe(() => openDoctor()))
    GM_registerMenuCommand('暂停 / 恢复备注显示', safe(() => {
      updateSettings((s) => {
        s.enabled = !s.enabled
      })
      toast(getSettings().enabled ? '备注显示已恢复' : '备注显示已暂停（数据保留）')
      scanNow()
    }))
    GM_registerMenuCommand('导出备注 JSON', safe(() => {
      downloadText(`bili-remark-${stampForFile()}.json`, store.exportJSON(), 'application/json')
      updateSettings((s) => {
        s.backup.lastExportAt = Date.now()
      })
      toast('已导出 JSON')
    }))
  } catch (err) {
    warn('注册菜单命令失败', err)
  }
}

function bindStorageSync(): void {
  try {
    GM_addValueChangeListener(STORAGE.data, (_name, _old, next, remote) => {
      if (!remote) return
      store.replaceFromRemote(next)
      scanNow()
    })
    GM_addValueChangeListener(STORAGE.settings, (_name, _old, next, remote) => {
      if (!remote) return
      reloadSettings(next)
      installStyles(refreshTheme())
      scanNow()
    })
  } catch (err) {
    warn('跨标签页同步不可用', err)
  }
}

function boot(): void {
  if (started) return
  started = true

  store.load()
  initFaceBackfill()
  refreshTheme()
  installStyles()

  themeCleanup = watchTheme(() => {
    installStyles(refreshTheme())
    emit('theme-changed')
    log('主题已更新')
  })

  mountFab()
  registerMenus()
  bindStorageSync()
  bindHotkey()
  setDoctorRescan(() => scanNow())

  on('data-changed', () => scanNow())

  on('settings-changed', () => {
    installStyles(refreshTheme())
    scanNow()
  })
  on('request-manager', () => openManager())
  on('request-doctor', () => openDoctor())

  // 调试模式打开时自动弹一次体检面板
  if (doctorEnabled()) openDoctor()

  watchRoute()
  startObserver()
  scheduleScan(200)

  window.addEventListener('pagehide', () => {
    store.flush()
    stopObserver()
    themeCleanup?.()
    if (urlTimer !== null) window.clearInterval(urlTimer)
    if (scanTimer !== null) window.clearTimeout(scanTimer)
  })

  ;(window as unknown as Record<string, unknown>)[APP_NS] = {
    version: VERSION,
    openManager: () => openManager(),
    doctor: () => openDoctor(),
    rescan: () => scanNow(),
    toggle: () => toggleManager(),
    status: () => ({
      enabled: getSettings().enabled,
      badges: badgeCount(),
      managerOpen: isManagerOpen(),
      doctorOpen: isDoctorOpen(),
    }),
  }

  log(`v${VERSION} 已启动，脚本管理器：${typeof GM_info !== 'undefined' ? GM_info.scriptHandler : 'unknown'}`)
}

function main(): void {
  try {
    if (window.top !== window.self) return
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', main, { once: true })
      return
    }
    boot()
  } catch (err) {
    warn('启动失败', err)
  }
}

/** 卸载（调试用，页面不会自动调用） */
export function shutdown(): void {
  stopObserver()
  themeCleanup?.()
  closeManager()
  closeDoctor()
  clearSpaceAside()
  clearInjected()
}

main()
