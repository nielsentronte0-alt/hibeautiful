/* Flowers for You — custom cursor: glowing dot + soft halo that lags behind,
   grows over interactive elements, and occasionally sheds petals/sparkles.
   Only enabled for fine pointers; touch devices keep the native behaviour. */
(function () {
  'use strict';
  const FFY = (window.FFY = window.FFY || {});
  const U = FFY.util;

  const el = document.getElementById('cursor');
  const dot = el.querySelector('.cursor__dot');
  const halo = el.querySelector('.cursor__halo');
  const enabled = U.finePointer && !U.prefersReduced;

  let tx = -100, ty = -100, dx = -100, dy = -100, hx = -100, hy = -100;
  let visible = false, raf = 0, active = false;
  let lastX = 0, lastY = 0, trailAcc = 0;

  // The loop only runs while the cursor is still converging; when idle it stops so
  // no per-frame style writes hit the main thread.
  let curScale = 1;
  function loop() {
    dx += (tx - dx) * .42;
    dy += (ty - dy) * .42;
    hx += (tx - hx) * .16;
    hy += (ty - hy) * .16;
    const targetScale = active ? 1.55 : 1;
    curScale += (targetScale - curScale) * .18;
    dot.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0)`;
    halo.style.transform = `translate3d(${hx.toFixed(1)}px,${hy.toFixed(1)}px,0) scale(${curScale.toFixed(3)})`;
    const settled = Math.abs(tx - hx) < .3 && Math.abs(ty - hy) < .3 && Math.abs(targetScale - curScale) < .003;
    raf = settled ? 0 : requestAnimationFrame(loop);
  }
  const wake = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function onMove(e) {
    tx = e.clientX; ty = e.clientY;
    if (!visible) {
      visible = true;
      dx = hx = tx; dy = hy = ty;
      el.classList.add('is-visible');
    }
    wake();
    const mvx = tx - lastX, mvy = ty - lastY;
    const speed = Math.hypot(mvx, mvy);
    lastX = tx; lastY = ty;
    // shed a tiny petal / sparkle when moving briskly
    trailAcc += speed;
    if (trailAcc > 140 && speed > 4) {
      trailAcc = 0;
      FFY.fx.trail(tx, ty, mvx, mvy);
    }
  }

  function init() {
    if (!enabled) { el.remove(); return; }
    document.documentElement.classList.add('fine-pointer');
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => { visible = false; el.classList.remove('is-visible'); });
    document.documentElement.addEventListener('mouseenter', () => { if (tx > -50) { visible = true; el.classList.add('is-visible'); } });
    window.addEventListener('pointerdown', () => el.classList.add('is-down'));
    window.addEventListener('pointerup', () => el.classList.remove('is-down'));
    document.addEventListener('pointerover', (e) => {
      const t = e.target;
      const hit = t && t.closest && t.closest('button, a, .fw');
      setActive(!!hit);
    });
    wake();
  }
  function setActive(b) {
    active = !!b;
    el.classList.toggle('is-active', active);
    wake();
  }

  FFY.cursor = { init, setActive, get enabled() { return enabled; } };
})();
