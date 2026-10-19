let debugEnabled = false

export function setDebug(on: boolean): void {
  debugEnabled = on
}

export function isDebug(): boolean {
  return debugEnabled
}

export function log(...args: unknown[]): void {
  if (debugEnabled) console.log('%c[BiliRemark]', 'color:#FB7299', ...args)
}

export function warn(...args: unknown[]): void {
  console.warn('[BiliRemark]', ...args)
}

/** 护栏：任何模块异常都不许冒泡到页面 */
export function guard<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (err) {
    warn(`模块 ${label} 异常：`, err)
    return fallback
  }
}
