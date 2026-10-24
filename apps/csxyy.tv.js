// CN影视（csxyy.com）的电视适配：去广告、遥控器导航、播放页全屏和按键控制。
// 注入脚本在网页自己的脚本之前运行，也注入到同源的播放器 iframe 里。
(function () {
  'use strict';

  var TOP = window.top === window;
  var SITE = 'csxyy.com';
  var PLAY = TOP && location.pathname.indexOf('/movie-play/') === 0;

  // MacPlayer 会用 src="" 生成两个隐藏 iframe（#buffer / #install）来放广告，空 src 会递归加载当前页。
  // 在递归页面里立刻把父 iframe 删掉并停止解析。
  try {
    var fe = window.frameElement;
    if (fe && (fe.id === 'buffer' || fe.id === 'install')) {
      try { fe.remove(); } catch (e1) {}
      try { window.stop(); } catch (e2) {}
      return;
    }
  } catch (e) {}

  // 语言：站点把简/繁选择存在 localStorage.zh_choose；TV 默认简体，
  // 第一次运行新版本时把之前误切的繁体改回来（之后仍尊重用户选择）。
  try {
    if (!localStorage.getItem('csxyyTvLang')) {
      localStorage.setItem('csxyyTvLang', '1');
      if (localStorage.getItem('zh_choose') === 't') localStorage.setItem('zh_choose', 's');
    }
  } catch (e) {}

  function urlOf(x) {
    try { return new URL(x.href || x, location.href); } catch (e) { return null; }
  }
  function isSiteHost(h) {
    h = (h || '').toLowerCase();
    return h === SITE || h.slice(-(SITE.length + 1)) === '.' + SITE;
  }
  function isSiteUrl(x) {
    var u = urlOf(x);
    return !!u && (u.protocol === 'http:' || u.protocol === 'https:') && isSiteHost(u.hostname);
  }
  function isHttpUrl(x) {
    var u = urlOf(x);
    return !!u && (u.protocol === 'http:' || u.protocol === 'https:');
  }

  // ── 广告清理（所有 frame）─────────────────────────────────────────
  // 只删明确的广告容器；.top-back 是右侧悬浮工具栏，电视上不需要。
  var AD_SELECTORS = [
    '.ec-ad', '.ad-container', '.ad-item', '.ad-img',
    '#ADplayer', '#ADtip', '.vod-gg', '#player_pause',
    'iframe#buffer', 'iframe#install'
  ].join(',');

  function nukeAds() {
    var els;
    try { els = document.querySelectorAll(AD_SELECTORS); } catch (e) { return; }
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i];
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  // 外链一律不跳转（本站内容链接都在 csxyy.com）。原生侧还有 blockExternal 兜底。
  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;
    if (!isHttpUrl(a) || isSiteUrl(a)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (TOP && window.TVShell && TVShell.toast) TVShell.toast('已拦截外部链接');
  }, true);

  // 广告常用 window.open；多个窗口在套壳里本来也打不开。
  try { window.open = function () { return null; }; } catch (e) {}

  var pendingNuke = false;
  function scheduleNuke() {
    if (pendingNuke) return;
    pendingNuke = true;
    setTimeout(function () { pendingNuke = false; nukeAds(); }, 120);
  }

  // ── 以下是顶层页面的电视适配 ─────────────────────────────────────
  function hideEl(el) {
    if (el && el.style) el.style.setProperty('display', 'none', 'important');
  }
  function hideAll(sel) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) hideEl(els[i]);
  }
  function toast(msg) {
    try { if (window.TVShell && TVShell.toast) TVShell.toast(msg); } catch (e) {}
  }

  var CSS = [
    // 广告和右侧悬浮工具栏
    'html body .top-back{display:none!important}',
    'html body .ec-ad,html body .ad-container,html body .ad-item,html body .ad-img{display:none!important}',
    // 首页大图：只留当前海报，隐藏右侧文字和底部标题条；高度压到 320，给下面的内容留位置
    'html body .slide-a{height:320px!important}',
    'html body .slide-time-list,html body .slide-time-bj{height:100%!important;margin-top:0!important}',
    'html body .slide-nav-list,html body .slide-a .box-width,html body .slide-a .this-100,html body .slide-a .swiper-pagination{display:none!important}',
    'html body .slide-time-img3,html body .slide-time-img3 img.slide-img{height:100%!important}',
    // 顶部导航：隐藏搜索、播放记录、头像和“更多”，把全部分类平铺出来（JS 会同时改 inline style）
    'html body .head .this-search,html body .head .gen-history,html body .head .head-user,html body .head .gen-left-list,html body .head .head-more-a{display:none!important}',
    'html body .head .head-nav{width:auto!important;flex:1 1 auto!important;overflow:visible!important}',
    'html body .head .head-nav .swiper-wrapper{display:flex!important;transform:none!important;width:auto!important}',
    'html body .head .head-nav .swiper-slide{display:block!important;width:auto!important;flex:0 0 auto!important}',
    // 遥控器焦点：卡片容器本身加描边，避免被 poster 的 overflow:hidden 裁掉
    'html body a:focus,html body button:focus,html body [tabindex]:focus{outline:4px solid #26b2ff!important;outline-offset:3px!important}',
    'html body .head-nav a:focus{outline-offset:-3px!important}',
    'html body .public-list-box:focus-within{outline:4px solid #26b2ff!important;outline-offset:4px!important;border-radius:10px!important;box-shadow:0 0 26px rgba(38,178,255,.55)!important;z-index:3;position:relative}',
    'html body .anthology-list-play li:focus-within{outline:4px solid #26b2ff!important;outline-offset:2px!important;background:rgba(38,178,255,.12)!important;border-radius:10px!important}',
    'html body .slide-time-bj:focus-within{outline:4px solid #26b2ff!important;outline-offset:-4px!important}',
    'html{scroll-padding-top:84px}',
    // 播放页：整页只留播放器，视频铺满 16:9 屏幕
    'html.tv-playing,html.tv-playing body{overflow:hidden!important;background:#000!important;padding:0!important}',
    'html.tv-playing .head,html.tv-playing .top-back,html.tv-playing .player-right,html.tv-playing #play1,html.tv-playing #play2,html.tv-playing .player-details-box,html.tv-playing .ad-container,html.tv-playing .ec-ad{display:none!important}',
    'html.tv-playing .player{width:100vw!important;height:100vh!important;margin:0!important;padding:0!important}',
    'html.tv-playing .player-left{width:100vw!important;height:100vh!important;margin:0!important;padding:0!important}',
    'html.tv-playing .MacPlayer{width:100vw!important;height:100vh!important;background:#000!important}',
    // 播放器 iframe 内部的广告位
    '#ADplayer,#ADtip,.vod-gg{display:none!important}'
  ].join('');

  function installCss() {
    try {
      var st = document.createElement('style');
      st.id = 'csxyy-tv-css';
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  installCss();
  if (PLAY) {
    try { document.documentElement.classList.add('tv-playing'); } catch (e) {}
  }

  // 只处理顶层页面；播放器 iframe 只做上面的广告清理。
  if (!TOP) {
    if (window.MutationObserver) {
      try { new MutationObserver(scheduleNuke).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    }
    document.addEventListener('DOMContentLoaded', nukeAds, { once: true });
    addEventListener('load', nukeAds);
    return;
  }

  function tidyHeader() {
    var nav = document.querySelector('.head-nav');
    if (!nav) return;
    if (nav.swiper && nav.swiper.destroy) {
      try { nav.swiper.destroy(false, false); } catch (e) {}
    }
    hideAll('.head .this-search,.head .gen-history,.head .head-user,.head .gen-left-list,.head .head-more-a');
    var wr = nav.querySelector('.swiper-wrapper');
    if (wr) {
      wr.style.setProperty('display', 'flex', 'important');
      wr.style.setProperty('transform', 'none', 'important');
      wr.style.setProperty('width', 'auto', 'important');
    }
    var slides = nav.querySelectorAll('.swiper-slide');
    for (var i = 0; i < slides.length; i++) {
      slides[i].style.setProperty('display', 'block', 'important');
      slides[i].style.setProperty('width', 'auto', 'important');
      slides[i].style.setProperty('flex', '0 0 auto', 'important');
    }
    nav.style.setProperty('width', 'auto', 'important');
    nav.style.setProperty('flex', '1 1 auto', 'important');
    nav.style.setProperty('overflow', 'visible', 'important');
  }

  function tidyHero() {
    var list = document.querySelector('.slide-time-list');
    if (!list) return;
    var sw = list.swiper;
    var slides = list.querySelectorAll('.slide-time-bj');
    for (var i = slides.length - 1; i >= 0; i--) {
      var a = slides[i].querySelector('a');
      if (a && !isSiteUrl(a)) {
        if (slides[i].parentNode) slides[i].parentNode.removeChild(slides[i]);
      }
    }
    if (sw) {
      try { sw.loopDestroy(); } catch (e1) {}
      try { sw.update(); } catch (e2) {}
      try { if (sw.autoplay && sw.autoplay.stop) sw.autoplay.stop(); } catch (e3) {}
      try { sw.slideTo(0); } catch (e4) {}
    }
    var active = list.querySelector('.swiper-slide-active') || list.querySelector('.slide-time-bj');
    var links = list.querySelectorAll('.slide-time-bj a');
    for (var j = 0; j < links.length; j++) links[j].tabIndex = -1;
    if (active) {
      var main = active.querySelector('a');
      if (main) main.tabIndex = 0;
    }
  }

  function tidyTop() {
    nukeAds();
    hideAll('.top-back');
    tidyHeader();
    tidyHero();
    tidyFocusTargets();
    tidySearchPage();
  }

  // 站内搜索结果页会把搜索框自动聚焦并弹出输入法；电视上用套壳菜单里的搜索，
  // 页面里的搜索框只保留显示关键词，避免输入法盖住结果。
  function tidySearchPage() {
    if (location.pathname.indexOf('/search') !== 0) return;
    var inputs = document.querySelectorAll('input[name=wd]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].readOnly = true;
      inputs[i].tabIndex = -1;
    }
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
      try { ae.blur(); } catch (e) {}
    }
  }

  document.addEventListener('focusin', function (e) {
    if (location.pathname.indexOf('/search') !== 0) return;
    var t = e.target;
    if (t && t.matches && t.matches('input[name=wd]')) {
      try { t.blur(); } catch (err) {}
    }
  }, true);

  // 详情页的年份/地区/类型/演员等标签太多，遥控器会一个个经过；跳过它们，直接到“立即播放”和选集
  function tidyFocusTargets() {
    var els = document.querySelectorAll('.slide-info a,.deployment,.player-details a,.role-card a,.ec-report,.charge-button,.play-tips-bnt');
    for (var i = 0; i < els.length; i++) els[i].tabIndex = -1;
    // 搜索结果卡片：保留海报、片名和“播放正片”，跳过类型/演员等一堆标签
    var links = document.querySelectorAll('.search-box a');
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      if (a.closest('h3') || a.classList.contains('button') || a.querySelector('img')) continue;
      a.tabIndex = -1;
    }
  }

  // 焦点进入视口中间附近，避免贴边或者被吸顶导航挡住
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!el || el === document.body || el === document.documentElement) return;
    if (!el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    var top = 84;
    var bottom = window.innerHeight - 16;
    if (r.top < top || r.bottom > bottom) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); }
      catch (err) { try { el.scrollIntoView(); } catch (e2) {} }
    }
  }, true);

  // ── 播放器控制 ───────────────────────────────────────────────────
  var dpCache = null;

  function findPlayer(win, depth) {
    if (!win || depth > 4) return null;
    try { if (win.EC && win.EC.dp && win.EC.dp.video) return win.EC.dp; } catch (e) {}
    var fs = [];
    try { fs = win.document.querySelectorAll('iframe'); } catch (e) { return null; }
    for (var i = 0; i < fs.length; i++) {
      var r = null;
      try { r = findPlayer(fs[i].contentWindow, depth + 1); } catch (e) {}
      if (r) return r;
    }
    return null;
  }

  function getPlayer() {
    if (dpCache) {
      try { if (dpCache.video && dpCache.video.isConnected) return dpCache; } catch (e) {}
      dpCache = null;
    }
    dpCache = findPlayer(window, 0);
    return dpCache;
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showControls(dp) {
    try {
      if (dp.controller) {
        if (dp.controller.show) dp.controller.show();
        if (dp.controller.setAutoHide) dp.controller.setAutoHide();
      }
    } catch (e) {}
  }

  function seekBy(sec) {
    var dp = getPlayer();
    if (!dp) { toast('当前页面没有播放器'); return; }
    try {
      var d = dp.video.duration;
      var to = dp.video.currentTime + sec;
      if (d && isFinite(d)) to = Math.min(d, to);
      dp.seek(Math.max(0, to));
      showControls(dp);
      toast((sec > 0 ? '快进 ' : '快退 ') + Math.abs(sec) + ' 秒 · ' + fmt(dp.video.currentTime) + ' / ' + fmt(dp.video.duration));
    } catch (e) { toast('播放器还没准备好'); }
  }

  function volumeBy(delta) {
    var dp = getPlayer();
    if (!dp) { toast('当前页面没有播放器'); return; }
    try {
      var v = Math.max(0, Math.min(1, (dp.video.volume || 0) + delta));
      dp.volume(v);
      showControls(dp);
      toast('音量 ' + Math.round(v * 100) + '%');
    } catch (e) { toast('播放器还没准备好'); }
  }

  function togglePlay() {
    var dp = getPlayer();
    if (!dp) { toast('当前页面没有播放器'); return; }
    var wasPaused = dp.video.paused;
    try {
      if (dp.toggle) dp.toggle();
      else if (dp.video.paused) dp.play();
      else dp.pause();
      userPaused = !wasPaused;
      showControls(dp);
      toast(userPaused ? '已暂停' : '继续播放');
    } catch (e) { toast('播放器还没准备好'); }
  }

  var dmOff = false;
  try { dmOff = localStorage.getItem('csxyyDmOff') === '1'; } catch (e) {}
  var userPaused = false;

  // 记住弹幕开关：换集、重开 App 后仍保持
  function applyDanmakuPref() {
    if (!dmOff) return;
    var dp = getPlayer();
    if (!dp || !dp.danmaku) return;
    try {
      if (dp.danmaku.hide) dp.danmaku.hide();
      if (dp.danmaku.pause) dp.danmaku.pause();
    } catch (e) {}
  }

  // 菜单打开时套壳会 onPause，网页可能因此暂停；回到前台且不是用户主动暂停时继续播放
  function ensurePlaying() {
    var dp = getPlayer();
    if (!dp || !dp.video) return;
    applyDanmakuPref();
    if (!dp.video.paused || userPaused) return;
    try { dp.play(); } catch (e) {}
  }

  function ensurePlayingFor(seconds) {
    var until = Date.now() + seconds * 1000;
    ensurePlaying();
    var timer = setInterval(function () {
      if (Date.now() > until) { clearInterval(timer); return; }
      ensurePlaying();
    }, 1000);
  }

  function toggleDanmaku() {
    var dp = getPlayer();
    if (!dp || !dp.danmaku) { toast('当前页面没有弹幕'); return; }
    try {
      if (dmOff) {
        if (dp.danmaku.show) dp.danmaku.show();
        if (dp.danmaku.play) dp.danmaku.play();
        dmOff = false;
        try { localStorage.setItem('csxyyDmOff', '0'); } catch (e2) {}
        toast('弹幕已开启');
      } else {
        if (dp.danmaku.hide) dp.danmaku.hide();
        if (dp.danmaku.pause) dp.danmaku.pause();
        dmOff = true;
        try { localStorage.setItem('csxyyDmOff', '1'); } catch (e3) {}
        toast('弹幕已关闭');
      }
    } catch (e) { toast('弹幕切换失败'); }
  }

  function nextEpisode() {
    var next = null;
    try { next = window.player_aaaa && window.player_aaaa.link_next; } catch (e) {}
    if (!next) {
      var a = document.querySelector('a[title="下集"]');
      next = a && a.getAttribute('href');
    }
    if (!next) { toast('没有下一集'); return; }
    try { location.href = new URL(next, location.href).href; } catch (e) { location.href = next; }
  }

  function showEpisodes() {
    var target = document.getElementById('play2') || document.querySelector('.player-right');
    if (!target) { toast('当前页面没有选集'); return; }
    var dp = getPlayer();
    if (dp && dp.video && !dp.video.paused) {
      try { dp.pause(); } catch (e) {}
      userPaused = true;
    }
    try { document.documentElement.classList.remove('tv-playing'); } catch (e) {}
    try { document.body.style.overflow = ''; } catch (e) {}
    try {
      var y = target.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: y, behavior: 'smooth' });
    } catch (e) { try { target.scrollIntoView(); } catch (e2) {} }
    setTimeout(function () {
      function focusEpisode() {
        var cur = target.querySelector('li.on a.js-play-episode') || target.querySelector('a.js-play-episode');
        if (!cur || !cur.isConnected) return;
        var ae = document.activeElement;
        if (ae && ae.classList && ae.classList.contains('js-play-episode')) return;
        try { cur.focus({ preventScroll: true }); } catch (e) {}
        try { cur.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e2) {}
      }
      focusEpisode();
      // 菜单关闭时套壳会 requestFocus，可能把焦点还给页面第一个链接；多补几次
      setTimeout(focusEpisode, 650);
      setTimeout(focusEpisode, 1400);
    }, 450);
    toast('已暂停 · 方向键选择集数');
  }

  function enterPlayMode() {
    try { document.documentElement.classList.add('tv-playing'); } catch (e) {}
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    userPaused = false;
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  // 播放页的选集/线路切换可能是 AJAX 原地换源（URL 变了但页面没重载），换完自动回到全屏
  document.addEventListener('click', function (e) {
    if (!PLAY) return;
    var a = e.target && e.target.closest ? e.target.closest('a.js-play-episode,a.vod-playerUrl') : null;
    if (!a) return;
    setTimeout(enterPlayMode, 400);
    setTimeout(enterPlayMode, 1200);
    ensurePlayingFor(6);
  }, true);

  Object.defineProperty(window, 'csxyyTV', {
    configurable: true,
    value: Object.freeze({
      togglePlay: togglePlay,
      seek: seekBy,
      volume: volumeBy,
      nextEpisode: nextEpisode,
      showEpisodes: showEpisodes,
      toggleDanmaku: toggleDanmaku
    })
  });

  // 播放页：方向键快进/音量，确定键暂停；这些键不再传给 WebView 做焦点导航
  document.addEventListener('keydown', function (e) {
    if (!document.documentElement.classList.contains('tv-playing')) return;
    if (e.defaultPrevented) return;
    var t = e.target;
    if (t && t.matches && t.matches('input,textarea,select,[contenteditable="true"]')) return;
    var k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Enter' && k !== ' ') return;
    var dp = getPlayer();
    if (!dp) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'ArrowLeft') seekBy(-10);
    else if (k === 'ArrowRight') seekBy(10);
    else if (k === 'ArrowUp') volumeBy(0.1);
    else if (k === 'ArrowDown') volumeBy(-0.1);
    else togglePlay();
  }, true);

  // 有彩色键/搜索键的遥控器：红键或搜索键打开搜索，绿键开关弹幕
  document.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (e.code === 'F1' || e.code === 'F3') {
      e.preventDefault();
      e.stopPropagation();
      try { if (window.TVShell && TVShell.search) TVShell.search(); } catch (err) {}
      return;
    }
    if (e.code !== 'F2') return;
    e.preventDefault();
    e.stopPropagation();
    toggleDanmaku();
  }, true);

  // 首屏、懒加载和 Swiper 初始化后都清理一遍
  function boot() {
    tidyTop();
    scheduleNuke();
    setTimeout(tidyTop, 120);
    setTimeout(tidyTop, 700);
    setTimeout(tidyTop, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  addEventListener('load', function () { boot(); });

  if (window.MutationObserver) {
    try { new MutationObserver(scheduleNuke).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }

  if (PLAY) {
    setTimeout(function () { toast('方向键快进/音量 · 确定键暂停 · 返回键退出'); }, 1800);
    ensurePlayingFor(8);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(ensurePlaying, 400);
    });
  }
})();
