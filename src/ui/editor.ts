import { LIMITS, TAG_PRESET_COLORS } from '../core/constants'
import { getSettings } from '../core/config'
import { store } from '../core/store'
import type { SceneKey, UserRecord } from '../core/types'
import { h, truncate } from '../util/dom'
import { toast } from './toast'

export interface EditorOptions {
  mid?: string
  record?: UserRecord | null
  anchor?: Element | null
  nickname?: string
  face?: string
  scene?: SceneKey | 'manual'
  allowMidEdit?: boolean
  onSaved?: (record: UserRecord) => void
  onDeleted?: (mid: string) => void
}

let root: HTMLElement | null = null
let cleanupFns: Array<() => void> = []

export function closeEditor(): void {
  for (const fn of cleanupFns) fn()
  cleanupFns = []
  if (root) {
    root.remove()
    root = null
  }
}

function clampPosition(el: HTMLElement, anchor: Element | null): void {
  const margin = 8
  const rect = el.getBoundingClientRect()
  let left: number
  let top: number

  if (anchor && anchor.isConnected) {
    const a = anchor.getBoundingClientRect()
    left = a.left
    top = a.bottom + 6
    if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, a.top - rect.height - 6)
  } else {
    left = (window.innerWidth - rect.width) / 2
    top = (window.innerHeight - rect.height) / 2
  }

  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin))
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin))
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

