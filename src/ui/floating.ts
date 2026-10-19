import { icon } from './icons'
import { toggleManager } from './manager'

let fab: HTMLElement | null = null

export function mountFab(): void {
  if (fab && fab.isConnected) return
  const el = document.createElement('button')
  el.id = 'brmk-fab'
  el.type = 'button'
  el.title = 'BiliRemark 备注管理（Alt+R）'
  el.setAttribute('aria-label', '打开备注管理')
  el.appendChild(icon('pencil', 16))
  const label = document.createElement('span')
  label.className = 'brmk-fab-label'
  label.textContent = '备注'
  el.appendChild(label)
  el.addEventListener('click', () => toggleManager())
  document.body.appendChild(el)
  fab = el
}

export function unmountFab(): void {
  fab?.remove()
  fab = null
}
