// Electron 主进程：透明的「猫窗口」+ 独立的「操作面板窗口」两个始终置顶窗口
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, globalShortcut, screen } = require('electron');
// 禁用硬件加速：无 GPU 环境（虚拟机/远程桌面/部分显卡驱动）下避免 GPU 进程崩溃致渲染进程挂掉、窗口关闭、应用退出
app.disableHardwareAcceleration();
// 崩溃兜底日志（写入用户数据目录），避免静默退出难以排查
const _crashFile = () => { try { return path.join(app.getPath('userData'), 'crash.log'); } catch(e){ return null; } };
process.on('uncaughtException', (err)=>{ const f=_crashFile(); if(f) try{ fs.appendFileSync(f, ((err&&err.stack)?err.stack:String(err))+'\n--- '+new Date().toISOString()+' ---\n'); }catch(e){} });
process.on('unhandledRejection', (err)=>{ const f=_crashFile(); if(f) try{ fs.appendFileSync(f, 'REJECT: '+((err&&err.stack)?err.stack:String(err))+'\n--- '+new Date().toISOString()+' ---\n'); }catch(e){} });
// 诊断日志（默认关闭；排查时设 PET_DEBUG=1 开启）
function L(m){ if(process.env.PET_DEBUG==='1'){ try{ fs.appendFileSync(path.join(app.getPath('userData'),'diag.log'), m+'\n'); }catch(e){} } }
// 启动标记：写入系统临时目录（不依赖 app 就绪 / 不依赖渲染进程 console），用于确认「新代码是否真的跑起来了」
const APP_VERSION = '2026-08-13-fix5';
const BOOT_FILE = path.join(os.tmpdir(), 'pet-boot.log');
function BOOT(m){ try{ fs.appendFileSync(BOOT_FILE, '['+new Date().toISOString()+'] '+m+'\n'); }catch(e){} }
BOOT('START v='+APP_VERSION+' pid='+process.pid+' exe='+process.execPath);

/* ---------- 窗口位置记忆：把猫 / 面板坐标存到 userData，重启后恢复 ---------- */
const POS_FILE = path.join(app.getPath('userData'), 'window-pos.json');
let lastPetPos = null, lastPanelPos = null;
function loadPos(){
  try { const j = JSON.parse(fs.readFileSync(POS_FILE, 'utf8'));
    if(Array.isArray(j.pet)) lastPetPos = j.pet;
    if(Array.isArray(j.panel)) lastPanelPos = j.panel;
  } catch(e){}
}
function savePos(){
  try {
    if(petWin && !petWin.isDestroyed()) lastPetPos = petWin.getPosition();
    if(panelWin && !panelWin.isDestroyed()) lastPanelPos = panelWin.getPosition();
    if(lastPetPos && lastPanelPos) fs.writeFileSync(POS_FILE, JSON.stringify({ pet:lastPetPos, panel:lastPanelPos }));
  } catch(e){}
}
let posSaveT=null;
function scheduleSavePos(){ if(posSaveT) clearTimeout(posSaveT); posSaveT = setTimeout(savePos, 700); }

let petWin, panelWin, tray;
let isPetHidden = false;
let isPanelHidden = false;
let autoStepAside = true;     // 自动让位：点别的软件时猫半透明 + 点击穿透（默认开）
let autoStart = false;        // 开机自启动
let quitting = false;
let currentState = 'idle';

const MARGIN = 20;
const PET_W = 210;
const PET_H = 320;
const CAT_SIZE = 160;       // 猫的可见尺寸（须与 pet.html 的 --size 一致），用于计算命中矩形
const PANEL_W = 304;
const PANEL_H = 392;

function applyTop(win){ if(win) win.setAlwaysOnTop(true, 'screen-saver'); } // 最强置顶层级，普通软件盖不住

/* ---------- 命中检测：只有鼠标真正悬在「猫」身上时，猫窗口才可点击；其余区域自动穿透 ----------
   这样桌面宠的"判定区域"就缩小到猫本身，不会挡住你在透明留白处点击别的软件。 */
