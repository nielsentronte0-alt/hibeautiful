/* Flowers for You — shared utilities, device tier detection, SVG gradient registry */
(function () {
  'use strict';
  const FFY = (window.FFY = window.FFY || {});

  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const weighted = (items) => {
    // items: [{ v, w }]
    let total = 0;
    for (const it of items) total += it.w;
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it.v;
    }
    return items[items.length - 1].v;
  };
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const fmt = (n) => (Math.round(n * 1000) / 1000).toString();

  // ---- colour helpers ----------------------------------------------------
  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = ([r, g, b]) =>
    '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
  };
  const lighten = (c, t) => mix(c, '#ffffff', t);
  const darken = (c, t) => mix(c, '#000000', t);
  const rgba = (hex, a) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };

  // ---- environment -------------------------------------------------------
  const mq = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
  const prefersReduced = mq('(prefers-reduced-motion: reduce)');
  const finePointer = mq('(pointer: fine)') && !mq('(hover: none)');
  // Device tier drives flower/particle counts. It starts from viewport + hardware hints
  // and can be lowered at runtime by a frame-rate calibration (see main.js), or forced
  // with ?tier=lite|mid|high for testing.
  const forcedTier = (() => {
    try { const t = new URLSearchParams(location.search).get('tier'); return ['lite', 'mid', 'high'].includes(t) ? t : null; } catch (e) { return null; }
  })();
  const detectTier = () => {
    const w = window.innerWidth;
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 8;
    if (w < 640 || mem <= 3 || cores <= 3) return 'lite';
    if (w < 1024 || mem <= 4 || cores <= 4) return 'mid';
    return 'high';
  };

  FFY.util = {
    rand, randInt, pick, clamp, lerp, weighted, shuffle, fmt,
    hexToRgb, rgbToHex, mix, lighten, darken, rgba,
    prefersReduced, finePointer,
    tier: forcedTier || detectTier(),
    tierForced: !!forcedTier,
    setTier(t) { this.tier = t; document.documentElement.className = document.documentElement.className.replace(/\btier-\w+/g, '').trim() + ' tier-' + t; },
    TAU: Math.PI * 2,
  };

  // ---- shared SVG <defs> registry ---------------------------------------
  // Every flower references gradients by id from one document-level <defs>,
  // so we create each gradient exactly once.
  FFY.defs = (() => {
    const NS = 'http://www.w3.org/2000/svg';
    const made = new Set();
    let defsEl = null;
    const root = () => defsEl || (defsEl = document.getElementById('defs'));

    function add(id, markup) {
      if (made.has(id)) return id;
      made.add(id);
      const tmp = document.createElementNS(NS, 'svg');
      tmp.innerHTML = markup;
      const target = root();
      while (tmp.firstChild) target.appendChild(tmp.firstChild);
      return id;
    }
    const key = (c) => c.replace('#', '');

    // vertical petal gradient: light tip (top) → base colour → darker base (bottom)
    function petal(color, tip = 0.42, base = 0.26) {
      const id = `pg-${key(color)}-${Math.round(tip * 100)}-${Math.round(base * 100)}`;
      return add(id,
        `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${lighten(color, tip)}"/>` +
        `<stop offset=".55" stop-color="${color}"/>` +
        `<stop offset="1" stop-color="${darken(color, base)}"/></linearGradient>`);
    }
    // soft radial glow behind a flower head
    function glow(color, a = 0.6) {
      const id = `hg-${key(color)}-${Math.round(a * 100)}`;
      return add(id,
        `<radialGradient id="${id}"><stop offset="0" stop-color="${lighten(color, .25)}" stop-opacity="${a}"/>` +
        `<stop offset=".45" stop-color="${color}" stop-opacity="${a * .38}"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
    }
    // radial disc gradient (flower centres): light middle → colour → dark rim
    function disc(color, hi = 0.35, lo = 0.4) {
      const id = `dg-${key(color)}-${Math.round(hi * 100)}-${Math.round(lo * 100)}`;
      return add(id,
        `<radialGradient id="${id}" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="${lighten(color, hi)}"/>` +
        `<stop offset=".55" stop-color="${color}"/>` +
        `<stop offset="1" stop-color="${darken(color, lo)}"/></radialGradient>`);
    }
    // leaf gradient: lighter yellow-green tip → deep base
    function leaf(color) {
      const id = `lg-${key(color)}`;
      return add(id,
        `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${mix(lighten(color, .28), '#e6f0a0', .18)}"/>` +
        `<stop offset=".6" stop-color="${color}"/>` +
        `<stop offset="1" stop-color="${darken(color, .38)}"/></linearGradient>`);
    }
    // white shine overlay used on hover
    function shine() {
      const id = 'shine-g';
      return add(id,
        `<radialGradient id="${id}"><stop offset="0" stop-color="#fff" stop-opacity=".9"/>` +
        `<stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
    }
    return { petal, glow, disc, leaf, shine };
  })();
})();
