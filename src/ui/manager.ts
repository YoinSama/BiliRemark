import { LIMITS, TAG_PRESET_COLORS, VERSION } from '../core/constants'
import { getSettings, resetSettings, updateSettings } from '../core/config'
import { nickCache } from '../core/runtime'
import { store, normalizeRecord } from '../core/store'
import type { MergeStrategy, SceneKey, UserRecord } from '../core/types'
import { on } from '../core/bus'
import { h, truncate } from '../util/dom'
import { daysSince, downloadText, formatBytes, formatTime, relativeTime, stampForFile } from '../util/format'
import { openEditor } from './editor'
import { managerPalette, paletteOf, getTheme } from './theme'
import { toast } from './toast'

const SCENE_LABELS: Record<SceneKey | 'manual', string> = {
  videoUp: '视频 UP 主',
  comment: '评论区',
  space: '个人空间',
  dynamic: '动态',
  card: '视频卡片',
  relation: '粉丝/关注',
  message: '私信',
  manual: '手动添加',
}

type Tab = 'list' | 'settings'
type SortKey = 'updatedAt' | 'createdAt' | 'remark' | 'mid'

interface ViewState {
  tab: Tab
  search: string
  tag: string
  scene: string
  hasNote: 'any' | 'yes' | 'no'
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  page: number
  selected: Set<string>
}

const state: ViewState = {
  tab: 'list',
  search: '',
  tag: '',
  scene: '',
  hasNote: 'any',
  sortKey: 'updatedAt',
  sortDir: 'desc',
  page: 1,
  selected: new Set(),
}

interface Refs {
  root: HTMLElement
  panel: HTMLElement
  countBadge: HTMLElement
  search: HTMLInputElement
  stats: HTMLElement
  warn: HTMLElement
  tabs: HTMLElement
  listView: HTMLElement
  settingsView: HTMLElement
  toolbar: HTMLElement
  tagSelect: HTMLSelectElement
  sceneSelect: HTMLSelectElement
  noteSelect: HTMLSelectElement
  sortSelect: HTMLSelectElement
  dirBtn: HTMLButtonElement
  batchBar: HTMLElement
  bodyWrap: HTMLElement
  tbody: HTMLTableSectionElement
  empty: HTMLElement
  pager: HTMLElement
  subHost: HTMLElement
}

let refs: Refs | null = null
let unbindBus: (() => void) | null = null
let prevOverflow = ''
let keyHandler: ((ev: KeyboardEvent) => void) | null = null

// data-changed 重渲染调度：150ms 去抖 + 滚动挂起（滚动中不整表重建，停止 200ms 后补渲染）
let renderDebounce: number | null = null
let scrollSilence: number | null = null
let userScrolling = false
let renderPending = false

function clearRenderSchedule(): void {
  if (renderDebounce !== null) window.clearTimeout(renderDebounce)
  if (scrollSilence !== null) window.clearTimeout(scrollSilence)
  renderDebounce = null
  scrollSilence = null
  userScrolling = false
  renderPending = false
}

function scheduleDataRender(): void {
  if (renderDebounce !== null) window.clearTimeout(renderDebounce)
  renderDebounce = window.setTimeout(() => {
    renderDebounce = null
    if (userScrolling) {
      renderPending = true
      return
    }
    renderPending = false
    renderAll()
  }, 150)
}

/** 捕获阶段接住面板内任何滚动容器（列表/设置页）：置位滚动窗口，静默 200ms 判停 */
function onPanelScroll(): void {
  userScrolling = true
  if (scrollSilence !== null) window.clearTimeout(scrollSilence)
  scrollSilence = window.setTimeout(() => {
    userScrolling = false
    scrollSilence = null
    if (renderPending && refs) {
      renderPending = false
      renderAll()
    }
  }, 200)
}