let cursorPos=null, overPet=false, steppedAsideNow=false, forceClickable=false;
function petRect(){
  if(!petWin) return {x:0,y:0,w:0,h:0};
  const [x,y] = petWin.getPosition();
  const cx = x + PET_W/2;          // 与 pet.html 中 #pet left:50% 对应
  const cy = y + PET_H*0.60;       // 与 pet.html 中 #pet top:60% 对应
  const half = CAT_SIZE/2;
  return { x: cx-half, y: cy-half, w: CAT_SIZE, h: CAT_SIZE };
}
function applyPetPass(){
  if(!petWin || isPetHidden) return;
  const clickable = (overPet && !steppedAsideNow) || forceClickable;
  if(clickable){
    petWin.setIgnoreMouseEvents(false);
    try { petWin.webContents.send('pet-dim', 1); } catch(e){}
  } else {
    petWin.setIgnoreMouseEvents(true, { forward: true }); // 透明留白处点击穿透，不挡操作
    try { petWin.webContents.send('pet-dim', steppedAsideNow ? 0.4 : 1); } catch(e){}
  }
}
function setOverPet(v){ if(v!==overPet){ overPet=v; applyPetPass(); } }

// 猫窗口回报「移动模式」（散步/逗猫棒互斥，统一由主进程广播）
function broadcastMoving(w,t){ try { petWin && petWin.webContents.send('pet-set-moving', {walking:w, teaser:t}); } catch(_){} }

function setAutoStart(on){
  autoStart = on;
  try { app.setLoginItemSettings({ openAtLogin: on, path: app.getPath('exe') }); } catch(e){}
}

function showPet(show){
  if(!petWin) return;
  if(show){ petWin.show(); applyTop(petWin); isPetHidden=false; overPet=false; steppedAsideNow=false; applyPetPass(); syncPetBtn(); }
  else { petWin.hide(); isPetHidden=true; syncPetBtn(); }
}
function showPanel(show){
  if(!panelWin) return;
  if(show){ panelWin.show(); applyTop(panelWin); isPanelHidden=false; }
  else { panelWin.hide(); isPanelHidden=true; }
}
// 通知面板：猫的可见性（用于更新「隐藏桌宠」按钮文案）
function syncPetBtn(){
  try { panelWin && panelWin.webContents.send('panel-pet-visibility', isPetHidden); } catch(e){}
}

// 状态切换中枢：面板点选 → 通知猫渲染；猫内部变化（喂/随机/衰减）→ 通知面板高亮
function setPetState(key){
  currentState = key;
  try { petWin && petWin.webContents.send('pet-set-state', key); } catch(e){}
  try { panelWin && panelWin.webContents.send('panel-state-changed', key); } catch(e){}
}

