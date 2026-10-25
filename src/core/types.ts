/** 场景标识：与设置里的 scenes 一一对应 */
export type SceneKey =
  | 'videoUp'
  | 'comment'
  | 'space'
  | 'dynamic'
  | 'card'
  | 'live'
  | 'relation'
  | 'message'

export interface FirstSeen {
  scene: SceneKey | 'manual'
  url: string
}

export interface UserRecord {
  mid: string
  remark: string
  tags: string[]
  color: string | null
  note: string
  nickSnapshot: string
  faceSnapshot: string
  createdAt: number
  updatedAt: number
  firstSeen?: FirstSeen
}

export interface StoreData {
  schema: number
  updatedAt: number
  users: Record<string, UserRecord>
}

export interface DisplaySettings {
  position: 'afterName'
  showTags: boolean
  showColorDot: boolean
  maxTags: number
  replaceNickname: boolean
  showOnHoverOnly: boolean
}

export interface EditorSettings {
  entry: 'clickBadge'
  hotkey: string
}

export interface ManagerSettings {
  pageSize: number
  theme: 'auto' | 'dark' | 'light'
  zIndex: number
}

export interface BackupSettings {
  lastExportAt: number
  remindIntervalDays: number
}

export interface AdvancedSettings {
  observerDebounceMs: number
  maxNodesPerTick: number
  debug: boolean
}

export interface Settings {
  schema: number
  enabled: boolean
  scenes: Record<SceneKey, boolean>
  display: DisplaySettings
  editor: EditorSettings
  manager: ManagerSettings
  backup: BackupSettings
  advanced: AdvancedSettings
  /** 一次性迁移标记（只随存储持久化，DEFAULT_SETTINGS 不携带）：键名 = 迁移日期+主题 */
  migrations?: Record<string, boolean>
}

export interface ImportPreview {
  added: number
  updated: number
  skipped: number
  invalid: number
  removed: number
}

export type MergeStrategy = 'replace' | 'newer' | 'only-new'

export interface ThemeInfo {
  dark: boolean
  /** 可直接写进 CSS 的颜色字符串 */
  color: string
  rgb: [number, number, number]
  evolved: boolean
}
