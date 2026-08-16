/* Flowers for You — garden: arranges flowers across three depth layers with a
   bouquet-shaped silhouette, orchestrates growth timing, hover interactions
   (tilt toward cursor, glow, sparkles, neighbours reacting), parallax, petal
   emitters, and the leave → rebuild cycle for "Bloom Again". */
(function () {
  'use strict';
  const FFY = (window.FFY = window.FFY || {});
  const U = FFY.util;
  const { rand, clamp, weighted, shuffle } = U;

  const gardenEl = document.getElementById('garden');
  const layers = {
    back: gardenEl.querySelector('[data-layer="back"]'),
    mid: gardenEl.querySelector('[data-layer="mid"]'),
    front: gardenEl.querySelector('[data-layer="front"]'),
  };
  const tipEl = document.getElementById('tip');

  const reduced = U.prefersReduced;
  let flowers = [];
  let growing = false;
  let hovered = null;
  let nearSet = [];
  let duration = 0;
  let hoverTimer = 0;
  let parallax = { x: 0, y: 0, tx: 0, ty: 0, raf: 0 };
  let buildW = 0;

  // ---- arrangement -------------------------------------------------------
  function counts() {
    const w = window.innerWidth;
    const t = U.tier;
    if (t === 'lite' || w < 640) return { back: 9, mid: 12, front: 12, filler: 8, ground: 6 };
    if (t === 'mid' || w < 1024) return { back: 12, mid: 15, front: 14, filler: 10, ground: 8 };
    if (w > 1700) return { back: 20, mid: 26, front: 23, filler: 18, ground: 12 };
    return { back: 16, mid: 23, front: 20, filler: 16, ground: 10 };
  }

  // Bouquet dome: taller toward the centre, lower at the edges
  const dome = (x) => 1 - (window.innerWidth < 640 ? .28 : .4) * Math.pow((x - .5) * 2, 2);

  const BAG = {
    back: [
      { v: 'daisy', w: 2 }, { v: 'blossom', w: 2 }, { v: 'cosmos', w: 2 }, { v: 'tulip', w: 1.5 }, { v: 'rose', w: 1.5 },
      { v: 'lavender', w: 2 }, { v: 'babysbreath', w: 1.5 }, { v: 'poppy', w: .8 }, { v: 'lily', w: .8 },
    ],
    mid: [
      { v: 'rose', w: 2.4 }, { v: 'tulip', w: 2 }, { v: 'daisy', w: 1.6 }, { v: 'lily', w: 1.4 }, { v: 'cosmos', w: 1.6 },
      { v: 'poppy', w: 1.1 }, { v: 'blossom', w: 1 }, { v: 'lavender', w: 1.2 }, { v: 'eucalyptus', w: .8 },
    ],
    front: [
      { v: 'rose', w: 3 }, { v: 'tulip', w: 2.2 }, { v: 'lily', w: 1.6 }, { v: 'poppy', w: 1.3 }, { v: 'daisy', w: 1.3 },
      { v: 'cosmos', w: 1.2 }, { v: 'blossom', w: .6 },
    ],
    filler: [
      { v: 'lavender', w: 2 }, { v: 'babysbreath', w: 2 }, { v: 'blossom', w: 2 }, { v: 'eucalyptus', w: 1.6 }, { v: 'daisy', w: .8 }, { v: 'cosmos', w: .6 },
    ],
    ground: [{ v: 'foliage', w: 3 }, { v: 'eucalyptus', w: 1 }, { v: 'blossom', w: .8 }],
  };

  // per-layer look & feel
  const LAYER = {
    // `mute` blends colours toward the background (atmospheric perspective) — far
    // cheaper than per-flower blur/opacity, which would each need a GPU render surface.
    back: { scale: [.5, .68], h: [.42, .68], mute: [.3, .48], d: [0, 1.4], zBase: 0 },
    mid: { scale: [.78, .98], h: [.42, .74], mute: [0, .08], d: [.4, 2.9], zBase: 100 },
    front: { scale: [1.08, 1.42], h: [.3, .56], mute: [0, 0], d: [1.1, 3.9], zBase: 200 },
    filler: { scale: [.75, 1.0], h: [.17, .42], mute: [0, .05], d: [1.4, 4.8], zBase: 300 },
    ground: { scale: [1.0, 1.35], h: [.07, .17], mute: [0, 0], d: [.4, 2.4], zBase: 400 },
  };

  function slots(n, jitter = .38) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = (i + .5) / n;
      out.push(clamp((c + rand(-jitter, jitter) / n) * 106 - 3, -2, 102));
    }
    return shuffle(out);
  }

  // where the final message ends (its children are display:none until revealed, so
  // estimate from computed font sizes rather than measuring the box)
  function messageBottom() {
    const msg = document.getElementById('message');
    if (!msg) return window.innerHeight * .3;
    const top = msg.getBoundingClientRect().top;
    const fs = (sel, fallback) => { const el = msg.querySelector(sel); return el ? parseFloat(getComputedStyle(el).fontSize) || fallback : fallback; };
    return top + fs('.message__title', 48) * 1.1 + 34 + fs('.message__sub', 18) * 1.5 + 12;
  }

  function build() {
    clear();
    const W = window.innerWidth, H = window.innerHeight;
    buildW = W;
    const narrow = W < 640;
    const unit = (Math.min(W, H) / 100) * (narrow ? 1.7 : W < 1024 ? 1.2 : 1);   // ≈ 1vmin, boosted on small screens
    const c = counts();
    const list = [];
    // keep flower heads below the final message so it stays legible
    const headCeiling = clamp(messageBottom() + 14, H * .2, H * .45);

    const make = (layerKey, group, count) => {
      const L = LAYER[group];
      const xs = slots(count, group === 'ground' ? .5 : .38);
      for (let i = 0; i < count; i++) {
        const type = weighted(BAG[group]);
        const T = FFY.flowers.TYPES[type];
        const x = xs[i];
        const xf = clamp(x / 100, 0, 1);
        const scale = rand(L.scale[0], L.scale[1]);
        const s = T.size * unit * (narrow ? 4.0 : 4.3) * scale;
        const heightFrac = rand(L.h[0], L.h[1]) * (group === 'ground' || group === 'filler' ? 1 : dome(xf));
        const base = -(6 + rand(0, 10));
        let Hs = Math.max(unit * 6, heightFrac * H);
        if (T.build) Hs = Math.max(unit * 6, Math.min(Hs, H - base - headCeiling - s * 1.3));
        const late = (group === 'filler' || group === 'back') && Math.random() < .16;   // a few late bloomers keep the garden alive
        const d = late ? rand(7, 16) : rand(L.d[0], L.d[1]);
        const sd = 1.25 + (Hs / H) * 1.5 + rand(0, .45);
        const bd = (type === 'rose' ? 1.6 : type === 'lavender' ? 1.4 : 1.15) + rand(0, .45);
        const st = rand(4.6, 8.2);
        const sa = clamp(1.2 + (Hs / H) * 3.4, 1.2, 4.2) * (group === 'front' ? .85 : 1) * rand(.8, 1.15);
        list.push({
          type, s, Hs, x, layer: layerKey, group,
          d, sd, bd, st, sa,
          nt: rand(3.6, 5.6), na: rand(-3.5, 3.5),
          mute: rand(L.mute[0], L.mute[1]),
          nod: group === 'front' && s > unit * 3.2,
          // small/distant flowers animate petals per ring instead of one by one
          simple: group === 'back' || group === 'filler' || group === 'ground' || (U.tier !== 'high' && group !== 'front'),
          ld2: rand(0, .55),
          base,
          zBase: L.zBase, late,
        });
      }
    };
    make('back', 'back', c.back);
    make('mid', 'mid', c.mid);
    make('front', 'front', c.front);
    make('front', 'filler', c.filler);
    make('front', 'ground', c.ground);

    // shorter flowers in front of taller ones within a layer → natural overlap
    const byLayer = {};
    for (const sp of list) (byLayer[sp.layer + sp.zBase] ||= []).push(sp);
    for (const k in byLayer) {
      byLayer[k].sort((a, b) => b.Hs - a.Hs).forEach((sp, i) => (sp.z = sp.zBase + i + 1));
    }

    duration = 0;
    const frag = { back: document.createDocumentFragment(), mid: document.createDocumentFragment(), front: document.createDocumentFragment() };
    for (const sp of list) {
      const fl = FFY.flowers.create(sp);
      fl.late = sp.late;
      fl.el._flower = fl;
      flowers.push(fl);
      frag[sp.layer].appendChild(fl.el);
      if (!sp.late) duration = Math.max(duration, fl.end);
    }
    layers.back.appendChild(frag.back);
    layers.mid.appendChild(frag.mid);
    layers.front.appendChild(frag.front);

    // neighbours (for "nearby petals react")
    const sorted = flowers.filter((fl) => fl.hasHead).sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      const fl = sorted[i];
      fl.near = [];
      for (let j = Math.max(0, i - 4); j <= Math.min(sorted.length - 1, i + 4); j++) {
        if (j === i) continue;
        const o = sorted[j];
        if (Math.abs(o.x - fl.x) < 6.5) fl.near.push({ fl: o, dir: Math.sign(o.x - fl.x) || 1 });
      }
    }
    updateEmitters();
    return duration;
  }

  function clear() {
    unhover();
    clearTimeout(emitterTimer);
    for (const k in layers) layers[k].replaceChildren();
    flowers = [];
    gardenEl.classList.remove('is-growing', 'is-leaving');
    FFY.fx.setEmitters([]);
  }

  // page-space position of a flower head (ignores sway, which is fine for emitters)
  function headPos(fl) {
    const W = window.innerWidth, H = window.innerHeight;
    return { x: (fl.x / 100) * W + fl.tipX, y: H - fl.base - fl.Hs };
  }
  let emitterTimer = 0;
  const scheduleEmitters = () => { clearTimeout(emitterTimer); emitterTimer = setTimeout(updateEmitters, 400); };
  function updateEmitters() {
    const list = [];
    for (const fl of flowers) {
      if (!fl.bloomed || !fl.hasHead || fl.type === 'babysbreath' || fl.type === 'lavender' || fl.type === 'eucalyptus') continue;
      const p = headPos(fl);
      list.push({ x: p.x, y: p.y, r: fl.hs * .6, depth: fl.layer === 'front' ? .85 : fl.layer === 'mid' ? .6 : .3 });
    }
    FFY.fx.setEmitters(list);
  }

  // ---- growth ------------------------------------------------------------
  function grow() {
    if (!flowers.length) build();
    // force a style flush so the animations start from their initial state
    void gardenEl.offsetWidth;
    gardenEl.classList.add('is-growing');
    growing = true;
    return reduced ? 1.2 : duration;
  }

  function leave() {
    return new Promise((resolve) => {
      if (!flowers.length) return resolve();
      gardenEl.classList.add('is-leaving');
      unhover();
      FFY.fx.setEmitters([]);
      const t = reduced ? 500 : 1650;
      setTimeout(() => { clear(); resolve(); }, t);
    });
  }

  // ---- hover interactions ------------------------------------------------
  function flowerFromEvent(e) {
    const t = e.target;
    if (!t || !t.closest) return null;
    const fw = t.closest('.fw');
    return fw ? fw._flower : null;
  }

  function setHover(fl, e) {
    if (hovered === fl) return;
    if (hovered) unhover();
    hovered = fl;
    if (!fl) return;
    fl.el.classList.add('is-hover');
    nearSet = fl.near || [];
    for (const n of nearSet) {
      n.fl.el.classList.add('is-near');
      n.fl.el.style.setProperty('--tilt', `${n.dir * rand(1.4, 2.6)}deg`);
    }
    const p = headPos(fl);
    if (!reduced) FFY.fx.sparkleAt(p.x, p.y, 3, fl.hs * .7);
    showTip(fl, e);
    clearInterval(hoverTimer);
    if (!reduced) {
      hoverTimer = setInterval(() => {
        if (!hovered) return clearInterval(hoverTimer);
        const q = headPos(hovered);
        if (Math.random() < .7) FFY.fx.sparkleAt(q.x, q.y, 1, hovered.hs * .8);
        else FFY.fx.petalFrom(q.x + rand(-hovered.hs, hovered.hs) * .5, q.y, hovered.layer === 'front' ? .85 : .6);
      }, 420);
    }
  }
  function unhover() {
    if (!hovered) return;
    hovered.el.classList.remove('is-hover');
    hovered.el.style.setProperty('--tilt', '0deg');
    for (const n of nearSet) {
      n.fl.el.classList.remove('is-near');
      n.fl.el.style.setProperty('--tilt', '0deg');
    }
    nearSet = [];
    hovered = null;
    clearInterval(hoverTimer);
    hideTip();
  }
  function tiltToward(fl, clientX) {
    const p = headPos(fl);
    const dx = clientX - p.x;
    const tilt = clamp((dx / Math.max(40, fl.hs * 2.2)) * 5, -7, 7);
    fl.el.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`);
  }

  function placeTip(x, y) {
    const w = tipEl.offsetWidth || 160, h = tipEl.offsetHeight || 30;
    tipEl.style.setProperty('--x', `${Math.min(x, window.innerWidth - w - 30)}px`);
    tipEl.style.setProperty('--y', `${Math.min(y, window.innerHeight - h - 32)}px`);
  }
  function showTip(fl, e) {
    if (!tipEl || !U.finePointer) return;
    tipEl.innerHTML = `<b>${fl.name}</b> <i>· ${fl.phrase}</i>`;
    if (e) placeTip(e.clientX, e.clientY);
    tipEl.classList.add('is-visible');
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('is-visible'); }

  const BAKE = new Set(['petalBloom', 'leafUnfold', 'budPop', 'stemGrow', 'budFade', 'stamensIn']);

  function bindEvents() {
    // bake finished growth animations (see garden.css "Baked final states")
    const fwOf = (t) => (t && t.closest ? t.closest('.fw') : null);
    // stem starts drawing → leaves may unfold (see garden.css: growth is gated per flower)
    gardenEl.addEventListener('animationstart', (e) => {
      if (e.animationName !== 'stemGrow') return;
      const fw = fwOf(e.target);
      if (fw) fw.classList.add('is-sprouting');
    });
    gardenEl.addEventListener('animationend', (e) => {
      const n = e.animationName;
      if (BAKE.has(n) && e.target && e.target.classList) e.target.classList.add('done');
      if (n === 'stemGrow') {
        // stem reached its tip → bud pops, petals unfurl, sway begins
        const fw = fwOf(e.target);
        if (fw) fw.classList.add('is-blooming');
      } else if (n === 'budPop') {
        // the head has appeared → this flower may now shed petals
        const fw = fwOf(e.target);
        if (fw && fw._flower) { fw._flower.bloomed = true; scheduleEmitters(); }
      }
    });
    gardenEl.addEventListener('pointerover', (e) => {
      if (!growing || e.pointerType !== 'mouse') return;
      const fl = flowerFromEvent(e);
      if (fl) setHover(fl, e);
    });
    gardenEl.addEventListener('pointerout', (e) => {
      if (!hovered || e.pointerType !== 'mouse') return;   // touch taps release on a timer instead
      const to = e.relatedTarget;
      const toFl = to && to.closest ? to.closest('.fw') : null;
      if (!toFl || toFl._flower !== hovered) unhover();
    });
    let moveRaf = 0, lastMove = null;
    window.addEventListener('pointermove', (e) => {
      lastMove = e;
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        const ev = lastMove;
        if (hovered) {
          tiltToward(hovered, ev.clientX);
          if (tipEl && tipEl.classList.contains('is-visible')) placeTip(ev.clientX, ev.clientY);
        }
        if (U.finePointer && !reduced) {
          parallax.tx = (ev.clientX / window.innerWidth - .5);
          parallax.ty = (ev.clientY / window.innerHeight - .5);
          wakeParallax();
        }
      });
    }, { passive: true });
    // touch: tapping a flower reacts, then releases
    let touchTimer = 0;
    gardenEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !growing) return;
      const fl = flowerFromEvent(e);
      if (!fl) return;
      clearTimeout(touchTimer);
      setHover(fl, e);
      tiltToward(fl, e.clientX);
      touchTimer = setTimeout(() => { if (hovered === fl) unhover(); }, 1600);
    });
    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(onResize, 260);
    });
  }

  // Parallax loop runs only while converging toward the pointer target, then idles.
  let parallaxOn = true;
  function parallaxLoop() {
    parallax.raf = 0;
    if (!parallaxOn) return;
    parallax.x += (parallax.tx - parallax.x) * .06;
    parallax.y += (parallax.ty - parallax.y) * .06;
    const px = parallax.x, py = parallax.y;
    layers.back.style.transform = `translate3d(${(px * -14).toFixed(1)}px,${(py * -6).toFixed(1)}px,0)`;
    layers.mid.style.transform = `translate3d(${(px * -6).toFixed(1)}px,${(py * -3).toFixed(1)}px,0)`;
    layers.front.style.transform = `translate3d(${(px * 5).toFixed(1)}px,${(py * 2).toFixed(1)}px,0)`;
    if (Math.abs(parallax.tx - px) > .002 || Math.abs(parallax.ty - py) > .002) parallax.raf = requestAnimationFrame(parallaxLoop);
  }
  const wakeParallax = () => { if (!parallax.raf && parallaxOn) parallax.raf = requestAnimationFrame(parallaxLoop); };

  function onResize() {
    if (!flowers.length) return;
    const W = window.innerWidth;
    // ignore small height-only changes (mobile URL bar); rebuild on real width changes
    if (Math.abs(W - buildW) < 90) { updateEmitters(); return; }
    if (growing) {
      // let main.js run the graceful leave → rebuild → regrow cycle
      document.dispatchEvent(new CustomEvent('garden:rebuild'));
      return;
    }
    build();
  }

  FFY.garden = {
    build, grow, leave, clear, bindEvents,
    get duration() { return duration; },
    get flowers() { return flowers; },
    get growing() { return growing; },
    setGrowing(v) { growing = v; },
    setParallax(v) { parallaxOn = !!v; if (v) wakeParallax(); },
  };
})();