function createWindows(){
  const wa = screen.getPrimaryDisplay().workArea;   // 主屏工作区（含 x/y 偏移；多屏下主屏未必位于虚拟坐标 (0,0)）
  // 仅在「主屏」内才沿用存档位置；旧位置落在副屏/错误屏（多屏错位会让它看似在中央）时，强制回到主屏右下角
  const inPrimary = (p) => { if(!Array.isArray(p)) return false;
    return p[0]>=wa.x && p[0]<=wa.x+wa.width && p[1]>=wa.y && p[1]<=wa.y+wa.height; };

  /* ---------- 猫窗口（仅猫，可拖拽） ---------- */
  const validPos = lastPetPos && inPrimary(lastPetPos);
  const px = validPos ? lastPetPos[0] : wa.x + wa.width  - PET_W - MARGIN;
  const py = validPos ? lastPetPos[1] : wa.y + wa.height - PET_H - MARGIN;
  petWin = new BrowserWindow({
    width: PET_W, height: PET_H,
    x: px, y: py,
    transparent: true, frame: false, alwaysOnTop: true,
    resizable: false, hasShadow: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-pet.js'), contextIsolation: true, nodeIntegration: false },
  });
  petWin.loadFile('pet.html');
  BOOT('PET_WIN_LOADFILE');
  // 抓渲染进程所有 console/报错，落盘到 userData/pet-render.log（不依赖 preload，必触发）
  petWin.webContents.on('console-message', (e, level, message)=>{
    try{ fs.appendFileSync(path.join(app.getPath('userData'),'pet-render.log'), '['+new Date().toISOString()+'] [pet-console:'+level+'] '+message+'\n'); }catch(_){}
  });
  petWin.webContents.on('preload-error', (e, err)=>{
    try{ fs.appendFileSync(path.join(app.getPath('userData'),'pet-render.log'), '['+new Date().toISOString()+'] [preload-error] '+(err&&err.stack||err)+'\n'); }catch(_){}
  });
  applyTop(petWin);
  petWin.on('show', () => applyTop(petWin));
  petWin.on('restore', () => applyTop(petWin));
  petWin.on('focus', () => { applyTop(petWin); steppedAsideNow=false; applyPetPass(); });
  // 失焦时让位（猫半透明 + 点击穿透），但若是面板获得焦点则不处理（避免点面板按钮猫就变透明）
  petWin.on('blur', () => {
    applyTop(petWin);
    if(autoStepAside && !isPetHidden && BrowserWindow.getFocusedWindow() !== panelWin){ steppedAsideNow=true; applyPetPass(); }
  });
  petWin.on('close', e => { if(!quitting){ e.preventDefault(); showPet(false); } });
  // 手动拖动猫才记录位置（散步/逗猫棒期间不记录，避免抖动）
  petWin.on('move', () => { if(!walking && !teaserOn) scheduleSavePos(); });

  /* ---------- 操作面板窗口（可拖拽 + 隐藏按钮） ---------- */
  const validPanel = lastPanelPos && inPrimary(lastPanelPos);
  const panelX = validPanel ? lastPanelPos[0] : wa.x + wa.width  - PANEL_W - MARGIN;
  const panelY = validPanel ? lastPanelPos[1] : wa.y + MARGIN; // 默认贴右上角，与猫（右下角）分开，互不遮挡
  panelWin = new BrowserWindow({
    width: PANEL_W, height: PANEL_H,
    x: panelX, y: panelY,
    transparent: true, frame: false, alwaysOnTop: true,
    resizable: false, hasShadow: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-panel.js'), contextIsolation: true, nodeIntegration: false },
  });
  panelWin.loadFile('panel.html');
  applyTop(panelWin);
  panelWin.on('show', () => applyTop(panelWin));
  panelWin.on('restore', () => applyTop(panelWin));
  panelWin.on('close', e => { if(!quitting){ e.preventDefault(); showPanel(false); } });
  panelWin.on('move', scheduleSavePos);   // 面板拖动即记录位置

  /* ---------- 全局光标监视窗（全屏透明，只监听鼠标、不挡操作） ---------- */
  createCursorWatch();

  /* ---------- 拖拽：两个窗口各自独立 ---------- */
  ipcMain.on('pet-drag', (e, dx, dy) => {
    const [cx, cy] = petWin.getPosition(); petWin.setPosition(cx + dx, cy + dy);
  });
  ipcMain.on('panel-drag', (e, dx, dy) => {
    const [cx, cy] = panelWin.getPosition(); panelWin.setPosition(cx + dx, cy + dy);
  });

  /* ---------- 面板 → 主进程 → 猫 ---------- */
  ipcMain.on('panel-set-state', (e, key) => setPetState(key));
  ipcMain.on('panel-set-auto', () => { try { petWin && petWin.webContents.send('pet-set-auto'); } catch(_){} });
  ipcMain.on('panel-toggle-random', () => { try { petWin && petWin.webContents.send('pet-toggle-random'); } catch(_){} });
  ipcMain.on('panel-play', () => { try { petWin && petWin.webContents.send('pet-play'); } catch(_){} });
  ipcMain.on('panel-start-catch', () => { try { petWin && petWin.webContents.send('pet-start-catch'); } catch(_){} });
  ipcMain.on('panel-toggle-walk', () => {
    if(walking){ stopWalk(); broadcastMoving(false, teaserOn); }
    else { stopTeaser(); startWalk(); broadcastMoving(true, false); }
  });
  ipcMain.on('panel-toggle-teaser', () => {
    if(teaserOn){ stopTeaser(); broadcastMoving(walking, false); }
    else { stopWalk(); startTeaser(); broadcastMoving(false, true); }
  });
  ipcMain.on('teaser-move', (e, p) => {
    // teaser.html 上报的是相对 teaserWin 视口的 clientX/Y；teaserWin 左上角在屏幕 (bx,by)，
    // 需叠加其窗口位置才得到屏幕绝对坐标，否则多屏/主屏非 (0,0) 时猫会整体偏移一个屏幕偏移量
    if(teaserWin && !teaserWin.isDestroyed()){
      const [wx, wy] = teaserWin.getPosition();
      teaserTarget = { x: p.x + wx, y: p.y + wy };
    } else {
      teaserTarget = { x: p.x, y: p.y };
    }
  });
  // 全局光标坐标：判断鼠标是否悬在猫身上，决定猫窗口是否可点击
  ipcMain.on('cursor-move', (e, p) => {
    cursorPos = p;
    const r = petRect(), m = 12;
    const over = p.x >= r.x-m && p.x <= r.x+r.w+m && p.y >= r.y-m && p.y <= r.y+r.h+m;
    if(over) steppedAsideNow = false;   // 鼠标回到猫身上 → 取消"让位"状态
    setOverPet(over);
  });
  // 接工资/掉钱小游戏期间：整窗可点击（否则硬币落在猫身外点不到）
  ipcMain.on('pet-force-clickable', (e, v) => { forceClickable = !!v; applyPetPass(); });
  ipcMain.on('panel-simulate-payday', () => { try { petWin && petWin.webContents.send('pet-simulate-payday'); } catch(_){} });
  ipcMain.on('panel-set-reminder', (e, min) => { try { petWin && petWin.webContents.send('pet-set-reminder', min); } catch(_){} });
  ipcMain.on('panel-toggle-lowpower', () => { try { petWin && petWin.webContents.send('pet-toggle-lowpower'); } catch(_){} });
  ipcMain.on('panel-hide-self', () => showPanel(false));
  ipcMain.on('panel-toggle-pet', () => showPet(!isPetHidden));

  /* ---------- 猫 → 主进程 ---------- */
  ipcMain.on('pet-state-changed', (e, key) => {
    currentState = key;
    try { panelWin && panelWin.webContents.send('panel-state-changed', key); } catch(_){}
  });
  ipcMain.on('pet-stats', (e, stats) => { try { panelWin && panelWin.webContents.send('panel-stats', stats); } catch(_){} });
  ipcMain.on('pet-flags', (e, flags) => { try { panelWin && panelWin.webContents.send('panel-flags', flags); } catch(_){} });
  ipcMain.on('pet-toggle-hide', () => showPet(!isPetHidden));
  ipcMain.on('pet-hover', () => { if(autoStepAside){ steppedAsideNow=false; applyPetPass(); } });
  // 渲染进程诊断日志（落盘到 userData/pet-render.log，供排查 GIF/脚本问题）
  ipcMain.on('pet-log', (e, m)=>{ try{ fs.appendFileSync(path.join(app.getPath('userData'),'pet-render.log'), '['+new Date().toISOString()+'] '+m+'\n'); }catch(_){} });

  /* ---------- 右键菜单（猫身上） ---------- */
  petWin.webContents.on('context-menu', (e, params) => {
    Menu.buildFromTemplate([
      { label: '摸摸头', click: () => petWin.webContents.send('pet-pat') },
      { label: '喂一口', click: () => petWin.webContents.send('pet-feed') },
      { label: '玩耍', click: () => petWin.webContents.send('pet-play') },
      { label: '捂鼻子扇闻', click: () => petWin.webContents.send('pet-sniff') },
      { label: '接工资（日结）', click: () => petWin.webContents.send('pet-start-catch') },
      { type: 'separator' },
      { label: isPetHidden ? '显示桌宠' : '隐藏桌宠', click: () => showPet(!isPetHidden) },
      { label: '打开操作面板', click: () => showPanel(true) },
      { type: 'separator' },
      { label: '退出', click: () => doQuit() },
    ]).popup(petWin);
  });
}