function btn(label: string, className: string, onClick: (ev: MouseEvent) => void): HTMLButtonElement {
  const b = h('button', className, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

/** 带 data-act 的按钮：便于自检/自动化定位，也方便后续扩展 */
function btnAct(
  label: string,
  className: string,
  act: string,
  onClick: (ev: MouseEvent) => void,
): HTMLButtonElement {
  const b = btn(label, className, onClick)
  b.setAttribute('data-act', act)
  return b
}

function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option')
  o.value = value
  o.textContent = label
  return o
}

function switchEl(checked: boolean, onChange: (next: boolean) => void, disabled = false): HTMLButtonElement {
  const b = h('button', 'brmk-switch')
  b.type = 'button'
  b.setAttribute('role', 'switch')
  b.setAttribute('aria-checked', String(checked))
  if (disabled) {
    b.disabled = true
    b.style.opacity = '.45'
    b.style.cursor = 'not-allowed'
  }
  b.addEventListener('click', () => {
    if (disabled) return
    const next = b.getAttribute('aria-checked') !== 'true'
    b.setAttribute('aria-checked', String(next))
    onChange(next)
  })
  return b
}

function filteredRecords(): UserRecord[] {
  const keyword = state.search.trim().toLowerCase()
  let list = store.all()

  if (keyword) {
    list = list.filter((r) => {
      return (
        r.remark.toLowerCase().includes(keyword) ||
        r.nickSnapshot.toLowerCase().includes(keyword) ||
        r.mid.includes(keyword) ||
        r.note.toLowerCase().includes(keyword) ||
        r.tags.some((t) => t.toLowerCase().includes(keyword))
      )
    })
  }
  if (state.tag) list = list.filter((r) => r.tags.includes(state.tag))
  if (state.scene) list = list.filter((r) => (r.firstSeen?.scene ?? '') === state.scene)
  if (state.hasNote === 'yes') list = list.filter((r) => r.note.trim().length > 0)
  if (state.hasNote === 'no') list = list.filter((r) => !r.note.trim())

  const dir = state.sortDir === 'asc' ? 1 : -1
  list.sort((a, b) => {
    switch (state.sortKey) {
      case 'remark':
        return dir * (a.remark || a.nickSnapshot).localeCompare(b.remark || b.nickSnapshot, 'zh-Hans-CN')
      case 'mid':
        return dir * (Number(a.mid) - Number(b.mid))
      case 'createdAt':
        return dir * (a.createdAt - b.createdAt)
      default:
        return dir * (a.updatedAt - b.updatedAt)
    }
  })
  return list
}

function pageSize(): number {
  return Math.max(10, getSettings().manager.pageSize)
}

function renderStats(r: Refs): void {
  const stats = store.stats()
  const settings = getSettings()
  const days = daysSince(settings.backup.lastExportAt)
  r.countBadge.textContent = String(stats.count)
  r.stats.textContent = ''

  const card = (value: string, label: string, title?: string): void => {
    const box = h('div', 'brmk-stat')
    box.appendChild(h('b', '', value))
    box.appendChild(h('span', '', label))
    if (title) box.title = title
    r.stats.appendChild(box)
  }

  card(String(stats.count), '备注总数')
  card(String(stats.monthAdded), '本月新增')
  card(formatBytes(stats.bytes), `估算占用 / ${LIMITS.records} 条上限`)
  card(
    Number.isFinite(days) ? `${days} 天` : '从未导出',
    '距上次导出',
    settings.backup.lastExportAt ? formatTime(settings.backup.lastExportAt) : '建议定期导出备份',
  )
  if (stats.tags.length) {
    const tagsBox = h('div', 'brmk-stat')
    tagsBox.appendChild(h('b', '', String(stats.tags.length)))
    tagsBox.appendChild(h('span', '', '标签种类'))
    tagsBox.title = stats.tags
      .slice(0, 12)
      .map((t) => `${t.tag} (${t.count})`)
      .join('，')
    r.stats.appendChild(tagsBox)
  }
}

function renderWarn(r: Refs): void {
  r.warn.textContent = ''
  const messages: string[] = []
  const stats = store.stats()
  const settings = getSettings()

  if (store.lastError) messages.push(store.lastError)
  if (stats.bytes > LIMITS.warnBytes) {
    messages.push(`估算占用 ${formatBytes(stats.bytes)}，接近存储上限，建议先导出备份再清理。`)
  }
  if (stats.count > LIMITS.records) {
    messages.push(`记录数已超过 ${LIMITS.records} 条，建议导出后清理。`)
  }
  const gap = daysSince(settings.backup.lastExportAt)
  if (settings.backup.remindIntervalDays > 0 && gap >= settings.backup.remindIntervalDays) {
    messages.push(`距上次导出已有 ${Number.isFinite(gap) ? gap + ' 天' : '很久'}，数据只存在本机，建议现在导出备份。`)
  }
  if (!messages.length) return
  for (const msg of messages) r.warn.appendChild(h('div', 'brmk-warn', msg))
}

function renderTagOptions(r: Refs): void {
  const current = state.tag
  r.tagSelect.textContent = ''
  r.tagSelect.appendChild(option('', '全部标签'))
  const tags = store.stats().tags
  for (const t of tags) r.tagSelect.appendChild(option(t.tag, `${t.tag} (${t.count})`))
  r.tagSelect.value = tags.some((t) => t.tag === current) ? current : ''
  if (r.tagSelect.value !== current) state.tag = r.tagSelect.value

  const sceneCurrent = state.scene
  r.sceneSelect.textContent = ''
  r.sceneSelect.appendChild(option('', '全部场景'))
  for (const [key, label] of Object.entries(SCENE_LABELS)) {
    r.sceneSelect.appendChild(option(key, label))
  }
  r.sceneSelect.value = sceneCurrent
}

function renderBatchBar(r: Refs): void {
  r.batchBar.textContent = ''
  if (!state.selected.size) {
    r.batchBar.style.display = 'none'
    return
  }
  r.batchBar.style.display = 'flex'
  r.batchBar.appendChild(h('span', '', `已选 ${state.selected.size} 条`))
  r.batchBar.appendChild(
    btn('批量删除', 'brmk-btn brmk-btn-danger', () => {
      const mids = Array.from(state.selected)
      confirmAction('批量删除', `将删除 ${mids.length} 条备注，可在 5 秒内撤销。`, '删除', () => {
        const removed = store.removeMany(mids)
        state.selected.clear()
        if (removed.length) {
          toast(`已删除 ${removed.length} 条`, {
            actionLabel: '撤销',
            duration: 5000,
            onAction: () => store.restore(removed),
          })
        }
        renderAll()
      })
    }),
  )
  r.batchBar.appendChild(
    btn('取消选择', 'brmk-btn', () => {
      state.selected.clear()
      renderAll()
    }),
  )
}

function renderTable(r: Refs): void {
  const list = filteredRecords()
  const size = pageSize()
  const totalPages = Math.max(1, Math.ceil(list.length / size))
  if (state.page > totalPages) state.page = totalPages
  const start = (state.page - 1) * size
  const rows = list.slice(start, start + size)

  r.tbody.textContent = ''
  const allChecked = rows.length > 0 && rows.every((row) => state.selected.has(row.mid))
  const headCheck = r.panel.querySelector<HTMLInputElement>('.brmk-check-all')
  if (headCheck) {
    headCheck.checked = allChecked
    headCheck.indeterminate = !allChecked && rows.some((row) => state.selected.has(row.mid))
  }

  for (const rec of rows) {
    const tr = document.createElement('tr')
    tr.setAttribute('data-mid', rec.mid)

    const tdCheck = document.createElement('td')
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = state.selected.has(rec.mid)
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(rec.mid)
      else state.selected.delete(rec.mid)
      renderBatchBar(r)
      renderTable(r)
    })
    tdCheck.appendChild(cb)
    tr.appendChild(tdCheck)

    const tdUser = document.createElement('td')
    const userLine = h('div', 'brmk-cell-main')
    userLine.appendChild(document.createTextNode(rec.nickSnapshot || '（无昵称快照）'))
    const currentNick = nickCache.get(rec.mid)
    if (currentNick && rec.nickSnapshot && currentNick !== rec.nickSnapshot) {
      const mark = h('span', 'brmk-mark', '昵称已变')
      mark.title = `页面当前昵称：${currentNick}`
      userLine.appendChild(mark)
    }
    tdUser.appendChild(userLine)
    if (rec.firstSeen?.url) {
      const sub = h('div', 'brmk-cell-sub', truncate(rec.firstSeen.url, 42))
      sub.title = rec.firstSeen.url
      tdUser.appendChild(sub)
    }
    tr.appendChild(tdUser)

    const tdMid = document.createElement('td')
    const midBtn = h('button', 'brmk-mid', rec.mid)
    midBtn.type = 'button'
    midBtn.title = '点击复制 mid'
    midBtn.addEventListener('click', () => {
      try {
        if (typeof GM_setClipboard === 'function') GM_setClipboard(rec.mid, 'text')
        else void navigator.clipboard?.writeText(rec.mid)
        toast('mid 已复制')
      } catch {
        toast('复制失败')
      }
    })
    tdMid.appendChild(midBtn)
    tr.appendChild(tdMid)

    const tdRemark = document.createElement('td')
    const remarkText = rec.remark || '—'
    const remarkDiv = h('div', 'brmk-cell-main', remarkText)
    if (rec.color) remarkDiv.style.color = rec.color
    tdRemark.appendChild(remarkDiv)
    tr.appendChild(tdRemark)

    const tdTags = document.createElement('td')
    if (rec.tags.length) {
      for (const tag of rec.tags) tdTags.appendChild(h('span', 'brmk-row-tag', tag))
    } else {
      tdTags.textContent = '—'
      tdTags.style.color = 'var(--brmk-fg2)'
    }
    tr.appendChild(tdTags)

    const tdNote = document.createElement('td')
    const noteDiv = h('div', 'brmk-note-clip', rec.note ? truncate(rec.note, 30) : '—')
    if (rec.note) noteDiv.title = rec.note
    tdNote.appendChild(noteDiv)
    tr.appendChild(tdNote)

    const tdScene = document.createElement('td')
    tdScene.textContent = SCENE_LABELS[rec.firstSeen?.scene ?? 'manual'] ?? '—'
    tdScene.style.whiteSpace = 'nowrap'
    tdScene.style.color = 'var(--brmk-fg2)'
    tr.appendChild(tdScene)

    const tdTime = document.createElement('td')
    const timeDiv = h('div', '', relativeTime(rec.updatedAt))
    timeDiv.title = `创建：${formatTime(rec.createdAt)}\n更新：${formatTime(rec.updatedAt)}`
    timeDiv.style.whiteSpace = 'nowrap'
    tdTime.appendChild(timeDiv)
    tr.appendChild(tdTime)

    const tdActions = document.createElement('td')
    const actions = h('div', 'brmk-row-actions')
    actions.appendChild(
      btnAct('编辑', 'brmk-link-btn', 'edit', () => {
        openEditor({ mid: rec.mid, record: rec, nickname: rec.nickSnapshot, scene: 'manual' })
      }),
    )
    actions.appendChild(
      btnAct('空间', 'brmk-link-btn', 'open', () => {
        window.open(`https://space.bilibili.com/${rec.mid}`, '_blank', 'noopener,noreferrer')
      }),
    )
    actions.appendChild(
      btnAct('删除', 'brmk-link-btn brmk-danger', 'delete', () => {
        confirmAction('删除备注', `确定删除 mid ${rec.mid} 的备注吗？可在 5 秒内撤销。`, '删除', () => {
          const removed = store.remove(rec.mid)
          if (removed) {
            toast('备注已删除', {
              actionLabel: '撤销',
              duration: 5000,
              onAction: () => store.restore([removed]),
            })
          }
          state.selected.delete(rec.mid)
          renderAll()
        })
      }),
    )
    tdActions.appendChild(actions)
    tr.appendChild(tdActions)

    r.tbody.appendChild(tr)
  }

  r.empty.style.display = list.length ? 'none' : 'block'
  if (!list.length) {
    r.empty.textContent = ''
    r.empty.appendChild(h('b', '', store.count ? '没有匹配的记录' : '还没有任何备注'))
    r.empty.appendChild(
      document.createTextNode(
        store.count ? '换个关键词或清空筛选试试。' : '去视频页把鼠标移到 UP 主昵称上，点小铅笔就能加备注。',
      ),
    )
  }

  renderPager(r, list.length, totalPages)
  renderBatchBar(r)
}

