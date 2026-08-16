/* Flowers for You — procedural SVG flowers.
   Every flower = curved stem (grows via a composited scaleY), leaves along the stem,
   and a head built from individually-animated petals.

   Rendering strategy (matters for performance): every petal / leaf / sepal is placed by
   baking its placement transform into the path geometry, so a finished flower carries
   NO per-element transforms (one paint chunk per SVG instead of hundreds). Blooms then
   animate with the individual `scale` / `rotate` properties about the flower centre —
   those run on the main thread as tiny SVG repaints instead of promoting ~1,500 petals
   to compositor layers during growth. Head builders work in unit coordinates
   (head radius ≈ 1) and are scaled by `s`. */
(function () {
  'use strict';
  const FFY = (window.FFY = window.FFY || {});
  const U = FFY.util;
  const D = FFY.defs;
  const { rand, randInt, pick, clamp, mix, lighten, darken, rgba, fmt: f } = U;

  // ---- 2D affine helpers: m = [a, b, c, d, e, f] (x' = ax + cy + e, y' = bx + dy + f) ------
  const I = [1, 0, 0, 1, 0, 0];
  const rot = (deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
  const tr = (x, y) => [1, 0, 0, 1, x, y];
  const mul = (m, n) => [       // m ∘ n : apply n first, then m
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const chain = (...ms) => ms.reduce((acc, m) => mul(acc, m), I);
  const ap = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  // command list → path data with the transform baked in
  const toD = (cmds, m = I) => cmds.map((c) => (typeof c === 'string' ? c : ap(m, c).map(f).join(','))).join(' ');

  // ---- outlines as command lists (base at 0,0 → tip at 0,-L) --------------------------------
  const shapes = {
    round: (L, w) => ['M', [0, 0], 'C', [-w * .9, -L * .15], [-w * 1.15, -L * .8], [-w * .35, -L], 'C', [-w * .1, -L * 1.04], [w * .1, -L * 1.04], [w * .35, -L], 'C', [w * 1.15, -L * .8], [w * .9, -L * .15], [0, 0], 'Z'],
    oval: (L, w) => ['M', [0, 0], 'C', [-w, -L * .25], [-w, -L * .8], [0, -L], 'C', [w, -L * .8], [w, -L * .25], [0, 0], 'Z'],
    lance: (L, w) => ['M', [0, 0], 'C', [-w * 1.1, -L * .3], [-w * .75, -L * .78], [0, -L], 'C', [w * .75, -L * .78], [w * 1.1, -L * .3], [0, 0], 'Z'],
    cup: (L, w) => ['M', [0, 0], 'C', [-w * 1.25, -L * .25], [-w * 1.15, -L * .8], [-w * .55, -L], 'C', [-w * .2, -L * .92], [w * .2, -L * .92], [w * .55, -L], 'C', [w * 1.15, -L * .8], [w * 1.25, -L * .25], [0, 0], 'Z'],
    heart: (L, w) => ['M', [0, 0], 'C', [-w * .95, -L * .2], [-w * 1.15, -L * .78], [-w * .45, -L], 'C', [-w * .2, -L * 1.06], [-w * .04, -L * .95], [0, -L * .88], 'C', [w * .04, -L * .95], [w * .2, -L * 1.06], [w * .45, -L], 'C', [w * 1.15, -L * .78], [w * .95, -L * .2], [0, 0], 'Z'],
    cosmos: (L, w) => ['M', [0, 0], 'C', [-w * .8, -L * .2], [-w * 1.15, -L * .7], [-w * .9, -L * .92], 'L', [-w * .55, -L * .94], 'L', [-w * .3, -L], 'L', [0, -L * .95], 'L', [w * .3, -L], 'L', [w * .55, -L * .94], 'L', [w * .9, -L * .92], 'C', [w * 1.15, -L * .7], [w * .8, -L * .2], [0, 0], 'Z'],
    leaf: (L, w) => ['M', [0, 0], 'C', [-w * 1.1, -L * .3], [-w * .9, -L * .75], [0, -L], 'C', [w * .9, -L * .75], [w * 1.1, -L * .3], [0, 0], 'Z'],
    roundleaf: (L, w) => ['M', [0, 0], 'C', [-w * 1.3, -L * .12], [-w * 1.3, -L * .9], [0, -L], 'C', [w * 1.3, -L * .9], [w * 1.3, -L * .12], [0, 0], 'Z'],
  };
  const K = .5523;
  const ellipse = (rx, ry, cx = 0, cy = 0) => ['M', [cx + rx, cy], 'C', [cx + rx, cy + K * ry], [cx + K * rx, cy + ry], [cx, cy + ry], 'C', [cx - K * rx, cy + ry], [cx - rx, cy + K * ry], [cx - rx, cy], 'C', [cx - rx, cy - K * ry], [cx - K * rx, cy - ry], [cx, cy - ry], 'C', [cx + K * rx, cy - ry], [cx + rx, cy - K * ry], [cx + rx, cy], 'Z'];

  const shade = (c, t) => (t >= 0 ? mix(c, darken(c, .55), t) : lighten(c, -t));

  // ---- primitives ------------------------------------------------------------------------
  // A petal placed at `angle` (deg, clockwise from up), `offset` from the centre, plus an
  // optional (tx,ty) shift — all baked into the geometry. `circles` ride along.
  function petalInner(o) {
    if (o.raw) return o.raw;
    const m = chain(tr(o.tx || 0, o.ty || 0), rot(o.angle || 0), tr(0, -(o.offset || 0)));
    const d = toD(shapes[o.shape](o.L, o.w), m);
    let extra = '';
    for (const c of o.circles || []) {
      const p = ap(m, [c.cx || 0, c.cy || 0]);
      extra += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(c.r)}" fill="${c.fill}"${c.opacity !== undefined ? ` opacity="${c.opacity}"` : ''}/>`;
    }
    return `<path d="${d}" fill="${o.fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${f(o.strokeW || .018)}" stroke-linejoin="round"` : ''}/>${extra}`;
  }
  const petalStyle = (o) => `--pf:${f(o.pf || 0)};--in:${f(o.inRot || 0)}deg;--s0:${f(o.s0 !== undefined ? o.s0 : .15)}`;
  // `simple` (small background/filler flowers, low-power devices): petals of the same
  // ring share one animated group instead of animating one by one — far fewer
  // simultaneous animations, and invisible at those sizes.
  function petals(list, simple) {
    if (!simple) return list.map((o) => `<g class="petal" style="${petalStyle(o)}">${petalInner(o)}</g>`).join('');
    const groups = new Map();
    for (const o of list) { const k = o.group || 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
    let html = '';
    for (const g of groups.values()) {
      const first = g[0];
      html += `<g class="petal" style="${petalStyle({ pf: Math.min(...g.map((o) => o.pf || 0)), inRot: first.inRot, s0: first.s0 })}">${g.map(petalInner).join('')}</g>`;
    }
    return html;
  }
  const glowCircle = (color, r = 1.4, cy = 0, a = .6) => `<circle class="hglow" cy="${f(cy)}" r="${f(r)}" fill="url(#${D.glow(color, a)})"/>`;
  const shineCircle = (r = 1, cy = 0) => `<circle class="shine" cy="${f(cy)}" r="${f(r)}" fill="url(#${D.shine()})"/>`;
  function sepals(n, len, color, r0 = .08, w = .17) {
    let s = '';
    const a0 = rand(360);
    const fill = `url(#${D.leaf(color)})`;
    for (let i = 0; i < n; i++) {
      s += `<path d="${toD(shapes.lance(len * rand(.9, 1.1), w), chain(rot(a0 + i * 360 / n + rand(-6, 6)), tr(0, -r0)))}" fill="${fill}"/>`;
    }
    return `<g class="calyx">${s}</g>`;
  }
  const dottedRing = (r, color, w = .05, gap = .11) => `<circle r="${f(r)}" fill="none" stroke="${color}" stroke-width="${f(w)}" stroke-dasharray="0 ${f(gap)}" stroke-linecap="round"/>`;

  // ---- head builders (unit coordinates, y up = negative) ---------------------------------
  function rose(pal, simple) {
    const { base, inner } = pal;
    const list = [];
    const rings = [
      { n: 8, off: .46, L: .64, w: .37, tone: 0 },
      { n: 7, off: .29, L: .53, w: .33, tone: .28 },
      { n: 6, off: .15, L: .42, w: .27, tone: .55 },
      { n: 5, off: .05, L: .30, w: .19, tone: .8 },
    ];
    const total = 26;
    let order = 0, html = glowCircle(base, 1.5) + sepals(5, .95, pal.leaf);
    {
      // closed bud (a tight rosette) that the petals unfurl from
      const g1 = `url(#${D.petal(mix(base, inner, .55), .3, .3)})`, g2 = `url(#${D.petal(mix(base, inner, .8), .25, .35)})`;
      const st = rgba(darken(inner, .5), .25);
      let bud = '';
      for (let i = 0; i < 5; i++) bud += `<path d="${toD(shapes.round(.4, .27), chain(rot(i * 72 + 20), tr(0, -.03)))}" fill="${i % 2 ? g2 : g1}" stroke="${st}" stroke-width=".016"/>`;
      html += `<g class="budcap">${bud}<circle r=".09" fill="${rgba(darken(inner, .5), .5)}"/></g>`;
    }
    const stroke = rgba(darken(inner, .45), .22);
    rings.forEach((rg, ri) => {
      const a0 = rand(360);
      for (let i = 0; i < rg.n; i++) {
        list.push({
          shape: 'round', L: rg.L * rand(.93, 1.07), w: rg.w * rand(.92, 1.08),
          angle: a0 + i * 360 / rg.n + rand(-6, 6), offset: rg.off,
          fill: `url(#${D.petal(mix(base, inner, rg.tone), .38, .3)})`, stroke,
          pf: (order / total) * .55, inRot: -30, s0: .16, group: ri,
        });
        order++;
      }
    });
    html += petals(list, simple);
    html += `<circle r=".07" fill="${rgba(darken(inner, .5), .55)}"/>` + shineCircle(1.05);
    return { html, box: { x: -1.25, y: -1.25, w: 2.5, h: 2.5 } };
  }

  function tulip(pal) {
    const b = pal.base;
    const list = [
      { angle: 0, L: 1.0, w: .40, tone: .2, inRot: 0, order: 0 },
      { angle: -17, L: .95, w: .38, tone: .06, inRot: 26, order: 1 },
      { angle: 17, L: .95, w: .38, tone: 0, inRot: -26, order: 2 },
      { angle: 1.5, L: .84, w: .36, tone: -.16, inRot: 0, order: 3 },
    ];
    const leafFill = `url(#${D.leaf(pal.leaf)})`;
    let html = glowCircle(b, 1.2, -.5) + `<circle r=".13" cy=".02" fill="${leafFill}"/>`;
    html += `<g class="calyx"><path d="${toD(shapes.lance(.55, .13), rot(-32))}" fill="${leafFill}"/><path d="${toD(shapes.lance(.55, .13), rot(32))}" fill="${leafFill}"/></g>`;
    html += petals(list.map((p) => ({
      shape: 'cup', L: p.L * rand(.97, 1.03), w: p.w, angle: p.angle + rand(-2, 2),
      fill: `url(#${D.petal(shade(b, p.tone), .34, .28)})`, stroke: rgba(darken(b, .5), .16),
      pf: p.order * .11, inRot: p.inRot, s0: .55,
    })), false);
    html += shineCircle(.85, -.5);
    return { html, box: { x: -.9, y: -1.25, w: 1.8, h: 1.45 } };
  }

  function daisy(pal, simple) {
    const n = 16, list = [];
    let html = glowCircle('#fff2f4', 1.4, 0, .5) + sepals(7, .55, pal.leaf, .05, .12);
    const a0 = rand(360);
    for (let i = 0; i < n; i++) {
      list.push({
        shape: 'oval', L: rand(.9, 1.06), w: .135, angle: a0 + i * 360 / n + rand(-4, 4), offset: .12,
        fill: `url(#${D.petal(pal.base, .1, .12)})`, stroke: 'rgba(225,180,195,.4)', strokeW: .015,
        pf: (i / n) * .5, inRot: i % 2 ? 16 : -16, s0: .12, group: i % 2,
      });
    }
    html += petals(list, simple);
    html += `<g class="center"><circle r=".3" fill="url(#${D.disc('#f0b23a', .35, .45)})"/>${dottedRing(.2, '#c9821a', .06, .115)}${dottedRing(.1, '#a96412', .05, .1)}</g>` + shineCircle(1.05);
    return { html, box: { x: -1.2, y: -1.2, w: 2.4, h: 2.4 } };
  }

  function lily(pal, simple) {
    const b = pal.base, list = [];
    let html = glowCircle(b, 1.5) + sepals(3, .5, pal.leaf, .05, .12);
    const a0 = rand(360);
    for (let i = 0; i < 6; i++) {
      const back = i % 2 === 0;
      const circles = [];
      const dots = randInt(3, 5);
      for (let k = 0; k < dots; k++) circles.push({ cx: rand(-.07, .07), cy: -rand(.22, .58), r: rand(.016, .028), fill: darken(b, .5), opacity: .7 });
      list.push({
        shape: 'lance', L: back ? .94 : 1.0, w: back ? .27 : .3, angle: a0 + i * 60 + rand(-3, 3), offset: .04,
        fill: `url(#${D.petal(shade(b, back ? .14 : 0), .5, .25)})`, stroke: rgba(darken(b, .5), .18),
        pf: ((back ? i / 2 : 3 + i / 2) / 6) * .5, inRot: back ? -12 : 12, s0: .12, circles, group: back ? 0 : 1,
      });
    }
    html += petals(list, simple);
    html += `<circle r=".16" fill="url(#${D.disc(mix(b, '#e8f0a0', .55), .3, .3)})"/>`;
    let st = '';
    for (let k = 0; k < 6; k++) {
      const angDeg = -90 + (k - 2.5) * 24 + rand(-6, 6), ang = angDeg * Math.PI / 180, len = rand(.42, .6);
      const x2 = Math.cos(ang) * len, y2 = Math.sin(ang) * len;
      st += `<line x2="${f(x2)}" y2="${f(y2)}" stroke="#f6e7d0" stroke-width=".03" stroke-linecap="round"/>` +
        `<path d="${toD(ellipse(.065, .036), chain(tr(x2, y2), rot(angDeg)))}" fill="#8b3a2a"/>`;
    }
    html += `<g class="stamens">${st}</g>` + shineCircle(1.1);
    return { html, box: { x: -1.25, y: -1.25, w: 2.5, h: 2.5 } };
  }

  function cosmos(pal, simple) {
    const b = pal.base, list = [];
    let html = glowCircle(b, 1.4) + sepals(8, .5, pal.leaf, .06, .1);
    const a0 = rand(360), n = 8;
    for (let i = 0; i < n; i++) {
      list.push({
        shape: 'cosmos', L: rand(.94, 1.04), w: .42 * rand(.95, 1.05), angle: a0 + i * 45 + rand(-4, 4), offset: .13,
        fill: `url(#${D.petal(b, .35, .22)})`, stroke: rgba(darken(b, .5), .2),
        pf: (i / n) * .5, inRot: -20, s0: .15, group: i % 2,
      });
    }
    html += petals(list, simple);
    html += `<g class="center"><circle r=".23" fill="url(#${D.disc('#f2bb44', .35, .45)})"/>${dottedRing(.15, '#c8811e', .05, .1)}</g>` + shineCircle(1.05);
    return { html, box: { x: -1.2, y: -1.2, w: 2.4, h: 2.4 } };
  }

  function poppy(pal, simple) {
    const b = pal.base, list = [];
    let html = glowCircle(b, 1.4) + sepals(4, .5, pal.leaf, .05, .12);
    const a0 = rand(360);
    for (let i = 0; i < 6; i++) {
      list.push({
        shape: 'round', L: rand(.9, 1.0), w: .6, angle: a0 + i * 60 + rand(-5, 5), offset: .06,
        fill: `url(#${D.petal(shade(b, i % 2 ? .14 : -.05), .3, .3)})`, stroke: rgba(darken(b, .55), .18),
        pf: (i / 6) * .5, inRot: i % 2 ? 26 : -26, s0: .15, group: i % 2,
      });
    }
    html += petals(list, simple);
    html += `<g class="center"><circle r=".27" fill="url(#${D.disc('#3a1230', .2, .5)})"/>${dottedRing(.2, '#f0cf7a', .05, .12)}<circle r=".08" fill="#2a0c22"/></g>` + shineCircle(1.05);
    return { html, box: { x: -1.2, y: -1.2, w: 2.4, h: 2.4 } };
  }

  function blossom(pal, simple) {
    const b = pal.base, list = [];
    let html = glowCircle(b, 1.35, 0, .55) + sepals(5, .4, pal.leaf, .04, .1);
    const a0 = rand(360);
    for (let i = 0; i < 5; i++) {
      list.push({
        shape: 'heart', L: rand(.92, 1.04), w: .5, angle: a0 + i * 72 + rand(-4, 4), offset: .1,
        fill: `url(#${D.petal(b, .3, .16)})`, stroke: rgba(darken(b, .45), .18),
        pf: (i / 5) * .5, inRot: -22, s0: .12, group: 0,
      });
    }
    html += petals(list, simple);
    let st = '';
    for (let k = 0; k < 7; k++) {
      const ang = rand(0, U.TAU), len = rand(.22, .36);
      st += `<line x2="${f(Math.cos(ang) * len)}" y2="${f(Math.sin(ang) * len)}" stroke="#f3d27a" stroke-width=".035" stroke-linecap="round"/><circle cx="${f(Math.cos(ang) * len)}" cy="${f(Math.sin(ang) * len)}" r=".045" fill="#e8ad46"/>`;
    }
    html += `<g class="stamens">${st}<circle r=".1" fill="url(#${D.disc('#f5d98a', .3, .3)})"/></g>` + shineCircle(1);
    return { html, box: { x: -1.15, y: -1.15, w: 2.3, h: 2.3 } };
  }

  function lavender(pal, simple) {
    const b = pal.base, list = [];
    let html = glowCircle(b, 1.0, -.65, .55);
    const n = 11;
    for (let k = 0; k < n; k++) {
      const y = -k * .118, x = (k % 2 ? 1 : -1) * .115 * (1 - k / 18);
      const fill = `url(#${D.petal(shade(b, (k % 3) * .09 - .05), .3, .28)})`;
      // an ellipse floret, tilted alternately, placed up the spike
      const d = toD(ellipse(.125, .165), chain(tr(x, y), rot((k % 2 ? 1 : -1) * 22)));
      list.push({ raw: `<path d="${d}" fill="${fill}"/>`, pf: (k / n) * .55, inRot: 0, s0: .05, group: Math.floor(k / 4) });
    }
    list.push({ raw: `<path d="${toD(shapes.lance(.3, .1), tr(0, -n * .118 - .02))}" fill="url(#${D.petal(shade(b, .1), .3, .3)})"/>`, pf: .6, inRot: 0, s0: .05, group: 2 });
    html += petals(list, simple);
    return { html, box: { x: -.5, y: -1.7, w: 1, h: 1.85 } };
  }

  function babysbreath(pal, simple) {
    let html = glowCircle('#fff4f6', 1.05, -.2, .45);
    const n = randInt(5, 6), list = [];
    const white = `url(#${D.disc('#fff6f8', 0, .14)})`;
    for (let k = 0; k < n; k++) {
      const ang = (-90 + rand(-72, 72)) * Math.PI / 180, len = rand(.5, .95);
      const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
      html += `<line x2="${f(ex)}" y2="${f(ey)}" stroke="${pal.stem}" stroke-width=".035" stroke-linecap="round"/>`;
      const c = (cx, cy, r, fill) => `<circle cx="${f(ex + cx)}" cy="${f(ey + cy)}" r="${r}" fill="${fill}"/>`;
      list.push({ raw: c(0, -.07, '.1', white) + c(-.085, .05, '.095', white) + c(.085, .05, '.095', white) +
        c(0, -.07, '.025', '#f0c9d0') + c(-.085, .05, '.022', '#f0c9d0') + c(.085, .05, '.022', '#f0c9d0'), pf: (k / n) * .5, inRot: 0, s0: .05, group: 0 });
    }
    html += petals(list, simple);
    return { html, box: { x: -1.1, y: -1.15, w: 2.2, h: 1.6 } };
  }

  function eucalyptus(pal) {
    let html = '';
    html += petals([-1, 1].map((side) => ({ shape: 'roundleaf', L: .6, w: .32, angle: side * 28, fill: `url(#${D.leaf(pal.leaf)})`, stroke: rgba(darken(pal.leaf, .4), .3), strokeW: .015, pf: .1, inRot: -side * 30, s0: .1 })), false);
    return { html, box: { x: -.7, y: -.75, w: 1.4, h: .9 } };
  }

  // ---- palettes ----------------------------------------------------------
  const GREENS = ['#4c7f52', '#3f6f4a', '#5c8c5a', '#456f47', '#6a9468', '#3b664a'];
  const SAGE = ['#7d9d7f', '#6f8f74', '#8aa88a', '#5f7f68'];
  const withInner = (list) => list.map((c) => ({ base: c, inner: mix(c, '#7a1a44', .38) }));
  const P = {
    rose: withInner(['#c8244f', '#f4a7b9', '#f27b74', '#f6dcc4', '#e0407a', '#f8b195', '#d98ab5', '#ff8fa8']),
    tulip: withInner(['#f07d9f', '#f4826c', '#c58ad6', '#f7e6d0', '#d63d5c', '#f7c78b', '#ff9bb5']),
    daisy: withInner(['#fbf7f2', '#fdf3ee', '#f8f0f6']),
    lily: withInner(['#f7c9d6', '#f6b48c', '#e56a94', '#fbe7ea', '#f2a4bd']),
    cosmos: withInner(['#a97ad4', '#e35d9c', '#f3a2c1', '#f8b8a0', '#f6eef2', '#c98be0']),
    poppy: withInner(['#e8543f', '#f07f57', '#d94a5b', '#f26b7a']),
    blossom: withInner(['#f9c9d6', '#f5b7c8', '#fde3ea', '#f7c4dd']),
    lavender: withInner(['#a888dd', '#8f6fd0', '#c3a6ec', '#9d7fd8']),
    babysbreath: withInner(['#fff5f7']),
    eucalyptus: withInner(['#7d9d7f']),
    foliage: withInner(['#4c7f52']),
  };

  // ---- type registry -----------------------------------------------------
  const TYPES = {
    rose: { name: 'Rose', phrase: 'for love', size: 1.0, build: rose, tilt: .35, leaves: { n: [2, 3], L: [.8, 1.1], w: .42 } },
    tulip: { name: 'Tulip', phrase: 'for you', size: .92, build: tulip, tilt: .85, leaves: { n: [1, 2], L: [1.6, 2.3], w: .2, kind: 'lance', t: [.12, .42], spread: [18, 32] } },
    daisy: { name: 'Daisy', phrase: 'for joy', size: .82, build: daisy, tilt: .3, leaves: { n: [2, 3], L: [.7, .95], w: .38 } },
    lily: { name: 'Lily', phrase: 'for grace', size: 1.05, build: lily, tilt: .5, leaves: { n: [2, 3], L: [1.1, 1.5], w: .24, kind: 'lance', spread: [30, 48] } },
    cosmos: { name: 'Cosmos', phrase: 'for harmony', size: .82, build: cosmos, tilt: .35, leaves: { n: [2, 3], L: [.6, .9], w: .3, kind: 'lance', spread: [35, 55] } },
    poppy: { name: 'Poppy', phrase: 'for dreams', size: .9, build: poppy, tilt: .4, leaves: { n: [2, 2], L: [.8, 1.1], w: .38 } },
    blossom: { name: 'Blossom', phrase: 'for new beginnings', size: .55, build: blossom, tilt: .3, leaves: { n: [1, 2], L: [.9, 1.3], w: .4 } },
    lavender: { name: 'Lavender', phrase: 'for calm', size: .68, build: lavender, tilt: .9, leaves: { n: [2, 3], L: [1.0, 1.4], w: .16, kind: 'lance', spread: [24, 40] } },
    babysbreath: { name: "Baby's breath", phrase: 'for always', size: .75, build: babysbreath, tilt: .5, leaves: { n: [1, 2], L: [.6, .9], w: .22, kind: 'lance', spread: [30, 45] } },
    eucalyptus: { name: 'Eucalyptus', phrase: 'for peace', size: .55, build: eucalyptus, tilt: .9, leaves: { n: [4, 6], L: [.9, 1.3], w: .5, kind: 'roundleaf', pairs: true, t: [.25, .92], spread: [42, 60], sage: true } },
    foliage: { name: 'Greenery', phrase: 'for growth', size: .8, build: null, tilt: 0, leaves: { n: [5, 7], L: [1.4, 2.2], w: .38, t: [.12, .96], spread: [40, 70] } },
  };

  // ---- flower factory ----------------------------------------------------
  // spec: { type, s (head unit px), Hs (stem height px), x (% of width), layer,
  //         d, sd, bd, st, sa, nt, na, z, ld2, base, mute, nod }
  function create(spec) {
    const T = TYPES[spec.type];
    const s = spec.s;
    const Hs = spec.Hs;
    const src = pick(P[spec.type]);
    const mute = spec.mute || 0;
    const FOG = '#5a3052';
    const pal = {
      base: mute ? mix(src.base, FOG, mute) : src.base,
      inner: mute ? mix(src.inner, FOG, mute) : src.inner,
    };
    const leafSrc = T.leaves.sage ? pick(SAGE) : pick(GREENS);
    pal.leaf = mute ? mix(leafSrc, FOG, mute * .9) : leafSrc;
    pal.stem = mix(pal.leaf, mute ? FOG : '#2f4f38', mute ? .2 : rand(.1, .4));

    // stem: cubic bezier from (0,0) up to (tipX,-Hs)
    const tipX = rand(-1, 1) * Hs * (T.curve || .1);
    const c1x = rand(-1, 1) * Hs * .05;
    const c2x = tipX + rand(-1, 1) * Hs * .1;
    const P0 = [0, 0], P1 = [c1x, -Hs * .33], P2 = [c2x, -Hs * .66], P3 = [tipX, -Hs];
    const bez = (t) => {
      const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      return [a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]];
    };
    const tangentDeg = (t) => {
      const mt = 1 - t;
      const dx = 3 * mt * mt * (P1[0] - P0[0]) + 6 * mt * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
      const dy = 3 * mt * mt * (P1[1] - P0[1]) + 6 * mt * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
      return Math.atan2(dx, -dy) * 180 / Math.PI;      // 0 = straight up, + = leaning right
    };

    const head = T.build ? T.build(pal, !!spec.simple) : null;
    const hs = head ? s * Math.max(head.box.w, head.box.h) / 2 : s * .4;
    const lc = T.leaves;
    const maxLeaf = lc.L[1] * s;
    const E = Math.ceil(Math.abs(tipX) + Math.max(hs * 1.35, maxLeaf) + 8);
    const topPad = Math.ceil(hs * 1.7 + 6);
    const Hb = Math.ceil(Hs + topPad);
    const sw = clamp(s * .12, 1.8, 5);

    // stem markup (the whole svg is scaled up from the base while growing)
    const dStem = `M0,0C${f(P1[0])},${f(P1[1])} ${f(P2[0])},${f(P2[1])} ${f(P3[0])},${f(P3[1])}`;
    const stemHtml = `<path class="stem" d="${dStem}" stroke="${pal.stem}" stroke-width="${f(sw)}"/>` +
      `<path class="stem" d="${dStem}" stroke="rgba(255,255,255,.16)" stroke-width="${f(sw * .32)}" transform="translate(${f(-sw * .22)},0)"/>`;

    // leaves — placement baked into geometry; unfold pivots on the attachment point (--ox/--oy)
    let leavesHtml = '';
    const nL = randInt(lc.n[0], lc.n[1]);
    const tRange = lc.t || [.3, .8];
    const spread = lc.spread || [46, 66];
    const kind = lc.kind || 'leaf';
    let side = Math.random() < .5 ? -1 : 1;
    const leafColor = shade(pal.leaf, rand(-.08, .12));
    const leafGrad = D.leaf(leafColor);
    const leafStroke = rgba(darken(leafColor, .45), .28);
    const addLeaf = (t, sd) => {
      const [px, py] = bez(t);
      const L = rand(lc.L[0], lc.L[1]) * s;
      const w = L * lc.w * rand(.9, 1.1);
      const ang = tangentDeg(t) + sd * rand(spread[0], spread[1]);
      const lt = clamp(t * .92 + rand(-.03, .03), .12, .9);
      const m = chain(tr(px, py), rot(ang));
      const rib = kind === 'roundleaf' ? '' :
        `<path d="${toD(['M', [0, -L * .06], 'L', [0, -L * .88]], m)}" stroke="rgba(255,255,255,.22)" stroke-width="${f(Math.max(.8, sw * .28))}" stroke-linecap="round" fill="none"/>`;
      leavesHtml += `<g class="leaf" style="--ox:${f(px)}px;--oy:${f(py)}px;--lt:${f(lt)};--fold:${f(-sd * rand(35, 55))}deg;--ld:${f(rand(.75, 1.15))}s">` +
        `<path d="${toD(shapes[kind](L, w), m)}" fill="url(#${leafGrad})" stroke="${leafStroke}" stroke-width="${f(sw * .25)}" stroke-linejoin="round"/>${rib}</g>`;
    };
    for (let i = 0; i < nL; i++) {
      const t = nL === 1 ? rand(tRange[0], tRange[1]) : U.lerp(tRange[0], tRange[1], i / (nL - 1)) + rand(-.04, .04);
      if (lc.pairs) { addLeaf(t, -1); addLeaf(t + rand(-.02, .02), 1); }
      else { addLeaf(clamp(t, .08, .95), side); side = -side; }
    }

    // head markup (positioned at the stem tip, tilted with the stem)
    let headHtml = '';
    if (head) {
      const tilt = clamp(tangentDeg(1) * (T.tilt || 0) + rand(-4, 4), -24, 24);
      const bx = head.box.x * s, by = head.box.y * s, bw = head.box.w * s, bh = head.box.h * s;
      headHtml = `<div class="head" style="left:${f(E + tipX + bx)}px;top:${f(topPad + by)}px;width:${f(bw)}px;height:${f(bh)}px;--ox:${f(-bx)}px;--oy:${f(-by)}px">` +
        `<div class="head-nod"><div class="head-pop">` +
        `<svg class="head-svg" viewBox="${f(bx)} ${f(by)} ${f(bw)} ${f(bh)}" width="${f(bw)}" height="${f(bh)}"><g class="hit" transform="rotate(${f(tilt)}) scale(${f(s)})">${head.html}</g></svg>` +
        `</div></div></div>`;
    }

    const fw = document.createElement('div');
    fw.className = `fw fw--${spec.type} fw--${spec.layer}${spec.nod ? ' fw--nod' : ''}`;
    fw.style.cssText =
      `left:${f(spec.x)}%;width:${2 * E}px;height:${Hb}px;margin-left:${-E}px;` +
      `--d:${f(spec.d)}s;--sd:${f(spec.sd)}s;--bd:${f(spec.bd)}s;--st:${f(spec.st)}s;--sa:${f(spec.sa)}deg;` +
      `--nt:${f(spec.nt)}s;--na:${f(spec.na)}deg;--z:${spec.z};` +
      `--ld2:${f(spec.ld2 || 0)}s;--base:${f(spec.base)}px`;
    const vb = `viewBox="${-E} ${-Hb} ${2 * E} ${Hb}" width="${2 * E}" height="${Hb}"`;
    fw.innerHTML =
      `<div class="fh"><div class="fs">` +
      `<svg class="stem-svg" ${vb}>${stemHtml}</svg>` +
      `<svg class="leaves-svg" ${vb}>${leavesHtml}</svg>` +
      headHtml +
      `</div></div>`;

    return {
      el: fw,
      type: spec.type,
      name: T.name,
      phrase: T.phrase,
      hasHead: !!head,
      x: spec.x,            // percent
      tipX, Hs, hs, s,
      base: spec.base,
      layer: spec.layer,
      color: pal.base,
      timing: { d: spec.d, sd: spec.sd, bd: spec.bd },
      end: spec.d + spec.sd + spec.bd * 1.2,
    };
  }

  FFY.flowers = { create, TYPES, shapes };
})();