/* ---------- 全局光标监视窗：始终在最前、透明、点击穿透，仅向上报鼠标坐标 ---------- */
let cursorWin=null;
function createCursorWatch(){
  const { x:bx, y:by, width:sw, height:sh } = screen.getPrimaryDisplay().bounds;
  cursorWin = new BrowserWindow({
    x:bx, y:by, width:sw, height:sh,
    transparent:true, frame:false, alwaysOnTop:true, resizable:false,
    hasShadow:false, skipTaskbar:true, focusable:false,
    webPreferences:{ preload: path.join(__dirname,'preload-cursor.js'), contextIsolation:true, nodeIntegration:false },
  });
  cursorWin.loadFile('cursor.html');
  cursorWin.setIgnoreMouseEvents(true, { forward:true }); // 不挡鼠标，但仍能收到 mousemove 上报坐标
  cursorWin.on('close', e=>{ if(!quitting) e.preventDefault(); });
}

/* ---------- 自动散步：绕整个屏幕边缘走（已避开任务栏） ---------- */
let walking=false, walkTimer=null, walkPx=0, walkPy=0, walkDir=0; // 0右 1下 2左 3上（绕屏幕边缘一圈）
let walkBoundsCache=null;      // 散步开始时锁定「所在屏幕」边界，整段散步不再切换屏幕，避免跨屏跳跃/出屏
let teaserBoundsCache=null;    // 逗猫棒同理：锁定跟随所用的屏幕边界
let keepOnScreenTimer=null;    // 兜底安全网定时器
/* 取「猫当前所在屏幕」的可工作区（多显示器时跟猫走，不再只认主屏） */
function getPetDisplay(){
  try { return screen.getDisplayMatching(petWin ? petWin.getBounds() : {x:0,y:0,width:1,height:1}); }
  catch(_){ return screen.getPrimaryDisplay(); }
}
function walkBounds(disp){
  const d = disp || getPetDisplay();
  const wa = d.workArea; // workArea 已排除任务栏
  return { minX: wa.x, minY: wa.y, maxX: wa.x + wa.width - PET_W, maxY: wa.y + wa.height - PET_H };
}
/* 兜底硬夹：任何情况下 setPosition 前都保证在屏内（DPI/多屏边界异常也不出屏） */
function clampToScreen(x, y, b){
  const bb = b || walkBounds();
  return [ Math.max(bb.minX, Math.min(bb.maxX, Math.round(x))),
           Math.max(bb.minY, Math.min(bb.maxY, Math.round(y))) ];
}
/* 兜底安全网：散步/逗猫棒/拖拽/抛出之后，每 0.5s 把猫夹回所在屏幕内，杜绝出屏 */
function keepOnScreen(){
  if(!petWin || petWin.isDestroyed() || isPetHidden) return;
  const b = (teaserOn && teaserBoundsCache) ? teaserBoundsCache : walkBounds();   // 散步用猫真实所在屏幕实时兜底，避免锁定错误屏导致出屏
  const [x,y] = petWin.getPosition();
  const nx = Math.max(b.minX, Math.min(b.maxX, Math.round(x)));
  const ny = Math.max(b.minY, Math.min(b.maxY, Math.round(y)));
  if(nx!==x || ny!==y) petWin.setPosition(nx, ny);
}
function startWalk(){
  if(walking) return; walking=true;
  let [x,y] = petWin.getPosition();
  // 起步先拉回屏内：基于猫当前真实所在屏幕（getDisplayMatching 与 setPosition 同坐标系，DPI/多屏下都可靠）
  const b0 = walkBounds();
  [x,y] = clampToScreen(x, y, b0);
  walkPx = x; walkPy = y;
  walkDir = 0;   // 0右 1下 2左 3上：沿屏幕工作区边缘顺时针绕一整圈（必经最右/最下/最左/最上）
  walkTimer = setInterval(()=>{
    const STEP = 6;           // 每帧步长（像素）
    const b = walkBounds();   // 每帧用猫真实所在屏幕边界，绝不锁定到错误屏幕（修复散步跑出屏幕）
    if(walkDir===0){ walkPx += STEP; if(walkPx >= b.maxX){ walkPx = b.maxX; walkDir = 1; } }       // 向右走到右边缘
    else if(walkDir===1){ walkPy += STEP; if(walkPy >= b.maxY){ walkPy = b.maxY; walkDir = 2; } }   // 贴右边向下到底（最下）
    else if(walkDir===2){ walkPx -= STEP; if(walkPx <= b.minX){ walkPx = b.minX; walkDir = 3; } }   // 贴下边向左到最左
    else { walkPy -= STEP; if(walkPy <= b.minY){ walkPy = b.minY; walkDir = 0; } }                  // 贴左边向上到顶（最上），回到向右循环
    const [cx,cy]=clampToScreen(walkPx, walkPy, b);   // 每帧硬夹屏内，杜绝出屏
    petWin.setPosition(cx, cy);   // 不用动画，避免多 DPI 下漂移出屏
  }, 60);
}
function stopWalk(){ walking=false; clearInterval(walkTimer); walkTimer=null; walkBoundsCache=null; }