function renderPager(r: Refs, total: number, totalPages: number): void {
  r.pager.textContent = ''
  const from = total ? (state.page - 1) * pageSize() + 1 : 0
  const to = Math.min(total, state.page * pageSize())
  r.pager.appendChild(h('span', '', `共 ${total} 条，当前 ${from}-${to}`))
  r.pager.appendChild(h('span', '', ' '))
  const prev = btn('上一页', 'brmk-btn', () => {
    if (state.page > 1) {
      state.page--
      renderTable(r)
    }
  })
  prev.disabled = state.page <= 1
  const next = btn('下一页', 'brmk-btn', () => {
    if (state.page < totalPages) {
      state.page++
      renderTable(r)
    }
  })
  next.disabled = state.page >= totalPages
  r.pager.append(prev, h('span', '', `${state.page} / ${totalPages}`), next)
}

function fieldRow(label: string, hint: string, control: HTMLElement, soon = false): HTMLElement {
  const row = h('div', 'brmk-row')
  const labelWrap = h('div', 'brmk-row-label', label)
  if (hint) labelWrap.appendChild(h('small', '', hint))
  if (soon) {
    const tag = h('span', 'brmk-soon', '后续版本')
    labelWrap.appendChild(tag)
  }
  const controlWrap = h('div', 'brmk-row-control')
  controlWrap.appendChild(control)
  row.append(labelWrap, controlWrap)
  return row
}

