/* Flowers for You — canvas effects: floating petals (depth-sorted across two
   canvases), ambient light motes, sparkles, click bursts, cursor trail.
   One requestAnimationFrame loop, sprite-based drawing, pooled arrays. */
(function () {
  'use strict';
  const FFY = (window.FFY = window.FFY || {});
  const U = FFY.util;
  const { rand, lerp, clamp, pick } = U;

  const back = document.getElementById('fx-back');
  const front = document.getElementById('fx-front');
  const bctx = back.getContext('2d');
  const fctx = front.getContext('2d');

  const reduced = U.prefersReduced;

  const cfg = {};
  function applyTier() {
    const lite = U.tier === 'lite', mid = U.tier === 'mid';
    Object.assign(cfg, {
      lite,
      petalsGarden: lite ? 20 : mid ? 28 : 38,
      petalsOpening: lite ? 10 : 16,
      motes: lite ? 16 : mid ? 30 : 46,
      sparkleEvery: lite ? 1.5 : 0.85,       // seconds, garden mode
      focusSparkleEvery: 0.55,
      emitterEvery: lite ? 2.4 : 1.4,
      dprCap: lite ? 1.25 : 1.75,
      maxPetals: lite ? 60 : 140,
    });
  }
  applyTier();

  // frame-time samples taken during the opening screen (used to calibrate the tier)
  const frameStats = { samples: [], median: 0, startAt: 1000, endAt: 2600 };

  let W = 0, H = 0, DPR = 1;
  let running = false, rafId = 0, lastT = 0, time = 0;
  let mode = 'opening';                    // opening | garden | off
  let focus = null, focusHover = false;
  let emitters = [];

  const petals = [], motes = [], sparkles = [], dots = [];
  let wind = 0;
  const gust = { v: 0, start: -1, next: 6 };
  let spawnAcc = 0, sparkAcc = 0, focusAcc = 0, emitAcc = 0;

  // ---- sprites -----------------------------------------------------------
  const PETAL_COLORS = ['#f7b6c8', '#f28ba8', '#fbd0dc', '#e9789b', '#f9c9b6', '#f4a0b0', '#e2a6d8'];
  const sprites = { petal: [], soft: [], glow: {}, star: null };

  function petalSprite(color, soft) {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    if (soft && 'filter' in x) x.filter = 'blur(2.4px)';
    const g = x.createLinearGradient(0, 6, 0, 58);
    g.addColorStop(0, U.lighten(color, .38));
    g.addColorStop(.55, color);
    g.addColorStop(1, U.darken(color, .16));
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(32, 5);
    x.bezierCurveTo(53, 8, 59, 36, 32, 59);
    x.bezierCurveTo(5, 36, 11, 8, 32, 5);
    x.closePath();
    x.fill();
    if (!soft) {
      x.globalAlpha = .38;
      x.strokeStyle = 'rgba(255,255,255,.8)';
      x.lineWidth = 1.3;
      x.beginPath();
      x.moveTo(29, 15);
      x.bezierCurveTo(21, 25, 20, 37, 26, 49);
      x.stroke();
    }
    return c;
  }
  function glowSprite(color) {
    const S = 48;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, U.rgba(color, 1));
    g.addColorStop(.25, U.rgba(color, .55));
    g.addColorStop(.6, U.rgba(color, .12));
    g.addColorStop(1, U.rgba(color, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    return c;
  }
  function starSprite() {
    const S = 64, m = 32, R = 26, r = 3.2;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.shadowColor = 'rgba(255,225,240,.9)';
    x.shadowBlur = 8;
    x.fillStyle = '#fff8fb';
    x.beginPath();
    x.moveTo(m, m - R);
    x.quadraticCurveTo(m + r, m - r, m + R, m);
    x.quadraticCurveTo(m + r, m + r, m, m + R);
    x.quadraticCurveTo(m - r, m + r, m - R, m);
    x.quadraticCurveTo(m - r, m - r, m, m - R);
    x.closePath();
    x.fill();
    x.fill();
    return c;
  }
  function buildSprites() {
    for (const col of PETAL_COLORS) {
      sprites.petal.push(petalSprite(col, false));
      sprites.soft.push(petalSprite(col, true));
    }
    sprites.glow.white = glowSprite('#fff4f8');
    sprites.glow.pink = glowSprite('#ffa8c8');
    sprites.glow.gold = glowSprite('#ffd79a');
    sprites.glow.lilac = glowSprite('#d7b6ff');
    sprites.star = starSprite();
  }

  // ---- particles ---------------------------------------------------------
  function spawnPetal(o = {}) {
    if (petals.length >= cfg.maxPetals) return null;
    const depth = o.depth !== undefined ? o.depth : (mode === 'opening' ? .3 + Math.random() * .7 : Math.random());
    const size = lerp(8, 30, Math.pow(depth, 1.3)) * (o.sizeMul || 1);
    const p = {
      x: o.x !== undefined ? o.x : rand(-20, W + 20),
      y: o.y !== undefined ? o.y : rand(-70, -12),
      depth,
      size,
      alpha: o.alpha !== undefined ? o.alpha : lerp(.42, .95, depth),
      rot: rand(0, U.TAU),
      vr: rand(.006, .022) * (Math.random() < .5 ? 1 : -1),
      baseVy: lerp(.32, 1.15, depth) * rand(.8, 1.2),
      baseVx: rand(-.22, .22),
      vx: o.vx || 0,
      vy: o.vy !== undefined ? o.vy : lerp(.32, 1.15, depth),
      phase: rand(0, U.TAU),
      freq: rand(.55, 1.35),
      amp: lerp(.25, 1.05, depth),
      tumble: rand(.6, 1.6),
      sprite: (depth < .3 ? sprites.soft : sprites.petal)[o.colorIdx !== undefined ? o.colorIdx : Math.floor(Math.random() * PETAL_COLORS.length)],
      life: o.life !== undefined ? o.life : Infinity,
      age: 0,
      fadeIn: o.fadeIn || 0,
      drag: o.drag !== undefined ? o.drag : .03,
    };
    petals.push(p);
    return p;
  }
  function spawnMote() {
    motes.push({
      x: rand(0, W), y: rand(0, H),
      vx: rand(-.12, .12), vy: rand(-.22, -.06),
      r: rand(1.2, 3.4), a: rand(.22, .6),
      f: rand(.5, 1.6), ph: rand(0, U.TAU),
      sprite: Math.random() < .7 ? sprites.glow.white : (Math.random() < .5 ? sprites.glow.pink : sprites.glow.gold),
    });
  }
  function spawnSparkle(x, y, o = {}) {
    sparkles.push({
      x, y, age: 0,
      life: o.life || rand(1.1, 1.9),
      size: o.size || rand(9, 20),
      rot: rand(0, U.TAU), vr: rand(-.01, .01),
      vx: o.vx || rand(-.15, .15), vy: o.vy || rand(-.35, -.08),
      a: o.alpha || rand(.55, .95),
    });
  }
  function spawnDot(x, y, o = {}) {
    dots.push({
      x, y,
      vx: o.vx || 0, vy: o.vy || 0,
      age: 0, life: o.life || rand(.8, 1.6),
      size: o.size || rand(6, 16),
      sprite: o.sprite || sprites.glow.pink,
      drag: o.drag !== undefined ? o.drag : .965,
      grav: o.grav !== undefined ? o.grav : .035,
      a: o.alpha || 1,
    });
  }

  // ---- public effects ----------------------------------------------------
  function burst(x, y) {
    const n = cfg.lite ? 34 : 70;
    for (let i = 0; i < n; i++) {
      const a = rand(0, U.TAU), sp = rand(1.5, 9) * (Math.random() < .3 ? 1.6 : 1);
      spawnDot(x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        life: rand(.7, 1.7), size: rand(5, 18),
        sprite: pick([sprites.glow.pink, sprites.glow.white, sprites.glow.gold, sprites.glow.lilac]),
        drag: .955, grav: .03,
      });
    }
    for (let i = 0; i < (cfg.lite ? 8 : 16); i++) spawnSparkle(x + rand(-40, 40), y + rand(-40, 40), { life: rand(.8, 1.6), size: rand(10, 24), vy: rand(-.6, -.1) });
  }
  function petalBurst(x, y) {
    const n = cfg.lite ? 12 : 26;
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * .95, -Math.PI * .05);       // upward fan
      const sp = rand(3, 10);
      spawnPetal({
        x: x + rand(-18, 18), y: y + rand(-12, 12),
        depth: rand(.55, 1), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        drag: .018, life: rand(5, 9), sizeMul: rand(.7, 1.05),
      });
    }
  }
  function sparkleAt(x, y, n = 3, spread = 26) {
    for (let i = 0; i < n; i++) spawnSparkle(x + rand(-spread, spread), y + rand(-spread, spread), { size: rand(8, 16), life: rand(.9, 1.5) });
  }
  function petalFrom(x, y, depth = .8) {
    spawnPetal({ x, y, depth: clamp(depth + rand(-.15, .15), .2, 1), vx: rand(-.9, .9), vy: rand(-.9, -.2), sizeMul: rand(.55, .9), life: rand(6, 11), drag: .02 });
  }
  function trail(x, y, mvx, mvy) {
    if (Math.random() < .55) spawnSparkle(x + rand(-4, 4), y + rand(-4, 4), { size: rand(5, 10), life: rand(.5, .9), vx: -mvx * .05, vy: -mvy * .05 - .2, alpha: .8 });
    else spawnPetal({ x, y, depth: rand(.6, .95), vx: -mvx * .06 + rand(-.4, .4), vy: -mvy * .06 - rand(.2, .8), sizeMul: rand(.32, .5), life: rand(2.2, 3.6), fadeIn: .2, drag: .04 });
  }

  // ---- update ------------------------------------------------------------
  function updateWind(dt, sec) {
    if (gust.start < 0 && time > gust.next) gust.start = time;
    if (gust.start >= 0) {
      const t = time - gust.start;
      if (t < 1.1) gust.v = t / 1.1;
      else if (t < 2.4) gust.v = 1;
      else if (t < 3.8) gust.v = 1 - (t - 2.4) / 1.4;
      else { gust.v = 0; gust.start = -1; gust.next = time + rand(7, 15); }
    }
    wind = Math.sin(time * .16) * .22 + Math.sin(time * .047) * .32 + gust.v * 1.35;
  }

  function updatePetals(dt, sec, target) {
    // gentle continuous top-spawn to maintain target population
    if (target > 0) {
      spawnAcc += sec;
      const interval = mode === 'opening' ? .3 : .16;
      while (spawnAcc > interval) {
        spawnAcc -= interval;
        if (petals.length < target) spawnPetal();
      }
    }
    const lift = gust.v * .95;
    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.age += sec;
      p.vx += (p.baseVx - p.vx) * p.drag * dt;
      p.vy += (p.baseVy - p.vy) * (p.drag * .8) * dt;
      p.x += (p.vx + wind * (.4 + p.depth * .7) + Math.sin(p.phase + time * p.freq) * p.amp) * dt;
      p.y += (p.vy - lift * (.35 + p.depth * .65)) * dt;
      p.rot += (p.vr + Math.cos(p.phase + time * p.freq) * .012 * p.tumble) * dt;
      if (p.y > H + 60 || p.x < -90 || p.x > W + 90 || p.age > p.life) petals.splice(i, 1);
    }
  }
  function updateMotes(dt) {
    for (const m of motes) {
      m.x += (m.vx + wind * .12) * dt;
      m.y += m.vy * dt;
      if (m.y < -20) { m.y = H + 20; m.x = rand(0, W); }
      if (m.x < -20) m.x = W + 20; else if (m.x > W + 20) m.x = -20;
    }
  }
  function updateSparkles(dt, sec) {
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.age += sec;
      s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt;
      if (s.age >= s.life) sparkles.splice(i, 1);
    }
  }
  function updateDots(dt, sec) {
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i];
      d.age += sec;
      d.vx *= Math.pow(d.drag, dt); d.vy = d.vy * Math.pow(d.drag, dt) + d.grav * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.age >= d.life) dots.splice(i, 1);
    }
  }
  function ambient(sec) {
    if (mode === 'garden') {
      sparkAcc += sec;
      if (sparkAcc > cfg.sparkleEvery) {
        sparkAcc = 0;
        spawnSparkle(rand(W * .05, W * .95), rand(H * .3, H * .92), { size: rand(8, 16), life: rand(1.2, 2) });
      }
      if (emitters.length) {
        emitAcc += sec;
        if (emitAcc > cfg.emitterEvery) {
          emitAcc = 0;
          const e = pick(emitters);
          petalFrom(e.x + rand(-e.r, e.r), e.y + rand(-e.r * .5, e.r * .5), e.depth);
        }
      }
    } else if (mode === 'opening' && focus) {
      focusAcc += sec;
      if (focusAcc > (focusHover ? .22 : cfg.focusSparkleEvery)) {
        focusAcc = 0;
        const a = rand(0, U.TAU);
        const rx = focus.w * .62 + rand(0, 26), ry = focus.h * .8 + rand(0, 26);
        const x = focus.x + Math.cos(a) * rx, y = focus.y + Math.sin(a) * ry;
        if (focusHover && Math.random() < .6) {
          spawnPetal({ x, y, depth: rand(.55, .95), vx: Math.cos(a) * rand(.5, 1.5), vy: Math.sin(a) * rand(.5, 1.2) - .9, sizeMul: rand(.4, .7), life: rand(3, 5), fadeIn: .3, drag: .025 });
        } else {
          spawnSparkle(x, y, { size: rand(6, 13), life: rand(1, 1.8), vx: Math.cos(a) * .12, vy: Math.sin(a) * .12 - .12, alpha: .8 });
        }
      }
    }
  }

  // ---- draw --------------------------------------------------------------
  function drawPetal(ctx, p) {
    let a = p.alpha;
    if (p.fadeIn && p.age < p.fadeIn) a *= p.age / p.fadeIn;
    if (p.life !== Infinity && p.age > p.life - 1) a *= Math.max(0, p.life - p.age);
    if (p.y > H - 120) a *= clamp((H + 40 - p.y) / 160, 0, 1);
    if (a <= 0.01) return;
    const sy = .5 + .5 * Math.abs(Math.sin(p.phase * 2.3 + time * p.freq * 1.25));
    ctx.globalAlpha = a;
    ctx.setTransform(DPR, 0, 0, DPR, p.x * DPR, p.y * DPR);
    ctx.rotate(p.rot);
    ctx.scale(1, sy);
    ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
  }
  function drawGlow(ctx, sprite, x, y, size, a) {
    ctx.globalAlpha = a;
    ctx.setTransform(DPR, 0, 0, DPR, x * DPR, y * DPR);
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
  }
  function drawSparkle(ctx, s) {
    const t = s.age / s.life;
    const k = Math.sin(Math.PI * t);
    ctx.globalAlpha = s.a * k;
    ctx.setTransform(DPR, 0, 0, DPR, s.x * DPR, s.y * DPR);
    ctx.rotate(s.rot);
    const sz = s.size * (.35 + .65 * k);
    ctx.drawImage(sprites.star, -sz / 2, -sz / 2, sz, sz);
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const raw = now - lastT || 16.7;
    const elapsed = Math.min(64, raw);
    lastT = now;
    if (time * 1000 > frameStats.startAt && time * 1000 < frameStats.endAt && raw < 200 && !document.hidden) frameStats.samples.push(raw);
    const sec = elapsed / 1000;
    const dt = elapsed / 16.667;
    time += sec;

    updateWind(dt, sec);
    const target = mode === 'garden' ? cfg.petalsGarden : mode === 'opening' ? cfg.petalsOpening : 0;
    updatePetals(dt, sec, target);
    updateMotes(dt);
    updateSparkles(dt, sec);
    updateDots(dt, sec);
    ambient(sec);

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, back.width, back.height);
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, front.width, front.height);

    // back: motes then far petals
    for (const m of motes) {
      const a = m.a * (.55 + .45 * Math.sin(time * m.f + m.ph));
      drawGlow(bctx, m.sprite, m.x, m.y, m.r * 7, a);
    }
    for (const p of petals) if (p.depth < .55) drawPetal(bctx, p);
    // front: near petals, dots, sparkles
    for (const p of petals) if (p.depth >= .55) drawPetal(fctx, p);
    fctx.globalCompositeOperation = 'lighter';
    for (const d of dots) {
      const t = d.age / d.life;
      drawGlow(fctx, d.sprite, d.x, d.y, d.size * (1 - t * .5), d.a * (1 - t * t));
    }
    for (const s of sparkles) drawSparkle(fctx, s);
    fctx.globalCompositeOperation = 'source-over';
    fctx.globalAlpha = 1;
    bctx.globalAlpha = 1;
  }

  // ---- lifecycle ---------------------------------------------------------
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, cfg.dprCap);
    for (const c of [back, front]) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
    }
    while (motes.length < cfg.motes) spawnMote();
    while (motes.length > cfg.motes) motes.pop();
  }
  function start() {
    if (running || reduced) return;
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }
  function init() {
    buildSprites();
    resize();
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 120); });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    // seed a few petals mid-air so the opening isn't empty for the first seconds
    if (!reduced) for (let i = 0; i < cfg.petalsOpening; i++) spawnPetal({ y: rand(-40, H * .9) });
    start();
  }

  FFY.fx = {
    init, start, stop,
    // median frame time (ms) measured during the opening screen; 0 if not enough samples
    frameMedian() {
      const s = frameStats.samples;
      if (s.length < 30) return 0;
      const sorted = s.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    },
    setTier() { applyTier(); resize(); },
    setMode: (m) => { mode = m; },
    setFocus: (f) => { focus = f; },
    setFocusHover: (b) => { focusHover = !!b; },
    setEmitters: (list) => { emitters = list || []; },
    burst, petalBurst, sparkleAt, petalFrom, trail,
    get reduced() { return reduced; },
  };
})();
