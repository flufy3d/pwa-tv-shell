// TVShell 核心脚本：通过 WebViewCompat.addDocumentStartJavaScript 在网页任何脚本之前运行。
// CFG 由 ShellActivity 在运行时替换进来：{app, name, version, dpr, uaData, fixKeyEvents, mode, debug, fps}
(function (CFG) {
  'use strict';
  if (!CFG || window.__tvshell) return;
  const hide = (o, k, v) => Object.defineProperty(o, k, { value: v, configurable: true });
  const post = (cmd, arg) => {
    const n = window.TVShellNative; // WebMessageListener 只对允许的源注入
    if (n) n.postMessage(JSON.stringify({ cmd, arg }));
  };

  // ── devicePixelRatio 覆盖：只影响网页读到的值（比如 three.js 的渲染分辨率），CSS 布局不变 ──
  if (typeof CFG.dpr === 'number' && CFG.dpr > 0) {
    const dpr = CFG.dpr;
    Object.defineProperty(window, 'devicePixelRatio', { get: () => dpr, set() {}, configurable: true });
  }

  // ── navigator.userAgentData 覆盖（mobile / platform）──
  if (CFG.uaData && navigator.userAgentData) {
    const orig = navigator.userAgentData, o = CFG.uaData;
    const mobile = 'mobile' in o ? !!o.mobile : orig.mobile;
    const platform = 'platform' in o ? String(o.platform) : orig.platform;
    const fake = Object.freeze({
      get brands() { return orig.brands; },
      mobile, platform,
      getHighEntropyValues: h => orig.getHighEntropyValues(h).then(v => Object.assign({}, v, { mobile, platform })),
      toJSON: () => ({ brands: orig.brands, mobile, platform }),
    });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => fake, configurable: true });
  }

  // ── 原生按键修复（在 window 捕获阶段，比网页所有监听都早；事件仍是原生的，isTrusted 和用户激活都保留）──
  // 1. code：WebView 由 scanCode 推出 code，CEC/adb 注入的键 scanCode=0，code 为空，按 key 补上。
  // 2. repeat：WebView 把长按的重复按下也报成 repeat=false，按"没松开又按下"补上 repeat=true。
  const CODE_OF = {
    ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
    Enter: 'Enter', Escape: 'Escape', ' ': 'Space', Tab: 'Tab', Backspace: 'Backspace',
    PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End',
  };
  const codeOf = k => CODE_OF[k] || (/^[0-9]$/.test(k) ? 'Digit' + k : /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : '');
  const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  let mode = CFG.mode; // keys / focus / cursor，菜单里切换时由 __tvshell.setMode 更新
  const held = new Set();
  window.addEventListener('blur', () => held.clear());
  for (const type of ['keydown', 'keyup']) {
    window.addEventListener(type, e => {
      if (e.__tvshellMapped) return;
      if (CFG.fixKeyEvents) {
        if (!e.code) {
          const c = codeOf(e.key);
          if (c) { hide(e, 'code', c); hide(e, '__tvshellFixed', true); }
        }
        const id = e.code || e.key;
        if (type === 'keyup') held.delete(id);
        else if (held.has(id)) { if (!e.repeat) { hide(e, 'repeat', true); hide(e, '__tvshellFixed', true); } }
        else held.add(id);
      }
      // 无触摸屏时 WebView 默认开启空间导航：方向键会把焦点移到按钮上，之后确定键会"点击"它。
      // keys 模式（游戏）关掉：方向键 preventDefault（网页自己的监听照常收到）。cursor 模式下方向键不会传到网页。
      if (mode === 'keys' && type === 'keydown' && ARROWS.has(e.key)) e.preventDefault();
    }, true);
  }

  // ── 原生侧映射键：合成键盘事件派发到焦点元素，冒泡到 document / window ──
  function key(type, k, code, keyCode, repeat) {
    const t = document.activeElement || document.body || document.documentElement;
    if (!t) return;
    const ev = new KeyboardEvent(type, {
      key: k, code, keyCode, which: keyCode, repeat: !!repeat,
      bubbles: true, cancelable: true, composed: true, view: window,
    });
    if (ev.keyCode !== keyCode) { hide(ev, 'keyCode', keyCode); hide(ev, 'which', keyCode); }
    hide(ev, '__tvshellMapped', true);
    t.dispatchEvent(ev);
  }

  // ── 返回键（back.web=true）：网页 preventDefault 了就不执行默认返回 ──
  function back() {
    const ev = new Event('tvshell:back', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  // ── 光标模式的边缘滚动：指针推到屏幕边缘时由原生侧每帧调用。(fx, fy) 是指针在视口里的比例位置，dx/dy 是 CSS px ──
  // 指针下的元素往上找能往这个方向滚的容器；找不到就用页面上可见面积最大的可滚动容器（内嵌滚动区常常不贴屏幕边缘）；
  // 都没有就向指针下的元素派发 wheel 事件（给自己处理滚轮的 canvas 类应用）。返回 false 表示交给原生滚轮（跨域 iframe）。
  const canScroll = (el, dx, dy) => {
    const root = el === document.scrollingElement;
    if (!root) {
      const s = getComputedStyle(el);
      const oy = /(auto|scroll|overlay)/.test(s.overflowY), ox = /(auto|scroll|overlay)/.test(s.overflowX);
      if (!(dy && oy) && !(dx && ox)) return false;
    }
    if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    if (dy < 0 && el.scrollTop > 0) return true;
    if (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    return dx < 0 && el.scrollLeft > 0;
  };
  let scrollables = null, scrollablesAt = 0;
  const biggestScrollable = (dx, dy) => {
    const now = performance.now();
    if (!scrollables || now - scrollablesAt > 1000) {
      scrollables = [];
      scrollablesAt = now;
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) scrollables.push(el);
      }
    }
    let best = null, bestArea = 0;
    for (const el of scrollables) {
      if (!el.isConnected || !canScroll(el, dx, dy)) continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0), h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w > 0 && h > 0 && w * h > bestArea) { best = el; bestArea = w * h; }
    }
    return best;
  };
  function scroll(fx, fy, dx, dy) {
    const x = fx * innerWidth, y = fy * innerHeight;
    const hit = document.elementFromPoint(Math.min(x, innerWidth - 1), Math.min(y, innerHeight - 1));
    if (hit && hit.tagName === 'IFRAME') return false;
    let el = hit;
    while (el && el.nodeType === 1 && !canScroll(el, dx, dy)) el = el.parentElement;
    const se = document.scrollingElement;
    const target = (el && el.nodeType === 1 ? el : null) || (se && canScroll(se, dx, dy) ? se : null) || biggestScrollable(dx, dy);
    if (target) target.scrollBy(dx, dy);
    else if (hit) hit.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true, view: window }));
    return true;
  }

  hide(window, '__tvshell', Object.freeze({ key, back, scroll, setMode: m => { mode = m; } }));
  Object.defineProperty(window, 'TVShell', {
    value: Object.freeze({
      version: CFG.version, app: CFG.app, debug: !!CFG.debug,
      get inputMode() { return mode; },  // 当前输入方式：keys / focus / cursor
      exit: () => post('exit'),          // 退出 App
      back: () => post('back'),          // 执行套壳的默认返回（后退，或按 back.atRoot 处理）
      toast: msg => post('toast', String(msg)),
    }),
    enumerable: false,
  });

  // ── 调试：叠层显示网页实际收到的按键，并 console.log 到 logcat（TVShell-web）──
  if (CFG.debug) {
    const lines = [];
    let box = null;
    const show = s => {
      lines.push(s);
      if (lines.length > 8) lines.shift();
      if (!box && document.documentElement) {
        box = document.createElement('div');
        box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;pointer-events:none;' +
          'background:rgba(0,0,0,.72);color:#ff0;font:11px/1.35 monospace;padding:6px 8px;white-space:pre;';
        document.documentElement.appendChild(box);
      }
      if (box) box.textContent = 'web\n' + lines.join('\n');
    };
    const log = e => {
      const s = `${e.type.padEnd(7)} key=${JSON.stringify(e.key)} code=${JSON.stringify(e.code)} keyCode=${e.keyCode}` +
        ` rep=${e.repeat ? 1 : 0} trusted=${e.isTrusted ? 1 : 0}${e.__tvshellFixed ? ' fixed' : ''}${e.__tvshellMapped ? ' mapped' : ''}`;
      const a = document.activeElement;
      const focus = a && a !== document.body ? ` focus=${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}` : '';
      setTimeout(() => {
        const t = s + (e.defaultPrevented ? ' prevented' : '') + focus;
        console.log('[tvshell-key] ' + t);
        show(t);
      }, 0);
    };
    window.addEventListener('keydown', log, true);
    window.addEventListener('keyup', log, true);
    const life = e => console.log(`[tvshell] ${e.type} visibility=${document.visibilityState}`);
    document.addEventListener('visibilitychange', life);
    window.addEventListener('blur', life);
    window.addEventListener('focus', life);
    window.addEventListener('DOMContentLoaded', () => {
      const ua = navigator.userAgentData;
      console.log(`[tvshell] dpr=${devicePixelRatio} inner=${innerWidth}x${innerHeight} screen=${screen.width}x${screen.height}` +
        ` cores=${navigator.hardwareConcurrency} mem=${navigator.deviceMemory} uaData.mobile=${ua && ua.mobile} ua=${navigator.userAgent}`);
      show(`dpr=${devicePixelRatio} ${innerWidth}x${innerHeight} mobile=${ua && ua.mobile}`);
    });
  }

  // ── 帧率统计：每 5 秒 console.log 一次 rAF 帧率和最大 canvas 的绘制尺寸 ──
  if (CFG.fps) {
    let t0 = 0, last = 0, frames = 0, worst = 0, slow = 0;
    const canvasSize = () => {
      let best = null;
      for (const c of document.querySelectorAll('canvas')) if (!best || c.width * c.height > best.width * best.height) best = c;
      return best ? `${best.width}x${best.height}` : '-';
    };
    const tick = t => {
      if (t0 && t - last > 2000) t0 = 0; // 页面隐藏后恢复，重新计时
      if (!t0) { t0 = last = t; frames = 0; worst = 0; slow = 0; }
      else {
        const d = t - last;
        last = t;
        frames++;
        if (d > worst) worst = d;
        if (d > 1000 / 30) slow++;
        if (t - t0 >= 5000) {
          console.log(`[tvshell-fps] fps=${(frames * 1000 / (t - t0)).toFixed(1)} worst=${worst.toFixed(0)}ms` +
            ` slow(>33ms)=${slow}/${frames} dpr=${devicePixelRatio} canvas=${canvasSize()} view=${innerWidth}x${innerHeight}`);
          t0 = last = t; frames = 0; worst = 0; slow = 0;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
})(/*CFG*/null);
