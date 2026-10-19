import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

const MATCHES = [
  'https://www.bilibili.com/*',
  'https://space.bilibili.com/*',
  'https://t.bilibili.com/*',
  'https://live.bilibili.com/*',
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
        version: '1.0.0',
        description: 'B 站网页端本地用户备注：给 UP 主 / 评论者打只属于你自己的备注，数据不出本机。',
        author: 'Yoin',
        license: 'MIT',
        match: MATCHES,
        'run-at': 'document-idle',
        grant: [
          'GM_getValue',
          'GM_setValue',
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
