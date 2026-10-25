import type { Settings } from './types'

/**
 * 脚本版本唯一来源：main.ts / manager.ts 从这里取值；
 * vite.config.ts 构建时会校验此处与 package.json 的 version 一致，不一致直接构建失败。
 * 发版流程：改 package.json 的 version → 构建报错 → 把这里改成同一个值 → 重新构建。
 */
export const VERSION = '1.7.3'

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
    /** S5 视频卡片（v1.3.0）：首页 / 搜索 / 视频页右栏，解灰并默认开启 */
    card: true,
    /** S7 关注/粉丝（v1.6.0）：关系列表行卡片昵称旁，解灰并默认开启 */
    relation: true,
    /** S8 私信（v1.5.0）：会话列表行 + 聊天窗头部，解灰并默认开启 */
    message: true,
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
    maskBlur: false,
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
