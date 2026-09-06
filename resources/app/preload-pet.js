// 猫窗口预加载：把拖拽 / 事件安全地暴露给页面
const { contextBridge, ipcRenderer } = require('electron');

// 把 Windows 绝对路径转成 file:// URL（逐段 encodeURIComponent，正确处理中文用户名）。
// 注意：不依赖 require('path') / require('url') —— 个别 Electron 构建下 preload 加载这两个核心模块会报
// "module not found"，导致整个 preload 失败、window.__pet 缺失。这里纯字符串处理最稳。
function toFileURL(p){
  const segs = String(p).split(/[\\/]/).filter(Boolean);
  // 首个分段通常是盘符（如 C:），保留冒号不编码，结果与页面兜底路径 file:///C:/... 完全一致
  const enc = segs.map((s, i) => i === 0 ? s : encodeURIComponent(s));
  return 'file:///' + enc.join('/');
}

// 取应用目录：沙箱 preload 下 __dirname 未定义（曾导致整段脚本崩溃、window.__pet 缺失、互动按钮全失效），
// 故改用下方 resolveAppDir（优先级回退，绝不依赖 __dirname / require('path') / require('url')）。
function resolveAppDir(){
  try { const e = require('electron'); if(e && e.app && typeof e.app.getAppPath === 'function'){ const p = e.app.getAppPath(); if(p) return p; } } catch(_){}
  try { if(process && process.resourcesPath){ const base = String(process.resourcesPath).replace(/[\\/]+$/, ''); return base + (process.platform === 'win32' ? '\\app' : '/app'); } } catch(_){}
  try { const u = new URL(location.href); const p = decodeURIComponent(u.pathname).replace(/[\\/][^\\/]*$/, ''); if(p) return p; } catch(_){}
  return '';
}
const APP_DIR = resolveAppDir();

contextBridge.exposeInMainWorld('__pet', {
  // 绝对资源目录（file://，含中文用户名时已正确百分号编码），供页面加载 GIF
  assetBase: toFileURL(APP_DIR) + '/assets/yuexinmiao',
  // 应用根目录（file://，已编码）：用于加载 catalog.js / states.js / controls.js 等依赖脚本（避免中文用户名下相对路径加载失败）
  appBase: toFileURL(APP_DIR),
  log:           (msg) => ipcRenderer.send('pet-log', msg),
  dragBy:        (dx, dy) => ipcRenderer.send('pet-drag', dx, dy),
  onPat:         (cb) => ipcRenderer.on('pet-pat', cb),
  onFeed:        (cb) => ipcRenderer.on('pet-feed', cb),
  onPlay:        (cb) => ipcRenderer.on('pet-play', cb),
  onPoke:        (cb) => ipcRenderer.on('pet-poke', cb),
  onStartCatch:  (cb) => ipcRenderer.on('pet-start-catch', cb),
  onSetMoving:   (cb) => ipcRenderer.on('pet-set-moving', (e, d) => cb(d)),
  onSimulatePayday:(cb) => ipcRenderer.on('pet-simulate-payday', cb),
  onSniff:       (cb) => ipcRenderer.on('pet-sniff', cb),
  onSetReminder: (cb) => ipcRenderer.on('pet-set-reminder', (e, min) => cb(min)),
  onToggleLowPower:(cb) => ipcRenderer.on('pet-toggle-lowpower', cb),
  onSetAuto:     (cb) => ipcRenderer.on('pet-set-auto', cb),
  onSetState:    (cb) => ipcRenderer.on('pet-set-state', (e, key) => cb(key)),
  onToggleRandom:(cb) => ipcRenderer.on('pet-toggle-random', cb),
  onDim:         (cb) => ipcRenderer.on('pet-dim', (e, v) => cb(v)),
  toggleHide:    () => ipcRenderer.send('pet-toggle-hide'),
  hover:         () => ipcRenderer.send('pet-hover'),
  notifyStateChanged: (key) => ipcRenderer.send('pet-state-changed', key),
  notifyStats:   (stats) => ipcRenderer.send('pet-stats', stats),
  notifyFlags:   (flags) => ipcRenderer.send('pet-flags', flags),
  forceClickable:(v) => ipcRenderer.send('pet-force-clickable', v),
});