/* ---------- 逗猫棒：全屏红点 + 猫全局跟随鼠标 ---------- */
let teaserWin=null, teaserOn=false, teaserTimer=null, teaserTarget=null;
function ensureTeaser(){
  if(teaserWin && !teaserWin.isDestroyed()) return;
  try {
    const d = screen.getPrimaryDisplay();
    const { x:bx, y:by, width:sw, height:sh } = d.bounds;
    teaserWin = new BrowserWindow({
      x:bx, y:by, width:sw, height:sh,
      transparent:true, frame:false, alwaysOnTop:true, resizable:false,
      hasShadow:false, skipTaskbar:true, focusable:false,
      webPreferences:{ preload: path.join(__dirname,'preload-teaser.js'), contextIsolation:true, nodeIntegration:false },
    });
    teaserWin.loadFile('teaser.html');
    teaserWin.setIgnoreMouseEvents(true, { forward:true }); // 不挡鼠标，但仍能收到 mousemove
    teaserWin.on('close', e=>{ if(!quitting) e.preventDefault(); });
  } catch(e){ console.error('teaser win create fail', e); }
}
function startTeaser(){
  if(teaserOn) return; teaserOn=true; ensureTeaser();
  teaserBoundsCache = walkBounds();   // 锁定当前屏幕边界，逗猫棒全程在这块屏内跟随
  try { if(teaserWin && !teaserWin.isDestroyed()) teaserWin.show(); } catch(_){}
  try { teaserWin && !teaserWin.isDestroyed() && teaserWin.webContents.send('teaser-start'); } catch(_){}
  teaserTimer=setInterval(()=>{
    if(!teaserTarget || !petWin) return; const [x,y]=petWin.getPosition(); const b=teaserBoundsCache;
    const tx=Math.max(b.minX, Math.min(b.maxX, teaserTarget.x - PET_W/2));        // 猫水平中心在窗口 50%，对准鼠标
    const ty=Math.max(b.minY, Math.min(b.maxY, teaserTarget.y - PET_H*0.60));    // 猫身体中心在窗口 60%（对应 #pet top:60%），对齐鼠标
    const nx=Math.round(x+(tx-x)*0.18), ny=Math.round(y+(ty-y)*0.18);
    const [cx,cy]=clampToScreen(nx, ny, b);
    petWin.setPosition(cx, cy);   // 不用动画，避免漂移出屏
  }, 40);
  registerTeaserExit();   // 注册「Esc 退出键」，仅在逗猫棒进行中生效
}
/* 逗猫棒「退出键」：Esc 仅在逗猫棒进行中生效（随模式开关注册/注销），不影响其它场景的 Esc 正常行为 */
function registerTeaserExit(){
  try {
    if(!globalShortcut.isRegistered('Esc')){
      globalShortcut.register('Esc', () => { if(teaserOn){ stopTeaser(); broadcastMoving(walking, false); } });
    }
  } catch(e){ console.error('register teaser exit error', e); }
}
function unregisterTeaserExit(){
  try { if(globalShortcut.isRegistered('Esc')) globalShortcut.unregister('Esc'); } catch(e){}
}
function stopTeaser(){
  teaserOn=false; clearInterval(teaserTimer); teaserTimer=null; teaserTarget=null; teaserBoundsCache=null;
  unregisterTeaserExit();   // 退出后注销 Esc，恢复系统 Esc 正常行为
  try { if(teaserWin && !teaserWin.isDestroyed()){ teaserWin.webContents.send('teaser-stop'); teaserWin.hide(); } } catch(_){}
}

