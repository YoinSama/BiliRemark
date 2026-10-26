import { getSettings } from '../core/config'
import { getTheme } from '../ui/theme'
import { getDiagnostics } from '../core/runtime'
import { store } from '../core/store'
import { h } from '../util/dom'
import { formatBytes } from '../util/format'
import { badgeCount } from '../ui/badge'
import { toast } from '../ui/toast'

let root: HTMLElement | null = null
let rescan: (() => void) | null = null

export function setDoctorRescan(fn: () => void): void {
  rescan = fn
}

function buildReport(stats: ReturnType<typeof store.stats>): string {
  const lines: string[] = []
  const theme = getTheme()
  lines.push(`URL: ${location.href}`)
  lines.push(`页面类型: ${document.title}`)
  lines.push(`主题: dark=${theme.dark} evolved=${theme.evolved} color=${theme.color}`)
  lines.push(`存储: ${stats.count} 条 / ${formatBytes(stats.bytes)}`)
  lines.push(`已注入徽标: ${badgeCount()}`)
  for (const diag of getDiagnostics()) {
    lines.push(`--- ${diag.label} (${diag.scene}) ---`)
    lines.push(`mid 命中: ${diag.midResolved} / 注入: ${diag.injected}`)
    for (const s of diag.selectors) lines.push(`  ${s.selector} => ${s.hits}`)
    for (const note of diag.notes) lines.push(`  ! ${note}`)
  }
  return lines.join('\n')
}

export function openDoctor(): void {
  closeDoctor()
  const el = h('div')
  el.id = 'brmk-doctor'

  const head = h('h4')
  head.appendChild(h('span', '', '选择器体检'))
  const closeBtn = h('button', 'brmk-ed-close', '✕')
  closeBtn.type = 'button'
  closeBtn.addEventListener('click', () => closeDoctor())
  head.appendChild(closeBtn)
  el.appendChild(head)

  const info = h('div')
  const theme = getTheme()
  const stats = store.stats()
  const row = (label: string, value: string): void => {
    const r = h('div', 'brmk-doc-row')
    r.appendChild(h('span', '', label))
    r.appendChild(h('b', '', value))
    info.appendChild(r)
  }
  row('主题', `${theme.dark ? '深色' : '浅色'} / ${theme.evolved ? '跟随 Evolved' : '默认 B 站粉'}`)
  row('主题色', theme.color)
  row('备注条数', String(stats.count))
  row('估算占用', formatBytes(stats.bytes))
  row('已注入徽标', String(badgeCount()))
  el.appendChild(info)

  const diags = getDiagnostics()
  if (!diags.length) {
    el.appendChild(h('div', 'brmk-doc-row', '当前页面没有启用的场景适配器'))
  }
  for (const diag of diags) {
    el.appendChild(h('div', 'brmk-doc-row', `${diag.label}：mid ${diag.midResolved} / 注入 ${diag.injected}`))
  }

  const pre = h('pre', '', buildReport(stats))
  el.appendChild(pre)

  const actions = h('div')
  actions.style.display = 'flex'
  actions.style.gap = '6px'
  actions.style.marginTop = '8px'
  const again = h('button', 'brmk-btn', '重新扫描')
  again.type = 'button'
  again.addEventListener('click', () => {
    rescan?.()
    closeDoctor()
    openDoctor()
  })
  const copy = h('button', 'brmk-btn', '复制诊断')
  copy.type = 'button'
  copy.addEventListener('click', () => {
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(buildReport(store.stats()), 'text')
      else void navigator.clipboard?.writeText(buildReport(store.stats()))
      toast('诊断信息已复制')
    } catch {
      toast('复制失败')
    }
  })
  actions.append(again, copy)
  el.appendChild(actions)

  document.body.appendChild(el)
  root = el
}

export function closeDoctor(): void {
  root?.remove()
  root = null
}

export function isDoctorOpen(): boolean {
  return !!root
}

export function doctorEnabled(): boolean {
  return getSettings().advanced.debug
}
