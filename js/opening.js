/* Flowers for You — opening screen: magnetic glowing button, card tilt,
   hover atmosphere, and the cinematic click transition. */
(function () {
  'use strict';
  const FFY = (window.FFY = window.FFY || {});
  const U = FFY.util;
  const { clamp } = U;

  const root = document.getElementById('opening');
  const card = root.querySelector('.opening__card');
  const tilt = root.querySelector('.opening__tilt');
  const wrap = root.querySelector('.btn-wrap');
  const btn = document.getElementById('open-btn');
  const label = btn.querySelector('.btn__label');

  const magnetic = U.finePointer && !U.prefersReduced;
  let bx = 0, by = 0, cardRect = null;
  const cur = { x: 0, y: 0, rx: 0, ry: 0, s: 1 };
  const tgt = { x: 0, y: 0, rx: 0, ry: 0, s: 1 };
  let hover = false, done = false, raf = 0, onOpen = null;

  function measure() {
    const r = wrap.getBoundingClientRect();
    bx = r.left + r.width / 2;
    by = r.top + r.height / 2;
    cardRect = card.getBoundingClientRect();
    FFY.fx.setFocus({ x: bx, y: by, w: r.width, h: r.height });
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    cur.x += (tgt.x - cur.x) * .14;
    cur.y += (tgt.y - cur.y) * .14;
    cur.s += (tgt.s - cur.s) * .12;
    cur.rx += (tgt.rx - cur.rx) * .08;
    cur.ry += (tgt.ry - cur.ry) * .08;
    btn.style.transform = `translate3d(${cur.x.toFixed(2)}px,${cur.y.toFixed(2)}px,0) scale(${cur.s.toFixed(3)})`;
    label.style.transform = `translate3d(${(cur.x * .25).toFixed(2)}px,${(cur.y * .25 - (hover ? 2 : 0)).toFixed(2)}px,0)`;
    tilt.style.transform = `perspective(1100px) rotateX(${cur.rx.toFixed(2)}deg) rotateY(${cur.ry.toFixed(2)}deg)`;
  }

  function onMove(e) {
    if (done) return;
    if (!cardRect) measure();
    const dx = e.clientX - bx, dy = e.clientY - by;
    const dist = Math.hypot(dx, dy);
    const R = 190;
    if (dist < R) {
      const k = 1 - dist / R;
      tgt.x = dx * .34 * k;
      tgt.y = dy * .34 * k;
    } else {
      tgt.x = 0; tgt.y = 0;
    }
    // card tilt toward the cursor
    const cx = cardRect.left + cardRect.width / 2, cy = cardRect.top + cardRect.height / 2;
    const inCard = e.clientX > cardRect.left - 80 && e.clientX < cardRect.right + 80 && e.clientY > cardRect.top - 80 && e.clientY < cardRect.bottom + 80;
    tgt.ry = inCard ? clamp((e.clientX - cx) / cardRect.width * 7, -5, 5) : 0;
    tgt.rx = inCard ? clamp(-(e.clientY - cy) / cardRect.height * 7, -5, 5) : 0;
  }

  // Speed the ring / glow / sheen up on hover by changing playback rate — this keeps
  // their current phase (changing animation-duration in CSS would make them jump).
  function setPace(rate) {
    if (!btn.getAnimations) return;
    for (const a of btn.getAnimations({ subtree: true })) {
      const n = a.animationName;
      if (n === 'ringSpin' || n === 'glowBreath' || n === 'sheen') {
        if (a.updatePlaybackRate) a.updatePlaybackRate(rate); else a.playbackRate = rate;
      }
    }
  }

  function setHover(h) {
    if (done) return;
    hover = h;
    tgt.s = h ? 1.06 : 1;
    root.classList.toggle('is-hover', h);
    document.documentElement.classList.toggle('btn-hover', h);
    FFY.fx.setFocusHover(h);
    setPace(h ? 1.8 : 1);
  }

  function open() {
    if (done) return;
    done = true;
    measure();
    hover = false;
    tgt.x = tgt.y = tgt.rx = tgt.ry = 0;
    tgt.s = 1.08;
    root.style.setProperty('--fx', `${bx}px`);
    root.style.setProperty('--fy', `${by}px`);
    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    root.style.setProperty('--flash-scale', (diag / 120 * 1.15).toFixed(2));
    root.classList.remove('is-hover');
    root.classList.add('is-pressed');
    document.documentElement.classList.remove('btn-hover');
    FFY.fx.setFocus(null);
    FFY.fx.setFocusHover(false);
    btn.setAttribute('aria-disabled', 'true');
    btn.blur();
    if (onOpen) onOpen(bx, by);
    // 1) glow → 2) dim/flash → 3) zoom out & fade
    setTimeout(() => root.classList.add('is-leaving'), U.prefersReduced ? 200 : 420);
  }

  function hide() {
    cancelAnimationFrame(raf);
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
  }

  function init(opts) {
    onOpen = opts && opts.onOpen;
    btn.addEventListener('click', open);
    btn.addEventListener('pointerenter', () => setHover(true));
    btn.addEventListener('pointerleave', () => setHover(false));
    btn.addEventListener('focus', () => setHover(true));
    btn.addEventListener('blur', () => setHover(false));
    if (magnetic) {
      root.addEventListener('pointermove', onMove, { passive: true });
      root.addEventListener('pointerleave', () => { tgt.x = tgt.y = tgt.rx = tgt.ry = 0; });
      loop();
    }
    // measure after the entrance animation settles, and on resize
    setTimeout(measure, 300);
    setTimeout(measure, 1900);
    window.addEventListener('resize', () => { cardRect = null; measure(); });
  }

  FFY.opening = { init, open, hide, measure };
})();