function numberInput(value: number, min: number, max: number, onChange: (n: number) => void): HTMLInputElement {
  const input = h('input')
  input.type = 'number'
  input.min = String(min)
  input.max = String(max)
  input.value = String(value)
  input.addEventListener('change', () => {
    const n = Math.min(max, Math.max(min, Math.round(Number(input.value) || value)))
    input.value = String(n)
    onChange(n)
  })
  return input
}

function renderSettings(r: Refs): void {
  const settings = getSettings()
  r.settingsView.textContent = ''

  const section = (title: string): HTMLElement => {
    const sec = h('div', 'brmk-sec')
    sec.appendChild(h('div', 'brmk-sec-head', title))
    r.settingsView.appendChild(sec)
    return sec
  }

  const basic = section('总览')
  basic.appendChild(
    fieldRow('启用备注显示', '关闭后页面不再注入任何标签，数据保留', switchEl(settings.enabled, (next) => {
      updateSettings((s) => {
        s.enabled = next
      })
      renderAll()
    })),
  )

  const scenes = section('场景开关')
  /** 场景说明：未实现的场景统一标「后续版本」 */
  const SCENE_HINTS: Partial<Record<SceneKey, string>> = {
    videoUp: '视频页 UP 主昵称旁显示备注',
    comment: '评论者昵称旁显示备注（主楼 + 楼中楼回复）',
    space: '个人空间右侧侧栏显示独立备注卡片',
    dynamic: '动态发布者与转发原作者昵称旁显示备注（opus / dyn 详情 / 关注流 / 空间动态列表）',
    card: '卡片 UP 主昵称旁显示备注（首页 / 搜索 / 视频页右栏）',
    relation: '关系列表用户昵称旁显示备注（粉丝 / 关注两个子页）',
    message: '私信会话列表与聊天窗对方昵称旁显示备注',
  }
  const sceneDefs: { key: SceneKey; soon: boolean }[] = [
    { key: 'videoUp', soon: false },
    { key: 'comment', soon: false },
    { key: 'space', soon: false },
    { key: 'dynamic', soon: false },
    { key: 'card', soon: false },
    { key: 'relation', soon: false },
    { key: 'message', soon: false },
  ]
  for (const def of sceneDefs) {
    scenes.appendChild(
      fieldRow(
        SCENE_LABELS[def.key],
        def.soon ? '本里程碑未实现，开关暂不生效' : (SCENE_HINTS[def.key] ?? ''),
        switchEl(settings.scenes[def.key], (next) => {
          updateSettings((s) => {
            s.scenes[def.key] = next
          })
        }, def.soon),
        def.soon,
      ),
    )
  }

  const display = section('显示')
  display.appendChild(
    fieldRow('显示标签胶囊', '备注标签跟在备注名后面', switchEl(settings.display.showTags, (next) => {
      updateSettings((s) => {
        s.display.showTags = next
      })
      renderAll()
    })),
  )
  display.appendChild(
    fieldRow('显示颜色圆点', '备注名前的小圆点', switchEl(settings.display.showColorDot, (next) => {
      updateSettings((s) => {
        s.display.showColorDot = next
      })
      renderAll()
    })),
  )
  display.appendChild(
    fieldRow(
      '最多显示标签数',
      '0 表示不显示标签',
      numberInput(settings.display.maxTags, 0, 5, (n) => {
        updateSettings((s) => {
          s.display.maxTags = n
        })
        renderAll()
      }),
    ),
  )
  display.appendChild(
    fieldRow('仅 hover 时显示', '不悬浮时备注半透明隐藏', switchEl(settings.display.showOnHoverOnly, (next) => {
      updateSettings((s) => {
        s.display.showOnHoverOnly = next
      })
      renderAll()
    })),
  )
  const positionSelect = h('select')
  positionSelect.appendChild(option('afterName', '昵称之后（追加）'))
  positionSelect.disabled = true
  display.appendChild(fieldRow('显示位置', '初版仅支持追加在昵称之后', positionSelect, true))
  const replaceSwitch = switchEl(false, () => {}, true)
  display.appendChild(fieldRow('用备注名替换昵称', '会改变页面原有文字，初版不做', replaceSwitch, true))

  const editorSec = section('编辑入口')
  const hotkey = h('input')
  hotkey.type = 'text'
  hotkey.value = settings.editor.hotkey
  hotkey.placeholder = 'Alt+R'
  hotkey.addEventListener('change', () => {
    const v = hotkey.value.trim() || 'Alt+R'
    hotkey.value = v
    updateSettings((s) => {
      s.editor.hotkey = v
    })
    toast('快捷键已保存，刷新页面后生效')
  })
  editorSec.appendChild(fieldRow('打开管理页快捷键', '格式如 Alt+R / Ctrl+Shift+R', hotkey))
  const entrySelect = h('select')
  entrySelect.appendChild(option('clickBadge', '点击备注标签'))
  entrySelect.disabled = true
  editorSec.appendChild(fieldRow('编辑气泡入口', '点击页面上已存在的备注标签', entrySelect, true))

  const managerSec = section('管理页')
  managerSec.appendChild(
    fieldRow(
      '每页条数',
      '10 ~ 500',
      numberInput(settings.manager.pageSize, 10, 500, (n) => {
        updateSettings((s) => {
          s.manager.pageSize = n
        })
        state.page = 1
        renderAll()
      }),
    ),
  )
  const themeSelect = h('select')
  themeSelect.appendChild(option('auto', '跟随页面'))
  themeSelect.appendChild(option('dark', '强制深色'))
  themeSelect.appendChild(option('light', '强制浅色'))
  themeSelect.value = settings.manager.theme
  themeSelect.addEventListener('change', () => {
    const value = themeSelect.value as 'auto' | 'dark' | 'light'
    updateSettings((s) => {
      s.manager.theme = value
    })
    applyPalette()
  })
  managerSec.appendChild(fieldRow('管理页面板配色', '不影响页面内备注标签', themeSelect))
  managerSec.appendChild(fieldRow('遮罩背景模糊', '打开管理页时模糊背后页面，更沉浸但更耗性能', switchEl(settings.manager.maskBlur, (next) => {
    updateSettings((s) => {
      s.manager.maskBlur = next
    })
    applyPalette()
  })))
  managerSec.appendChild(
    fieldRow(
      '面板层级 z-index',
      '与其他脚本冲突时调整',
      numberInput(settings.manager.zIndex, 1000, 2147483000, (n) => {
        updateSettings((s) => {
          s.manager.zIndex = n
        })
        if (refs) refs.root.style.zIndex = String(n)
      }),
    ),
  )

  const backupSec = section('备份')
  backupSec.appendChild(
    fieldRow(
      '导出提醒间隔',
      '0 表示不提醒',
      numberInput(settings.backup.remindIntervalDays, 0, 365, (n) => {
        updateSettings((s) => {
          s.backup.remindIntervalDays = n
        })
        renderAll()
      }),
    ),
  )
  const lastExport = h('span', '', settings.backup.lastExportAt ? formatTime(settings.backup.lastExportAt) : '从未导出')
  lastExport.style.fontSize = '12px'
  lastExport.style.color = 'var(--brmk-fg2)'
  backupSec.appendChild(fieldRow('上次导出时间', '导出的同时会写入时间', lastExport))
  backupSec.appendChild(
    fieldRow(
      '立即备份',
      '导出完整 JSON 到本地',
      btn('导出 JSON', 'brmk-btn brmk-btn-primary', () => doExportJson()),
    ),
  )

  const advanced = section('高级')
  advanced.appendChild(
    fieldRow(
      'DOM 观察去抖 (ms)',
      '150 ~ 2000，越大越省 CPU',
      numberInput(settings.advanced.observerDebounceMs, 50, 2000, (n) => {
        updateSettings((s) => {
          s.advanced.observerDebounceMs = n
        })
        toast('刷新页面后生效')
      }),
    ),
  )
  advanced.appendChild(
    fieldRow(
      '单批处理节点上限',
      '5 ~ 200',
      numberInput(settings.advanced.maxNodesPerTick, 5, 200, (n) => {
        updateSettings((s) => {
          s.advanced.maxNodesPerTick = n
        })
      }),
    ),
  )
  advanced.appendChild(
    fieldRow('调试模式', '控制台输出详细日志，并启用选择器体检', switchEl(settings.advanced.debug, (next) => {
      updateSettings((s) => {
        s.advanced.debug = next
      })
    })),
  )
  advanced.appendChild(
    fieldRow(
      '清空全部数据',
      '不可恢复，执行前会自动写一份备份到 GM 存储',
      btn('清空数据', 'brmk-btn brmk-btn-danger', () => {
        confirmAction('清空全部备注', `将删除 ${store.count} 条备注（会自动留一份备份）。确定继续？`, '清空', () => {
          store.clearAll()
          state.selected.clear()
          renderAll()
          toast('已清空全部备注')
        })
      }),
    ),
  )
  advanced.appendChild(
    fieldRow(
      '恢复默认设置',
      '只重置设置，不动备注数据',
      btn('恢复默认', 'brmk-btn', () => {
        confirmAction('恢复默认设置', '所有开关将回到初始状态，备注数据不受影响。', '恢复', () => {
          resetSettings()
          renderAll()
        })
      }),
    ),
  )

  const about = section('关于')
  const aboutText = h('div', 'brmk-row')
  const aboutLabel = h('div', 'brmk-row-label', `BiliRemark v${VERSION}`)
  aboutLabel.appendChild(h('small', '', '备注只存在本机浏览器扩展存储里，不会上传，也不会同步到 B 站账号。'))
  aboutText.appendChild(aboutLabel)
  about.appendChild(aboutText)
}

