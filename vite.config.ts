import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'
import pkg from './package.json'

// 发版一致性闸门：package.json / src/core/constants.ts 的 VERSION 两处必须一致，
// 否则构建直接失败（防止「关于」行或 __biliRemark__.version 跟着旧值发出去）。
const srcVersion = /VERSION = '([^']+)'/.exec(
  readFileSync(fileURLToPath(new URL('src/core/constants.ts', import.meta.url)), 'utf8'),
)?.[1]
if (!srcVersion || srcVersion !== pkg.version) {
  throw new Error(
    `版本号不一致：package.json = ${pkg.version}，src/core/constants.ts VERSION = ${srcVersion ?? '(未找到)'}。发版时两处要一起改。`,
  )
}

const MATCHES = [
  'https://www.bilibili.com/*',
  'https://space.bilibili.com/*',
  'https://t.bilibili.com/*',
  'https://message.bilibili.com/*',
  'https://search.bilibili.com/*',
]

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'BiliRemark',
        namespace: 'https://github.com/YoinSama/BiliRemark',
        version: pkg.version,
        description: 'B 站网页端本地用户备注：给 UP 主 / 评论者打只属于你自己的备注，数据不出本机。',
        author: 'Yoin',
        license: 'MIT',
        match: MATCHES,
        'run-at': 'document-idle',
        'updateURL': 'https://raw.githubusercontent.com/YoinSama/BiliRemark/main/dist/BiliRemark.user.js',
        'downloadURL': 'https://raw.githubusercontent.com/YoinSama/BiliRemark/main/dist/BiliRemark.user.js',
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_deleteValue',
          'GM_listValues',
          'GM_addValueChangeListener',
          'GM_registerMenuCommand',
          'GM_setClipboard',
          'GM_info',
          'unsafeWindow',
        ],
      },
      build: {
        fileName: 'BiliRemark.user.js',
      },
    }),
  ],
  build: {
    target: 'es2020',
    emptyOutDir: true,
    outDir: 'dist',
  },
})