// 开关键（Alt+Z）：只管猫的隐藏/显示
function togglePet(){ showPet(!isPetHidden); }

// 退出：先置 quitting，允许 close 真正关闭窗口再 quit
function doQuit(){
  quitting = true;
  try { stopWalk(); stopTeaser(); } catch(_){}
  try { cursorWin && !cursorWin.isDestroyed() && cursorWin.destroy(); } catch(_){}
  try { globalShortcut.unregisterAll(); } catch(_){}
  try { savePos(); } catch(_){}
  try { if(fs.existsSync(INST_LOCK)) fs.unlinkSync(INST_LOCK); } catch(_){}   // 释放单实例锁
  app.quit();
}

// 托盘菜单（可勾选项需动态重建以同步状态）
function buildTrayMenu(){
  return Menu.buildFromTemplate([
    { label: isPetHidden ? '显示桌宠 (Alt+Z)' : '隐藏桌宠 (Alt+Z)', click: () => togglePet() },
    { label: isPanelHidden ? '显示操作面板' : '隐藏操作面板', click: () => showPanel(!isPanelHidden) },
    { type: 'separator' },
    { label: '自动让位（点别的软件时猫半透明不挡）', type:'checkbox', checked: autoStepAside,
      click: (i) => { autoStepAside = i.checked; if(!autoStepAside){ steppedAsideNow=false; applyPetPass(); } tray && tray.setContextMenu(buildTrayMenu()); } },
    { label: '开机自启动', type:'checkbox', checked: autoStart,
      click: (i) => { setAutoStart(i.checked); tray && tray.setContextMenu(buildTrayMenu()); } },
    { type: 'separator' },
    { label: '摸摸头', click: () => petWin && petWin.webContents.send('pet-pat') },
    { label: '喂一口', click: () => petWin && petWin.webContents.send('pet-feed') },
    { label: '玩耍', click: () => petWin && petWin.webContents.send('pet-play') },
    { label: '接工资（日结）', click: () => petWin && petWin.webContents.send('pet-start-catch') },
    { label: '模拟发工资', click: () => petWin && petWin.webContents.send('pet-simulate-payday') },
    { type: 'separator' },
    { label: walking ? '停止散步' : '开始散步', click: () => { if(walking) stopWalk(); else { stopTeaser(); startWalk(); } broadcastMoving(walking, teaserOn); } },
    { label: teaserOn ? '关闭逗猫棒' : '打开逗猫棒', click: () => { if(teaserOn) stopTeaser(); else { stopWalk(); startTeaser(); } broadcastMoving(walking, teaserOn); } },
    { type: 'separator' },
    { label: '退出', click: () => doQuit() },
  ]);
}

