import { getSettings } from '../core/config'
import { LIMITS } from '../core/constants'
import { pageUrlMid } from '../core/midResolver'
import { rememberNick, setDiagnostic, type SceneDiagnostic } from '../core/runtime'
import { store } from '../core/store'
import type { SceneKey, UserRecord } from '../core/types'
import { formatDay } from '../util/format'
import { h, qsa } from '../util/dom'
import { log, warn } from '../util/log'
import { openEditor } from '../ui/editor'
import { toast } from '../ui/toast'

/** 宿主选择器：新版空间页右侧黑色侧栏。改版时只动这里（实测记录见 tests/selectors.md） */
const HOST_CANDIDATES = ['.aside']

const CARD_ID = 'brmk-space-card'
const SCENE: SceneKey = 'space'

/** 本地夹具显式标记：生产页面不会出现该属性，避免在任意 127.0.0.1 页误注入 */
const FIXTURE_ATTR = 'data-brmk-space-fixture'
const SPACE_HOST_RE = /^space\.bilibili\.com$/i
const SPACE_PATH_RE = /^\/(\d{1,20})(?:\/|$)/

let card: HTMLElement | null = null
let cardMid = ''
let editing = false
let lastSig = ''
let draftTags: string[] = []
/** 由 mount 注册的查看态重绘函数；scan 里按签名决定是否调用 */
let refreshView: (() => void) | null = null

export function isSpacePage(): boolean {
  if (!SPACE_HOST_RE.test(location.hostname) && !document.documentElement.hasAttribute(FIXTURE_ATTR)) {
    return false
  }
  return SPACE_PATH_RE.test(location.pathname)
}

/** 空间页 mid：路径即 mid，兜底走 href 正则 */
export function spaceMid(): string | null {
  const m = SPACE_PATH_RE.exec(location.pathname)
  if (m && m[1] !== '0') return m[1]
  return pageUrlMid()
}

/** 空间页标题形如「余音度半的个人空间-…」，取前段作昵称快照 */
function titleNickname(): string {
  const title = document.title || ''
  const m = /^(.+?)的个人空间/.exec(title)
  return m ? m[1].trim().slice(0, 100) : ''
}

function findHost(): { host: Element | null; hits: { selector: string; hits: number }[] } {
  const hits: { selector: string; hits: number }[] = []
  for (const selector of HOST_CANDIDATES) {
    const found = qsa(selector)
    hits.push({ selector, hits: found.length })
    if (found.length) return { host: found[0], hits }
  }
  return { host: null, hits }
}

function hasContent(record: UserRecord | undefined): boolean {
  if (!record) return false
  return !!record.remark || record.tags.length > 0 || !!record.note.trim()
}

/** 查看态内容签名：没变就不重绘，避免每轮巡检都抖 DOM */
function signatureOf(record: UserRecord | undefined): string {
  return [
    record?.remark ?? '',
    record?.tags.join('\u0001') ?? '',
    record?.note ?? '',
    String(record?.updatedAt ?? 0),
    record?.color ?? '',
  ].join('\u0002')
}

function destroy(): void {
  card?.remove()
  card = null
  cardMid = ''
  editing = false
  lastSig = ''
  draftTags = []
  refreshView = null
}

