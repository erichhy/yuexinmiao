// 光标监视窗预加载：把鼠标坐标安全地发给主进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__cursor', {
  move: (x, y) => ipcRenderer.send('cursor-move', { x, y }),
});
