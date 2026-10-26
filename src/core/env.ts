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

/**
 * 徽标文字色兜底（2026-10-25 原生深色 × Evolved 报障加固）：
 * 徽标底 = accent 14% + 盘底 的混合色，文字 = accent 本身。深色盘下若来源色
 * （Evolved 主题色 / 用户备注色）太深，字就沉进底里——「一团黑不显示字」。
 * 与实际药丸底对比不足 3 时沿色相向白提亮（readableOn），只动深色盘：浅色盘的
 * 「粉字粉底」是既定设计（对比 ~2.2 但用户已认可），不掺和。
 * 注意固定点：提亮后的字色同时参与底混合（--brmk-c 驱动文字与底两者），
 * 按原色算一次的修正量会不足，须迭代到「字 vs 字混合出的底」达标为止（实测 2~3 轮收敛）。
 */
export function readableBadgeColor(color: string, dark: boolean): string {
  if (!dark) return color
  let c = parseColor(color)
  if (!c) return color
  const base: [number, number, number] = [0x1f, 0x1f, 0x1f]
  for (let i = 0; i < 6; i++) {
    const pill = c.map((v, j) => Math.round(v * 0.14 + base[j] * 0.86)) as [number, number, number]
    if (contrastOf(c, pill) >= 3) return toHex(c)
    const next = parseColor(readableOn(toHex(c), pill, 3))
    if (!next) break
    c = next
  }
  return toHex(c)
}

/** 背景色亮度（含 alpha 感知）：近全透明返回 null（透明不等于黑，不能据此判深色） */
function bgLuminance(color: string): number | null {
  const m = color.match(/^rgba?\(([^)]+)\)$/)
  if (!m) return null
  const parts = m[1].split(/[,\s/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const nums = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)))
  if (nums.some((n) => !Number.isFinite(n))) return null
  if (parts.length >= 4) {
    const a = parseFloat(parts[3])
    if (Number.isFinite(a) && a <= 0.05) return null
  }
  return relativeLuminance([nums[0], nums[1], nums[2]])
}

/**
 * B 站 / Evolved 的深色判定。
 * Evolved 夜间模式的真实信号是 body.dark class + meta[color-scheme]（上游 dark-mode 组件
 * add/remove 的全部动作，registry/lib/components/style/dark-mode/index.ts）。
 * 注意 --foreground-color 不能当深色信号：那是 Evolved 核心按主题色亮度推导的自身 UI 文字色
 * （Color(themeColor).isLight() ? 'black' : 'white'），默认主题色下恒为 white、与夜间模式无关
 * （2026-10-25 真机复现：夜间模式关闭后浅色页上仍 white，导致徽标烤进深色盘变黑）。
 */
function detectDark(): boolean {
  if (document.documentElement.classList.contains('dark')) return true
  if (document.body?.classList.contains('dark')) return true
  // B 站原生深色（账号级设置，服务端下发）：信号是 html 上的 bili_dark class
  // （2026-10-25 登录态实测：htmlClass="bili_dark"、--Ga1/--bg1 翻深、body 背景 rgb(10,11,12)）
  if (document.documentElement.classList.contains('bili_dark')) return true
  if (document.body?.classList.contains('bili_dark')) return true
  if (document.documentElement.getAttribute('data-theme') === 'dark') return true

  const scheme = document
    .querySelector('meta[name="color-scheme"]')
    ?.getAttribute('content')
    ?.trim()
    .toLowerCase()
  if (scheme === 'dark') return true
  if (scheme === 'light') return false

  try {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue
      const lum = bgLuminance(getComputedStyle(el).backgroundColor)
      if (lum !== null) return lum < 0.4
    }
  } catch {
    /* ignore */
  }
  return false
}

export function detectTheme(): ThemeInfo {
  const rawColor = cssVar('--theme-color')
  // 归一化闸门：--theme-color 是页面可控变量，buildCss 用字符串拼接进 <style>，
  // 只放合法颜色形态（#hex / rgb()）进去，非法值一律按无主题色处理
  const parsed = parseColor(rawColor)
  return {
    dark: detectDark(),
    color: parsed ? rawColor : toHex(FALLBACK_RGB),
    rgb: parsed ?? FALLBACK_RGB,
    evolved: !!parsed,
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
