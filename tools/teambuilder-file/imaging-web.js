/*
 * imaging-web.js — the imaging interface textures.js wants, backed by the
 * browser's own decoder and canvas. png.js does the same job in Node; it
 * cannot be used here because it needs zlib synchronously and the browser
 * only offers CompressionStream, which is async.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBImagingWeb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function canvasOf(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  async function toBlob(canvas) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
    return new Promise((res) => canvas.toBlob(res, 'image/png'));
  }

  async function decode(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = canvasOf(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, rgba: new Uint8Array(data.data.buffer) };
  }

  async function encode(img) {
    const canvas = canvasOf(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    const blob = await toBlob(canvas);
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Canvas resampling, which is smoother than a plain box filter. */
  async function downscale(img, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale >= 1) return img;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const src = canvasOf(img.width, img.height);
    src.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    const dst = canvasOf(w, h);
    const ctx = dst.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, rgba: new Uint8Array(data.data.buffer) };
  }

  /** Same test as png.js: does this image carry any variation at all? */
  function flatness(img, tolerance) {
    const tol = tolerance == null ? 2 : tolerance;
    const n = img.width * img.height;
    const step = Math.max(1, Math.floor(n / 20000));
    const min = [255, 255, 255, 255], max = [0, 0, 0, 0], sum = [0, 0, 0, 0];
    let count = 0;
    for (let i = 0; i < n; i += step) {
      const s = i * 4;
      for (let c = 0; c < 4; c++) {
        const v = img.rgba[s + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
        sum[c] += v;
      }
      count++;
    }
    let spread = 0;
    for (let c = 0; c < 4; c++) spread = Math.max(spread, max[c] - min[c]);
    return { flat: spread <= tol, spread, colour: sum.map((v) => Math.round(v / count)) };
  }

  return { imaging: () => ({ decode, encode, downscale, flatness }) };
});
