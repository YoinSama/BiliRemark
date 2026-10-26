export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function formatTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function formatDay(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function relativeTime(ts: number, now = Date.now()): string {
  if (!ts) return '—'
  const diff = Math.max(0, now - ts)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return formatDay(ts)
}

export function daysSince(ts: number, now = Date.now()): number {
  if (!ts) return Number.POSITIVE_INFINITY
  return Math.floor((now - ts) / 86_400_000)
}

export function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length
  } catch {
    return text.length
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 公式触发字符：Excel/WPS/Sheets 会把这些开头的单元格当公式执行（CSV Injection） */
const FORMULA_LEAD = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  const safe = FORMULA_LEAD.test(s) ? "'" + s : s
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}

export function stampForFile(ts = Date.now()): string {
  const d = new Date(ts)
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
}
