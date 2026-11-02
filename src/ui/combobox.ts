import { h } from '../util/dom'

/**
 * 可复用的「可输入下拉」（combobox）：输入框聚焦 / 输入时在下方弹出建议面板，空间不够自动向上翻。
 * - create 模式（编辑器标签）：无高亮项时 Enter 不拦截，宿主可把输入文本当新值提交；
 * - pick 模式（管理页筛选）：无高亮项时 Enter 采用第一个可用项，只能选已有值。
 * 菜单挂在 input.parentElement（须 position:relative，.brmk-tagbox）下并留在宿主弹层内部，
 * 选中用 pointerdown + preventDefault：input 不失焦，宿主「失焦即提交」类逻辑不会抢先触发。
 * Escape 不在此处理：宿主在 document 捕获层有关闭逻辑，须用 closeIfOpen() 做分层。
 */

export interface ComboboxItem {
  value: string
  /** 展示文案，缺省用 value */
  label?: string
  disabled?: boolean
  /** 仅在过滤词为空时出现（如管理页的「全部标签」伪选项） */
  emptyMatchOnly?: boolean
}

export interface ComboboxConfig {
  input: HTMLInputElement
  mode: 'create' | 'pick'
  /** 每次渲染菜单时取最新项：宿主状态（已选 chips / 当前筛选）可在会话中变化 */
  getItems: () => ComboboxItem[]
  onPick: (value: string) => void
  /** 无匹配项时的空态文案 */
  emptyText: string
}

export interface ComboboxHandle {
  /** 菜单开着则关闭并返回 true（宿主 Esc 分层：先关菜单再关自己） */
  closeIfOpen(): boolean
  dispose(): void
}

const MENU_MAX_HEIGHT = 180
const EDGE_MARGIN = 8

let uid = 0

export function attachCombobox(config: ComboboxConfig): ComboboxHandle {
  const { input, mode, getItems, onPick, emptyText } = config
  const id = `brmk-cb-${++uid}`

  const menu = h('div', 'brmk-tag-menu')
  menu.id = id
  menu.setAttribute('role', 'listbox')
  menu.style.display = 'none'

  const host = input.parentElement
  if (!host) throw new Error('[BiliRemark] combobox 需要 input 有定位父级（.brmk-tagbox）')
  host.appendChild(menu)
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-expanded', 'false')
  input.setAttribute('aria-controls', id)
  input.setAttribute('aria-autocomplete', 'list')

  let open = false
  /** 打开后用户是否输入过：未输入时按全量列表展示（管理页输入框里预填的当前筛选值不算过滤词） */
  let typed = false
  let highlight = -1
  let visible: ComboboxItem[] = []
  let itemEls: HTMLElement[] = []

  /** 向下空间不够且向上更宽裕时翻到输入框上方弹 */
  const place = (): void => {
    const rect = input.getBoundingClientRect()
    const needed = Math.min(menu.scrollHeight, MENU_MAX_HEIGHT) + EDGE_MARGIN
    const below = window.innerHeight - rect.bottom
    menu.classList.toggle('up', below < needed && rect.top > below)
  }

  const setHighlight = (index: number): void => {
    highlight = index
    itemEls.forEach((el, i) => {
      if (i === index) el.setAttribute('aria-selected', 'true')
      else el.removeAttribute('aria-selected')
    })
    const el = index >= 0 ? itemEls[index] : null
    if (el) {
      input.setAttribute('aria-activedescendant', el.id)
      el.scrollIntoView({ block: 'nearest' })
    } else {
      input.removeAttribute('aria-activedescendant')
    }
  }

  const renderMenu = (): void => {
    const query = typed ? input.value.trim().toLowerCase() : ''
    visible = getItems().filter((item) => {
      if (!query) return true
      if (item.emptyMatchOnly) return false
      return item.value.toLowerCase().includes(query)
    })
    if (query) {
      // 前缀命中排前，组内保持宿主给定顺序（最近使用优先）；sort 稳定
      visible = visible
        .map((item) => ({ item, prefix: item.value.toLowerCase().startsWith(query) }))
        .sort((a, b) => Number(b.prefix) - Number(a.prefix))
        .map((entry) => entry.item)
    }
    menu.textContent = ''
    itemEls = []
    visible.forEach((item, index) => {
      const el = h('div', 'brmk-tag-item', item.label ?? item.value)
      el.id = `${id}-opt-${index}`
      el.setAttribute('role', 'option')
      if (item.disabled) el.setAttribute('aria-disabled', 'true')
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault()
        if (!item.disabled) pick(item.value)
      })
      menu.appendChild(el)
      itemEls.push(el)
    })
    if (!visible.length) menu.appendChild(h('div', 'brmk-tag-empty', emptyText))
    place()
    setHighlight(-1)
  }

  const setOpen = (next: boolean): void => {
    if (next === open) return
    if (next && input.disabled) return
    open = next
    if (open) {
      typed = false
      renderMenu()
      menu.style.display = 'block'
      input.setAttribute('aria-expanded', 'true')
    } else {
      menu.style.display = 'none'
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
      highlight = -1
    }
  }

  const pick = (value: string): void => {
    setOpen(false)
    onPick(value)
  }

  /** 从当前高亮移动 dir 步到下一个可用项；全部不可用则原地不动 */
  const moveHighlight = (dir: 1 | -1): void => {
    if (!visible.length) return
    let index = highlight
    for (let step = 0; step < visible.length; step++) {
      index = (index + dir + visible.length) % visible.length
      if (!visible[index].disabled) {
        setHighlight(index)
        return
      }
    }
  }

  input.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      if (!open) {
        setOpen(true)
        // 从首/末端外起步，让第一步落在第一个/最后一个可用项上
        highlight = ev.key === 'ArrowDown' ? -1 : visible.length
        moveHighlight(ev.key === 'ArrowDown' ? 1 : -1)
        return
      }
      moveHighlight(ev.key === 'ArrowDown' ? 1 : -1)
    } else if (ev.key === 'Enter' && open) {
      const target = highlight >= 0 ? visible[highlight] : undefined
      const chosen =
        target && !target.disabled ? target : mode === 'pick' ? visible.find((it) => !it.disabled) : undefined
      if (chosen) {
        ev.preventDefault()
        // 拦下宿主后续注册的同元素 Enter 监听（create 模式宿主会把输入文本当新值提交）
        ev.stopImmediatePropagation()
        pick(chosen.value)
      }
    }
  })

  input.addEventListener('input', () => {
    if (!open) setOpen(true)
    typed = true
    renderMenu()
  })

  input.addEventListener('focus', () => {
    if (open) return
    setOpen(true)
    if (input.value) input.select()
  })

  input.addEventListener('click', () => {
    if (!open) setOpen(true)
  })

  input.addEventListener('blur', () => setOpen(false))

  const onDocPointerDown = (ev: PointerEvent): void => {
    if (!open) return
    const target = ev.target as Node | null
    if (target && target !== input && !menu.contains(target)) setOpen(false)
  }
  document.addEventListener('pointerdown', onDocPointerDown, true)

  return {
    closeIfOpen: () => {
      if (!open) return false
      setOpen(false)
      return true
    },
    dispose: () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      menu.remove()
      input.removeAttribute('role')
      input.removeAttribute('aria-expanded')
      input.removeAttribute('aria-controls')
      input.removeAttribute('aria-autocomplete')
    },
  }
}
