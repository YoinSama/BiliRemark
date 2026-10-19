import { DEFAULT_SETTINGS, SETTINGS_SCHEMA, STORAGE } from './constants'
import type { Settings } from './types'
import { emit } from './bus'
import { setDebug, warn } from '../util/log'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readRaw(): unknown {
  try {
    const raw = GM_getValue<unknown>(STORAGE.settings, null)
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    return raw
  } catch (err) {
    warn('读取设置失败，使用默认设置', err)
    return null
  }
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function mergeSettings(base: Settings, raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, any>

  base.enabled = bool(r.enabled, base.enabled)

  if (r.scenes && typeof r.scenes === 'object') {
    for (const key of Object.keys(base.scenes) as (keyof Settings['scenes'])[]) {
      base.scenes[key] = bool(r.scenes[key], base.scenes[key])
    }
  }

  if (r.display && typeof r.display === 'object') {
    const d = r.display
    // 初版只实现「昵称之后」，其余位置留待后续里程碑
    base.display.position = 'afterName'
    base.display.showTags = bool(d.showTags, base.display.showTags)
    base.display.showColorDot = bool(d.showColorDot, base.display.showColorDot)
    base.display.maxTags = num(d.maxTags, base.display.maxTags, 0, 5)
    base.display.replaceNickname = false
    base.display.showOnHoverOnly = bool(d.showOnHoverOnly, base.display.showOnHoverOnly)
  }

  if (r.editor && typeof r.editor === 'object') {
    base.editor.entry = 'clickBadge'
    base.editor.hotkey =
      typeof r.editor.hotkey === 'string' && r.editor.hotkey.trim() ? r.editor.hotkey.trim() : base.editor.hotkey
  }

  if (r.manager && typeof r.manager === 'object') {
    const m = r.manager
    base.manager.pageSize = num(m.pageSize, base.manager.pageSize, 10, 500)
    base.manager.theme = m.theme === 'dark' || m.theme === 'light' ? m.theme : 'auto'
    base.manager.zIndex = num(m.zIndex, base.manager.zIndex, 1000, 2147483000)
  }

  if (r.backup && typeof r.backup === 'object') {
    const b = r.backup
    base.backup.lastExportAt = num(b.lastExportAt, 0, 0, Number.MAX_SAFE_INTEGER)
    base.backup.remindIntervalDays = num(b.remindIntervalDays, base.backup.remindIntervalDays, 0, 365)
  }

  if (r.advanced && typeof r.advanced === 'object') {
    const a = r.advanced
    base.advanced.observerDebounceMs = num(a.observerDebounceMs, base.advanced.observerDebounceMs, 50, 2000)
    base.advanced.maxNodesPerTick = num(a.maxNodesPerTick, base.advanced.maxNodesPerTick, 5, 200)
    base.advanced.debug = bool(a.debug, base.advanced.debug)
  }

  return base
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (!cache) {
    cache = mergeSettings(clone(DEFAULT_SETTINGS), readRaw())
    cache.schema = SETTINGS_SCHEMA
    setDebug(cache.advanced.debug)
  }
  return cache
}

export function saveSettings(): void {
  const settings = getSettings()
  try {
    GM_setValue(STORAGE.settings, settings)
  } catch (err) {
    warn('保存设置失败', err)
  }
}

export function updateSettings(mutator: (settings: Settings) => void): void {
  const settings = getSettings()
  mutator(settings)
  setDebug(settings.advanced.debug)
  saveSettings()
  emit('settings-changed', settings)
}

/** 外部（其他标签页）写入后重新载入 */
export function reloadSettings(remoteValue: unknown): void {
  cache = mergeSettings(clone(DEFAULT_SETTINGS), remoteValue)
  cache.schema = SETTINGS_SCHEMA
  setDebug(cache.advanced.debug)
  emit('settings-changed', cache)
}

export function resetSettings(): void {
  cache = clone(DEFAULT_SETTINGS)
  saveSettings()
  emit('settings-changed', cache)
}