function createTray(){
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/icon.ico'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
    ) : icon);
    tray.setToolTip('月薪喵 桌面宠物（Alt+Z 隐藏/显示猫）');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => togglePet()); // 点托盘图标开关猫
  } catch (e) { console.error('tray error', e); }
}

/* ---------- 单实例：启动即用 taskkill /F /IM pet.exe 清掉所有同名旧进程，再请求内置锁防重复双击 ----------
   之前自实现的 PID 文件锁有缺陷：旧 pid 被系统复用给无关程序时会误判"存活"而放行，且 taskkill /PID
   有时杀不掉 Electron 主进程，导致旧窗口一直占着、新代码永远接管不上。改为启动即强杀同名进程最干脆。 */
function killOtherPetInstances(){
  // 关键：必须排除「当前进程自身」，否则 taskkill /IM <本进程名> 会把刚启动的这个实例也杀掉（导致一开就闪退、永远看不到猫）
  // 进程名跟随 exe 文件名（重命名 pet.exe -> 月薪喵.exe 后也能正确强杀同名旧实例）
  try {
    const self = process.pid;
    const exeName = path.basename(process.execPath);
    const esc = exeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const out = execSync('tasklist /FI "IMAGENAME eq ' + exeName + '" /FO CSV /NH', { windowsHide:true }).toString();
    out.split('\n').forEach(line=>{
      const m = line.match(new RegExp('"' + esc + '",\\s*"?(\\d+)"', 'i')) || line.match(new RegExp(esc + ',\\s*(\\d+)', 'i'));
      if(!m) return;
      const pid = parseInt(m[1], 10);
      if(pid && pid !== self){ try{ execSync('taskkill /F /PID '+pid, { windowsHide:true }); }catch(e){} }
    });
  } catch(e){ /* 没有其它实例则忽略 */ }
}
killOtherPetInstances();              // 启动即清掉任何残留的同名旧进程（含托盘里那个没猫的旧窗口）
const _gotLock = app.requestSingleInstanceLock();
BOOT('LOCK ok='+_gotLock+' pid='+process.pid);
L('LOCK_DONE ok=' + _gotLock);
if(!_gotLock){ L('LOCK_FAIL_QUIT'); app.quit(); return; }   // 同一瞬间多次双击时，仅第一个实例继续

