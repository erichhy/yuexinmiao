// 逗猫棒覆盖窗预加载：把全局鼠标坐标安全地发给主进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__teaser', {
  move:  (x, y) => ipcRenderer.send('teaser-move', { x, y }),
  onStart: (cb) => ipcRenderer.on('teaser-start', cb),
  onStop: (cb) => ipcRenderer.on('teaser-stop', cb),
});
