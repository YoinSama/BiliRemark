import { DATA_SCHEMA, LIMITS, STORAGE } from './constants'
import type { ImportPreview, MergeStrategy, SceneKey, StoreData, UserRecord } from './types'
import { emit } from './bus'
import { byteLength, csvCell, formatTime } from '../util/format'
import { warn } from '../util/log'

export interface UpsertMeta {
  scene?: SceneKey | 'manual'
  url?: string
  nickSnapshot?: string
  faceSnapshot?: string
}

function now(): number {
  return Date.now()
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function timeOf(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function normalizeMid(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{1,20}$/.test(raw)) return null
  if (raw === '0') return null
  return raw
}

export function normalizeTags(value: unknown): string[] {
  const arr = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\s]+/)
      : []
  const out: string[] = []
  for (const item of arr) {
    const tag = String(item ?? '').trim().slice(0, LIMITS.tag)
    if (!tag) continue
    if (out.includes(tag)) continue
    out.push(tag)
    if (out.length >= LIMITS.tags) break
  }
  return out
}

function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v
  if (/^rgba?\([\d\s.,%]+\)$/.test(v)) return v
  return null
}

export interface RawRecordInput {
  mid?: unknown
  remark?: unknown
  tags?: unknown
  color?: unknown
  note?: unknown
  nickSnapshot?: unknown
  faceSnapshot?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  firstSeen?: unknown
}

export function normalizeRecord(input: RawRecordInput, fallbackNow = now()): UserRecord | null {
  const mid = normalizeMid(input.mid)
  if (!mid) return null
  const createdAt = timeOf(input.createdAt, fallbackNow)
  const updatedAt = timeOf(input.updatedAt, createdAt)
  const firstSeenRaw = input.firstSeen as Record<string, unknown> | undefined
  const firstSeen =
    firstSeenRaw && typeof firstSeenRaw === 'object'
      ? {
          scene: (asString(firstSeenRaw.scene, 'manual') as SceneKey | 'manual') || 'manual',
          url: asString(firstSeenRaw.url, ''),
        }
      : undefined

  return {
    mid,
    remark: asString(input.remark).trim().slice(0, LIMITS.remark),
    tags: normalizeTags(input.tags),
    color: normalizeColor(input.color),
    note: asString(input.note).slice(0, LIMITS.note),
    nickSnapshot: asString(input.nickSnapshot).slice(0, 100),
    faceSnapshot: asString(input.faceSnapshot).slice(0, 500),
    createdAt,
    updatedAt,
    ...(firstSeen ? { firstSeen } : {}),
  }
}

function emptyData(): StoreData {
  return { schema: DATA_SCHEMA, updatedAt: now(), users: {} }
}

function parseData(raw: unknown): { data: StoreData; corrupted: boolean } {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { data: emptyData(), corrupted: true }
    }
  }
  if (!value || typeof value !== 'object') return { data: emptyData(), corrupted: false }
  const obj = value as Record<string, unknown>
  const users: Record<string, UserRecord> = {}
  const rawUsers = obj.users
  if (rawUsers && typeof rawUsers === 'object') {
    for (const [key, item] of Object.entries(rawUsers as Record<string, unknown>)) {
      if (!item || typeof item !== 'object') continue
      const rec = normalizeRecord({ ...(item as RawRecordInput), mid: (item as RawRecordInput).mid ?? key })
      if (rec) users[rec.mid] = rec
    }
  }
  return {
    data: {
      schema: DATA_SCHEMA,
      updatedAt: timeOf(obj.updatedAt, now()),
      users,
    },
    corrupted: false,
  }
}

class RemarkStore {
  private data: StoreData = emptyData()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private loaded = false
  /** 有未落盘的改动才写，避免 pagehide 时用旧内存覆盖别处刚写入的数据 */
  private dirty = false
  lastError: string | null = null