export function openEditor(options: EditorOptions = {}): void {
  closeEditor()

  const existing = options.mid ? store.get(options.mid) : null
  const record = options.record ?? existing ?? null
  let mid = options.mid ?? record?.mid ?? ''
  let tags: string[] = record?.tags ? [...record.tags] : []
  let color: string | null = record?.color ?? null
  const allowMidEdit = options.allowMidEdit ?? !mid

  const el = h('div')
  el.id = 'brmk-editor'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '用户备注')
  el.style.position = 'fixed'
  el.style.zIndex = String(Math.max(getSettings().manager.zIndex + 10, 10000))

  const head = h('div', 'brmk-ed-head')
  const titleWrap = h('div')
  const title = h('div', 'brmk-ed-title', record ? '编辑备注' : '添加备注')
  const sub = h(
    'div',
    'brmk-ed-sub',
    [options.nickname || record?.nickSnapshot || '', mid ? `mid ${mid}` : '尚未选择用户'].filter(Boolean).join(' · '),
  )
  titleWrap.append(title, sub)
  const closeBtn = h('button', 'brmk-ed-close', '✕')
  closeBtn.type = 'button'
  closeBtn.title = '关闭（Esc）'
  closeBtn.addEventListener('click', () => closeEditor())
  head.append(titleWrap, closeBtn)
  el.appendChild(head)

  const hint = h('div', 'brmk-ed-hint', '')

  const midInputWrapper = h('div', 'brmk-field')
  const midLabel = h('label', 'brmk-label', '用户 mid')
  const midInput = h('input', 'brmk-input')
  midInput.type = 'text'
  midInput.inputMode = 'numeric'
  midInput.placeholder = '纯数字，如 946974'
  midInput.setAttribute('data-field', 'mid')
  midInput.value = mid
  if (!allowMidEdit) {
    midInput.disabled = true
    midInput.title = '已有记录不可改 mid'
  }
  midInputWrapper.append(midLabel, midInput)

  const remarkField = h('div', 'brmk-field')
  const remarkLabel = h('label', 'brmk-label', `备注名（≤${LIMITS.remark} 字）`)
  const remarkInput = h('input', 'brmk-input')
  remarkInput.type = 'text'
  remarkInput.maxLength = LIMITS.remark
  remarkInput.placeholder = '例如：老番茄 / 某某的另一个号'
  remarkInput.setAttribute('data-field', 'remark')
  remarkInput.value = record?.remark ?? ''
  remarkField.append(remarkLabel, remarkInput)

  const tagField = h('div', 'brmk-field')
  const tagLabel = h('label', 'brmk-label', `标签（≤${LIMITS.tags} 个，回车添加）`)
  const chips = h('div', 'brmk-chips')
  const tagInput = h('input', 'brmk-input')
  tagInput.type = 'text'
  tagInput.maxLength = LIMITS.tag
  tagInput.placeholder = tags.length >= LIMITS.tags ? '已达标签上限' : '输入后按回车'
  tagInput.setAttribute('data-field', 'tag')
  tagField.append(tagLabel, chips, tagInput)

  const renderChips = (): void => {
    chips.textContent = ''
    tags.forEach((tag, index) => {
      const chip = h('span', 'brmk-chip', tag)
      const remove = h('button', '', '×')
      remove.type = 'button'
      remove.title = '移除标签'
      remove.addEventListener('click', () => {
        tags.splice(index, 1)
        renderChips()
      })
      chip.appendChild(remove)
      chips.appendChild(chip)
    })
    tagInput.disabled = tags.length >= LIMITS.tags
    tagInput.placeholder = tags.length >= LIMITS.tags ? '已达标签上限' : '输入后按回车'
  }

  const addTag = (): void => {
    const raw = tagInput.value.trim().replace(/[,，;；]/g, '')
    tagInput.value = ''
    if (!raw) return
    if (tags.length >= LIMITS.tags) {
      toast(`最多 ${LIMITS.tags} 个标签`)
      return
    }
    const tag = truncate(raw, LIMITS.tag)
    if (tags.includes(tag)) return
    tags.push(tag)
    renderChips()
  }

  tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === '，') {
      ev.preventDefault()
      addTag()
    } else if (ev.key === 'Backspace' && !tagInput.value && tags.length) {
      tags.pop()
      renderChips()
    }
  })
  tagInput.addEventListener('blur', () => {
    if (tagInput.value.trim()) addTag()
  })
  renderChips()

  const colorField = h('div', 'brmk-field')
  const colorLabel = h('label', 'brmk-label', '颜色')
  const colorRow = h('div', 'brmk-colors')

  const makeSwatch = (value: string | null, titleText: string): HTMLButtonElement => {
    const btn = h('button', 'brmk-swatch')
    btn.type = 'button'
    btn.title = titleText
    btn.setAttribute('aria-pressed', String(color === value))
    btn.style.background = value ?? 'transparent'
    if (value === null) {
      btn.style.background = 'linear-gradient(135deg, #FB7299 50%, #3FA9F5 50%)'
    }
    btn.addEventListener('click', () => {
      color = value
      for (const child of Array.from(colorRow.querySelectorAll('.brmk-swatch'))) {
        child.setAttribute('aria-pressed', 'false')
      }
      btn.setAttribute('aria-pressed', 'true')
      colorInput.value = value ?? '#fb7299'
    })
    return btn
  }

  colorRow.appendChild(makeSwatch(null, '跟随主题色'))
  for (const preset of TAG_PRESET_COLORS) colorRow.appendChild(makeSwatch(preset, preset))

  const colorInput = h('input', 'brmk-color-input')
  colorInput.type = 'color'
  colorInput.value = color ?? '#fb7299'
  colorInput.title = '自定义颜色'
  colorInput.addEventListener('input', () => {
    color = colorInput.value
    for (const child of Array.from(colorRow.querySelectorAll('.brmk-swatch'))) {
      child.setAttribute('aria-pressed', 'false')
    }
  })
  colorRow.appendChild(colorInput)
  colorField.append(colorLabel, colorRow)

  const noteField = h('div', 'brmk-field')
  const noteLabel = h('label', 'brmk-label', `长文本备注（≤${LIMITS.note} 字，仅自己可见）`)
  const noteInput = h('textarea', 'brmk-textarea')
  noteInput.maxLength = LIMITS.note
  noteInput.placeholder = '为什么备注这个人、注意什么……'
  noteInput.setAttribute('data-field', 'note')
  noteInput.value = record?.note ?? ''
  noteField.append(noteLabel, noteInput)

  const foot = h('div', 'brmk-ed-foot')
  const deleteBtn = h('button', 'brmk-btn brmk-btn-danger', '删除')
  deleteBtn.type = 'button'
  deleteBtn.setAttribute('data-act', 'delete')
  deleteBtn.style.display = record ? '' : 'none'
  const cancelBtn = h('button', 'brmk-btn', '取消')
  cancelBtn.type = 'button'
  cancelBtn.setAttribute('data-act', 'cancel')
  const saveBtn = h('button', 'brmk-btn brmk-btn-primary', '保存')
  saveBtn.type = 'button'
  saveBtn.setAttribute('data-act', 'save')
  foot.append(hint, deleteBtn, cancelBtn, saveBtn)

  el.append(midInputWrapper, remarkField, tagField, colorField, noteField, foot)

  const doSave = (): void => {
    const finalMid = (allowMidEdit ? midInput.value : mid).trim()
    if (!/^\d{1,20}$/.test(finalMid) || finalMid === '0') {
      hint.textContent = '请填写正确的数字 mid'
      midInput.focus()
      return
    }
    const remark = remarkInput.value.trim()
    const note = noteInput.value
    if (!remark && !tags.length && !note.trim() && !color) {
      hint.textContent = '备注名、标签、正文至少填一项'
      remarkInput.focus()
      return
    }
    const saved = store.upsert(
      {
        mid: finalMid,
        remark,
        tags,
        color,
        note,
        nickSnapshot: options.nickname ?? record?.nickSnapshot ?? '',
        faceSnapshot: options.face ?? record?.faceSnapshot ?? '',
      },
      { scene: options.scene ?? 'manual', url: location.href },
    )
    if (!saved) {
      hint.textContent = '保存失败，请检查输入'
      return
    }
    mid = finalMid
    toast(record ? '备注已更新' : '备注已保存')
    closeEditor()
    options.onSaved?.(saved)
  }

  const doDelete = (): void => {
    if (!mid) return
    const removed = store.remove(mid)
    if (removed) {
      toast('备注已删除', {
        actionLabel: '撤销',
        duration: 5000,
        onAction: () => store.restore([removed]),
      })
      options.onDeleted?.(mid)
    }
    closeEditor()
  }

  saveBtn.addEventListener('click', doSave)
  cancelBtn.addEventListener('click', () => closeEditor())
  deleteBtn.addEventListener('click', doDelete)
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault()
      doSave()
    }
  })

  document.body.appendChild(el)
  root = el

  requestAnimationFrame(() => {
    if (root !== el) return
    clampPosition(el, options.anchor ?? null)
    if (allowMidEdit && !mid) midInput.focus()
    else remarkInput.focus()
  })

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.stopPropagation()
      closeEditor()
    }
  }
  const onPointer = (ev: PointerEvent): void => {
    if (!root) return
    const target = ev.target as Node | null
    if (target && !root.contains(target)) closeEditor()
  }
  const onResize = (): void => {
    if (root) clampPosition(root, options.anchor ?? null)
  }

  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
  window.addEventListener('resize', onResize)
  cleanupFns.push(
    () => document.removeEventListener('keydown', onKey, true),
    () => document.removeEventListener('pointerdown', onPointer, true),
    () => window.removeEventListener('resize', onResize),
  )
}
