import type { ThemeInfo } from './types'

const FALLBACK_RGB: [number, number, number] = [251, 113, 152] // B 站粉 #FB7299

export function parseColor(value: string): [number, number, number] | null {
  const v = (value || '').trim().toLowerCase()
  if (!v) return null
  const hex = v.match(/^#([0-9a-f]{3,8})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .slice(0, 3)
        .map((c) => c + c)
        .join('')
    }
    if (h.length < 6) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean)
    if (parts.length >= 3) {
      const nums = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)))
      if (nums.every((n) => Number.isFinite(n))) {
        return [Math.round(nums[0]), Math.round(nums[1]), Math.round(nums[2])]
      }
    }
  }
  return null
}

export function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

export function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0'))
      .join('')
  )
}

function cssVar(name: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  } catch {
    return ''
  }
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((n) => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 相对亮度（0-1），供深浅判定与对比度修正使用 */
export function luminanceOf(color: string): number | null {
  const rgb = parseColor(color)
  return rgb ? relativeLuminance(rgb) : null
}

function contrastOf(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * 显示色修正：color 与背景的 WCAG 对比度不足 min 时，沿原色相向背景反方向
 * 逐步混色（深底往白提亮、浅底往黑压暗），刚好达标即停；色相基本保留。
 * 只影响展示，存储里仍保留用户原色。
 */
export function readableOn(color: string, bg: [number, number, number], min = 4.5): string {
  const fg = parseColor(color)
  if (!fg) return color
  if (contrastOf(fg, bg) >= min) return color
  const target = relativeLuminance(bg) < 0.25 ? 255 : 0
  for (let t = 0.06; t <= 0.9; t += 0.06) {
    const mix = fg.map((v) => v + (target - v) * t) as [number, number, number]
    if (contrastOf(mix, bg) >= min) return toHex(mix)
  }
  return target === 255 ? '#e9e9e9' : '#18191c'
}

/** B 站 / Evolved 的深色判定：优先读变量，其次 class，最后看背景亮度 */
function detectDark(): boolean {
  const fg = cssVar('--foreground-color')
  if (fg === 'white' || fg === '#fff' || fg === '#ffffff') return true
  if (fg === 'black' || fg === '#000' || fg === '#000000') return false

  if (document.documentElement.classList.contains('dark')) return true
  if (document.body?.classList.contains('dark')) return true
  if (document.documentElement.getAttribute('data-theme') === 'dark') return true

  try {
    const bg = getComputedStyle(document.body).backgroundColor
    const lum = luminanceOf(bg)
    if (lum !== null) return lum < 0.4
  } catch {
    /* ignore */
  }
  return false
}

export function detectTheme(): ThemeInfo {
  const rawColor = cssVar('--theme-color')
  const rgb = parseColor(rawColor) ?? FALLBACK_RGB
  return {
    dark: detectDark(),
    color: rawColor || toHex(FALLBACK_RGB),
    rgb,
    evolved: !!rawColor,
  }
}

/** 监听主题变化（Evolved 改 html style / 切深色 / 系统主题） */
export function watchTheme(callback: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      callback()
    }, 250)
  }

  const obs = new MutationObserver(schedule)
  try {
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    })
    if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] })
  } catch {
    /* ignore */
  }

  let mq: MediaQueryList | null = null
  const onMq = (): void => schedule()
  try {
    mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', onMq)
  } catch {
    /* ignore */
  }

  return () => {
    obs.disconnect()
    if (mq) mq.removeEventListener('change', onMq)
    if (timer !== null) clearTimeout(timer)
  }
}
