import { detectTheme, rgba, toHex } from '../core/env'
import { getSettings } from '../core/config'
import type { ThemeInfo } from '../core/types'

let current: ThemeInfo = { dark: false, color: '#FB7299', rgb: [251, 113, 152], evolved: false }

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif'

export interface Palette {
  dark: boolean
  bg: string
  bg2: string
  bg3: string
  fg: string
  fg2: string
  border: string
  shadow: string
  accent: string
  accentWeak: string
  accentBorder: string
  overlay: string
}

export function paletteOf(theme: ThemeInfo, force?: 'auto' | 'dark' | 'light'): Palette {
  const dark = force === 'dark' ? true : force === 'light' ? false : theme.dark
  const [r, g, b] = theme.rgb
  return {
    dark,
    bg: dark ? '#1f1f1f' : '#ffffff',
    bg2: dark ? '#2a2a2a' : '#f6f7f8',
    bg3: dark ? '#353535' : '#eaecef',
    fg: dark ? '#e9e9e9' : '#18191c',
    fg2: dark ? 'rgba(233,233,233,.62)' : 'rgba(24,25,28,.6)',
    border: dark ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.1)',
    shadow: dark ? '0 8px 32px rgba(0,0,0,.55)' : '0 8px 32px rgba(0,0,0,.16)',
    accent: theme.color,
    accentWeak: rgba([r, g, b], dark ? 0.18 : 0.1),
    accentBorder: rgba([r, g, b], dark ? 0.45 : 0.35),
    overlay: 'rgba(0,0,0,.45)',
  }
}

export function getTheme(): ThemeInfo {
  return current
}

export function refreshTheme(): ThemeInfo {
  current = detectTheme()
  return current
}

export function managerPalette(): Palette {
  const p = getSettings().manager.theme
  return paletteOf(current, p)
}