function renderAll(): void {
  const r = refs
  if (!r) return
  r.tabs.querySelectorAll<HTMLElement>('.brmk-tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab))
  })
  r.listView.style.display = state.tab === 'list' ? 'flex' : 'none'
  r.settingsView.style.display = state.tab === 'settings' ? 'block' : 'none'
  renderStats(r)
  renderWarn(r)
  if (state.tab === 'list') {
    renderTagOptions(r)
    renderTable(r)
  } else {
    renderSettings(r)
  }
}

function applyPalette(): void {
  const r = refs
  if (!r) return
  const s = getSettings()
  r.root.style.zIndex = String(s.manager.zIndex)
  if (s.manager.maskBlur) r.root.setAttribute('data-mask-blur', '1')
  else r.root.removeAttribute('data-mask-blur')
  const p = managerPalette()
  const set = (name: string, value: string): void => r.root.style.setProperty(name, value)
  set('--brmk-bg', p.bg)
  set('--brmk-bg2', p.bg2)
  set('--brmk-bg3', p.bg3)
  set('--brmk-fg', p.fg)
  set('--brmk-fg2', p.fg2)
  set('--brmk-border', p.border)
  set('--brmk-shadow', p.shadow)
  set('--brmk-accent', p.accent)
  set('--brmk-accent-weak', p.accentWeak)
  set('--brmk-accent-border', p.accentBorder)
  r.panel.style.background = p.bg
  r.panel.style.color = p.fg
}