/** 构建模块（只在首次注入或 mid 变化时调用） */
function mount(host: Element, mid: string): HTMLElement {
  const nickname = titleNickname()
  if (nickname) rememberNick(mid, nickname)

  const el = h('div', 'brmk-space-card')
  el.id = CARD_ID
  el.setAttribute('data-brmk-mid', mid)
  el.setAttribute('data-brmk-scene', SCENE)

  // ---- 头部 ----
  const head = h('div', 'brmk-sp-head')
  const title = h('span', 'brmk-sp-title', '备注')
  const editBtn = h('button', 'brmk-sp-link', '编辑备注')
  editBtn.type = 'button'
  editBtn.setAttribute('data-act', 'edit')
  head.append(title, editBtn)

  // ---- 查看态 ----
  const view = h('div', 'brmk-sp-view')
  const nameRow = h('div', 'brmk-sp-name')
  const dot = h('span', 'brmk-sp-dot')
  const nameText = h('span', 'brmk-sp-nametext')
  nameRow.append(dot, nameText)
  const tagsRow = h('div', 'brmk-sp-tags')
  const noteEl = h('div', 'brmk-sp-note')
  const foot = h('div', 'brmk-sp-foot')
  const footMeta = h('span', 'brmk-sp-meta')
  const footSpacer = h('span', 'brmk-sp-spacer')
  const advBtn = h('button', 'brmk-sp-link brmk-sp-adv', '高级编辑')
  advBtn.type = 'button'
  advBtn.setAttribute('data-act', 'advanced')
  foot.append(footMeta, footSpacer, advBtn)
  view.append(nameRow, tagsRow, noteEl, foot)

  // ---- 空态 ----
  const empty = h('div', 'brmk-sp-empty')
  const emptyText = h('div', 'brmk-sp-emptytext', '还没给这位用户写备注。')
  const addBtn = h('button', 'brmk-btn brmk-btn-primary', '添加备注')
  addBtn.type = 'button'
  addBtn.setAttribute('data-act', 'add')
  empty.append(emptyText, addBtn)

  // ---- 编辑态 ----
  const editor = h('div', 'brmk-sp-editor')

  const remarkLabel = h('label', 'brmk-sp-label', `备注名（≤${LIMITS.remark} 字）`)
  const remarkInput = h('input', 'brmk-sp-input')
  remarkInput.type = 'text'
  remarkInput.maxLength = LIMITS.remark
  remarkInput.placeholder = '例如：老番茄 / 某某的另一个号'
  remarkInput.setAttribute('data-field', 'remark')

  const tagLabel = h('label', 'brmk-sp-label', `标签（≤${LIMITS.tags} 个，回车添加）`)
  const chips = h('div', 'brmk-sp-chips')
  const tagInput = h('input', 'brmk-sp-input')
  tagInput.type = 'text'
  tagInput.maxLength = LIMITS.tag
  tagInput.placeholder = '输入后按回车'
  tagInput.setAttribute('data-field', 'tag')

  const noteLabel = h('label', 'brmk-sp-label', `长文本备注（≤${LIMITS.note} 字，仅自己可见）`)
  const noteInput = h('textarea', 'brmk-sp-textarea')
  noteInput.maxLength = LIMITS.note
  noteInput.placeholder = '为什么备注这个人、注意什么……'
  noteInput.setAttribute('data-field', 'note')

  const counter = h('div', 'brmk-sp-counter')
  const countNum = h('span', 'brmk-sp-count', '0')
  counter.append(countNum, document.createTextNode(`/${LIMITS.note}`))

  const actions = h('div', 'brmk-sp-actions')
  const cancelBtn = h('button', 'brmk-btn', '取消')
  cancelBtn.type = 'button'
  cancelBtn.setAttribute('data-act', 'cancel')
  const saveBtn = h('button', 'brmk-btn brmk-btn-primary', '保存')
  saveBtn.type = 'button'
  saveBtn.setAttribute('data-act', 'save')
  actions.append(cancelBtn, saveBtn)

  editor.append(remarkLabel, remarkInput, tagLabel, chips, tagInput, noteLabel, noteInput, counter, actions)

  el.append(head, view, empty, editor)
  host.appendChild(el)

  // ---------------- 交互 ----------------

  const currentRecord = (): UserRecord | undefined => store.get(mid)

  const renderChips = (): void => {
    chips.textContent = ''
    draftTags.forEach((tag, index) => {
      const chip = h('span', 'brmk-sp-chip', tag)
      const remove = h('button', 'brmk-sp-chipx', '×')
      remove.type = 'button'
      remove.title = '移除标签'
      remove.setAttribute('data-act', 'chip-remove')
      remove.addEventListener('click', () => {
        draftTags.splice(index, 1)
        renderChips()
      })
      chip.appendChild(remove)
      chips.appendChild(chip)
    })
    tagInput.disabled = draftTags.length >= LIMITS.tags
    tagInput.placeholder = draftTags.length >= LIMITS.tags ? '已达标签上限' : '输入后按回车'
  }

  const addTag = (): void => {
    const raw = tagInput.value.trim().replace(/[,，;；]/g, '')
    tagInput.value = ''
    if (!raw) return
    if (draftTags.length >= LIMITS.tags) {
      toast(`最多 ${LIMITS.tags} 个标签`)
      return
    }
    const tag = raw.slice(0, LIMITS.tag)
    if (draftTags.includes(tag)) return
    draftTags.push(tag)
    renderChips()
  }

  const syncCount = (): void => {
    countNum.textContent = String(noteInput.value.length)
  }

  const renderView = (): void => {
    const record = currentRecord()
    const filled = hasContent(record)
    view.hidden = !filled
    empty.hidden = filled
    editor.hidden = true
    // 空态由卡片内的「添加备注」按钮承担入口，头部不再重复
    editBtn.hidden = !filled
    editBtn.textContent = '编辑备注'
    if (!filled) return

    nameText.textContent = record?.remark || record?.nickSnapshot || `mid ${mid}`
    if (record?.color) el.style.setProperty('--brmk-sp-c', record.color)
    else el.style.removeProperty('--brmk-sp-c')
    tagsRow.textContent = ''
    for (const tag of record?.tags ?? []) tagsRow.appendChild(h('span', 'brmk-sp-tag', tag))
    tagsRow.hidden = !(record?.tags.length ?? 0)
    noteEl.textContent = record?.note ?? ''
    noteEl.hidden = !record?.note.trim()
    footMeta.textContent = `mid ${mid} · 更新于 ${formatDay(record?.updatedAt ?? Date.now())}`
  }

  const enterEdit = (): void => {
    const record = currentRecord()
    draftTags = record?.tags ? [...record.tags] : []
    remarkInput.value = record?.remark ?? ''
    noteInput.value = record?.note ?? ''
    tagInput.value = ''
    renderChips()
    syncCount()
    editing = true
    view.hidden = true
    empty.hidden = true
    editor.hidden = false
    editBtn.hidden = true
    lastSig = ''
    remarkInput.focus()
  }

  const exitEdit = (): void => {
    editing = false
    editor.hidden = true
    lastSig = ''
    renderView()
  }

  const doSave = (): void => {
    const liveMid = spaceMid()
    if (!liveMid || liveMid !== mid) {
      toast('页面已切换用户，本次内容未保存')
      exitEdit()
      return
    }
    const remark = remarkInput.value.trim()
    const note = noteInput.value
    if (!remark && !draftTags.length && !note.trim()) {
      toast('备注名、标签、正文至少填一项')
      remarkInput.focus()
      return
    }
    const saved = store.upsert(
      { mid, remark, tags: [...draftTags], note, nickSnapshot: currentRecord()?.nickSnapshot ?? titleNickname() },
      { scene: SCENE, url: location.href },
    )
    if (!saved) {
      toast('保存失败，请检查输入')
      return
    }
    toast('备注已保存')
    exitEdit()
  }

  editBtn.addEventListener('click', enterEdit)
  addBtn.addEventListener('click', enterEdit)
  advBtn.addEventListener('click', () => {
    openEditor({
      mid,
      record: currentRecord() ?? null,
      anchor: el,
      nickname: currentRecord()?.nickSnapshot ?? titleNickname(),
      scene: SCENE,
    })
  })
  cancelBtn.addEventListener('click', exitEdit)
  saveBtn.addEventListener('click', doSave)

  tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === '，') {
      ev.preventDefault()
      addTag()
    } else if (ev.key === 'Backspace' && !tagInput.value && draftTags.length) {
      draftTags.pop()
      renderChips()
    }
  })
  tagInput.addEventListener('blur', () => {
    if (tagInput.value.trim()) addTag()
  })
  noteInput.addEventListener('input', syncCount)

  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && editing) {
      ev.stopPropagation()
      exitEdit()
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && editing) {
      ev.preventDefault()
      doSave()
    }
  })

  renderView()
  lastSig = signatureOf(currentRecord())
  refreshView = renderView
  log('空间侧栏备注模块已注入', mid)
  return el
}

