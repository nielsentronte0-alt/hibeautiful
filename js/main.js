/* Flowers for You — orchestration: opening → cinematic transition → growth →
   message → living garden, plus "Bloom Again". */
(function () {
  'use strict';
  const FFY = (window.FFY = window.FFY || {});
  const U = FFY.util;

  const scene = document.getElementById('scene');
  const message = document.getElementById('message');
  const again = document.getElementById('again');
  const muteBtn = document.getElementById('mute');
  const music = document.getElementById('music');
  const countdownEl = document.getElementById('countdown');
  const countdownNum = document.getElementById('countdown-num');
  const html = document.documentElement;
  const COUNTDOWN_FROM = 10;

  let state = 'opening';   // opening | transition | garden | resetting
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };

  if (U.prefersReduced) html.classList.add('reduced');
  html.classList.add(`tier-${U.tier}`);

  const messageParts = message.querySelectorAll('.message__title, .message__rule, .message__sub');
  function showMessage(afterMs) {
    later(() => {
      message.classList.remove('is-leaving');
      messageParts.forEach((el) => { el.hidden = false; });      // real DOM change → live region announces
      requestAnimationFrame(() => message.classList.add('is-visible'));
    }, afterMs);
    later(() => {
      again.hidden = false;
      requestAnimationFrame(() => again.classList.add('is-visible'));
    }, afterMs + 900);
  }
  function hideMessage() {
    message.classList.add('is-leaving');
    again.classList.remove('is-visible');
    later(() => {
      message.classList.remove('is-visible', 'is-leaving');
      messageParts.forEach((el) => { el.hidden = true; });
    }, 900);
    later(() => { again.hidden = true; }, 900);
  }

  function startGrowth() {
    scene.classList.add('is-active');
    const dur = FFY.garden.grow();               // seconds until the main bouquet is fully bloomed
    FFY.fx.setMode('garden');
    state = 'garden';
    showMessage(Math.min(dur, 7.6) * 1000 + 300);
  }

  // Runtime calibration: the synchronous garden build is a decent CPU benchmark (≈60 ms
  // on a fast desktop, several hundred on a slow one), and the opening screen's frame
  // times catch weak GPUs. Either signal steps the device tier down before the (much
  // heavier) growth phase — fewer flowers/particles, grouped petals, less perpetual motion.
  let buildMs = 0;
  function timedBuild() {
    const t0 = performance.now();
    FFY.garden.build();
    buildMs = performance.now() - t0;
    return buildMs;
  }
  function calibrateTier() {
    if (U.tierForced || U.prefersReduced) return;
    const median = FFY.fx.frameMedian();
    let steps = 0;
    if (buildMs > 260) steps = 2; else if (buildMs > 120 || (median && median > 21)) steps = 1;
    if (!steps) return;
    const order = ['high', 'mid', 'lite'];
    const next = order[Math.min(2, order.indexOf(U.tier) + steps)];
    if (next === U.tier) return;
    U.setTier(next);
    FFY.fx.setTier();
    FFY.garden.build();
  }

  // ---- music -------------------------------------------------------------
  function startMusic() {
    if (!music) return;
    try {
      music.currentTime = 0;
      music.volume = .9;
      const p = music.play();
      if (p && p.catch) p.catch(() => {});      // e.g. file missing / blocked — the show goes on
    } catch (e) { /* ignore */ }
    muteBtn.hidden = false;
    requestAnimationFrame(() => muteBtn.classList.add('is-visible'));
  }
  function toggleMute() {
    music.muted = !music.muted;
    muteBtn.setAttribute('aria-pressed', String(music.muted));
    const label = music.muted ? 'Unmute music' : 'Mute music';
    muteBtn.setAttribute('aria-label', label);
    muteBtn.title = label;
  }

  // ---- countdown ---------------------------------------------------------
  // 10 → 1, one beat per second (numeral breathes in, ring drains, glow pulses), then done().
  function runCountdown(from, done) {
    countdownEl.style.setProperty('--cd', `${from}s`);
    countdownEl.hidden = false;
    requestAnimationFrame(() => countdownEl.classList.add('is-visible'));
    let k = from;
    const tick = () => {
      if (k <= 0) {
        countdownEl.classList.add('is-leaving');
        later(() => { countdownEl.hidden = true; countdownEl.classList.remove('is-visible', 'is-leaving'); }, 600);
        done();
        return;
      }
      countdownNum.textContent = String(k);
      countdownNum.classList.remove('is-tick');
      void countdownNum.offsetWidth;                  // restart the numeral animation
      countdownNum.classList.add('is-tick');
      k--;
      later(tick, 1000);
    };
    tick();
  }

  function openBouquet(x, y) {
    if (state !== 'opening') return;
    state = 'transition';
    calibrateTier();
    startMusic();
    if (!FFY.fx.reduced) {
      FFY.fx.burst(x, y);
      later(() => FFY.fx.petalBurst(x, y), 120);
    }
    // Hook for extra wiring: `bouquet:open` fires the moment the bouquet is opened.
    document.dispatchEvent(new CustomEvent('bouquet:open', { detail: { x, y } }));
    later(() => FFY.opening.hide(), U.prefersReduced ? 1100 : 2100);
    // the countdown takes over as the card zooms away; the flowers grow when it ends
    later(() => runCountdown(COUNTDOWN_FROM, () => {
      if (!FFY.fx.reduced) {
        const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
        FFY.fx.burst(cx, cy);
        FFY.fx.petalBurst(cx, cy);
      }
      document.dispatchEvent(new CustomEvent('bouquet:bloom'));
      later(startGrowth, 250);
    }), U.prefersReduced ? 300 : 550);
  }

  async function bloomAgain() {
    if (state !== 'garden') return;
    state = 'resetting';
    again.blur();
    clearTimers();
    hideMessage();
    document.dispatchEvent(new CustomEvent('bouquet:reset'));
    FFY.garden.setGrowing(false);
    await FFY.garden.leave();          // flowers fold back into the ground
    FFY.garden.build();                // fresh randomized arrangement
    later(() => {
      const dur = FFY.garden.grow();
      state = 'garden';
      showMessage(Math.min(dur, 7.6) * 1000 + 300);
    }, 180);
  }

  function init() {
    FFY.fx.init();
    FFY.cursor.init();
    FFY.garden.bindEvents();
    FFY.opening.init({ onOpen: openBouquet });
    again.addEventListener('click', bloomAgain);
    muteBtn.addEventListener('click', toggleMute);
    // a real width change while the garden is up → graceful leave + regrow (same path as Bloom Again)
    document.addEventListener('garden:rebuild', () => { if (state === 'garden') bloomAgain(); });

    // Pre-build the bouquet during idle time so the first click is instant.
    const prebuild = () => { if (!FFY.garden.flowers.length) timedBuild(); };
    if ('requestIdleCallback' in window) requestIdleCallback(prebuild, { timeout: 1500 });
    else setTimeout(prebuild, 400);

    // keyboard: Enter/Space on the page opens the bouquet if the button isn't focused
    window.addEventListener('keydown', (e) => {
      if (state === 'opening' && (e.key === 'Enter' || e.key === ' ') && document.activeElement !== document.getElementById('open-btn')) {
        e.preventDefault();
        FFY.opening.open();
      }
    });
  }

  // small public API (e.g. for wiring up music)
  window.FlowersForYou = {
    open: () => FFY.opening.open(),
    bloomAgain,
    onOpen: (cb) => document.addEventListener('bouquet:open', cb),
    get state() { return state; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