function hideSub(): void {
  const r = refs
  if (!r) return
  r.subHost.textContent = ''
  r.subHost.style.display = 'none'
}

function showSub(title: string, build: (panel: HTMLElement) => void): void {
  const r = refs
  if (!r) return
  r.subHost.textContent = ''
  r.subHost.style.display = 'flex'
  const mask = h('div', 'brmk-submask')
  const panel = h('div', 'brmk-subpanel')
  const heading = h('h3', '', title)
  panel.appendChild(heading)
  build(panel)
  panel.addEventListener('click', (ev) => ev.stopPropagation())
  mask.addEventListener('click', () => hideSub())
  mask.appendChild(panel)
  r.subHost.appendChild(mask)
}

function confirmAction(title: string, text: string, okLabel: string, onOk: () => void): void {
  showSub(title, (panel) => {
    panel.appendChild(h('p', '', text))
    const foot = h('div', 'brmk-subfoot')
    foot.appendChild(btn('取消', 'brmk-btn', () => hideSub()))
    foot.appendChild(
      btnAct(okLabel, 'brmk-btn brmk-btn-danger', 'confirm-ok', () => {
        hideSub()
        try {
          onOk()
        } catch (err) {
          console.warn('[BiliRemark] 操作失败', err)
          toast('操作失败，详见控制台')
        }
      }),
    )
    panel.appendChild(foot)
  })
}

function doExportJson(): void {
  try {
    const text = store.exportJSON()
    downloadText(`bili-remark-${stampForFile()}.json`, text, 'application/json')
    updateSettings((s) => {
      s.backup.lastExportAt = Date.now()
    })
    renderAll()
    toast('已导出 JSON')
  } catch (err) {
    console.warn('[BiliRemark] 导出失败', err)
    toast('导出失败')
  }
}

function doExportCsv(): void {
  try {
    const text = store.exportCSV()
    downloadText(`bili-remark-${stampForFile()}.csv`, text, 'text/csv')
    updateSettings((s) => {
      s.backup.lastExportAt = Date.now()
    })
    renderAll()
    toast('已导出 CSV')
  } catch (err) {
    console.warn('[BiliRemark] 导出失败', err)
    toast('导出失败')
  }
}

function openExportDialog(): void {
  showSub('导出备注', (panel) => {
    panel.appendChild(
      h('p', '', 'JSON 是完整备份（含 schema 版本与来源信息），可再次导入；CSV 便于用表格软件查看，但不能导入。'),
    )
    const foot = h('div', 'brmk-subfoot')
    foot.appendChild(btnAct('导出 CSV', 'brmk-btn', 'export-csv', () => {
      hideSub()
      doExportCsv()
    }))
    foot.appendChild(btnAct('导出 JSON', 'brmk-btn brmk-btn-primary', 'export-json', () => {
      hideSub()
      doExportJson()
    }))
    panel.appendChild(foot)
  })
}

interface ParsedImport {
  records: UserRecord[]
  invalid: number
}

function parseImport(text: string): ParsedImport | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  let list: unknown[] = []
  if (Array.isArray(raw)) list = raw
  else if (obj.users && typeof obj.users === 'object' && !Array.isArray(obj.users)) {
    list = Object.entries(obj.users as Record<string, unknown>).map(([key, value]) =>
      value && typeof value === 'object' ? { ...(value as Record<string, unknown>), mid: (value as Record<string, unknown>).mid ?? key } : value,
    )
  } else return null

  const records: UserRecord[] = []
  let invalid = 0
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      invalid++
      continue
    }
    const rec = normalizeRecord(item as Record<string, unknown>)
    if (rec) records.push(rec)
    else invalid++
  }
  return { records, invalid }
}

