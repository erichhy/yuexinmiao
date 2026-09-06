// 预加载脚本：把拖拽/事件安全地暴露给页面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__pet', {
  dragBy:    (dx, dy) => ipcRenderer.send('pet-drag', dx, dy),
  onPat:     (cb) => ipcRenderer.on('pet-pat', cb),
  onFeed:    (cb) => ipcRenderer.on('pet-feed', cb),
  toggleHide:() => ipcRenderer.send('toggle-hide'), // 开关键：隐藏/显示
  hover:     () => ipcRenderer.send('pet-hover'),   // 鼠标移回猫身上 → 退出让位态
  onDim:     (cb) => ipcRenderer.on('pet-dim', (e, v) => cb(v)), // 切换半透明
});
