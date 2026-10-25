import type { SceneKey } from './types'
import { emit } from './bus'

/** 运行期缓存：当前页面解析到的昵称，用于「昵称已变」提示（不联网） */
export const nickCache = new Map<string, string>()

export function rememberNick(mid: string, nickname: string): void {
  const nick = (nickname || '').trim()
  if (!mid || !nick) return
  if (!nickCache.has(mid)) nickCache.set(mid, nick)
}

/** 运行期缓存：当前页面解析到的头像 URL，保存备注时落入 faceSnapshot（G1） */
export const faceCache = new Map<string, string>()

export function rememberFace(mid: string, face: string): void {
  const url = (face || '').trim()
  if (!mid || !url) return
  if (!faceCache.has(mid)) {
    faceCache.set(mid, url)
    // 供旧数据头像回填监听（见 core/faceFetch），每次页面加载每个 mid 只发一次
    emit('face-seen', { mid, url })
  }
}

export function faceOf(mid: string): string | undefined {
  return faceCache.get(mid)
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