function openImportDialog(): void {
  showSub('导入备注', (panel) => {
    panel.appendChild(
      h('p', '', '支持本脚本导出的 JSON，或包含 users 对象的同结构 JSON。导入前会先展示将新增/更新/跳过多少条，确认后才写入。'),
    )

    const fileRow = h('div')
    fileRow.style.display = 'flex'
    fileRow.style.gap = '8px'
    fileRow.style.alignItems = 'center'
    fileRow.style.marginBottom = '8px'
    const fileInput = h('input')
    fileInput.setAttribute('data-field', 'import-file')
    fileInput.type = 'file'
    fileInput.accept = '.json,application/json'
    fileInput.style.fontSize = '12px'
    fileRow.appendChild(fileInput)
    panel.appendChild(fileRow)

    const textarea = h('textarea')
    textarea.setAttribute('data-field', 'import-text')
    textarea.placeholder = '或把 JSON 粘贴到这里'
    panel.appendChild(textarea)

    const strategyRow = h('div')
    strategyRow.style.display = 'flex'
    strategyRow.style.alignItems = 'center'
    strategyRow.style.gap = '8px'
    strategyRow.style.marginTop = '10px'
    strategyRow.appendChild(h('span', '', '合并策略'))
    const strategySelect = h('select')
    strategySelect.setAttribute('data-field', 'import-strategy')
    strategySelect.appendChild(option('newer', '按 mid 合并，保留较新（默认）'))
    strategySelect.appendChild(option('only-new', '仅新增，不覆盖已有'))
    strategySelect.appendChild(option('replace', '覆盖全部（导入为准）'))
    strategyRow.appendChild(strategySelect)
    panel.appendChild(strategyRow)

    const preview = h('div', 'brmk-preview')
    panel.appendChild(preview)

    let parsed: ParsedImport | null = null

    const refreshPreview = (): void => {
      preview.textContent = ''
      if (!parsed) return
      const strategy = strategySelect.value as MergeStrategy
      const p = store.previewImport(parsed.records, strategy)
      const add = (text: string): void => {
        preview.appendChild(h('span', '', text))
      }
      add(`新增 ${p.added}`)
      add(`更新 ${p.updated}`)
      add(`跳过 ${p.skipped}`)
      if (p.removed) add(`删除 ${p.removed}`)
      if (parsed.invalid) add(`无效 ${parsed.invalid}`)
    }

    const tryParse = (text: string): void => {
      if (!text.trim()) {
        parsed = null
        preview.textContent = ''
        return
      }
      parsed = parseImport(text)
      if (!parsed) {
        preview.textContent = ''
        preview.appendChild(h('span', '', 'JSON 解析失败或结构不符合要求'))
        return
      }
      refreshPreview()
    }

    textarea.addEventListener('input', () => tryParse(textarea.value))
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result ?? '')
        textarea.value = text
        tryParse(text)
      }
      reader.readAsText(file)
    })
    strategySelect.addEventListener('change', refreshPreview)

    const foot = h('div', 'brmk-subfoot')
    foot.appendChild(btn('取消', 'brmk-btn', () => hideSub()))
    const okBtn = btnAct('确认导入', 'brmk-btn brmk-btn-primary', 'import-ok', () => {
      if (!parsed) {
        toast('请先选择文件或粘贴 JSON')
        return
      }
      if (!parsed.records.length) {
        toast('没有可导入的记录')
        return
      }
      const strategy = strategySelect.value as MergeStrategy
      const p = store.applyImport(parsed.records, strategy)
      hideSub()
      renderAll()
      toast(`导入完成：新增 ${p.added}，更新 ${p.updated}，跳过 ${p.skipped}`)
    })
    foot.appendChild(okBtn)
    panel.appendChild(foot)
  })
}

function bind(r: Refs): void {
  r.search.addEventListener('input', () => {
    state.search = r.search.value
    state.page = 1
    renderTable(r)
  })

  r.tabs.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>('.brmk-tab')
    if (!target || !target.dataset.tab) return
    state.tab = target.dataset.tab as Tab
    renderAll()
  })

  r.tagSelect.addEventListener('change', () => {
    state.tag = r.tagSelect.value
    state.page = 1
    renderTable(r)
  })
  r.sceneSelect.addEventListener('change', () => {
    state.scene = r.sceneSelect.value
    state.page = 1
    renderTable(r)
  })
  r.noteSelect.addEventListener('change', () => {
    state.hasNote = r.noteSelect.value as 'any' | 'yes' | 'no'
    state.page = 1
    renderTable(r)
  })
  r.sortSelect.addEventListener('change', () => {
    state.sortKey = r.sortSelect.value as SortKey
    renderTable(r)
  })
  r.dirBtn.addEventListener('click', () => {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc'
    r.dirBtn.textContent = state.sortDir === 'desc' ? '↓ 降序' : '↑ 升序'
    renderTable(r)
  })

  const checkAll = r.panel.querySelector<HTMLInputElement>('.brmk-check-all')
  checkAll?.addEventListener('change', () => {
    const list = filteredRecords()
    const start = (state.page - 1) * pageSize()
    const rows = list.slice(start, start + pageSize())
    if (checkAll.checked) for (const row of rows) state.selected.add(row.mid)
    else state.selected.clear()
    renderTable(r)
  })

  r.root.addEventListener('click', (ev) => {
    if (ev.target === r.root) closeManager()
  })

  const onKey = (ev: KeyboardEvent): void => {
    if (!refs) return
    if (!refs.subHost.contains(document.activeElement) && ev.key === 'Escape') {
      if (refs.subHost.style.display === 'flex') {
        hideSub()
        return
      }
      closeManager()
      return
    }
    const active = document.activeElement
    const inInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
    if (!inInput && ev.key === '/') {
      ev.preventDefault()
      refs.search.focus()
    }
    if (!inInput && ev.key === 'Delete' && state.selected.size) {
      const mids = Array.from(state.selected)
      confirmAction('批量删除', `将删除 ${mids.length} 条备注，可在 5 秒内撤销。`, '删除', () => {
        const removed = store.removeMany(mids)
        state.selected.clear()
        if (removed.length) {
          toast(`已删除 ${removed.length} 条`, {
            actionLabel: '撤销',
            duration: 5000,
            onAction: () => store.restore(removed),
          })
        }
        renderAll()
      })
    }
  }
  keyHandler = onKey
  document.addEventListener('keydown', onKey)
}

