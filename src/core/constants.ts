import type { Settings } from './types'

export const STORAGE = {
  data: 'brmk.data.v1',
  settings: 'brmk.settings.v1',
  meta: 'brmk.meta.v1',
  backupPrefix: 'brmk.data.backup.',
} as const

export const LIMITS = {
  remark: 50,
  tag: 16,
  tags: 5,
  note: 500,
  records: 5000,
  /** 触发告警的估算占用（字节），真上限实测前先保守取值 */
  warnBytes: 4 * 1024 * 1024,
} as const

export const DATA_SCHEMA = 1
export const SETTINGS_SCHEMA = 1

export const DEFAULT_SETTINGS: Settings = {
  schema: SETTINGS_SCHEMA,
  enabled: true,
  scenes: {
    videoUp: true,
    comment: true,
    space: true,
    dynamic: true,
    card: false,
    live: false,
    relation: false,
    message: false,
  },
  display: {
    position: 'afterName',
    showTags: true,
    showColorDot: true,
    maxTags: 3,
    replaceNickname: false,
    showOnHoverOnly: false,
  },
  editor: {
    entry: 'clickBadge',
    hotkey: 'Alt+R',
  },
  manager: {
    pageSize: 50,
    theme: 'auto',
    zIndex: 99999,
  },
  backup: {
    lastExportAt: 0,
    remindIntervalDays: 30,
  },
  advanced: {
    observerDebounceMs: 150,
    maxNodesPerTick: 50,
    debug: false,
  },
}

export const TAG_PRESET_COLORS = [
  '#FB7299',
  '#FF7F50',
  '#F5C242',
  '#7BC96F',
  '#3FA9F5',
  '#9B7BFF',
  '#FF6B6B',
  '#8C8C8C',
]