function buildCss(theme: ThemeInfo): string {
  const p = paletteOf(theme, 'auto')
  return `
/* ===== BiliRemark 样式（全部 brmk- 前缀，不覆盖页面既有样式） ===== */
/* 页面内浮层：徽标 / 铅笔都挂在这里，绝不进入 B 站自己的容器 */
/* 页面内浮层：徽标 / 铅笔都挂在这里，绝不进入 B 站自己的容器。
   层钉在文档原点（absolute 而非 fixed），徽标按文档坐标定位 —— 主文档滚动时
   徽标与页面内容同帧移动，不需要 JS 追帧重算（那会慢一帧，看起来在飘）。
   width:100% 不能省：徽标 max-width 里的 100% 和 shrink-to-fit 都按包含块解析，
   层宽为 0 会把徽标塌缩成一个点。height:0 不参与布局，仅作定位原点。 */
#brmk-layer{
  position:absolute; left:0; top:0; width:100%; height:0;
  z-index:99997; pointer-events:none; overflow:visible;
  contain:layout style;
}
/* portal 用 translate 属性定位（不用 transform，避免被 .brmk-badge 的 transform 过渡拖成飞入/弹跳） */
#brmk-layer>.brmk-badge,#brmk-layer>.brmk-pencil{
  position:absolute; left:0; top:0; margin:0; pointer-events:auto;
  will-change:translate;
}
.brmk-badge{
  display:inline-flex; align-items:center; gap:4px;
  margin:0; padding:0 7px; height:18px; max-width:min(240px, 100%);
  border-radius:9px; vertical-align:middle;
  /* 内联挂法（评论区夹在昵称和等级之间）：flex 组里垂直居中、不被压缩 */
  align-self:center; flex:none;
  font-family:${FONT_STACK}; font-size:12px; font-weight:500; line-height:16px;
  letter-spacing:0; white-space:nowrap; cursor:pointer; user-select:none;
  color:var(--brmk-c, ${p.accent});
  /* 不透明底：浮层徽标会盖在页面文字上，透底会显得到处叠字 */
  background:color-mix(in srgb, var(--brmk-c, ${p.accent}) 14%, ${p.bg});
  border:1px solid color-mix(in srgb, var(--brmk-c, ${p.accent}) 38%, transparent);
  transition:background .12s ease, transform .12s ease;
}
.brmk-badge:hover{
  background:color-mix(in srgb, var(--brmk-c, ${p.accent}) 24%, ${p.bg});
}
.brmk-badge:active{ transform:scale(.97); }
.brmk-badge.brmk-hover-only{ opacity:0; }
.brmk-badge.brmk-hover-only:hover{ opacity:1; }
.brmk-badge:focus-visible{ outline:2px solid var(--brmk-c, ${p.accent}); outline-offset:1px; }
.brmk-badge .brmk-dot{
  width:6px; height:6px; border-radius:50%; flex:0 0 auto;
  background:var(--brmk-c, ${p.accent});
}
.brmk-badge .brmk-name{
  overflow:hidden; text-overflow:ellipsis; max-width:140px;
}
.brmk-badge .brmk-tags{ display:inline-flex; gap:3px; overflow:hidden; }
.brmk-badge .brmk-tag{
  font-size:10px; line-height:14px; padding:0 4px; border-radius:4px;
  background:color-mix(in srgb, currentColor 14%, transparent);
  white-space:nowrap; max-width:80px; overflow:hidden; text-overflow:ellipsis;
}
.brmk-badge .brmk-more{ font-size:10px; opacity:.7; }
/* 浮层给的空间不够时（portal 打的标记），先让位给备注名，标签胶囊收起 */
.brmk-badge[data-brmk-tight] .brmk-tags{ display:none; }
.brmk-badge[data-brmk-tight] .brmk-name{ max-width:100%; }
/* 内联挂法（评论区夹在昵称和等级之间）：边距对齐原生昵称行节奏 ——
   真机实测等级图标 margin-left 5px，徽标跟它同节奏；右侧不另加，
   让后面元素（等级图标）自带的 5px 左边距生效 */
.brmk-badge.brmk-inline{ margin:0 0 0 5px; }
/* 内联徽标随评论淡入（160ms），避免加载完成后成批突现 */
.brmk-badge.brmk-inline{ animation:brmk-badge-in .16s ease-out; }
@keyframes brmk-badge-in{ from{ opacity:0 } }

/* S5 视频页右栏三行布局：备注行作为卡片 .info 内的一行（.upname 与 .playinfo 之间）。
   进入文档流前先隐藏，插入后靠这个类显现（替代浮层的定位职责） */
.brmk-card-badge-row{ margin:3px 0 0; line-height:1.6; }
.brmk-card-badge-row .brmk-badge{ max-width:100%; animation:brmk-badge-in .16s ease-out; }

.brmk-pencil{
  display:inline-flex; align-items:center; justify-content:center;
  width:16px; height:16px; margin:0; padding:0; border:0; border-radius:50%;
  vertical-align:middle; cursor:pointer; opacity:0; pointer-events:none;
  color:${p.fg2}; background:${p.bg3};
  transition:opacity .14s ease, background .14s ease, color .14s ease;
}
.brmk-pencil svg{ width:9px; height:9px; display:block; }
.brmk-pencil.brmk-pencil-on{ opacity:1; pointer-events:auto; }
.brmk-pencil:hover{ color:#fff; background:${p.accent}; }

/* ===== 编辑气泡 ===== */
#brmk-editor{
  position:fixed; z-index:2147483000; width:344px; max-width:calc(100vw - 16px);
  box-sizing:border-box; padding:14px; border-radius:12px;
  font-family:${FONT_STACK}; font-size:13px; color:${p.fg};
  background:${p.bg}; border:1px solid ${p.border}; box-shadow:${p.shadow};
  animation:brmk-pop .16s ease-out;
}
@keyframes brmk-pop{ from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:none} }
#brmk-editor *{ box-sizing:border-box; font-family:inherit; }
.brmk-ed-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
.brmk-ed-title{ font-size:14px; font-weight:600; }
.brmk-ed-sub{ font-size:11px; color:${p.fg2}; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.brmk-ed-close{
  border:0; background:transparent; color:${p.fg2}; cursor:pointer; font-size:16px; line-height:1;
  padding:4px 6px; border-radius:6px;
}
.brmk-ed-close:hover{ background:${p.bg2}; color:${p.fg}; }
.brmk-field{ margin-bottom:10px; }
.brmk-label{ display:block; font-size:12px; color:${p.fg2}; margin-bottom:5px; }
.brmk-input,.brmk-textarea{
  width:100%; border:1px solid ${p.border}; border-radius:6px; background:${p.bg2}; color:${p.fg};
  font-size:13px; line-height:20px; padding:6px 8px; outline:none;
  transition:border-color .12s ease, box-shadow .12s ease;
}
.brmk-input:focus,.brmk-textarea:focus{ border-color:${p.accent}; box-shadow:0 0 0 2px ${p.accentWeak}; }
.brmk-textarea{ resize:vertical; min-height:64px; max-height:180px; }
.brmk-chips{ display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }
.brmk-chip{
  display:inline-flex; align-items:center; gap:3px; height:20px; padding:0 6px;
  border-radius:10px; font-size:11px; line-height:20px;
  background:${p.accentWeak}; color:${p.accent}; border:1px solid ${p.accentBorder};
}
.brmk-chip button{ border:0; background:transparent; color:inherit; cursor:pointer; font-size:12px; line-height:1; padding:0 0 0 1px; }
.brmk-colors{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.brmk-swatch{
  width:18px; height:18px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0;
  box-shadow:inset 0 0 0 1px ${p.border};
}
.brmk-swatch[aria-pressed="true"]{ border-color:${p.fg}; }
.brmk-color-input{
  width:24px; height:20px; padding:0; border:1px solid ${p.border}; border-radius:4px; background:${p.bg2}; cursor:pointer;
}
.brmk-ed-foot{ display:flex; align-items:center; gap:8px; margin-top:12px; }
.brmk-ed-hint{ flex:1; font-size:11px; color:${p.fg2}; }
.brmk-btn{
  appearance:none; border:1px solid ${p.border}; border-radius:6px; padding:0 12px; height:28px;
  font-size:12px; font-family:inherit; cursor:pointer; color:${p.fg}; background:${p.bg2};
  transition:background .12s ease, border-color .12s ease, color .12s ease;
}
.brmk-btn:hover{ border-color:${p.accentBorder}; color:${p.accent}; }
.brmk-btn-primary{ background:${p.accent}; border-color:${p.accent}; color:#fff; }
.brmk-btn-primary:hover{ color:#fff; filter:brightness(1.06); }
.brmk-btn-danger{ color:#e5484d; border-color:rgba(229,72,77,.4); background:transparent; }
.brmk-btn-danger:hover{ background:rgba(229,72,77,.12); color:#e5484d; border-color:#e5484d; }
.brmk-btn:disabled{ opacity:.45; cursor:not-allowed; }

/* ===== 空间页侧栏「备注」模块（跟随原生侧栏深浅：默认浅色原生样式，深色侧栏由 data-brmk-sp-theme 覆盖） ===== */
/* 浅色取自 2026-10 实测原生卡面：#F6F7F8 底 / 6px 圆角 / 无边框，标题 16px 500 #18191C，间距节奏 10px */
#brmk-space-card{
  box-sizing:border-box; margin:0 0 10px; padding:14px 16px;
  border-radius:6px; border:0;
  background:#f6f7f8; color:#18191c;
  font-family:${FONT_STACK}; font-size:13px; line-height:1.6;
  --brmk-sp-c:${p.accent};
}
#brmk-space-card *{ box-sizing:border-box; font-family:inherit; }
#brmk-space-card [hidden]{ display:none !important; }
.brmk-sp-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.brmk-sp-title{ font-size:16px; font-weight:500; color:#18191c; }
.brmk-sp-link{
  appearance:none; border:0; border-radius:4px; padding:2px 4px; cursor:pointer;
  background:transparent; color:#61666d;
  font-size:12px; font-family:inherit; line-height:18px;
  transition:color .12s ease, background .12s ease;
}
.brmk-sp-link:hover{ color:${p.accent}; background:rgba(0,0,0,.05); }
.brmk-sp-link:focus-visible{ outline:2px solid ${p.accent}; outline-offset:1px; }
.brmk-sp-name{ display:flex; align-items:center; gap:7px; margin:2px 0 8px; }
.brmk-sp-dot{ width:8px; height:8px; border-radius:50%; background:var(--brmk-sp-c); flex:0 0 auto; }
.brmk-sp-nametext{ font-size:15px; font-weight:600; color:var(--brmk-sp-c); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.brmk-sp-tags{ display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px; }
.brmk-sp-tag{
  font-size:11px; line-height:18px; padding:0 7px; border-radius:9px; max-width:120px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--brmk-sp-c, ${p.accent});
  background:color-mix(in srgb, var(--brmk-sp-c, ${p.accent}) 13%, transparent);
  border:1px solid color-mix(in srgb, var(--brmk-sp-c, ${p.accent}) 35%, transparent);
}
.brmk-sp-note{ color:#61666d; white-space:pre-wrap; word-break:break-word; max-height:168px; overflow:auto; }
.brmk-sp-foot{ display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap; }
.brmk-sp-meta{ color:#9499a0; font-size:11px; }
.brmk-sp-mid{
  appearance:none; border:0; background:transparent; padding:0; cursor:pointer;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:11px; line-height:1.6; color:#9499a0;
  transition:color .12s ease;
}
.brmk-sp-mid:hover{ color:${p.accent}; text-decoration:underline; }
.brmk-sp-spacer{ flex:1; }
.brmk-sp-adv{ font-size:11px; color:#9499a0; white-space:nowrap; }
.brmk-sp-emptytext{ color:#9499a0; margin-bottom:10px; }
.brmk-sp-label{ display:block; font-size:11px; color:#9499a0; margin:8px 0 4px; }
.brmk-sp-input,.brmk-sp-textarea{
  width:100%; font-size:13px; line-height:20px; padding:7px 9px; outline:none;
  color:#18191c; background:#fff;
  border:1px solid #e3e5e7; border-radius:6px;
  transition:border-color .12s ease, background .12s ease;
}
.brmk-sp-input::placeholder,.brmk-sp-textarea::placeholder{ color:#9499a0; }
.brmk-sp-input:focus,.brmk-sp-textarea:focus{ border-color:${p.accent}; box-shadow:0 0 0 2px ${p.accentWeak}; }
.brmk-sp-textarea{ resize:vertical; min-height:64px; max-height:180px; }
.brmk-sp-chips{ display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }
.brmk-sp-chip{
  display:inline-flex; align-items:center; gap:3px; height:20px; padding:0 6px; border-radius:10px;
  font-size:11px; line-height:20px; color:${p.accent};
  background:color-mix(in srgb, ${p.accent} 15%, transparent);
  border:1px solid color-mix(in srgb, ${p.accent} 38%, transparent);
}
.brmk-sp-chipx{ border:0; background:transparent; color:inherit; cursor:pointer; font-size:12px; line-height:1; padding:0 0 0 1px; }
.brmk-sp-counter{ text-align:right; font-size:11px; color:#9499a0; margin-top:3px; }
.brmk-sp-actions{ display:flex; justify-content:flex-end; gap:8px; margin-top:10px; }
#brmk-space-card .brmk-btn{
  border:1px solid #e3e5e7; background:#fff; color:#61666d;
  height:28px; padding:0 14px; border-radius:6px; font-size:12px;
}
#brmk-space-card .brmk-btn:hover{ color:${p.accent}; border-color:${p.accentBorder}; background:#fff; }
#brmk-space-card .brmk-btn-primary{ background:${p.accent}; border-color:${p.accent}; color:#fff; }
#brmk-space-card .brmk-btn-primary:hover{ color:#fff; filter:brightness(1.06); background:${p.accent}; }

/* 深色侧栏（B 站灰度或旧版布局）时的覆盖：沿用原深色配色 */
#brmk-space-card[data-brmk-sp-theme="dark"]{ background:rgba(255,255,255,.055); color:#e9e9e9; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-title{ color:#f1f1f3; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-link{ color:rgba(255,255,255,.55); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-link:hover{ color:${p.accent}; background:rgba(255,255,255,.06); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-mid:hover{ color:${p.accent}; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-note{ color:rgba(255,255,255,.78); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-meta,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-mid,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-adv,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-counter,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-emptytext,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-label{ color:rgba(255,255,255,.45); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-input,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-textarea{
  color:#f1f1f3; background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.14); border-radius:8px;
}
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-input::placeholder,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-textarea::placeholder{ color:rgba(255,255,255,.32); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-input:focus,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-textarea:focus{ background:rgba(255,255,255,.1); box-shadow:none; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-btn{ border-color:rgba(255,255,255,.16); background:transparent; color:rgba(255,255,255,.75); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-btn:hover{ color:#fff; border-color:rgba(255,255,255,.3); background:rgba(255,255,255,.06); }

/* ===== 管理页 ===== */
#brmk-manager{
  position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center;
  font-family:${FONT_STACK}; color:var(--brmk-fg, ${p.fg});
  --brmk-bg:${p.bg}; --brmk-bg2:${p.bg2}; --brmk-bg3:${p.bg3}; --brmk-fg:${p.fg}; --brmk-fg2:${p.fg2};
  --brmk-border:${p.border}; --brmk-shadow:${p.shadow}; --brmk-accent:${p.accent};
  --brmk-accent-weak:${p.accentWeak}; --brmk-accent-border:${p.accentBorder};
  background:${p.overlay}; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  animation:brmk-fade .16s ease-out;
}
@keyframes brmk-fade{ from{opacity:0} to{opacity:1} }
#brmk-manager *{ box-sizing:border-box; font-family:inherit; }
#brmk-manager .brmk-panel{
  display:flex; flex-direction:column; width:min(1100px, calc(100vw - 64px)); height:84vh; min-height:420px;
  position:relative;
  border-radius:12px; overflow:hidden; background:var(--brmk-bg); color:var(--brmk-fg);
  border:1px solid var(--brmk-border); box-shadow:var(--brmk-shadow);
  animation:brmk-rise .18s ease-out;
}
@keyframes brmk-rise{ from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:none} }
#brmk-manager .brmk-head{
  display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid var(--brmk-border);
  flex:0 0 auto; flex-wrap:wrap;
}
#brmk-manager .brmk-title{ font-size:16px; font-weight:600; white-space:nowrap; }
#brmk-manager .brmk-title small{ font-size:12px; font-weight:400; color:var(--brmk-fg2); margin-left:6px; }
#brmk-manager .brmk-search{
  flex:1 1 220px; min-width:160px; height:30px; padding:0 10px; font-size:13px;
  border:1px solid var(--brmk-border); border-radius:6px; background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
}
#brmk-manager .brmk-search:focus{ border-color:var(--brmk-accent); box-shadow:0 0 0 2px var(--brmk-accent-weak); }
#brmk-manager .brmk-head-actions{ display:flex; align-items:center; gap:6px; margin-left:auto; }
#brmk-manager .brmk-tabs{ display:flex; gap:2px; padding:0 18px; border-bottom:1px solid var(--brmk-border); flex:0 0 auto; }
#brmk-manager .brmk-tab{
  border:0; background:transparent; color:var(--brmk-fg2); font-size:13px; padding:9px 12px; cursor:pointer;
  border-bottom:2px solid transparent; margin-bottom:-1px;
}
#brmk-manager .brmk-tab[aria-selected="true"]{ color:var(--brmk-accent); border-bottom-color:var(--brmk-accent); }
#brmk-manager .brmk-stats{
  display:flex; flex-wrap:wrap; gap:8px; padding:12px 18px 0; flex:0 0 auto;
}
#brmk-manager .brmk-stat{
  flex:1 1 120px; min-width:110px; padding:8px 10px; border-radius:8px;
  background:var(--brmk-bg2); border:1px solid var(--brmk-border);
}
#brmk-manager .brmk-stat b{ display:block; font-size:16px; font-weight:600; margin-bottom:2px; }
#brmk-manager .brmk-stat span{ font-size:11px; color:var(--brmk-fg2); }
#brmk-manager .brmk-warn{
  margin:10px 18px 0; padding:8px 10px; border-radius:6px; font-size:12px;
  background:rgba(245,194,66,.12); border:1px solid rgba(245,194,66,.4); color:${p.dark ? '#f5c242' : '#8a6100'};
}
#brmk-manager .brmk-toolbar{
  display:flex; align-items:center; gap:8px; padding:10px 18px; flex-wrap:wrap; flex:0 0 auto;
}
#brmk-manager select{
  height:28px; padding:0 6px; font-size:12px; border-radius:6px; border:1px solid var(--brmk-border);
  background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
}
#brmk-manager .brmk-spacer{ flex:1; }
#brmk-manager .brmk-body{ flex:1 1 auto; overflow:auto; margin:0 18px; border:1px solid var(--brmk-border); border-radius:8px; }
#brmk-manager table{ width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
#brmk-manager thead th{
  position:sticky; top:0; z-index:2; background:var(--brmk-bg2); color:var(--brmk-fg2);
  font-size:12px; font-weight:500; text-align:left; padding:9px 10px; border-bottom:1px solid var(--brmk-border);
  white-space:nowrap;
}
#brmk-manager tbody td{ padding:8px 10px; border-bottom:1px solid var(--brmk-border); vertical-align:middle; }
#brmk-manager tbody tr:hover td{ background:var(--brmk-accent-weak); }
#brmk-manager tbody tr:last-child td{ border-bottom:0; }
#brmk-manager .brmk-cell-main{ font-weight:500; }
#brmk-manager .brmk-cell-sub{ font-size:11px; color:var(--brmk-fg2); margin-top:1px; }
#brmk-manager .brmk-mid{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px;
  color:var(--brmk-fg2); cursor:pointer; border:0; background:transparent; padding:0;
}
#brmk-manager .brmk-mid:hover{ color:var(--brmk-accent); text-decoration:underline; }
#brmk-manager .brmk-row-tag{
  display:inline-block; height:18px; padding:0 6px; margin:1px 3px 1px 0; border-radius:9px; font-size:11px; line-height:18px;
  background:var(--brmk-accent-weak); color:var(--brmk-accent); white-space:nowrap;
}
#brmk-manager .brmk-mark{
  display:inline-block; margin-left:4px; padding:0 4px; border-radius:3px; font-size:10px;
  background:rgba(245,194,66,.15); color:#b98900; border:1px solid rgba(245,194,66,.4);
}
#brmk-manager .brmk-note-clip{
  max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--brmk-fg2); font-size:12px;
}
#brmk-manager .brmk-row-actions{ display:flex; gap:4px; white-space:nowrap; }
#brmk-manager .brmk-link-btn{
  border:0; background:transparent; color:var(--brmk-accent); font-size:12px; cursor:pointer; padding:2px 4px; border-radius:4px;
}
#brmk-manager .brmk-link-btn:hover{ background:var(--brmk-accent-weak); }
#brmk-manager .brmk-link-btn.brmk-danger{ color:#e5484d; }
#brmk-manager .brmk-pager{
  display:flex; align-items:center; gap:8px; padding:10px 18px; flex:0 0 auto; font-size:12px; color:var(--brmk-fg2);
}
#brmk-manager .brmk-pager .brmk-btn{ height:26px; padding:0 10px; }
#brmk-manager .brmk-empty{ padding:48px 16px; text-align:center; color:var(--brmk-fg2); font-size:13px; }
#brmk-manager .brmk-empty b{ display:block; font-size:15px; color:var(--brmk-fg); margin-bottom:6px; }

/* 设置页 */
#brmk-manager .brmk-settings{ flex:1 1 auto; overflow:auto; padding:14px 18px 24px; }
#brmk-manager .brmk-sec{ margin-bottom:18px; border:1px solid var(--brmk-border); border-radius:8px; overflow:hidden; }
#brmk-manager .brmk-sec-head{ padding:10px 12px; background:var(--brmk-bg2); font-size:13px; font-weight:600; border-bottom:1px solid var(--brmk-border); }
#brmk-manager .brmk-row{
  display:flex; align-items:center; gap:12px; padding:9px 12px; border-bottom:1px solid var(--brmk-border); font-size:13px;
}
#brmk-manager .brmk-row:last-child{ border-bottom:0; }
#brmk-manager .brmk-row-label{ flex:1; min-width:140px; }
#brmk-manager .brmk-row-label small{ display:block; color:var(--brmk-fg2); font-size:11px; margin-top:1px; }
#brmk-manager .brmk-row-control{ flex:0 0 auto; display:flex; align-items:center; gap:6px; }
#brmk-manager .brmk-row-control input[type="number"],#brmk-manager .brmk-row-control input[type="text"]{
  width:110px; height:26px; padding:0 6px; font-size:12px; border-radius:6px;
  border:1px solid var(--brmk-border); background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
}
#brmk-manager .brmk-soon{ font-size:10px; color:var(--brmk-fg2); border:1px solid var(--brmk-border); border-radius:3px; padding:0 3px; }
.brmk-switch{
  position:relative; width:34px; height:19px; border-radius:10px; border:1px solid var(--brmk-border);
  background:var(--brmk-bg3); cursor:pointer; padding:0; transition:background .12s ease, border-color .12s ease;
}
.brmk-switch::after{
  content:""; position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:50%;
  background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.3); transition:transform .12s ease;
}
.brmk-switch[aria-checked="true"]{ background:var(--brmk-accent); border-color:var(--brmk-accent); }
.brmk-switch[aria-checked="true"]::after{ transform:translateX(15px); }

/* 导入弹窗 / 确认 */
#brmk-manager .brmk-submask{
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,.45); z-index:3;
}
#brmk-manager .brmk-subpanel{
  width:min(520px, calc(100% - 48px)); max-height:80%; overflow:auto;
  background:var(--brmk-bg); color:var(--brmk-fg); border-radius:10px; border:1px solid var(--brmk-border);
  box-shadow:var(--brmk-shadow); padding:16px;
}
#brmk-manager .brmk-subpanel h3{ margin:0 0 10px; font-size:15px; }
#brmk-manager .brmk-subpanel p{ margin:0 0 10px; font-size:12px; color:var(--brmk-fg2); line-height:1.6; }
#brmk-manager .brmk-subpanel textarea{
  width:100%; height:120px; resize:vertical; padding:8px; font-size:12px; line-height:1.5;
  border:1px solid var(--brmk-border); border-radius:6px; background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#brmk-manager .brmk-preview{ display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
#brmk-manager .brmk-preview span{ font-size:12px; padding:3px 8px; border-radius:5px; background:var(--brmk-bg2); border:1px solid var(--brmk-border); }
#brmk-manager .brmk-subfoot{ display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }

/* 浮动按钮 */
#brmk-fab{
  position:fixed; right:0; top:50%; transform:translateY(-50%); z-index:99998;
  display:flex; align-items:center; gap:6px; height:38px; padding:0 8px 0 10px;
  border-radius:19px 0 0 19px; border:1px solid ${p.border}; border-right:0;
  background:${p.bg}; color:${p.fg}; box-shadow:${p.shadow}; cursor:pointer;
  font-family:${FONT_STACK}; font-size:12px; opacity:.55; transition:opacity .16s ease, padding .16s ease;
}
#brmk-fab:hover{ opacity:1; }
#brmk-fab svg{ width:16px; height:16px; flex:0 0 auto; color:${p.accent}; }
#brmk-fab .brmk-fab-label{ max-width:0; overflow:hidden; white-space:nowrap; transition:max-width .18s ease; }
#brmk-fab:hover .brmk-fab-label{ max-width:120px; }

/* toast */
#brmk-toast{
  position:fixed; left:50%; bottom:48px; transform:translateX(-50%); z-index:2147483001;
  display:flex; flex-direction:column; gap:6px; align-items:center; pointer-events:none;
  font-family:${FONT_STACK};
}
#brmk-toast .brmk-toast-item{
  display:flex; align-items:center; gap:10px; pointer-events:auto;
  padding:8px 14px; border-radius:8px; font-size:12px; color:${p.dark ? '#fff' : '#fff'};
  background:rgba(30,30,30,.92); box-shadow:0 6px 20px rgba(0,0,0,.3);
  animation:brmk-toast-in .16s ease-out;
}
@keyframes brmk-toast-in{ from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none} }
#brmk-toast button{ border:0; background:transparent; color:${p.accent}; font-size:12px; cursor:pointer; padding:0; }

/* 选择器体检 */
#brmk-doctor{
  position:fixed; right:16px; bottom:16px; z-index:2147483000; width:360px; max-height:70vh; overflow:auto;
  padding:12px; border-radius:10px; background:${p.bg}; color:${p.fg}; border:1px solid ${p.border};
  box-shadow:${p.shadow}; font-family:${FONT_STACK}; font-size:12px; line-height:1.6;
}
#brmk-doctor h4{ margin:0 0 8px; font-size:13px; display:flex; justify-content:space-between; align-items:center; }
#brmk-doctor .brmk-doc-row{ display:flex; justify-content:space-between; gap:8px; border-bottom:1px dashed ${p.border}; padding:3px 0; }
#brmk-doctor .brmk-doc-row b{ color:${p.accent}; font-weight:600; }
#brmk-doctor pre{
  white-space:pre-wrap; word-break:break-all; margin:8px 0 0; padding:8px; border-radius:6px;
  background:${p.bg2}; color:${p.fg2}; max-height:160px; overflow:auto; font-size:11px;
}

@media (prefers-reduced-motion: reduce){
  #brmk-editor,#brmk-manager,#brmk-manager .brmk-panel,#brmk-toast .brmk-toast-item{ animation:none !important; }
  .brmk-badge,.brmk-pencil,.brmk-switch,.brmk-switch::after{ transition:none !important; }
  .brmk-badge.brmk-inline{ animation:none !important; }
}
`.trim()
}

