// neon-racer 的电视适配（不改游戏源码）。成就面板的打开按钮原本只能用鼠标点：
// - 套壳菜单里的"成就档案"调用 neonRacerTV.toggleArchive()，任何遥控器都能用
// - 返回键（back.web=true）在面板打开时先关面板
// - 有彩色键的遥控器：绿键（映射成 F2）打开/关闭，红键（映射成 Escape）关闭
// - 面板开着时上下键滚动面板
(function () {
  const $ = id => document.getElementById(id);
  const archiveOpen = () => { const p = $('achieveScreen'); return !!p && !p.classList.contains('hidden'); };
  function toggleArchive() {
    if (archiveOpen()) return $('achClose').click();
    // 开始页或结算页上可见的那个按钮；游戏进行中没有，什么都不做
    const btn = ['achBtn', 'achBtn2'].map($).find(b => b && b.getClientRects().length > 0);
    if (btn) btn.click();
    else if (window.TVShell) TVShell.toast('游戏结束后才能查看成就');
  }
  Object.defineProperty(window, 'neonRacerTV', { value: Object.freeze({ toggleArchive }) });
  addEventListener('tvshell:back', e => {
    if (archiveOpen()) { $('achClose').click(); e.preventDefault(); }
  });
  addEventListener('keydown', e => {
    if (e.code === 'F2' && !e.repeat) toggleArchive();
    // 面板开着时上下键滚动面板：按键模式下套壳对方向键 preventDefault，游戏自己也不处理面板滚动。
    // 按住时遥控器的重复按下会继续滚。
    if (archiveOpen() && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      const panel = document.querySelector('#achieveScreen .achievePanel');
      if (panel) panel.scrollBy({ top: (e.code === 'ArrowDown' ? 1 : -1) * panel.clientHeight * 0.4, behavior: 'smooth' });
    }
  });
})();
