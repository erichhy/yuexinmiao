// 操作面板窗口预加载：把拖拽 / 隐藏 / 状态选择 / 互动安全地暴露给页面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__panel', {
  dragBy:        (dx, dy) => ipcRenderer.send('panel-drag', dx, dy),
  hideSelf:      () => ipcRenderer.send('panel-hide-self'),
  togglePet:     () => ipcRenderer.send('panel-toggle-pet'),
  setCurrentState:(key) => ipcRenderer.send('panel-set-state', key),
  setAuto:       () => ipcRenderer.send('panel-set-auto'),
  toggleRandom:  () => ipcRenderer.send('panel-toggle-random'),
  // 互动
  play:          () => ipcRenderer.send('panel-play'),
  startCatch:    () => ipcRenderer.send('panel-start-catch'),
  toggleWalk:    () => ipcRenderer.send('panel-toggle-walk'),
  toggleTeaser:  () => ipcRenderer.send('panel-toggle-teaser'),
  simulatePayday:() => ipcRenderer.send('panel-simulate-payday'),
  setReminder:   (min) => ipcRenderer.send('panel-set-reminder', min),
  toggleLowPower:() => ipcRenderer.send('panel-toggle-lowpower'),
  // 主进程通知
  onStateChanged:(cb) => ipcRenderer.on('panel-state-changed', (e, key) => cb(key)),
  onPetVisibility:(cb) => ipcRenderer.on('panel-pet-visibility', (e, hidden) => cb(hidden)),
  onStats:       (cb) => ipcRenderer.on('panel-stats', (e, s) => cb(s)),
  onFlags:       (cb) => ipcRenderer.on('panel-flags', (e, f) => cb(f)),
});
