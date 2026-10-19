import type { SceneKey } from './types'

/** 运行期缓存：当前页面解析到的昵称，用于「昵称已变」提示（不联网） */
export const nickCache = new Map<string, string>()

export function rememberNick(mid: string, nickname: string): void {
  const nick = (nickname || '').trim()
  if (!mid || !nick) return
  if (!nickCache.has(mid)) nickCache.set(mid, nick)
}

export interface SceneDiagnostic {
  scene: SceneKey
  label: string
  selectors: { selector: string; hits: number }[]
  midResolved: number
  injected: number
  notes: string[]
}

const diagnostics = new Map<SceneKey, SceneDiagnostic>()

export function setDiagnostic(diag: SceneDiagnostic): void {
  diagnostics.set(diag.scene, diag)
}

export function getDiagnostics(): SceneDiagnostic[] {
  return Array.from(diagnostics.values())
}