/** 扫描并幂等注入；返回诊断信息供体检面板使用 */
export function scanSpaceAside(): SceneDiagnostic {
  const { host, hits } = findHost()
  const mid = spaceMid()
  const diag: SceneDiagnostic = {
    scene: SCENE,
    label: '个人空间侧栏',
    selectors: hits,
    midResolved: mid ? 1 : 0,
    injected: 0,
    notes: [],
  }

  if (!isSpacePage()) {
    destroy()
    diag.notes.push('当前页不是空间页，已卸载模块')
    setDiagnostic(diag)
    return diag
  }
  if (!mid) {
    destroy()
    diag.notes.push('URL 里没有解析到 mid，页面结构或路由可能已变')
    setDiagnostic(diag)
    return diag
  }
  if (!host) {
    destroy()
    diag.notes.push('未找到 .aside 侧栏（可能未登录、页面未渲染完或已改版）')
    setDiagnostic(diag)
    return diag
  }

  const alive = card && card.isConnected && card.parentElement === host
  if (!alive || cardMid !== mid) {
    destroy()
    try {
      card = mount(host, mid)
      cardMid = mid
      diag.injected = 1
    } catch (err) {
      warn('注入空间侧栏备注模块失败', err)
      diag.notes.push('注入异常，详见控制台')
    }
  } else {
    diag.injected = 1
    // 编辑态不刷新，避免打断输入；查看态按内容签名判断是否需要重绘
    if (!editing) {
      const sig = signatureOf(store.get(mid))
      if (sig !== lastSig) {
        lastSig = sig
        refreshView?.()
      }
    }
  }

  if (!getSettings().scenes[SCENE]) {
    destroy()
    diag.injected = 0
    diag.notes.push('「个人空间」场景开关已关闭')
  }

  setDiagnostic(diag)
  return diag
}

export function clearSpaceAside(): void {
  destroy()
}

/** 供测试/调试：当前是否已注入 */
export function spaceAsideMounted(): boolean {
  return !!card && card.isConnected
}
