/* 头条图片去水印 — 应用逻辑
 * 流程：多选图片 → 自动逐张处理 → 一键保存（批量 / 逐张引导兜底）
 * 保存策略（逐张下载）：
 *   - 批量：同一次手势内按 400ms 间隔依次触发下载；Chrome 系内核弹一次
 *     「允许下载多个文件」授权即全部保存
 *   - 逐张引导：每次点击只触发 1 个下载（独立用户手势，任何浏览器不拦）
 *   - blob URL 延迟 10s 再 revoke，避免部分浏览器取消进行中的下载
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    nav: $('nav'), navTitle: $('navTitle'), installBtn: $('installBtn'),
    emptyState: $('emptyState'), pickBtn: $('pickBtn'),
    gallery: $('gallery'), grid: $('grid'), statsPill: $('statsPill'), addMoreBtn: $('addMoreBtn'),
    bottomBar: $('bottomBar'), saveAllBtn: $('saveAllBtn'), saveEachBtn: $('saveEachBtn'), clearBtn: $('clearBtn'),
    fileInput: $('fileInput'),
    scrim: $('scrim'), sheet: $('sheet'), sheetImg: $('sheetImg'), sheetName: $('sheetName'),
    sheetBadge: $('sheetBadge'), sheetDims: $('sheetDims'), sheetReason: $('sheetReason'),
    sheetClose: $('sheetClose'), sheetGrabber: $('sheetGrabber'), sheetHead: $('sheetHead'),
    guided: $('guided'), guidedNext: $('guidedNext'), guidedSub: $('guidedSub'), guidedCancel: $('guidedCancel'),
    hud: $('hud'), hudText: $('hudText'), envWarn: $('envWarn'),
  };

  var SVG_DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v9.5m0 0l-3.8-3.8M12 14l3.8-3.8M5 18.5h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v10m0-10L8.5 7M12 3.5L15.5 7M8 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var state = {
    items: [],
    seq: 0,
    processing: false,
    saveBusy: false,
    guided: null,
  };

  var shareSupported = (function () {
    try {
      var f = new File(['x'], 'a.png', { type: 'image/png' });
      return !!(navigator.canShare && navigator.canShare({ files: [f] }));
    } catch (e) { return false; }
  })();

  /* ---------------- 选图与队列 ---------------- */

  function addFiles(fileList) {
    var files = Array.prototype.filter.call(fileList || [], function (f) {
      return f && (String(f.type).indexOf('image/') === 0 ||
        /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|jfif)$/i.test(f.name || ''));
    });
    if (!files.length) return;
    var base = state.items.length;
    files.forEach(function (f) {
      state.items.push({
        id: ++state.seq, file: f,
        name: f.name || ('图片' + state.seq),
        status: 'pending', result: null, reason: '',
        origUrl: '', viewUrl: '',
        badgeEl: null, overlayEl: null, dlBtn: null, shareBtn: null, thumbImg: null,
      });
    });
    for (var i = base; i < state.items.length; i++) {
      els.grid.appendChild(buildCard(state.items[i], i - base));
    }
    updateChrome();
    runQueue();
  }

  function buildCard(item, idx) {
    var card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = Math.min(idx * 45, 420) + 'ms';
    card.innerHTML =
      '<div class="thumb"><img alt="" draggable="false">' +
      '<div class="processing-overlay" hidden><div class="spinner"></div></div></div>' +
      '<div class="card-body"><div class="card-name"></div>' +
      '<div class="card-row"><span class="badge">等待处理</span><span class="spacer"></span>' +
      '<button type="button" class="icon-btn dl" aria-label="下载这张">' + SVG_DL + '</button>' +
      (shareSupported ? '<button type="button" class="icon-btn share" aria-label="分享这张">' + SVG_SHARE + '</button>' : '') +
      '</div></div>';

    item.thumbImg = card.querySelector('img');
    item.thumbImg.src = getOrigUrl(item);
    card.querySelector('.card-name').textContent = item.name;
    item.badgeEl = card.querySelector('.badge');
    item.overlayEl = card.querySelector('.processing-overlay');
    item.dlBtn = card.querySelector('.dl');
    item.shareBtn = card.querySelector('.share');
    item.dlBtn.disabled = true;
    if (item.shareBtn) item.shareBtn.disabled = true;

    card.addEventListener('click', function () { openSheet(item); });
    item.dlBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (item.status === 'done') { downloadBlob(item.result.blob, allocateNames([item])[0]); buzz(8); }
    });
    if (item.shareBtn) item.shareBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (item.status === 'done') shareItem(item);
    });
    return card;
  }

  function getOrigUrl(item) {
    if (!item.origUrl) item.origUrl = URL.createObjectURL(item.file);
    return item.origUrl;
  }

  async function runQueue() {
    if (state.processing) return;
    state.processing = true;
    try {
      for (var i = 0; i < state.items.length; i++) {
        var item = state.items[i];
        if (item.status !== 'pending') continue;
        setItemStatus(item, 'processing');
        var res;
        try { res = await Strip.stripWatermark(item.file); }
        catch (err) { res = { status: 'fail', reason: Strip.SKIP.encode }; }
        if (res.status === 'done') {
          item.result = res;
          item.viewUrl = URL.createObjectURL(res.blob);
          setItemStatus(item, 'done');
        } else {
          item.reason = res.reason || '';
          item.skipDims = res.width ? { w: res.width, h: res.height } : null;
          setItemStatus(item, res.status === 'fail' ? 'fail' : 'skip');
        }
        updateChrome();
        await new Promise(function (r) { requestAnimationFrame(r); });
      }
    } finally {
      state.processing = false;
      updateChrome();
    }
  }

  function setItemStatus(item, status) {
    item.status = status;
    var b = item.badgeEl;
    item.overlayEl.hidden = status !== 'processing';
    b.className = 'badge' + (status === 'done' ? ' done' : status === 'skip' ? ' skip' :
      status === 'fail' ? ' fail' : status === 'processing' ? ' processing' : '');
    if (status === 'done') {
      b.textContent = '已裁 −' + item.result.cropH + 'px';
      item.thumbImg.src = item.viewUrl;
      item.dlBtn.disabled = false;
      if (item.shareBtn) item.shareBtn.disabled = false;
    } else if (status === 'skip') { b.textContent = '已跳过'; }
    else if (status === 'fail') { b.textContent = '失败'; }
    else if (status === 'processing') { b.textContent = '处理中…'; }
    else { b.textContent = '等待处理'; }
  }

  /* ---------------- 界面状态 ---------------- */

  function updateChrome() {
    var n = state.items.length, done = 0, skip = 0, fail = 0, busy = 0;
    state.items.forEach(function (it) {
      if (it.status === 'done') done++;
      else if (it.status === 'skip') skip++;
      else if (it.status === 'fail') fail++;
      else if (it.status === 'processing') busy++;
    });

    els.emptyState.hidden = n > 0;
    els.gallery.hidden = n === 0;
    els.bottomBar.hidden = n === 0;
    els.saveAllBtn.disabled = !done || state.saveBusy;
    els.saveEachBtn.disabled = !done || state.saveBusy;
    els.clearBtn.disabled = state.saveBusy;
    if (!state.saveBusy) els.saveAllBtn.textContent = done ? '保存全部 (' + done + ')' : '保存全部';

    var parts = ['共 <b>' + n + '</b>'];
    if (busy) parts.push('处理中 ' + busy);
    if (done) parts.push('<span class="ok">成功 ' + done + '</span>');
    if (skip) parts.push('<span class="skip">跳过 ' + skip + '</span>');
    if (fail) parts.push('<span class="bad">失败 ' + fail + '</span>');
    els.statsPill.innerHTML = parts.join(' · ');
  }

  /* ---------------- 保存 ---------------- */

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 延迟 revoke：部分浏览器会取消还未开始写盘的下载
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  async function saveAll() {
    var done = state.items.filter(function (i) { return i.status === 'done'; });
    if (!done.length || state.saveBusy) return;
    state.saveBusy = true;
    updateChrome();
    var names = allocateNames(done);
    try {
      for (var k = 0; k < done.length; k++) {
        downloadBlob(done[k].result.blob, names[k]);
        els.saveAllBtn.textContent = '正在保存 ' + (k + 1) + '/' + done.length;
        if (k < done.length - 1) await sleep(400);
      }
      showHud('已保存 ' + done.length + ' 张');
      buzz(15);
    } finally {
      state.saveBusy = false;
      updateChrome();
    }
  }

  function startGuided() {
    var done = state.items.filter(function (i) { return i.status === 'done'; });
    if (!done.length) return;
    state.guided = { list: done, names: allocateNames(done), index: 0 };
    els.guided.hidden = false;
    updateGuided();
  }

  function updateGuided() {
    var g = state.guided;
    els.guidedNext.textContent = '保存 ' + (g.index + 1) + '/' + g.list.length;
    els.guidedSub.textContent = '第 ' + (g.index + 1) + ' 张：' + g.list[g.index].name;
  }

  function endGuided() {
    state.guided = null;
    els.guided.hidden = true;
  }

  async function shareItem(item) {
    try {
      var blob = item.result.blob;
      var file = blob instanceof File ? blob : new File([blob], allocateNames([item])[0], { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: file.name });
      }
    } catch (e) { /* 用户取消分享 */ }
  }

  function allocateNames(items) {
    var used = new Map();
    return items.map(function (it) {
      var ext = Strip.EXT_BY_MIME[it.result.mime] || 'jpg';
      var name = ensureExt(it.name || 'image', ext);
      var c = used.get(name) || 0;
      used.set(name, c + 1);
      if (c > 0) name = insertBeforeExt(name, ' (' + c + ')');
      return name;
    });
  }

  function ensureExt(name, ext) {
    var m = /\.([a-z0-9]+)$/i.exec(name);
    if (!m) return name + '.' + ext;
    var cur = m[1].toLowerCase();
    if (cur === ext || (ext === 'jpg' && (cur === 'jpeg' || cur === 'jpe'))) return name;
    return name.slice(0, name.length - m[0].length) + '.' + ext;
  }

  function insertBeforeExt(name, s) {
    var m = /\.([a-z0-9]+)$/i.exec(name);
    if (!m) return name + s;
    return name.slice(0, name.length - m[0].length) + s + m[0];
  }

  /* ---------------- 预览面板（可下拉关闭） ---------------- */

  var sheetItem = null;

  function openSheet(item) {
    sheetItem = item;
    els.sheetImg.src = item.viewUrl || getOrigUrl(item);
    els.sheetName.textContent = item.name;
    var b = els.sheetBadge;
    b.className = 'badge';
    var dims = els.sheetDims, reason = els.sheetReason;
    reason.hidden = true; reason.textContent = '';
    dims.textContent = '';

    if (item.status === 'done') {
      b.className = 'badge done';
      b.textContent = '已裁 −' + item.result.cropH + 'px';
      dims.textContent = item.result.width + '×' + item.result.height +
        '（原图 ' + item.result.width + '×' + (item.result.height + item.result.cropH) + '）';
    } else if (item.status === 'skip' || item.status === 'fail') {
      b.className = 'badge ' + (item.status === 'skip' ? 'skip' : 'fail');
      b.textContent = item.status === 'skip' ? '已跳过' : '失败';
      if (item.skipDims) dims.textContent = item.skipDims.w + '×' + item.skipDims.h + '（未修改）';
      if (item.reason) { reason.textContent = item.reason; reason.hidden = false; }
    } else {
      b.textContent = item.status === 'processing' ? '处理中…' : '等待处理';
    }

    els.sheet.hidden = false;
    els.scrim.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        els.sheet.classList.add('animating');
        els.sheet.classList.add('open');
        els.scrim.classList.add('open');
      });
    });
  }

  function closeSheet() {
    if (els.sheet.hidden) return;
    els.sheet.classList.add('animating');
    els.sheet.classList.remove('open');
    els.scrim.classList.remove('open');
    setTimeout(function () {
      els.sheet.hidden = true;
      els.scrim.hidden = true;
      els.sheet.style.transform = '';
    }, 440);
  }

  // 下拉 1:1 跟手 + 顶部橡皮筋 + 松手按速度判定（velocity handoff）
  (function () {
    var dragging = false, startY = 0, curY = 0, samples = [];

    function onDown(e) {
      if (els.sheet.hidden) return;
      dragging = true;
      startY = curY = e.clientY;
      samples = [{ t: e.timeStamp, y: e.clientY }];
      els.sheet.setPointerCapture(e.pointerId);
      els.sheet.classList.remove('animating');
    }
    function onMove(e) {
      if (!dragging) return;
      curY = e.clientY;
      samples.push({ t: e.timeStamp, y: e.clientY });
      if (samples.length > 5) samples.shift();
      var dy = curY - startY;
      if (dy < 0) dy = dy / (1 + Math.abs(dy) / 140); // 向上拖有阻尼
      els.sheet.style.transform = 'translateY(' + Math.max(dy, -90) + 'px)';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      var dy = curY - startY;
      var v = 0;
      if (samples.length >= 2) {
        var a = samples[0], b = samples[samples.length - 1];
        if (b.t > a.t) v = (b.y - a.y) / (b.t - a.t) * 1000;
      }
      els.sheet.classList.add('animating');
      var h = els.sheet.offsetHeight;
      if (dy > 0 && (dy > h * 0.25 || v > 650)) {
        els.sheet.style.transform = '';
        closeSheet();
      } else {
        els.sheet.style.transform = ''; // 弹回
      }
    }

    els.sheetGrabber.addEventListener('pointerdown', onDown);
    els.sheetHead.addEventListener('pointerdown', onDown);
    els.sheet.addEventListener('pointermove', onMove);
    els.sheet.addEventListener('pointerup', onUp);
    els.sheet.addEventListener('pointercancel', onUp);
  })();

  /* ---------------- HUD / 触感 ---------------- */

  var hudTimer = null;
  function showHud(text) {
    els.hudText.textContent = text;
    els.hud.hidden = false;
    requestAnimationFrame(function () { els.hud.classList.add('show'); });
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () {
      els.hud.classList.remove('show');
      setTimeout(function () { els.hud.hidden = true; }, 260);
    }, 1400);
  }

  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 不支持则忽略 */ }
  }

  /* ---------------- 清空 ---------------- */

  function clearAll() {
    var hasDone = state.items.some(function (i) { return i.status === 'done'; });
    if (hasDone && !window.confirm('已处理的结果尚未保存，确认清空？')) return;
    state.items.forEach(function (it) {
      if (it.origUrl) URL.revokeObjectURL(it.origUrl);
      if (it.viewUrl) URL.revokeObjectURL(it.viewUrl);
    });
    state.items = [];
    els.grid.innerHTML = '';
    updateChrome();
  }

  /* ---------------- 安装到桌面 ---------------- */

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener('click', async function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) { /* 忽略 */ }
    deferredPrompt = null;
    els.installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', function () { els.installBtn.hidden = true; });

  /* ---------------- 其它 ---------------- */

  window.addEventListener('scroll', function () {
    els.nav.classList.toggle('scrolled', window.scrollY > 28);
  }, { passive: true });

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------------- 事件绑定 ---------------- */

  els.pickBtn.addEventListener('click', function () { els.fileInput.click(); });
  els.addMoreBtn.addEventListener('click', function () { els.fileInput.click(); });
  els.fileInput.addEventListener('change', function (e) {
    addFiles(e.target.files);
    e.target.value = '';
  });
  els.saveAllBtn.addEventListener('click', saveAll);
  els.saveEachBtn.addEventListener('click', startGuided);
  els.clearBtn.addEventListener('click', clearAll);
  els.guidedNext.addEventListener('click', function () {
    var g = state.guided;
    if (!g) return;
    var item = g.list[g.index];
    downloadBlob(item.result.blob, g.names[g.index]);
    buzz(8);
    g.index++;
    if (g.index >= g.list.length) {
      endGuided();
      showHud('已全部保存 ' + g.list.length + ' 张');
      buzz(20);
    } else {
      updateGuided();
    }
  });
  els.guidedCancel.addEventListener('click', endGuided);
  els.sheetClose.addEventListener('click', closeSheet);
  els.scrim.addEventListener('click', closeSheet);

  // Service Worker：注册失败或被托管方禁用（CSP sandbox，如 html2link.dev）时给出提示。
  // 注意：沙箱上下文里连 navigator.serviceWorker 的属性访问都会抛异常，必须 try/catch。
  function markSwUnavailable() {
    els.envWarn.innerHTML = '<b>当前托管环境禁用了 Service Worker</b>：无法安装到桌面、无法离线使用。<br>' +
      '请改用支持 PWA 的静态托管（EdgeOne Pages、Cloudflare Pages、GitHub Pages、自有服务器等），' +
      '短链预览类服务（如 html2link.dev）均强制沙箱，装不了。';
    els.envWarn.hidden = false;
  }

  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      navigator.serviceWorker.register('./sw.js').catch(function () { markSwUnavailable(); });
    } else {
      markSwUnavailable();
    }
  } catch (e) {
    markSwUnavailable();
  }

  updateChrome();

  // 测试钩子（冒烟测试用）
  window.__app = { addFiles: addFiles, state: state };
})();
