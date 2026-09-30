/* 头条图片去水印 — 核心裁切算法
 * 规格来源：头条图片去水印裁切逻辑-PWA开发规格.md（strip_watermark_file）
 *   crop_h = min(150, max(40, int(宽 × 0.06)))   —— int 截断
 *   只裁底部全宽横带 (0, 0, w, h − crop_h)
 *   跳过：crop_h ≥ 高×0.3 或 高−crop_h < 100（宁可保留水印，不裁残小图）
 *   JPEG 重存 quality=90，其余格式默认参数
 * 浏览器端差异（规格列明）：
 *   - EXIF 方向显式转正（createImageBitmap from-image，回退 <img>），所见即所得
 *   - GIF 一律跳过（动图丢帧；Canvas 无法按 GIF 原格式导出）
 *   - AVIF/BMP/HEIC 无法原格式导出或解码 → 按规格「格式不识别就跳过」
 */
(function (global) {
  'use strict';

  var SKIP = {
    gif: 'GIF 不处理：动图会丢帧，浏览器也无法按 GIF 原格式导出',
    bmp: 'BMP 无法在浏览器端原格式导出，已跳过',
    avif: 'AVIF 无法在浏览器端原格式导出，已跳过（规格：格式不识别就跳过）',
    heic: 'HEIC/HEIF 照片浏览器无法解码，已跳过',
    unknown: '不支持的图片格式，已跳过',
    too_small: '图片太小：按规格裁切会裁残，保留原图',
    decode: '图片解码失败：文件可能损坏或格式不受支持',
    encode: '导出失败：图片可能过大或手机内存不足',
  };

  // 可原格式导出的目标格式
  var OUT = { 'image/jpeg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp' };

  var EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  var EXT_TO_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
    png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    bmp: 'image/bmp', dib: 'image/bmp', avif: 'image/avif', avifs: 'image/avif',
    heic: 'image/heic', heif: 'image/heic',
  };

  function normMime(file) {
    var t = String(file.type || '').toLowerCase();
    if (t === 'image/jpg' || t === 'image/pjpeg' || t === 'image/jpe') t = 'image/jpeg';
    if (t && t !== 'application/octet-stream') return t;
    // 媒体库有时不给 type，按扩展名兜底
    var m = /\.([a-z0-9]+)$/i.exec(file.name || '');
    var ext = m ? m[1].toLowerCase() : '';
    return EXT_TO_MIME[ext] || (t || '');
  }

  function computeCropH(width) {
    return Math.min(150, Math.max(40, Math.trunc(width * 0.06)));
  }

  /* 解码并统一 EXIF 方向（转正后坐标即所见坐标） */
  function decode(file) {
    if (typeof global.createImageBitmap === 'function') {
      // 显式按 EXIF 转正；个别内核不认 options 再降级重试
      return global.createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(function (bmp) { return { src: bmp, bitmap: true }; })
        .catch(function () {
          return global.createImageBitmap(file).then(function (bmp) { return { src: bmp, bitmap: true }; });
        })
        .catch(function () { return decodeByImg(file); });
    }
    return Promise.resolve(decodeByImg(file));
  }

  function decodeByImg(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.decoding = 'async';
      var done = false;
      var finish = function (ok) {
        if (done) return;
        done = true;
        if (ok) resolve({ src: img, bitmap: false, url: url });
        else { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onload = function () { finish(true); };
      img.onerror = function () { finish(false); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve(b); }, mime, quality);
    });
  }

  /**
   * 处理单个文件。
   * @returns {Promise<{status:'done', blob, mime, cropH, width, height}|
   *                   {status:'skip', reason, width?, height?}|
   *                   {status:'fail', reason}>}
   */
  function stripWatermark(file) {
    var mime = normMime(file);
    if (mime === 'image/gif') return Promise.resolve({ status: 'skip', reason: SKIP.gif });
    if (mime === 'image/bmp') return Promise.resolve({ status: 'skip', reason: SKIP.bmp });
    if (mime === 'image/avif') return Promise.resolve({ status: 'skip', reason: SKIP.avif });
    if (mime === 'image/heic') return Promise.resolve({ status: 'skip', reason: SKIP.heic });
    var outMime = OUT[mime];
    if (!outMime) return Promise.resolve({ status: 'skip', reason: SKIP.unknown });

    return decode(file).then(function (dec) {
      if (!dec) return { status: 'skip', reason: SKIP.decode };
      try {
        var w = dec.src.naturalWidth || dec.src.width;
        var h = dec.src.naturalHeight || dec.src.height;
        if (!w || !h) return { status: 'skip', reason: SKIP.decode };

        // ② 裁切高度 + ③ 小图/竖长图保护（照抄规格公式）
        var cropH = computeCropH(w);
        if (cropH >= h * 0.3 || h - cropH < 100) {
          return { status: 'skip', reason: SKIP.too_small, width: w, height: h };
        }

        // ④ 只裁底部
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h - cropH;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(dec.src, 0, 0, w, h - cropH, 0, 0, w, h - cropH);

        // ⑤ 保存：JPEG quality 90，其余默认；编码不可用时（如 WebP→PNG 回退）按实际类型落盘
        var quality = outMime === 'image/jpeg' ? 0.9 : undefined;
        return canvasToBlob(canvas, outMime, quality).then(function (blob) {
          var actualMime = outMime;
          if (!blob && outMime === 'image/webp') {
            actualMime = 'image/png';
            blob = null;
            return canvasToBlob(canvas, 'image/png').then(function (png) {
              if (!png) return { status: 'fail', reason: SKIP.encode };
              return { status: 'done', blob: png, mime: actualMime, cropH: cropH, width: w, height: h - cropH };
            });
          }
          if (!blob) return { status: 'fail', reason: SKIP.encode };
          if (blob.type && blob.type !== outMime && OUT[blob.type]) actualMime = blob.type;
          return { status: 'done', blob: blob, mime: actualMime, cropH: cropH, width: w, height: h - cropH };
        });
      } catch (err) {
        return { status: 'fail', reason: SKIP.encode };
      } finally {
        if (dec.bitmap && dec.src.close) dec.src.close();
        if (dec.url) URL.revokeObjectURL(dec.url);
      }
    });
  }

  global.Strip = {
    stripWatermark: stripWatermark,
    computeCropH: computeCropH,
    SKIP: SKIP,
    EXT_BY_MIME: EXT_BY_MIME,
  };
})(window);
