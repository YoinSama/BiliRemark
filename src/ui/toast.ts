export interface ToastOptions {
  duration?: number
  actionLabel?: string
  onAction?: () => void
}

let root: HTMLElement | null = null

function ensureRoot(): HTMLElement {
  if (root && root.isConnected) return root
  root = document.createElement('div')
  root.id = 'brmk-toast'
  document.body.appendChild(root)
  return root
}

export function toast(message: string, options: ToastOptions = {}): void {
  const host = ensureRoot()
  const item = document.createElement('div')
  item.className = 'brmk-toast-item'
  const text = document.createElement('span')
  text.textContent = message
  item.appendChild(text)

  let timer: ReturnType<typeof setTimeout> | null = null
  const close = (): void => {
    if (timer !== null) clearTimeout(timer)
    item.remove()
  }

  if (options.actionLabel && options.onAction) {
    const action = document.createElement('button')
    action.type = 'button'
    action.textContent = options.actionLabel
    action.addEventListener('click', () => {
      close()
      try {
        options.onAction?.()
      } catch (err) {
        console.warn('[BiliRemark] toast action failed', err)
      }
    })
    item.appendChild(action)
  }

  host.appendChild(item)
  timer = setTimeout(close, options.duration ?? 2600)
}