let cssText = ''
let docStyleEl: HTMLStyleElement | null = null
let sharedSheet: CSSStyleSheet | null = null
let canAdopt = false
const shadowRoots = new Set<ShadowRoot>()
const fallbackStyles = new Map<ShadowRoot, HTMLStyleElement>()

function supportsConstructable(): boolean {
  try {
    return (
      typeof CSSStyleSheet !== 'undefined' &&
      'replaceSync' in CSSStyleSheet.prototype &&
      'adoptedStyleSheets' in Document.prototype
    )
  } catch {
    return false
  }
}

function getSheet(): CSSStyleSheet | null {
  if (!canAdopt) return null
  if (!sharedSheet) {
    try {
      sharedSheet = new CSSStyleSheet()
      sharedSheet.replaceSync(cssText)
    } catch {
      canAdopt = false
      sharedSheet = null
    }
  }
  return sharedSheet
}

/** 安装 / 更新全局样式（document 级 + 已登记的 shadow root） */
export function installStyles(theme: ThemeInfo = current): void {
  current = theme
  cssText = buildCss(theme)
  canAdopt = supportsConstructable()

  if (!docStyleEl || !docStyleEl.isConnected) {
    docStyleEl = document.getElementById('brmk-style') as HTMLStyleElement | null
    if (!docStyleEl) {
      docStyleEl = document.createElement('style')
      docStyleEl.id = 'brmk-style'
      ;(document.head ?? document.documentElement).appendChild(docStyleEl)
    }
  }
  docStyleEl.textContent = cssText

  const sheet = getSheet()
  if (sheet) {
    try {
      sheet.replaceSync(cssText)
    } catch {
      /* ignore */
    }
  }
  for (const [root, el] of fallbackStyles) {
    if (!root.host?.isConnected) {
      fallbackStyles.delete(root)
      shadowRoots.delete(root)
      continue
    }
    el.textContent = cssText
  }
  for (const root of shadowRoots) ensureShadowStyle(root)
}

/** 往 shadow root 注入样式：优先 adoptedStyleSheets，失败降级克隆 <style> */
export function ensureShadowStyle(root: ShadowRoot): void {
  shadowRoots.add(root)
  const sheet = getSheet()
  if (sheet && 'adoptedStyleSheets' in root) {
    try {
      const currentSheets = root.adoptedStyleSheets
      if (!Array.from(currentSheets).includes(sheet)) {
        root.adoptedStyleSheets = [...currentSheets, sheet]
      }
      return
    } catch {
      /* 降级 */
    }
  }
  let el = fallbackStyles.get(root)
  if (!el || !el.isConnected) {
    el = document.createElement('style')
    el.setAttribute('data-brmk-style', '1')
    el.textContent = cssText
    root.appendChild(el)
    fallbackStyles.set(root, el)
  } else {
    el.textContent = cssText
  }
}

export function accentHex(): string {
  return toHex(current.rgb)
}