app.whenReady().then(() => {
  L('APP_READY');
  try { killOtherPetInstances(); } catch(_){}   // 再杀一次兜底，防竞态下旧进程没清干净
  try { autoStart = app.getLoginItemSettings().openAtLogin; } catch(e){}
  try { loadPos(); } catch(_){}             // 恢复上次猫 / 面板的位置
  try {
    createWindows();
    L('WINDOWS_DONE');
    BOOT('WINDOWS_DONE pid='+process.pid);
  } catch(e){ L('CREATE_WINDOWS_ERR ' + ((e&&e.stack)?e.stack:String(e))); BOOT('CREATE_WINDOWS_ERR '+(e&&e.message)); }
  if(!keepOnScreenTimer) keepOnScreenTimer = setInterval(keepOnScreen, 500);  // 兜底安全网：猫永不离开屏幕
  setAutoStart(true);   // 默认开启开机自启（用户要求；托盘可关）
  createTray();
  L('TRAY_DONE');

  try {
    if(!globalShortcut.isRegistered('Alt+Z')) globalShortcut.register('Alt+Z', togglePet);
    if(!globalShortcut.isRegistered('Alt+P')) globalShortcut.register('Alt+P', () => showPanel(true));
  } catch (e) { console.error('shortcut error', e); }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows(); });
});

app.on('before-quit', () => { quitting = true; });
// 桌宠有托盘：所有窗口关闭也不退出，托盘可重新唤出（避免渲染进程意外崩溃时整个应用消失）
app.on('window-all-closed', () => { /* keep alive via tray */ });