  load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = GM_getValue<unknown>(STORAGE.data, null)
      const { data, corrupted } = parseData(raw)
      this.data = data
      if (corrupted) {
        // 原始数据不丢：另存一份原始值，等待人工处理
        try {
          GM_setValue(STORAGE.backupPrefix + now(), raw)
        } catch {
          /* 备份失败也不阻塞启动 */
        }
        this.lastError = '本地数据无法解析，已另存原始备份并启用空数据'
        warn(this.lastError)
      }
    } catch (err) {
      warn('读取备注数据失败', err)
      this.lastError = '读取备注数据失败（存储不可用？）'
      this.data = emptyData()
    }
  }

  get users(): Record<string, UserRecord> {
    return this.data.users
  }

  get count(): number {
    return Object.keys(this.data.users).length
  }

  get(mid: string): UserRecord | undefined {
    return this.data.users[mid]
  }

  all(): UserRecord[] {
    return Object.values(this.data.users)
  }

  upsert(input: RawRecordInput, meta: UpsertMeta = {}): UserRecord | null {
    const existing = input.mid !== undefined ? this.data.users[String(input.mid)] : undefined
    const ts = now()
    const merged = normalizeRecord(
      {
        mid: input.mid,
        remark: input.remark ?? existing?.remark,
        tags: input.tags ?? existing?.tags,
        color: input.color ?? existing?.color,
        note: input.note ?? existing?.note,
        nickSnapshot: meta.nickSnapshot ?? input.nickSnapshot ?? existing?.nickSnapshot,
        faceSnapshot: meta.faceSnapshot ?? input.faceSnapshot ?? existing?.faceSnapshot,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        firstSeen:
          existing?.firstSeen ??
          (meta.scene
            ? { scene: meta.scene, url: meta.url ?? location.href }
            : { scene: 'manual', url: location.href }),
      },
      ts,
    )
    if (!merged) return null
    this.data.users[merged.mid] = merged
    this.data.updatedAt = ts
    this.persistSoon()
    emit('data-changed', { reason: 'upsert', mids: [merged.mid] })
    return merged
  }

  remove(mid: string): UserRecord | null {
    const rec = this.data.users[mid]
    if (!rec) return null
    delete this.data.users[mid]
    this.data.updatedAt = now()
    this.persistSoon()
    emit('data-changed', { reason: 'remove', mids: [mid] })
    return rec
  }

  removeMany(mids: string[]): UserRecord[] {
    const removed: UserRecord[] = []
    for (const mid of mids) {
      const rec = this.data.users[mid]
      if (rec) {
        delete this.data.users[mid]
        removed.push(rec)
      }
    }
    if (removed.length) {
      this.data.updatedAt = now()
      this.persistSoon()
      emit('data-changed', { reason: 'remove', mids: removed.map((r) => r.mid) })
    }
    return removed
  }

  restore(records: UserRecord[]): void {
    for (const rec of records) this.data.users[rec.mid] = rec
    this.data.updatedAt = now()
    this.persistSoon()
    emit('data-changed', { reason: 'restore', mids: records.map((r) => r.mid) })
  }

  clearAll(): void {
    this.backupNow('clear')
    this.data = emptyData()
    this.persistSoon()
    emit('data-changed', { reason: 'clear' })
  }

  /** 导入前的差异统计 */
  previewImport(records: UserRecord[], strategy: MergeStrategy): ImportPreview {
    let added = 0
    let updated = 0
    let skipped = 0
    const incoming = new Map(records.map((r) => [r.mid, r]))
    for (const rec of incoming.values()) {
      const existing = this.data.users[rec.mid]
      if (!existing) {
        added++
        continue
      }
      if (strategy === 'replace') updated++
      else if (strategy === 'newer') {
        if (rec.updatedAt > existing.updatedAt) updated++
        else skipped++
      } else skipped++
    }
    let removed = 0
    if (strategy === 'replace') {
      for (const mid of Object.keys(this.data.users)) if (!incoming.has(mid)) removed++
    }
    return { added, updated, skipped, invalid: 0, removed }
  }

  applyImport(records: UserRecord[], strategy: MergeStrategy): ImportPreview {
    this.backupNow('import')
    const preview = this.previewImport(records, strategy)
    const incoming = new Map(records.map((r) => [r.mid, r]))
    if (strategy === 'replace') {
      const next: Record<string, UserRecord> = {}
      for (const rec of incoming.values()) next[rec.mid] = rec
      this.data.users = next
    } else if (strategy === 'newer') {
      for (const rec of incoming.values()) {
        const existing = this.data.users[rec.mid]
        if (!existing || rec.updatedAt > existing.updatedAt) this.data.users[rec.mid] = rec
      }
    } else {
      for (const rec of incoming.values()) {
        if (!this.data.users[rec.mid]) this.data.users[rec.mid] = rec
      }
    }
    this.data.updatedAt = now()
    this.dirty = true
    this.persistNow()
    emit('data-changed', { reason: 'import' })
    return preview
  }

  exportJSON(): string {
    return JSON.stringify(
      {
        schema: DATA_SCHEMA,
        exportedAt: now(),
        generator: 'BiliRemark',
        users: this.data.users,
      },
      null,
      2,
    )
  }

  exportCSV(): string {
    const head = [
      'mid',
      'remark',
      'tags',
      'color',
      'note',
      'nickSnapshot',
      'createdAt',
      'updatedAt',
      'firstSeenScene',
      'firstSeenUrl',
    ]
    const rows = this.all()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) =>
        [
          r.mid,
          r.remark,
          r.tags.join('|'),
          r.color ?? '',
          r.note,
          r.nickSnapshot,
          formatTime(r.createdAt),
          formatTime(r.updatedAt),
          r.firstSeen?.scene ?? '',
          r.firstSeen?.url ?? '',
        ]
          .map(csvCell)
          .join(','),
      )
    return '\uFEFF' + [head.join(','), ...rows].join('\r\n')
  }

  stats(): { count: number; bytes: number; monthAdded: number; tags: { tag: string; count: number }[] } {
    const list = this.all()
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const monthAdded = list.filter((r) => r.createdAt >= startOfMonth.getTime()).length
    const tagMap = new Map<string, number>()
    for (const rec of list) for (const tag of rec.tags) tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1)
    const tags = Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
    const bytes = byteLength(JSON.stringify(this.data))
    return { count: list.length, bytes, monthAdded, tags }
  }

  /** 导出/导入前留一份自动备份，避免误操作不可回滚 */
  backupNow(reason: string): void {
    try {
      GM_setValue(`${STORAGE.backupPrefix}${reason}.${now()}`, JSON.stringify(this.data))
    } catch (err) {
      warn('自动备份失败', err)
    }
  }

  replaceFromRemote(value: unknown): void {
    const { data } = parseData(value)
    this.data = data
    this.dirty = false
    emit('data-changed', { reason: 'remote' })
  }

  private persistSoon(): void {
    this.dirty = true
    if (this.saveTimer !== null) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.persistNow()
    }, 250)
  }

  persistNow(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.dirty) return
    this.dirty = false
    try {
      GM_setValue(STORAGE.data, this.data)
      this.lastError = null
    } catch (err) {
      this.dirty = true
      this.lastError = '写入本地存储失败，可能是容量已满'
      warn(this.lastError, err)
    }
  }

  flush(): void {
    this.persistNow()
  }
}

export const store = new RemarkStore()
