// 共享 UI：构建状态选择按钮网格，供 pet.html（浏览器预览）与 panel.html（操作面板）复用
// 用法：const ui = buildStateUI(containerEl, onPick);  ui.setActive(stateKey);
function buildStateUI(container, onPick){
  const sb = document.createElement('div');
  sb.className = 'stateBtns';
  const btnMap = {};
  STATE_ORDER.forEach(k => {
    const list = stateLists[k]; if(!list) return;
    const b = document.createElement('button');
    b.className = 'btn'; b.dataset.k = k;
    b.textContent = `${STATE_NAMES[k]} ${list.length}`;
    b.onclick = () => { if(onPick) onPick(k); };
    sb.appendChild(b);
    btnMap[k] = b;
  });
  container.appendChild(sb);
  return {
    el: sb,
    setActive(key){
      Object.values(btnMap).forEach(b => b.classList.toggle('active', b.dataset.k === key));
    }
  };
}
