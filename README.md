# BiliRemark

B 站网页端「用户备注」油猴脚本：给 UP 主、评论者打上**只有你自己能看见**的备注（备注名 / 标签 / 颜色 / 长文本），浏览时自动显示在昵称旁，并提供一个页内管理面板统一检索、编辑、导入导出。

**数据只存在本机浏览器扩展存储里，不联网、不上传、不同步到 B 站账号。**

## 当前进度

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1** | 工程骨架 / 存储 / 备注标签 / 编辑气泡 / 视频页 UP 主（S1）/ 管理页 / 导入导出 / 体检面板 | ✅ 已完成 |
| M2 | 评论区（S2，Shadow DOM）/ 空间页（S3）/ 动态（S4） | 未开始（前置实测已完成，见 `tests/selectors.md`） |
| M3 | 视频卡片 / 直播 / 关系列表 / 私信 / 性能调优 | 未开始 |

## 安装

1. 装 [Tampermonkey](https://www.tampermonkey.net/)（Violentmonkey / ScriptCat 也可，但只保证 API 交集内不崩）。
2. 打开 `dist/BiliRemark.user.js`，全选复制，粘进 Tampermonkey 新建脚本；或直接把文件拖进扩展。
3. 打开任意 B 站视频页，右下角会出现「备注」浮动按钮；把鼠标移到 UP 主昵称上会出现小铅笔。

> 从源码构建：`npm install && npm run build`，产物为 `dist/BiliRemark.user.js`（单文件，运行期零外部依赖）。

## 使用

- **加备注**：hover 昵称 → 点铅笔；或点已有的备注标签修改。
- **管理**：右下浮动按钮 / 油猴菜单「打开备注管理器」/ `Alt+R`。
- **导出**：管理页「导出」→ JSON（完整备份，可再导入）或 CSV（只读）。
- **导入**：管理页「导入」→ 选文件或粘贴 JSON → 选合并策略 → 看预览 → 确认。
- **暂停**：油猴菜单「暂停 / 恢复备注显示」，数据保留。

## 与方案 v1.0 的默认值对齐

- 字段：备注名（≤50）/ 标签（≤5 个、每个 ≤16）/ 自定义颜色 / 长文本（≤500）。
- 显示：追加在昵称之后，不替换昵称；标签可关；可设「仅 hover 显示」。
- 存储：`GM_getValue/setValue`，key 带 schema 版本（`brmk.data.v1` / `brmk.settings.v1`）。
- 主题：跟随 `--theme-color`，读不到回退 `#FB7299`；深浅用 `--foreground-color` → class → 背景亮度三级判定。
- 约束：`document-idle`、零网络请求、零 CDN、不改页面既有节点（只 `appendChild` 自己的节点）、CSS 全部 `brmk-` 前缀、全局仅暴露 `window.__biliRemark__`。

## 验证

```bash
npm run build          # tsc --noEmit + vite build
node tests/run.mjs     # 真实 Chromium + B 站视频页夹具，17 项断言
```

`tests/run.mjs` 覆盖：hover 铅笔 → 编辑保存 → 徽标即时刷新 → 刷新后仍在 → 管理页列表/搜索/设置切换 → JSON 导入（预览 + 合并）→ JSON 导出下载 → 删除与撤销 → 手动按 mid 新增 → 深色主题 → 体检面板 → 零外部请求。

真实页面另有三支探针：`tests/probe-real*.mjs`，实测结论写进 `tests/selectors.md`。

## 已知限制

- 不支持 iframe 内内容、B 站 App / 小程序 / 客户端内嵌 WebView。
- 备注不随账号同步；换设备需手动导出/导入。
- 昵称变更只做「快照对比提示」，不联网拉取最新昵称（方案 A5 默认）。
- 只做备注，不做按备注屏蔽/过滤（方案 A6 默认）。
- M1 只接入视频页 UP 主一个场景；评论区、空间页等的设置开关已列出但标注「后续版本」，不生效。

## 目录

```
src/
├── main.ts               入口：环境探测 / 路由 / 观察器 / 菜单 / 快捷键 / 生命周期
├── core/                 store（GM 存储 + 脏标记）、config、midResolver、env、bus、runtime
├── adapters/videoUp.ts   视频页 UP 主适配器（多组备选选择器 + 诊断）
├── ui/                   badge / editor / manager / theme / floating / toast / icons
├── dev/doctor.ts         选择器体检面板
└── util/                 dom / format / log
tests/
├── run.mjs               运行时验证（本地 HTTP 服务 + 夹具）
├── fixtures/video.html   B 站视频页结构夹具
├── gm-shim.js            测试用 GM API 模拟层
└── selectors.md          选择器与实测定点快照（含日期）
docs/开发方案-v1.0.md      初版开发方案
```

## 许可

MIT。内联 SVG 图标路径取自 [Material Design Icons](https://materialdesignicons.com/)（MIT）。
