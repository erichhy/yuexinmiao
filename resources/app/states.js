// 共享数据：把 GIF_CATALOG 按 state 分组，并定义状态展示顺序
// （pet.html 与 panel.html 都会加载，需在 catalog.js 之后引入）
const stateLists = {};
GIF_CATALOG.forEach(item => {
  if (!stateLists[item.state]) stateLists[item.state] = [];
  stateLists[item.state].push(item);
});
const STATE_ORDER = ["happy","sad","shock","angry","love","eat","phone","work","sleep","sport","shy","rich","other"];
