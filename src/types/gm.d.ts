/**
 * GM API 全局声明（只声明本脚本实际用到的部分）。
 * 运行期由 Tampermonkey / Violentmonkey 注入。
 */

declare function GM_getValue<T = unknown>(key: string, defaultValue?: T): T
declare function GM_setValue(key: string, value: unknown): void
declare function GM_deleteValue(key: string): void

declare function GM_addValueChangeListener(
  key: string,
  listener: (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void,
): number
declare function GM_removeValueChangeListener(listenerId: number): void

declare function GM_addStyle(css: string): HTMLStyleElement

declare function GM_registerMenuCommand(
  caption: string,
  onClick: (event: MouseEvent | KeyboardEvent) => void,
  options?: string | { title?: string; id?: string; accessKey?: string; autoClose?: boolean },
): number | void

declare function GM_setClipboard(text: string, info?: string | { type?: string; mimetype?: string }): void

declare function GM_xmlhttpRequest(details: {
  method: 'GET' | 'POST' | 'HEAD'
  url: string
  timeout?: number
  headers?: Record<string, string>
  onload?: (response: { status: number; responseText: string }) => void
  onerror?: (response: unknown) => void
  ontimeout?: (response: unknown) => void
}): unknown

declare const GM_info: {
  script: {
    name: string
    version: string
    description?: string
    matches?: string[]
  }
  scriptHandler: string
  version?: string
}

declare const unsafeWindow: Window & typeof globalThis & Record<string, any>
