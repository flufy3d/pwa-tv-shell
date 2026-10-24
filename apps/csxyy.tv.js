// CN影视（csxyy.com）的电视适配：去广告、遥控器导航、本地播放记录、排行榜入口和播放页控制。
// 注入脚本在网页自己的脚本之前运行，也注入到同源的播放器 iframe 里。
//
// 电视端信息架构：
//   · 顶部导航：搜索（原生输入框）、排行榜、观看记录，一眼可达，不用翻系统菜单
//   · 首页“继续观看”：本地记录成排展示，确定键直接续播
//   · 播放页：暂停时出现大按钮操作条（播放/上一集/下一集/选集/弹幕/返回）
//   · 系统菜单只保留“继续 / 输入方式 / 刷新 / 退出”这些兜底动作
(function () {
  'use strict';

  var TOP = window.top === window;
  var SITE = 'csxyy.com';
  var PATH = TOP ? location.pathname : '';
  var PLAY = TOP && PATH.indexOf('/movie-play/') === 0;
  var DETAIL = TOP && /^\/movie\/\d+/.test(PATH);
  var RANK = TOP && (PATH.indexOf('/label/rank') === 0 || PATH.indexOf('/label/rb') === 0 || PATH === '/map' || PATH.indexOf('/map/') === 0);
  var HOME = TOP && (PATH === '/' || PATH === '/index.php' || PATH === '/index.html');
  var SEARCH = TOP && PATH.indexOf('/search') === 0;

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
  try { window.open = function () { return null; } } catch (e) {}

  var pendingNuke = false;
  function scheduleNuke() {
    if (pendingNuke) return;
    pendingNuke = true;
    setTimeout(function () { pendingNuke = false; nukeAds(); }, 120);
  }

  // ── 通用 DOM 小工具 ───────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
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
  function safeFocus(target) {
    if (!target || !target.focus) return;
    try { target.focus({ preventScroll: true }); }
    catch (e) { try { target.focus(); } catch (e2) {} }
  }

  var CSS = [
    // 基础主题色和字体
    ':root{--tv-accent:#ff5a3c;--tv-gold:#ffc857;--tv-bg:#0b0e14;--tv-panel:#121722;--tv-text:#eef2f8;--tv-muted:#8b95a8;--tv-line:rgba(255,255,255,.09)}',
    'html{background:#0b0e14}',

    // 广告和右侧悬浮工具栏
    'html body .top-back{display:none!important}',
    'html body .ec-ad,html body .ad-container,html body .ad-item,html body .ad-img{display:none!important}',

    // ── 顶部导航：固定、深色、搜索框、排行榜/观看记录 ──
    'html body .head{position:fixed!important;top:0!important;left:0!important;right:0!important;height:72px!important;padding:0 32px!important;background:#0a0d13!important;border-bottom:1px solid var(--tv-line)!important;box-shadow:0 8px 30px rgba(0,0,0,.38)!important;z-index:9998!important;display:flex!important;align-items:center!important;box-sizing:border-box!important}',
    'html body .head .left{display:flex!important;align-items:center!important;min-width:0!important;flex:1 1 auto!important;gap:10px!important}',
    'html body .head .logo-brand{margin:0!important;display:flex!important;align-items:center!important}',
    'html body .head .logo-brand img{height:38px!important;width:auto!important}',
    'html body .head .logo-brand .logo1{display:none!important}',
    'html body .head .head-nav{height:72px!important;display:flex!important;align-items:center!important;overflow:visible!important;width:auto!important;flex:1 1 auto!important}',
    'html body .head .head-nav .swiper-wrapper{display:flex!important;align-items:center!important;transform:none!important;width:auto!important;gap:2px!important}',
    'html body .head .head-nav .swiper-slide{display:block!important;width:auto!important;flex:0 0 auto!important}',
    'html body .head .head-nav li{height:72px!important;line-height:72px!important;margin:0!important;display:flex!important;align-items:center!important}',
    'html body .head .head-nav li.tv-nav-hidden{display:none!important}',
    'html body .head .head-nav a{display:inline-flex!important;align-items:center!important;gap:7px!important;height:42px!important;line-height:42px!important;padding:0 14px!important;border-radius:10px!important;font-size:15px!important;font-weight:600!important;color:rgba(255,255,255,.72)!important;transition:background .15s,color .15s!important;white-space:nowrap!important}',
    'html body .head .head-nav a:hover{background:rgba(255,255,255,.07)!important;color:#fff!important}',
    'html body .head .head-nav a.current{background:linear-gradient(135deg,rgba(255,90,60,.24),rgba(255,176,58,.12))!important;color:#fff!important;box-shadow:inset 0 0 0 1px rgba(255,120,70,.45)!important}',
    'html body .head .head-nav a em.fa{display:none!important}',
    'html body .head .head-more-a{display:none!important}',
    'html body .head .right{display:flex!important;align-items:center!important;gap:10px!important;margin-left:14px!important;flex:0 0 auto!important}',
    'html body .head .this-search,html body .head .gen-history,html body .head .head-user,html body .head .gen-left-list,html body .head .gen-search,html body .head #qiAnDao_bnt{display:none!important}',
    'html body .head .head-nav a:focus{outline-offset:-3px!important}',

    // 顶部搜索框：电视上没有键盘，点它直接打开原生搜索
    '.tv-search{display:flex!important;align-items:center!important;gap:10px!important;width:286px!important;height:44px!important;padding:0 13px!important;border-radius:12px!important;background:rgba(255,255,255,.06)!important;border:1px solid rgba(255,255,255,.11)!important;color:#aeb8ca!important;font-size:14px!important;line-height:1.2!important;cursor:pointer!important;box-sizing:border-box!important;flex:0 0 auto!important;transition:background .15s,border-color .15s!important}',
    '.tv-search:hover{background:rgba(255,255,255,.1)!important;color:#e7edf7!important}',
    '.tv-search:focus{outline:3px solid #fff!important;outline-offset:2px!important;border-color:rgba(255,120,70,.85)!important;background:rgba(255,255,255,.11)!important;color:#fff!important;box-shadow:0 0 0 6px rgba(255,90,60,.38)!important}',
    '.tv-search svg{flex:0 0 auto!important;opacity:.9!important}',
    '.tv-search-text{flex:1 1 auto!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}',
    '.tv-search-hint{flex:0 0 auto!important;font-size:11px!important;line-height:20px!important;padding:0 7px!important;border-radius:6px!important;background:rgba(255,255,255,.1)!important;color:#8f9aad!important}',
    '.tv-search:focus .tv-search-hint{background:rgba(255,90,60,.22)!important;color:#ffd3c7!important}',

    // 首页大图：只留当前海报，隐藏右侧文字和底部标题条；高度压到 320，给下面的内容留位置
    'html body .slide-a{height:320px!important}',
    'html body .slide-time-list,html body .slide-time-bj{height:100%!important;margin-top:0!important}',
    'html body .slide-nav-list,html body .slide-a .box-width,html body .slide-a .this-100,html body .slide-a .swiper-pagination{display:none!important}',
    'html body .slide-time-img3,html body .slide-time-img3 img.slide-img{height:100%!important}',

    // 焦点：白圈 + 品牌橙光晕，电视上一眼能看出焦点
    'html body a:focus,html body button:focus,html body [tabindex]:focus{outline:3px solid #fff!important;outline-offset:3px!important}',
    'html body .public-list-box:focus-within{outline:3px solid #fff!important;outline-offset:4px!important;border-radius:10px!important;box-shadow:0 0 0 7px rgba(255,90,60,.48),0 18px 40px rgba(0,0,0,.48)!important;z-index:3;position:relative;transform:translateY(-3px)!important}',
    'html body .anthology-list-play li:focus-within{outline:3px solid #fff!important;outline-offset:2px!important;background:rgba(255,90,60,.14)!important;border-radius:10px!important}',
    'html body .slide-time-bj:focus-within{outline:3px solid #fff!important;outline-offset:-4px!important}',
    'html body .public-play i{background:linear-gradient(135deg,#ff5a3c,#ff8a3c)!important;color:#fff!important;box-shadow:0 6px 20px rgba(0,0,0,.4)!important}',
    'html{scroll-padding-top:88px}',

    // 各页面里的小图标字体在部分盒子上显示成方块，电视频道导航和几个按钮直接去掉图标
    'html body .head-nav em.fa,html body .vod-rank-num i.fa,html body .vod-detail-bnt i.fa,html body .detail-get-box i.fa,html body .search-box .button i.fa,html body .player-switch,html body .title-a em.fa,html body .title-a i.fa,html body .title-m em.fa,html body .title-m i.fa,html body .vod-news i.fa,html body .anthology i.fa,html body .player-anthology i.fa,html body .vod-playerUrl i.fa{display:none!important}',

    // 详情页右侧的“扫码用手机看”对电视没用，整个评分侧栏隐藏，详情信息占满宽度
    'html body .vod-detail > .box-width > .right{display:none!important}',
    'html body .star-works .swiper-button-next,html body .star-works .swiper-button-prev{display:none!important}',
    // 搜索页：搜索框和类型标签对电视没意义，换成简洁的结果页头
    'html.tv-search-page body{padding-top:72px!important}',
    'html body .m-search{display:none!important}',
    'html body .tv-search-head{width:calc(100% - 120px)!important;max-width:2316px!important;margin:0 auto!important;padding:26px 0 8px!important;box-sizing:border-box!important}',
    'html body .tv-search-head h1{font-size:34px!important;line-height:1.15!important;font-weight:800!important;color:#fff!important;margin:8px 0 6px!important}',
    'html body .tv-search-head p{font-size:14px!important;color:var(--tv-muted)!important;margin:0!important}',
    'html body .search-box .thumb-s,html body .search-box .thumb-menu i.fa,html body .vod-hot-content .fa,html body .row .title-m i.fa{display:none!important}',

    // ── 首页“继续观看” ──
    '#csxyy-tv-continue{width:calc(100% - 120px);max-width:2316px;margin:26px auto 6px;position:relative;z-index:5}',
    '#csxyy-tv-continue .tv-shelf-head{display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:20px!important;margin:0 2px 14px!important}',
    '#csxyy-tv-continue .tv-shelf-title{display:flex!important;align-items:center!important;gap:12px!important;min-width:0!important}',
    '#csxyy-tv-continue .tv-shelf-h2{position:relative!important;padding-left:14px!important;font-size:24px!important;line-height:1.1!important;margin:0!important;font-weight:800!important;color:#fff!important;letter-spacing:.01em!important}',
    '#csxyy-tv-continue .tv-shelf-h2::before{content:""!important;position:absolute!important;left:0!important;top:4px!important;bottom:4px!important;width:4px!important;border-radius:2px!important;background:linear-gradient(180deg,#ff5a3c,#ffb03a)!important}',
    '#csxyy-tv-continue .tv-shelf-sub{font-size:13px!important;color:var(--tv-muted)!important;line-height:1.3!important}',
    '#csxyy-tv-continue .tv-shelf-all{font-size:14px!important;font-weight:700!important;color:#ffad9b!important;text-decoration:none!important;padding:6px 10px!important;border-radius:8px!important}',
    '#csxyy-tv-continue .tv-shelf-all:hover{background:rgba(255,90,60,.14)!important;color:#ffd3c7!important}',
    '#csxyy-tv-continue .tv-shelf-row{display:flex!important;gap:18px!important;overflow-x:auto!important;overflow-y:hidden!important;padding:10px 8px 16px!important;margin:-10px -8px 0!important;scroll-behavior:smooth!important;scrollbar-width:none!important}',
    '#csxyy-tv-continue .tv-shelf-row::-webkit-scrollbar{display:none!important}',
    '#csxyy-tv-continue .tv-card{flex:0 0 300px!important;width:300px!important;height:169px!important}',

    // 通用横向卡片（首页 + 观看记录）
    '.tv-card{position:relative!important;display:block!important;border-radius:14px!important;overflow:hidden!important;background:linear-gradient(135deg,#1b2433,#10151e)!important;color:#fff!important;text-decoration:none!important;box-shadow:0 8px 24px rgba(0,0,0,.34)!important;transition:transform .16s ease,box-shadow .16s ease!important;box-sizing:border-box!important;isolation:isolate!important}',
    '.tv-card img{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center 26%!important;display:block!important}',
    '.tv-card::after{content:""!important;position:absolute!important;inset:0!important;background:linear-gradient(180deg,rgba(0,0,0,.02) 22%,rgba(0,0,0,.32) 55%,rgba(0,0,0,.88) 100%)!important;pointer-events:none!important;z-index:1!important}',
    '.tv-card.tv-card-noposter{background:radial-gradient(120% 120% at 20% 0%,#2b3a52,#111722 60%)!important}',
    '.tv-card.tv-card-noposter::before{content:"CN影视"!important;position:absolute!important;left:16px!important;top:16px!important;font-size:12px!important;font-weight:800!important;letter-spacing:.16em!important;color:rgba(255,255,255,.42)!important;z-index:2!important}',
    '.tv-card-badge{position:absolute!important;left:12px!important;top:12px!important;z-index:3!important;max-width:62%!important;padding:4px 8px!important;border-radius:7px!important;background:rgba(0,0,0,.68)!important;border:1px solid rgba(255,255,255,.16)!important;font-size:12px!important;font-weight:700!important;line-height:1.25!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;color:#fff!important}',
    '.tv-card-play{position:absolute!important;right:12px!important;top:12px!important;z-index:3!important;width:32px!important;height:32px!important;border-radius:50%!important;background:rgba(255,90,60,.92)!important;box-shadow:0 4px 14px rgba(0,0,0,.35)!important}',
    '.tv-card-play::after{content:""!important;position:absolute!important;left:12px!important;top:9px!important;border-left:10px solid #fff!important;border-top:7px solid transparent!important;border-bottom:7px solid transparent!important}',
    '.tv-card-info{position:absolute!important;left:14px!important;right:14px!important;bottom:12px!important;z-index:2!important;min-width:0!important}',
    '.tv-card-title{display:block!important;font-size:17px!important;line-height:1.25!important;font-weight:800!important;color:#fff!important;text-shadow:0 2px 8px rgba(0,0,0,.65)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}',
    '.tv-card-meta{display:block!important;margin-top:5px!important;font-size:12px!important;line-height:1.3!important;color:rgba(255,255,255,.72)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;text-shadow:0 1px 6px rgba(0,0,0,.7)!important}',
    '.tv-card-bar{position:absolute!important;left:0!important;right:0!important;bottom:0!important;height:4px!important;background:rgba(255,255,255,.17)!important;z-index:3!important;display:block!important}',
    '.tv-card-bar i{display:block!important;height:100%!important;background:linear-gradient(90deg,#ff5a3c,#ffb03a)!important;border-radius:0 3px 3px 0!important}',
    '.tv-card:focus{outline:3px solid #fff!important;outline-offset:3px!important;transform:translateY(-4px) scale(1.02)!important;box-shadow:0 0 0 8px rgba(255,90,60,.5),0 20px 46px rgba(0,0,0,.6)!important}',

    // ── 观看记录全屏面板 ──
    'html.tv-overlay-open{overflow:hidden!important}',
    'html.tv-overlay-open body{overflow:hidden!important}',
    'html.tv-overlay-open body > *:not(.tv-hist){visibility:hidden!important}',
    '.tv-hist{display:none!important;position:fixed!important;inset:0!important;z-index:100000!important;box-sizing:border-box!important;padding:34px 56px 0!important;background:radial-gradient(1200px 640px at 16% -10%,#22314a 0%,#0b0e14 58%,#080a0f 100%)!important;color:var(--tv-text)!important;flex-direction:column!important;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif!important}',
    '.tv-hist.open{display:flex!important}',
    '.tv-hist-top{display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:28px!important;width:100%!important;max-width:1600px!important;margin:0 auto!important;padding-bottom:20px!important;border-bottom:1px solid var(--tv-line)!important}',
    '.tv-hist-title{min-width:0!important}',
    '.tv-eyebrow{display:block!important;font-size:11px!important;line-height:1.2!important;font-weight:800!important;letter-spacing:.18em!important;color:#ff8b72!important;text-transform:uppercase!important}',
    '.tv-hist h2{font-size:36px!important;line-height:1.15!important;margin:8px 0 7px!important;font-weight:800!important;color:#fff!important}',
    '.tv-hist-sub{font-size:13px!important;line-height:1.3!important;color:var(--tv-muted)!important;margin:0!important}',
    '.tv-hist-actions{display:flex!important;gap:10px!important;flex:0 0 auto!important}',
    '.tv-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:46px!important;padding:0 20px!important;border-radius:10px!important;border:0!important;background:rgba(255,255,255,.09)!important;color:#e9eef7!important;font-size:15px!important;font-weight:700!important;line-height:1!important;cursor:pointer!important;text-decoration:none!important;font-family:inherit!important;box-sizing:border-box!important}',
    '.tv-btn:hover{background:rgba(255,255,255,.15)!important}',
    '.tv-btn:focus{outline:3px solid #fff!important;outline-offset:3px!important;box-shadow:0 0 0 7px rgba(255,90,60,.45)!important;background:rgba(255,255,255,.18)!important}',
    '.tv-btn-primary{background:linear-gradient(135deg,#ff5a3c,#ff8a3c)!important;color:#190a06!important}',
    '.tv-btn-primary:hover{background:linear-gradient(135deg,#ff6b4f,#ffa04f)!important}',
    '.tv-btn-danger{background:rgba(255,90,60,.22)!important;color:#ffd0c6!important;box-shadow:inset 0 0 0 1px rgba(255,120,90,.5)!important}',
    '.tv-hist-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))!important;gap:18px!important;align-content:start!important;flex:1 1 auto!important;min-height:0!important;width:100%!important;max-width:1600px!important;margin:24px auto 0!important;padding:8px 6px 26px!important;overflow-y:auto!important;box-sizing:border-box!important;scroll-padding:20px!important}',
    '.tv-hist-grid .tv-card{width:100%!important;height:auto!important;aspect-ratio:16/9!important}',
    '.tv-hist.is-empty .tv-hist-grid{display:none!important}',
    '.tv-hist.is-empty .tv-hist-actions [data-act="clear"]{display:none!important}',
    '.tv-hist-empty{display:none!important;flex:1 1 auto!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;gap:12px!important;text-align:center!important;padding-bottom:60px!important}',
    '.tv-hist.is-empty .tv-hist-empty{display:flex!important}',
    '.tv-hist-empty .tv-empty-ico{width:74px!important;height:74px!important;border-radius:22px!important;background:rgba(255,255,255,.06)!important;border:1px solid rgba(255,255,255,.1)!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:34px!important;color:#ff8b72!important;margin-bottom:6px!important}',
    '.tv-hist-empty h3{font-size:24px!important;margin:0!important;color:#fff!important;font-weight:800!important}',
    '.tv-hist-empty p{font-size:14px!important;color:var(--tv-muted)!important;margin:0 0 10px!important;line-height:1.5!important}',
    '.tv-hist-foot{flex:0 0 auto!important;width:100%!important;max-width:1600px!important;margin:0 auto!important;padding:12px 6px 16px!important;border-top:1px solid rgba(255,255,255,.06)!important;font-size:12px!important;color:#6f7a8d!important;text-align:right!important}',

    // ── 播放页 ──
    'html.tv-playing,html.tv-playing body{overflow:hidden!important;background:#000!important;padding:0!important;margin:0!important}',
    'html.tv-playing .head,html.tv-playing .top-back,html.tv-playing .player-right,html.tv-playing #play1,html.tv-playing #play2,html.tv-playing .player-details-box,html.tv-playing .ad-container,html.tv-playing .ec-ad{display:none!important}',
    'html.tv-playing .player{width:100vw!important;height:100vh!important;margin:0!important;padding:0!important}',
    'html.tv-playing .player-left{width:100vw!important;height:100vh!important;margin:0!important;padding:0!important}',
    'html.tv-playing .player-left iframe,html.tv-playing .MacPlayer{width:100vw!important;height:100vh!important;background:#000!important}',
    '#ADplayer,#ADtip,.vod-gg{display:none!important}',

    // 播放页操作条：暂停时出现，方向键选择，确定执行
    '.tv-hud{display:none!important;position:fixed!important;left:0!important;right:0!important;bottom:0!important;z-index:99990!important;box-sizing:border-box!important;padding:70px 48px 28px!important;color:#fff!important;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.84) 36%,#000 100%)!important;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif!important}',
    '.tv-hud.open{display:block!important}',
    '.tv-hud-info{display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:24px!important;margin-bottom:12px!important}',
    '.tv-hud-left{min-width:0!important;display:flex!important;align-items:baseline!important;gap:12px!important}',
    '.tv-hud-title{font-size:21px!important;font-weight:800!important;line-height:1.2!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;color:#fff!important}',
    '.tv-hud-ep{font-size:13px!important;font-weight:700!important;color:#ffb59f!important;white-space:nowrap!important;flex:0 0 auto!important}',
    '.tv-hud-time{font-size:13px!important;color:#9aa4b6!important;white-space:nowrap!important;flex:0 0 auto!important;font-variant-numeric:tabular-nums!important}',
    '.tv-hud-bar{height:6px!important;border-radius:3px!important;background:rgba(255,255,255,.26)!important;overflow:hidden!important;margin-bottom:20px!important}',
    '.tv-hud-bar i{display:block!important;height:100%!important;width:0!important;background:linear-gradient(90deg,#ff5a3c,#ffb03a)!important;border-radius:0 3px 3px 0!important}',
    '.tv-hud-actions{display:flex!important;gap:12px!important;flex-wrap:wrap!important;align-items:center!important}',
    '.tv-hbtn{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:52px!important;padding:0 24px!important;border-radius:11px!important;border:0!important;background:rgba(255,255,255,.13)!important;color:#fff!important;font-size:16px!important;font-weight:700!important;line-height:1!important;cursor:pointer!important;font-family:inherit!important;box-sizing:border-box!important}',
    '.tv-hbtn:hover{background:rgba(255,255,255,.2)!important}',
    '.tv-hbtn:focus{outline:3px solid #fff!important;outline-offset:2px!important;box-shadow:0 0 0 7px rgba(255,90,60,.5)!important;background:rgba(255,255,255,.22)!important}',
    '.tv-hbtn.primary{background:linear-gradient(135deg,#ff5a3c,#ff8a3c)!important;color:#190a06!important}',
    '.tv-hbtn.primary:focus{background:linear-gradient(135deg,#ff6b4f,#ffa04f)!important}',
    '.tv-hbtn[disabled]{opacity:.3!important;pointer-events:none!important}',
    '.tv-hud-hint{margin-top:12px!important;text-align:right!important;font-size:12px!important;color:#6f7a8d!important}',

    // 详情页“继续观看”
    '.vod-detail-bnt{display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:wrap!important}',
    'html body .vod-detail-bnt .button{width:140px!important;height:50px!important;line-height:50px!important;border-radius:10px!important;font-size:15px!important;font-weight:800!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}',
    '.tv-resume-btn{display:inline-flex!important;align-items:center!important;gap:10px!important;height:50px!important;padding:0 18px!important;border-radius:10px!important;background:#fff!important;color:#111722!important;text-decoration:none!important;box-shadow:0 8px 24px rgba(0,0,0,.28)!important;box-sizing:border-box!important}',
    '.tv-resume-btn:focus{outline:3px solid #fff!important;outline-offset:3px!important;box-shadow:0 0 0 8px rgba(255,90,60,.5),0 14px 30px rgba(0,0,0,.4)!important}',
    '.tv-resume-play{width:26px!important;height:26px!important;border-radius:50%!important;background:linear-gradient(135deg,#ff5a3c,#ff8a3c)!important;position:relative!important;flex:0 0 auto!important}',
    '.tv-resume-play::after{content:""!important;position:absolute!important;left:10px!important;top:7px!important;border-left:8px solid #fff!important;border-top:6px solid transparent!important;border-bottom:6px solid transparent!important}',
    '.tv-resume-text{display:flex!important;flex-direction:column!important;line-height:1.15!important;gap:3px!important}',
    '.tv-resume-text strong{font-size:15px!important;font-weight:800!important;color:#101722!important}',
    '.tv-resume-text em{font-size:11px!important;font-style:normal!important;font-weight:600!important;color:#657089!important;white-space:nowrap!important}',

    // ── 排行榜页 ──
    'html.tv-rank body{padding-top:72px!important}',
    'html.tv-rank .public-top-bj-box{display:none!important}',
    'html body .tv-pagehead{width:100%!important;margin:0!important;padding:24px 0 10px!important;box-sizing:border-box!important}',
    'html body .tv-pagehead h1{font-size:38px!important;line-height:1.1!important;font-weight:800!important;color:#fff!important;margin:8px 0 8px!important}',
    'html body .tv-pagehead p{font-size:14px!important;color:var(--tv-muted)!important;margin:0!important;line-height:1.5!important}',
    'html body .public-tab{position:sticky!important;top:72px!important;z-index:60!important;display:flex!important;justify-content:flex-start!important;gap:10px!important;padding:14px 0 16px!important;margin:0 0 4px!important;background:#0b0e14!important}',
    'html body .public-tab a{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:46px!important;line-height:46px!important;padding:0 22px!important;border-radius:10px!important;border-bottom:0!important;font-size:17px!important;font-weight:700!important;color:#8b95a8!important;background:rgba(255,255,255,.05)!important;box-sizing:border-box!important}',
    'html body .public-tab a:after{display:none!important;content:none!important}',
    'html body .public-tab a:hover{background:rgba(255,255,255,.1)!important;color:#fff!important}',
    'html body .public-tab a.cor6,html body .public-tab a:focus{background:rgba(255,90,60,.16)!important;color:#fff!important;box-shadow:inset 0 0 0 1px rgba(255,120,70,.42)!important}',
    'html body .vod-rank{margin-top:18px!important}',
    'html body .vod-rank-box{width:33.333333%!important}',
    'html body .vod-rank-box-br{background:#121722!important;border:1px solid rgba(255,255,255,.07)!important;border-radius:16px!important;padding:20px!important;margin:0 10px 20px!important;box-sizing:border-box!important}',
    'html body .vod-rank .vod-sum-head{text-align:left!important;margin-bottom:6px!important;line-height:1.2!important}',
    'html body .vod-rank .head-en{left:0!important;top:10px!important;transform:none!important;text-align:left!important;font-size:30px!important}',
    'html body .vod-rank .head-txt{font-size:22px!important;font-weight:800!important;text-align:left!important;color:#fff!important;margin:0!important}',
    'html body .vod-rank .vod-rank-vod{padding:10px 10px!important;border-radius:10px!important;align-items:center!important}',
    'html body .vod-rank .vod-rank-vod:hover{background:rgba(255,255,255,.05)!important}',
    'html body .vod-rank .vod-rank-vod:focus{outline:3px solid #fff!important;outline-offset:-2px!important;background:rgba(255,90,60,.13)!important;box-shadow:inset 0 0 0 1px rgba(255,120,70,.45)!important}',
    'html body .vod-rank .lazy{width:76px!important;height:104px!important;margin-right:14px!important;border-radius:8px!important;object-fit:cover!important;flex:0 0 auto!important}',
    'html body .vod-rank .vod-rank-title{font-size:17px!important;font-weight:700!important;line-height:1.25!important;white-space:normal!important}',
    'html body .vod-rank .vod-rank-state{font-size:11px!important;line-height:18px!important;height:18px!important;padding:0 6px!important;border-radius:4px!important;background:rgba(255,255,255,.08)!important;color:#c3ccdc!important;margin-top:5px!important}',
    'html body .vod-rank .vod-rank-explain,html body .vod-rank .vod-rank-txt{display:none!important}',
    'html body .vod-rank .vod-rank-num{font-size:18px!important;line-height:1.2!important;color:#9aa4b6!important}',
    'html body .vod-rank .key{font-size:30px!important;width:42px!important;color:#6f7a8d!important;flex:0 0 auto!important;text-align:center!important}',
    'html body .vod-rank .key.co1{color:var(--tv-gold)!important}',
    'html body .vod-rank .key.co2{color:#c7d2e3!important}',
    'html body .vod-rank .key.co3{color:#d7956b!important}',

    // 搜索页：输入框不再抢焦点，结果区更宽松
    'html body .search-box .public-list-box{transition:transform .16s ease!important}',
    'html body .search-box .public-list-box:focus-within{transform:translateY(-3px)!important}',

    // 小屏（部分盒子 CSS 宽度只有 960）
    '@media (max-width:1200px){',
    'html body .head{padding:0 20px!important}',
    'html body .head .logo-brand img{height:32px!important}',
    'html body .head .head-nav a{padding:0 10px!important;font-size:14px!important}',
    '.tv-search{width:280px!important;height:42px!important;font-size:13px!important}',
    '#csxyy-tv-continue{width:calc(100% - 40px)!important}',
    'html body .tv-search-head{width:calc(100% - 40px)!important}',
    '#csxyy-tv-continue .tv-shelf-row{gap:14px!important}',
    '#csxyy-tv-continue .tv-card{flex:0 0 215px!important;width:215px!important;height:121px!important}',
    '.tv-hist-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))!important}',
    'html body .vod-rank-box{width:50%!important}',
    'html body .tv-hist{padding:26px 28px 0!important}',
    'html body .tv-hud{padding:54px 28px 22px!important}',
    '}',
    '@media (max-width:900px){',
    'html body .vod-rank-box{width:100%!important}',
    'html body .head .head-nav a{padding:0 8px!important;font-size:13px!important}',
    '.tv-search{width:190px!important}',
    '.tv-search-hint{display:none!important}',
    '}'
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
  if (RANK) {
    try { document.documentElement.classList.add('tv-rank'); } catch (e) {}
  }
  if (SEARCH) {
    try { document.documentElement.classList.add('tv-search-page'); } catch (e) {}
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

  // ══════════════════════════════════════════════════════════════════
  // 本地播放记录（localStorage，不登录也能用）
  // ══════════════════════════════════════════════════════════════════
  var HIST_KEY = 'csxyyTvHistory.v1';
  var HIST_MAX = 40;
  var histCache = null;

  function readHistory() {
    if (histCache) return histCache;
    var list = [];
    try {
      var raw = localStorage.getItem(HIST_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.length) list = parsed;
      }
    } catch (e) {}
    histCache = [];
    for (var i = 0; i < list.length && histCache.length < HIST_MAX; i++) {
      var x = list[i];
      if (!x || !x.id || !x.title || !x.href) continue;
      histCache.push(x);
    }
    return histCache;
  }

  function writeHistory(list) {
    histCache = list.slice(0, HIST_MAX);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(histCache)); } catch (e) {}
  }

  function findHistory(id) {
    var list = readHistory();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function upsertHistory(item) {
    var list = readHistory().slice();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(item.id)) { list.splice(i, 1); break; }
    }
    list.unshift(item);
    writeHistory(list);
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function timeAgo(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function playHref(id, sid, nid) {
    id = String(id || '').replace(/[^\d]/g, '');
    sid = parseInt(sid, 10) || 1;
    nid = parseInt(nid, 10) || 1;
    return '/movie-play/' + id + '-' + sid + '-' + nid;
  }

  function resumeHref(item) {
    if (!item) return '/';
    if (item.done) return item.detail || ('/movie/' + item.id);
    var href = item.href || playHref(item.id, item.sid, item.nid);
    if (!item.t || item.t < 5) return href;
    return href + (href.indexOf('?') >= 0 ? '&' : '?') + 'tvresume=' + Math.floor(item.t);
  }

  // 当前播放页的信息；按 path + sid + nid 缓存，换集后自动失效
  var playInfoCache = null;

  function findPoster() {
    var img = document.querySelector('.player-vod-no1 .left img');
    var src = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
    if (!src || src.indexOf('data:') === 0) {
      var alt = document.querySelector('.player-details-box .role-card .left img, .player-vod-no1 img');
      src = alt ? (alt.getAttribute('data-src') || alt.getAttribute('src') || '') : '';
    }
    if (!src || src.indexOf('data:') === 0) {
      var og = document.querySelector('meta[property="og:image"],meta[name="og:image"]');
      src = og ? (og.getAttribute('content') || '') : '';
    }
    if (!src) return '';
    try { return new URL(src, location.href).href; } catch (e) { return src; }
  }

  function findEpisodeName(sid, nid) {
    var scope = sid ? document.querySelector('.anthology-list-box[data-play-sid="' + sid + '"]') : null;
    var a = scope ? scope.querySelector('.js-play-episode[data-play-nid="' + nid + '"]') : null;
    if (!a) a = document.querySelector('.js-play-episode[data-play-nid="' + nid + '"]');
    if (a) {
      var name = a.getAttribute('data-play-name') || a.textContent || '';
      name = name.replace(/\s+/g, ' ').trim();
      if (name) return name;
    }
    return nid ? '第' + nid + '集' : '';
  }

  function currentPlayInfo() {
    var pa;
    try { pa = window.player_aaaa; } catch (e) {}
    if (!pa || !pa.id) return null;
    var key = location.pathname + '|' + (pa.sid || 0) + '|' + (pa.nid || 0);
    if (playInfoCache && playInfoCache.key === key) return playInfoCache.info;
    var vod = pa.vod_data || {};
    var title = vod.vod_name || '';
    if (!title) {
      var h1 = document.querySelector('h1, .player-vod-no1 .right a');
      title = h1 ? (h1.textContent || '').trim() : document.title.replace(/^《|》.*$/g, '');
    }
    var sid = parseInt(pa.sid, 10) || 1;
    var nid = parseInt(pa.nid, 10) || 1;
    var info = {
      id: String(pa.id),
      title: title,
      poster: findPoster(),
      sid: sid,
      nid: nid,
      ep: findEpisodeName(sid, nid),
      href: playHref(pa.id, sid, nid),
      detail: '/movie/' + pa.id
    };
    playInfoCache = { key: key, info: info };
    return info;
  }

  var lastHistSave = 0;

  function savePlayProgress(force) {
    if (!PLAY) return;
    var now = Date.now();
    if (!force && now - lastHistSave < 6000) return;
    var dp = getPlayer();
    var info = currentPlayInfo();
    if (!dp || !dp.video || !info) return;
    var v = dp.video;
    var t = v.currentTime || 0;
    var d = v.duration || 0;
    if (!isFinite(t) || t < 5) return;
    if (!isFinite(d)) d = 0;
    t = Math.floor(t);
    d = Math.floor(d);
    var done = d > 0 && (t >= d - 30 || t / d >= 0.95);
    var old = findHistory(info.id);
    if (!force && old && old.ep === info.ep && Math.abs((old.t || 0) - t) < 3 && !!old.done === done) return;
    lastHistSave = now;
    upsertHistory({
      id: info.id,
      title: info.title,
      poster: info.poster,
      href: info.href,
      detail: info.detail,
      sid: info.sid,
      nid: info.nid,
      ep: info.ep,
      t: t,
      d: d,
      done: done,
      at: now
    });
  }

  var resumeAt = 0;
  try {
    var rm = /[?&]tvresume=(\d+)/.exec(location.search);
    if (rm) resumeAt = parseInt(rm[1], 10) || 0;
  } catch (e) {}
  var resumeDone = false;

  function tryResume() {
    if (!resumeAt || resumeDone || !PLAY) return;
    var dp = getPlayer();
    if (!dp || !dp.video) return;
    var v = dp.video;
    if (!v.duration || !isFinite(v.duration) || v.duration <= 0) return;
    var to = Math.min(resumeAt, Math.max(0, v.duration - 5));
    try {
      if (dp.seek) dp.seek(to);
      else v.currentTime = to;
    } catch (e) {
      try { v.currentTime = to; } catch (e2) {}
    }
    resumeDone = true;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    toast('已续播 ' + fmt(to));
    applyDanmakuPref();
  }

  // ══════════════════════════════════════════════════════════════════
  // 顶部导航：搜索、排行榜、观看记录
  // ══════════════════════════════════════════════════════════════════
  function openSearch() {
    try {
      if (window.TVShell && TVShell.search) { TVShell.search(); return; }
    } catch (e) {}
    var input = document.querySelector('.this-search input[name=wd]');
    if (input) {
      try {
        input.readOnly = false;
        input.focus();
        setTimeout(function () { try { input.readOnly = true; } catch (e) {} }, 100);
      } catch (e) {}
    } else {
      toast('搜索');
    }
  }

  function searchIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    var c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '11'); c.setAttribute('cy', '11'); c.setAttribute('r', '7');
    var l = document.createElementNS(ns, 'path');
    l.setAttribute('d', 'M20 20l-3.6-3.6');
    svg.appendChild(c); svg.appendChild(l);
    return svg;
  }

  function installHeader() {
    var head = document.querySelector('.head');
    if (!head) return;
    var nav = head.querySelector('.head-nav .swiper-wrapper');
    if (nav) {
      // 资讯对电视观影价值不大，腾出位置给排行榜和记录
      var arts = nav.querySelectorAll('a[href="/art"],a[href^="/art?"]');
      for (var i = 0; i < arts.length; i++) {
        var artLi = arts[i].closest('li');
        if (artLi) {
          artLi.classList.add('tv-nav-hidden');
          try { artLi.style.setProperty('display', 'none', 'important'); } catch (e) {}
        }
      }
      var moreLi = nav.querySelector('.head-more-a');
      if (!nav.querySelector('[data-tv-nav="rank"]')) {
        var rankLi = el('li', 'swiper-slide');
        var rankA = el('a', '', '排行榜');
        rankA.href = '/label/rank';
        rankA.setAttribute('data-tv-nav', 'rank');
        rankLi.appendChild(rankA);
        if (moreLi && moreLi.parentNode === nav) nav.insertBefore(rankLi, moreLi);
        else nav.appendChild(rankLi);
      }
      if (!nav.querySelector('[data-tv-nav="history"]')) {
        var histLi = el('li', 'swiper-slide');
        var histA = el('a', '', '记录');
        histA.href = 'javascript:';
        histA.title = '观看记录';
        histA.setAttribute('data-tv-nav', 'history');
        histA.addEventListener('click', function (e) {
          e.preventDefault();
          openHistory();
        });
        histLi.appendChild(histA);
        if (moreLi && moreLi.parentNode === nav) nav.insertBefore(histLi, moreLi);
        else nav.appendChild(histLi);
      }
      var cur = nav.querySelector('[data-tv-nav="rank"]');
      if (cur) {
        if (RANK) cur.classList.add('current');
        else cur.classList.remove('current');
      }
    }

    var right = head.querySelector('.right');
    if (right && !right.querySelector('.tv-search')) {
      var box = el('div', 'tv-search');
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.setAttribute('aria-label', '搜索影片、演员');
      box.appendChild(searchIcon());
      box.appendChild(el('span', 'tv-search-text', '搜索影片 / 演员'));
      box.appendChild(el('span', 'tv-search-hint', '确定'));
      box.addEventListener('click', openSearch);
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          openSearch();
        }
      });
      right.insertBefore(box, right.firstChild);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 继续观看卡片和记录面板
  // ══════════════════════════════════════════════════════════════════
  function cardPercent(item) {
    if (item.done) return 100;
    var d = item.d || 0;
    if (!d) return 0;
    return Math.max(2, Math.min(100, Math.round((item.t || 0) / d * 100)));
  }

  function cardMeta(item) {
    if (item.done) return '已看完 · ' + timeAgo(item.at);
    var s = item.t ? '看到 ' + fmt(item.t) : '未开始';
    if (item.d && item.t) s += ' / ' + fmt(item.d);
    if (item.at) s += ' · ' + timeAgo(item.at);
    return s;
  }

  function makeCard(item) {
    var a = el('a', 'tv-card');
    a.href = resumeHref(item);
    a.title = item.title;
    a.setAttribute('data-tv-card', '1');
    if (!item.poster) a.classList.add('tv-card-noposter');
    if (item.poster) {
      var img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = item.poster;
      img.addEventListener('error', function () {
        a.classList.add('tv-card-noposter');
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      a.appendChild(img);
    }
    if (item.ep) a.appendChild(el('span', 'tv-card-badge', item.ep));
    a.appendChild(el('span', 'tv-card-play'));
    var info = el('div', 'tv-card-info');
    info.appendChild(el('strong', 'tv-card-title', item.title));
    info.appendChild(el('span', 'tv-card-meta', cardMeta(item)));
    a.appendChild(info);
    var bar = el('span', 'tv-card-bar');
    var fill = el('i');
    fill.style.width = cardPercent(item) + '%';
    bar.appendChild(fill);
    a.appendChild(bar);
    return a;
  }

  function installShelf() {
    if (!HOME) return;
    var shelf = document.getElementById('csxyy-tv-continue');
    var hist = readHistory();
    if (!hist.length) {
      if (shelf && shelf.parentNode) shelf.parentNode.removeChild(shelf);
      return;
    }
    if (!shelf) {
      shelf = el('section');
      shelf.id = 'csxyy-tv-continue';
      var hero = document.querySelector('.slide-a');
      if (hero && hero.parentNode) hero.parentNode.insertBefore(shelf, hero.nextSibling);
      else {
        var firstBox = document.querySelector('.box-width');
        if (firstBox && firstBox.parentNode) firstBox.parentNode.insertBefore(shelf, firstBox);
        else document.body.appendChild(shelf);
      }
    }
    shelf.textContent = '';
    var head = el('div', 'tv-shelf-head');
    var title = el('div', 'tv-shelf-title');
    title.appendChild(el('h2', 'tv-shelf-h2', '继续观看'));
    title.appendChild(el('span', 'tv-shelf-sub', '本地播放记录 · 按确定键直接续播'));
    var all = el('a', 'tv-shelf-all', '全部记录');
    all.href = 'javascript:';
    all.addEventListener('click', function (e) {
      e.preventDefault();
      openHistory();
    });
    head.appendChild(title);
    head.appendChild(all);
    shelf.appendChild(head);
    var row = el('div', 'tv-shelf-row');
    for (var i = 0; i < hist.length && i < 12; i++) row.appendChild(makeCard(hist[i]));
    shelf.appendChild(row);
  }

  var overlay = null;
  var overlayOpen = false;
  var overlayLastFocus = null;
  var clearArmed = false;
  var clearTimer = 0;

  function resetClear() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = 0; }
    clearArmed = false;
    if (overlay) {
      var b = overlay.querySelector('[data-act="clear"]');
      if (b) {
        b.textContent = '清空记录';
        b.classList.remove('tv-btn-danger');
        b.classList.add('tv-btn-ghost');
      }
    }
  }

  function buildOverlay() {
    if (overlay) return overlay;
    overlay = el('div', 'tv-hist');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '观看记录');

    var top = el('div', 'tv-hist-top');
    var title = el('div', 'tv-hist-title');
    title.appendChild(el('span', 'tv-eyebrow', '只保存在这台设备'));
    title.appendChild(el('h2', '', '观看记录'));
    var sub = el('p', 'tv-hist-sub', '');
    title.appendChild(sub);
    top.appendChild(title);

    var actions = el('div', 'tv-hist-actions');
    var clear = el('button', 'tv-btn tv-btn-ghost', '清空记录');
    clear.type = 'button';
    clear.setAttribute('data-act', 'clear');
    var close = el('button', 'tv-btn', '关闭');
    close.type = 'button';
    close.setAttribute('data-act', 'close');
    actions.appendChild(clear);
    actions.appendChild(close);
    top.appendChild(actions);
    overlay.appendChild(top);

    overlay.appendChild(el('div', 'tv-hist-grid'));

    var empty = el('div', 'tv-hist-empty');
    empty.appendChild(el('div', 'tv-empty-ico', '▶'));
    empty.appendChild(el('h3', '', '还没有播放记录'));
    empty.appendChild(el('p', '', '看过一集之后，这里会自动记住进度，下次接着看。'));
    var go = el('a', 'tv-btn tv-btn-primary', '去首页看看');
    go.href = '/';
    empty.appendChild(go);
    overlay.appendChild(empty);

    overlay.appendChild(el('div', 'tv-hist-foot', '确定键继续播放 · 返回键关闭'));

    close.addEventListener('click', closeHistory);
    clear.addEventListener('click', onClearHistory);
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderHistoryOverlay() {
    buildOverlay();
    var grid = overlay.querySelector('.tv-hist-grid');
    var sub = overlay.querySelector('.tv-hist-sub');
    grid.textContent = '';
    var hist = readHistory();
    overlay.classList.toggle('is-empty', !hist.length);
    if (sub) sub.textContent = hist.length ? ('共 ' + hist.length + ' 部 · 按确定键续播') : '本地播放记录 · 只保存在这台设备';
    for (var i = 0; i < hist.length; i++) grid.appendChild(makeCard(hist[i]));
    resetClear();
  }

  function openHistory() {
    buildOverlay();
    if (!overlayOpen) overlayLastFocus = document.activeElement;
    var dp = getPlayer();
    if (dp && dp.video && !dp.video.paused) {
      userPaused = true;
      try { dp.pause(); } catch (e) {}
    }
    renderHistoryOverlay();
    document.documentElement.classList.add('tv-overlay-open');
    overlay.classList.add('open');
    overlayOpen = true;
    hideHud();
    var grid = overlay.querySelector('.tv-hist-grid');
    if (grid) grid.scrollTop = 0;
    setTimeout(function () {
      var target = null;
      if (!overlay.classList.contains('is-empty')) target = overlay.querySelector('.tv-hist-grid .tv-card');
      if (!target) target = overlay.querySelector('[data-act="close"]');
      safeFocus(target);
    }, 60);
  }

  function closeHistory() {
    if (!overlayOpen || !overlay) return;
    overlayOpen = false;
    overlay.classList.remove('open');
    document.documentElement.classList.remove('tv-overlay-open');
    resetClear();
    if (overlayLastFocus && overlayLastFocus.isConnected) safeFocus(overlayLastFocus);
    overlayLastFocus = null;
  }

  function onClearHistory() {
    var b = overlay && overlay.querySelector('[data-act="clear"]');
    if (!clearArmed) {
      clearArmed = true;
      if (b) {
        b.textContent = '再按一次确认清空';
        b.classList.add('tv-btn-danger');
        b.classList.remove('tv-btn-ghost');
      }
      clearTimer = setTimeout(resetClear, 4000);
      return;
    }
    writeHistory([]);
    resetClear();
    renderHistoryOverlay();
    installShelf();
    toast('已清空播放记录');
    setTimeout(function () {
      if (overlayOpen && overlay) safeFocus(overlay.querySelector('[data-act="close"]'));
    }, 40);
  }

  // ── 详情页“继续观看” ──
  function installDetailResume() {
    if (!DETAIL) return;
    var m = /^\/movie\/(\d+)/.exec(PATH);
    if (!m) return;
    var item = findHistory(m[1]);
    if (!item) return;
    var bar = document.querySelector('.vod-detail-bnt');
    if (!bar || bar.querySelector('.tv-resume-btn')) return;
    var a = el('a', 'tv-resume-btn');
    a.href = item.done ? (item.href || playHref(item.id, item.sid, item.nid)) : resumeHref(item);
    a.title = item.title;
    a.appendChild(el('span', 'tv-resume-play'));
    var text = el('span', 'tv-resume-text');
    text.appendChild(el('strong', '', item.done ? '重新观看' : '继续观看'));
    var meta = item.done ? '已看完 · 可再刷一遍' : ((item.ep ? item.ep + ' · ' : '') + '看到 ' + fmt(item.t));
    text.appendChild(el('em', '', meta));
    a.appendChild(text);
    bar.insertBefore(a, bar.firstChild);
  }

  // ── 排行榜页头 ──
  function installRankHead() {
    if (!RANK || document.querySelector('.tv-pagehead')) return;
    var tab = document.querySelector('.public-tab');
    if (!tab || !tab.parentNode) return;
    var title = PATH === '/label/rb' ? '优质精选' : PATH === '/map' ? '最新更新' : '排行榜';
    var sub = PATH === '/label/rb'
      ? '编辑精选的高分片单，慢慢挑'
      : PATH === '/map'
        ? '刚刚上线的剧集和电影，追新不迷路'
        : '全站热度最高的电影、剧集、综艺和动漫';
    var head = el('div', 'tv-pagehead');
    head.appendChild(el('span', 'tv-eyebrow', 'TOP CHART'));
    head.appendChild(el('h1', '', title));
    head.appendChild(el('p', '', sub));
    tab.parentNode.insertBefore(head, tab);
  }

  // ── 搜索结果页头 ──
  function installSearchHead() {
    if (!SEARCH || document.querySelector('.tv-search-head')) return;
    var msearch = document.querySelector('.m-search');
    var anchor = msearch && msearch.parentNode ? msearch : null;
    var q = '';
    var input = document.querySelector('.m-search input[name=wd]') || document.querySelector('input[name=wd]');
    if (input && input.value) q = input.value.trim();
    if (!q) {
      var m = /[?&]wd=([^&]+)/.exec(location.search);
      if (m) {
        try { q = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { q = m[1]; }
      }
    }
    var head = el('div', 'tv-search-head');
    head.appendChild(el('span', 'tv-eyebrow', '搜索结果'));
    head.appendChild(el('h1', '', q ? '“' + q + '”' : '搜索'));
    head.appendChild(el('p', '', '方向键浏览 · 确定键查看详情 · 顶部搜索框可重新搜索'));
    if (anchor) anchor.parentNode.insertBefore(head, anchor.nextSibling);
    else {
      var box = document.querySelector('.box-width');
      if (box && box.parentNode) box.parentNode.insertBefore(head, box);
      else document.body.appendChild(head);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 页面整理
  // ══════════════════════════════════════════════════════════════════
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
    installHeader();
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

  function tidyTop() {
    nukeAds();
    hideAll('.top-back');
    tidyHeader();
    tidyHero();
    installShelf();
    installDetailResume();
    installRankHead();
    installSearchHead();
    tidyFocusTargets();
    tidySearchPage();
  }

  // 焦点进入视口中间附近，避免贴边或者被吸顶导航挡住；顶部导航和全屏面板自己管理滚动
  document.addEventListener('focusin', function (e) {
    var node = e.target;
    if (!node || node === document.body || node === document.documentElement) return;
    if (!node.getBoundingClientRect) return;
    if (node.closest && node.closest('.head,.tv-hist,.tv-hud')) return;
    var r = node.getBoundingClientRect();
    var top = 88;
    var bottom = window.innerHeight - 16;
    if (r.top < top || r.bottom > bottom || r.left < 20 || r.right > window.innerWidth - 20) {
      try { node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); }
      catch (err) { try { node.scrollIntoView(); } catch (e2) {} }
    }
  }, true);

  // ══════════════════════════════════════════════════════════════════
  // 播放器控制
  // ══════════════════════════════════════════════════════════════════
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

  function goEpisode(direction) {
    var pa;
    try { pa = window.player_aaaa; } catch (e) {}
    var next = pa ? (direction > 0 ? pa.link_next : pa.link_pre) : '';
    if (!next) {
      var sel = direction > 0 ? 'a[title="下集"]' : 'a[title="上集"]';
      var a = document.querySelector(sel);
      next = a && a.getAttribute('href');
    }
    if (!next) { toast(direction > 0 ? '没有下一集' : '没有上一集'); return; }
    hideHud();
    try { location.href = new URL(next, location.href).href; } catch (e) { location.href = next; }
  }

  function nextEpisode() { goEpisode(1); }
  function prevEpisode() { goEpisode(-1); }

  function backOut() {
    try {
      if (window.TVShell && TVShell.back) { TVShell.back(); return; }
    } catch (e) {}
    try { history.back(); } catch (e) {}
  }

  function showEpisodes() {
    var target = document.getElementById('play2') || document.querySelector('.player-right');
    if (!target) { toast('当前页面没有选集'); return; }
    hideHud();
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
        safeFocus(cur);
        try { cur.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      }
      focusEpisode();
      // 菜单关闭时套壳会 requestFocus，可能把焦点还给页面第一个链接；多补几次
      setTimeout(focusEpisode, 650);
      setTimeout(focusEpisode, 1400);
    }, 450);
    toast('已暂停 · 方向键选择集数');
  }

  // ── 播放页底部操作条 ──
  var hud = null;
  var hudOpen = false;
  var hudVideo = null;

  function hudButton(act, label, primary) {
    var b = el('button', 'tv-hbtn' + (primary ? ' primary' : ''), label);
    b.type = 'button';
    b.setAttribute('data-act', act);
    return b;
  }

  function buildHud() {
    if (hud) return hud;
    hud = el('div', 'tv-hud');
    hud.id = 'csxyy-tv-hud';
    var info = el('div', 'tv-hud-info');
    var left = el('div', 'tv-hud-left');
    var title = el('strong', 'tv-hud-title', '');
    var ep = el('span', 'tv-hud-ep', '');
    left.appendChild(title);
    left.appendChild(ep);
    var time = el('div', 'tv-hud-time');
    var cur = el('span', 'tv-hud-cur', '0:00');
    var dur = el('span', 'tv-hud-dur', '0:00');
    time.appendChild(cur);
    time.appendChild(document.createTextNode(' / '));
    time.appendChild(dur);
    info.appendChild(left);
    info.appendChild(time);
    hud.appendChild(info);

    var bar = el('div', 'tv-hud-bar');
    var fill = el('i');
    bar.appendChild(fill);
    hud.appendChild(bar);

    var actions = el('div', 'tv-hud-actions');
    actions.appendChild(hudButton('toggle', '暂停', true));
    actions.appendChild(hudButton('prev', '上一集'));
    actions.appendChild(hudButton('next', '下一集'));
    actions.appendChild(hudButton('episodes', '选集'));
    actions.appendChild(hudButton('danmaku', '关闭弹幕'));
    actions.appendChild(hudButton('back', '返回'));
    hud.appendChild(actions);
    hud.appendChild(el('div', 'tv-hud-hint', '方向键选择 · 确定键执行 · 返回键关闭'));

    hud.__title = title;
    hud.__ep = ep;
    hud.__cur = cur;
    hud.__dur = dur;
    hud.__fill = fill;

    hud.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b || b.disabled) return;
      hudAction(b.getAttribute('data-act'));
    });
    hud.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        moveHudFocus(k === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'Escape') {
        // 让按钮自己处理确定键；阻止事件冒泡到网页播放器，避免一次按键触发两次
        e.stopPropagation();
        if (k === 'Escape') {
          e.preventDefault();
          hideHud();
        }
      }
    }, true);

    document.body.appendChild(hud);
    return hud;
  }

  function hudButtons() {
    if (!hud) return [];
    var all = hud.querySelectorAll('button[data-act]');
    var out = [];
    for (var i = 0; i < all.length; i++) if (!all[i].disabled) out.push(all[i]);
    return out;
  }

  function moveHudFocus(dir) {
    var list = hudButtons();
    if (!list.length) return;
    var current = document.activeElement;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i] === current) { idx = i; break; }
    if (idx < 0) idx = 0;
    var next = (idx + dir + list.length) % list.length;
    safeFocus(list[next]);
  }

  function refreshHud() {
    if (!hud) return;
    var info = currentPlayInfo();
    hud.__title.textContent = info ? info.title : (document.title || '正在播放');
    hud.__ep.textContent = info ? info.ep : '';
    var pa;
    try { pa = window.player_aaaa; } catch (e) {}
    var prev = hud.querySelector('[data-act="prev"]');
    var next = hud.querySelector('[data-act="next"]');
    if (prev) prev.disabled = !(pa && pa.link_pre);
    if (next) next.disabled = !(pa && pa.link_next);
    var dp = getPlayer();
    var paused = !dp || !dp.video || dp.video.paused;
    var toggle = hud.querySelector('[data-act="toggle"]');
    if (toggle) toggle.textContent = paused ? '播放' : '暂停';
    var dm = hud.querySelector('[data-act="danmaku"]');
    if (dm) dm.textContent = dmOff ? '开启弹幕' : '关闭弹幕';
  }

  function updateHudProgress() {
    if (!hud || !hudOpen) return;
    var dp = getPlayer();
    if (!dp || !dp.video) return;
    var v = dp.video;
    var t = v.currentTime || 0;
    var d = v.duration || 0;
    hud.__cur.textContent = fmt(t);
    hud.__dur.textContent = fmt(d);
    hud.__fill.style.width = d > 0 ? Math.min(100, (t / d) * 100) + '%' : '0%';
  }

  function showHud(focusAct) {
    if (!PLAY) return;
    var h = buildHud();
    refreshHud();
    hudOpen = true;
    h.classList.add('open');
    updateHudProgress();
    setTimeout(function () {
      var target = focusAct ? h.querySelector('button[data-act="' + focusAct + '"]') : null;
      if (!target || target.disabled) target = h.querySelector('button[data-act="toggle"]');
      safeFocus(target);
    }, 40);
  }

  function hideHud() {
    if (!hud) return;
    hudOpen = false;
    hud.classList.remove('open');
  }

  function hudAction(act) {
    var dp = getPlayer();
    if (act === 'toggle') {
      if (!dp) { toast('播放器还没准备好'); return; }
      try {
        if (dp.video.paused) {
          userPaused = false;
          dp.play();
          hideHud();
          toast('继续播放');
        } else {
          userPaused = true;
          dp.pause();
          refreshHud();
        }
      } catch (e) { toast('播放器还没准备好'); }
      return;
    }
    if (act === 'prev') { prevEpisode(); return; }
    if (act === 'next') { nextEpisode(); return; }
    if (act === 'episodes') { showEpisodes(); return; }
    if (act === 'danmaku') { toggleDanmaku(); refreshHud(); return; }
    if (act === 'back') { hideHud(); backOut(); return; }
  }

  // 暂停时按确定：打开操作条；操作条里的按钮再按确定执行
  function pauseForHud() {
    var dp = getPlayer();
    if (!dp) { toast('当前页面没有播放器'); return; }
    try {
      if (!dp.video.paused) {
        userPaused = true;
        dp.pause();
        try { if (dp.controller && dp.controller.hide) dp.controller.hide(); } catch (e) {}
      }
      showHud('toggle');
    } catch (e) { toast('播放器还没准备好'); }
  }

  function attachPlayVideo() {
    if (!PLAY) return;
    var dp = getPlayer();
    if (!dp || !dp.video) return;
    var v = dp.video;
    if (v === hudVideo) return;
    hudVideo = v;
    v.addEventListener('timeupdate', function () {
      if (hudOpen) updateHudProgress();
    });
    v.addEventListener('ended', function () {
      savePlayProgress(true);
      if (!document.hidden) showHud('next');
    });
    v.addEventListener('play', function () {
      if (hudOpen && !userPaused) hideHud();
    });
  }

  function enterPlayMode() {
    try { document.documentElement.classList.add('tv-playing'); } catch (e) {}
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    userPaused = false;
    hideHud();
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  // 播放页的选集/线路切换可能是 AJAX 原地换源（URL 变了但页面没重载），换完自动回到全屏
  document.addEventListener('click', function (e) {
    if (!PLAY) return;
    var a = e.target && e.target.closest ? e.target.closest('a.js-play-episode,a.vod-playerUrl') : null;
    if (!a) return;
    hideHud();
    setTimeout(enterPlayMode, 400);
    setTimeout(enterPlayMode, 1200);
    ensurePlayingFor(6);
  }, true);

  // 返回键：先关面板/操作条，再交给套壳处理
  window.addEventListener('tvshell:back', function (e) {
    if (overlayOpen) {
      e.preventDefault();
      closeHistory();
      return;
    }
    if (hudOpen) {
      e.preventDefault();
      hideHud();
    }
  });

  // 兼容少数把返回键发成 Escape 的遥控器
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (overlayOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeHistory();
      return;
    }
    if (hudOpen) {
      e.preventDefault();
      e.stopPropagation();
      hideHud();
    }
  }, true);

  Object.defineProperty(window, 'csxyyTV', {
    configurable: true,
    value: Object.freeze({
      togglePlay: togglePlay,
      seek: seekBy,
      volume: volumeBy,
      nextEpisode: nextEpisode,
      prevEpisode: prevEpisode,
      showEpisodes: showEpisodes,
      toggleDanmaku: toggleDanmaku,
      openHistory: openHistory,
      closeHistory: closeHistory,
      openHud: showHud,
      closeHud: hideHud,
      history: readHistory
    })
  });

  // 播放页：方向键快进/音量，确定键暂停并打开操作条；操作条打开时让按钮自己处理按键
  document.addEventListener('keydown', function (e) {
    if (!document.documentElement.classList.contains('tv-playing')) return;
    if (hudOpen && hud && hud.contains(document.activeElement)) return;
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
    else pauseForHud();
  }, true);

  // 有彩色键/搜索键的遥控器：红键或搜索键打开搜索，绿键开关弹幕
  document.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (e.code === 'F1' || e.code === 'F3') {
      e.preventDefault();
      e.stopPropagation();
      openSearch();
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
    if (PLAY) {
      buildHud();
      attachPlayVideo();
      tryResume();
    }
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

  // 广告脚本有时会把节点重新插回来，前 20 秒每 3 秒再清一次
  var nukeTimes = 0;
  var nukeTimer = setInterval(function () {
    nukeAds();
    if (++nukeTimes >= 7) clearInterval(nukeTimer);
  }, 3000);

  if (PLAY) {
    setTimeout(function () { toast('确定键暂停/播放选项 · 左右快进 · 上下音量'); }, 1800);
    ensurePlayingFor(8);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        savePlayProgress(true);
      } else {
        setTimeout(ensurePlaying, 400);
        setTimeout(tryResume, 500);
      }
    });
    addEventListener('pagehide', function () { savePlayProgress(true); });

    // 播放进度每 4 秒记录一次；换源/换集后重新绑定播放器事件
    setInterval(function () {
      attachPlayVideo();
      savePlayProgress(false);
      tryResume();
    }, 4000);

    // 自动播放被浏览器拦下时，把操作条亮出来，按确定就能开始
    setTimeout(function () {
      if (document.hidden || overlayOpen || hudOpen) return;
      var dp = getPlayer();
      if (dp && dp.video && dp.video.paused && !userPaused) showHud('toggle');
    }, 4500);
  }
})();