function buildShell(): Refs {
  const settings = getSettings()
  const root = h('div')
  root.id = 'brmk-manager'
  root.style.zIndex = String(settings.manager.zIndex)

  const panel = h('div', 'brmk-panel')

  const head = h('div', 'brmk-head')
  const title = h('div', 'brmk-title', '备注管理')
  const countBadge = h('small', '', '0')
  title.appendChild(countBadge)
  const search = h('input', 'brmk-search')
  search.type = 'search'
  search.setAttribute('data-field', 'search')
  search.placeholder = '搜索备注名 / 昵称 / mid / 正文（按 / 聚焦）'
  const headActions = h('div', 'brmk-head-actions')
  headActions.appendChild(
    btnAct('新增', 'brmk-btn', 'add', () => {
      openEditor({ allowMidEdit: true, scene: 'manual' })
    }),
  )
  headActions.appendChild(btnAct('导入', 'brmk-btn', 'import', () => openImportDialog()))
  headActions.appendChild(btnAct('导出', 'brmk-btn', 'export', () => openExportDialog()))
  headActions.appendChild(
    btnAct('设置', 'brmk-btn', 'settings', () => {
      state.tab = 'settings'
      renderAll()
    }),
  )
  headActions.appendChild(btnAct('✕', 'brmk-btn', 'close', () => closeManager()))
  head.append(title, search, headActions)

  const tabs = h('div', 'brmk-tabs')
  const listTab = h('button', 'brmk-tab', '列表')
  listTab.type = 'button'
  listTab.dataset.tab = 'list'
  const settingsTab = h('button', 'brmk-tab', '设置')
  settingsTab.type = 'button'
  settingsTab.dataset.tab = 'settings'
  tabs.append(listTab, settingsTab)

  const stats = h('div', 'brmk-stats')
  const warn = h('div')
  const listView = h('div')
  listView.style.display = 'flex'
  listView.style.flexDirection = 'column'
  listView.style.flex = '1 1 auto'
  listView.style.minHeight = '0'

  const toolbar = h('div', 'brmk-toolbar')
  const tagSelect = h('select')
  tagSelect.setAttribute('data-field', 'tag')
  const sceneSelect = h('select')
  sceneSelect.setAttribute('data-field', 'scene')
  const noteSelect = h('select')
  noteSelect.setAttribute('data-field', 'note')
  noteSelect.appendChild(option('any', '正文：全部'))
  noteSelect.appendChild(option('yes', '有正文'))
  noteSelect.appendChild(option('no', '无正文'))
  const sortSelect = h('select')
  sortSelect.setAttribute('data-field', 'sort')
  sortSelect.appendChild(option('updatedAt', '按更新时间'))
  sortSelect.appendChild(option('createdAt', '按创建时间'))
  sortSelect.appendChild(option('remark', '按备注名'))
  sortSelect.appendChild(option('mid', '按 mid'))
  sortSelect.value = 'updatedAt'
  const dirBtn = btn('↓ 降序', 'brmk-btn', () => {})
  dirBtn.setAttribute('data-act', 'sortdir')
  toolbar.append(tagSelect, sceneSelect, noteSelect, sortSelect, dirBtn, h('span', 'brmk-spacer'))

  const batchBar = h('div', 'brmk-toolbar')
  batchBar.style.display = 'none'
  batchBar.style.paddingTop = '0'

  const bodyWrap = h('div', 'brmk-body')
  const table = h('table')
  const thead = h('thead')
  const headRow = document.createElement('tr')
  const thCheck = document.createElement('th')
  thCheck.style.width = '28px'
  const checkAll = h('input')
  checkAll.type = 'checkbox'
  checkAll.className = 'brmk-check-all'
  thCheck.appendChild(checkAll)
  headRow.appendChild(thCheck)
  for (const label of ['用户', 'mid', '备注名', '标签', '正文', '场景', '更新时间', '操作']) {
    const th = h('th', '', label)
    headRow.appendChild(th)
  }
  thead.appendChild(headRow)
  const tbody = h('tbody')
  table.append(thead, tbody)
  bodyWrap.appendChild(table)
  const empty = h('div', 'brmk-empty')
  empty.style.display = 'none'
  bodyWrap.appendChild(empty)

  const pager = h('div', 'brmk-pager')

  listView.append(toolbar, batchBar, bodyWrap, pager)

  const settingsView = h('div', 'brmk-settings')
  settingsView.style.display = 'none'

  const subHost = h('div')
  subHost.style.display = 'none'
  subHost.style.position = 'absolute'
  subHost.style.inset = '0'

  panel.append(head, tabs, stats, warn, listView, settingsView, subHost)
  root.appendChild(panel)

  return {
    root,
    panel,
    countBadge,
    search,
    stats,
    warn,
    tabs,
    listView,
    settingsView,
    toolbar,
    tagSelect,
    sceneSelect,
    noteSelect,
    sortSelect,
    dirBtn,
    batchBar,
    bodyWrap,
    tbody,
    empty,
    pager,
    subHost,
  }
}

export function isManagerOpen(): boolean {
  return !!refs
}

export function openManager(tab: Tab = 'list'): void {
  if (refs) {
    state.tab = tab
    renderAll()
    return
  }
  const r = buildShell()
  refs = r
  state.tab = tab
  state.page = 1
  state.selected.clear()
  document.body.appendChild(r.root)
  applyPalette()
  r.panel.addEventListener('scroll', onPanelScroll, true)
  bind(r)
  renderAll()

  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  unbindBus = on('data-changed', () => {
    if (!refs) return
    scheduleDataRender()
  })
  const unbindTheme = on('theme-changed', () => applyPalette())
  const prevUnbind = unbindBus
  unbindBus = () => {
    prevUnbind?.()
    unbindTheme()
  }

  window.setTimeout(() => r.search.focus(), 30)
}

export function closeManager(): void {
  if (!refs) return
  const r = refs
  refs = null
  clearRenderSchedule()
  r.panel.removeEventListener('scroll', onPanelScroll, true)
  hideSub()
  r.root.remove()
  document.body.style.overflow = prevOverflow
  unbindBus?.()
  unbindBus = null
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
  state.selected.clear()
}

export function toggleManager(): void {
  if (refs) closeManager()
  else openManager()
}

/** 供 debug 面板使用 */
export const managerDebugInfo = {
  palettePreview: (): string => {
    const p = paletteOf(getTheme())
    return `bg=${p.bg} fg=${p.fg} accent=${p.accent}`
  },
  tagColors: TAG_PRESET_COLORS.length,
}
