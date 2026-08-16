# Flowers for You 🌷

A premium, romantic, interactive "digital bouquet" — vanilla **HTML + CSS + JS + SVG**, no build step, no dependencies.

Open `index.html` directly in a browser, or serve the folder with any static server.

## Experience

1. **Opening** — glass card with a magnetic, glowing "Open the Bouquet" button (breathing glow, rotating light ring, light sweep, card tilt, petals + sparkles around the button on hover).
2. **Cinematic transition** — clicking starts the music (`countdown.mp3`) and fires button glow → dim → radial light flash → particle burst → petals fanning upward → camera zoom-out of the card. A **10-second countdown** then takes over (numerals breathe in once per second, a ring drains, the glow pulses), and when it reaches zero a burst fires and the garden grows.
3. **Growth** — ~85 procedural SVG flowers grow from the bottom across three depth layers: each curved stem stretches up from the ground, leaves unfold as the stem passes them, a bud pops at the tip, then petals unfurl one by one from the centre outward, and finally each stem sways in the wind. Everything (delay, height, size, curve, colours, petal jitter, sway timing, bloom order) is randomized.
4. **Final message** blurs/fades/rises into place; the garden stays alive (sway, hover reactions, late-blooming flowers, petals shed from flower heads, sparkles).
5. **Bloom Again** folds the flowers back into the ground and grows a brand-new arrangement — no page reload.

## Structure

```
index.html
countdown.mp3   music that starts on "Open the Bouquet"
css/
  base.css      tokens, animated background (gradient, light blobs, rays, grain, vignette), canvases, cursor, tooltip
  opening.css   opening card + button + cinematic exit
  garden.css    flower structure & staged growth keyframes, hover, message, Bloom Again, responsive, reduced motion
js/
  utils.js      helpers, device tier, shared SVG <defs> gradient registry
  fx.js         canvas effects: floating petals (two depth canvases), light motes, sparkles, bursts, cursor trail
  cursor.js     custom cursor (fine pointers only)
  flowers.js    procedural flower builders (rose, tulip, daisy, lily, cosmos, poppy, blossom, lavender,
                baby's breath, eucalyptus, foliage) + stem/leaf geometry → one DOM node per flower
  garden.js     arrangement (depth layers, bouquet dome), growth orchestration, hover/tilt/neighbours,
                parallax, petal emitters, leave → rebuild
  opening.js    magnetic button, card tilt, hover atmosphere, click transition
  main.js       state machine: opening → transition → garden → resetting
```

## Hooks

- `document.addEventListener('bouquet:open', e => …)` — fires on the click (`e.detail` has the click position); `bouquet:bloom` fires when the countdown ends and growth begins; `bouquet:reset` fires on Bloom Again.
- Music: `countdown.mp3` in the project root is played by the `<audio id="music">` element (swap the file to change the track); a mute toggle sits bottom-left. Change `COUNTDOWN_FROM` in `js/main.js` to alter the countdown length.
- `window.FlowersForYou.open()`, `.bloomAgain()`, `.onOpen(cb)`, `.state`.

## Notes

- Respects `prefers-reduced-motion` (instant growth, no perpetual motion, no particle loop).
- Custom cursor and tooltip are only enabled for fine pointers; touch taps make flowers react.
- Flower/particle counts scale with viewport size and device capability (`FFY.util.tier`: `high` / `mid` / `lite`). The tier is calibrated at runtime (garden build time + opening-screen frame times) and can be forced with `?tier=lite|mid|high`.
- Performance architecture: petal/leaf/sepal placement is baked into path geometry (no per-element transforms once bloomed), blooms animate with the individual `scale`/`rotate` properties (main-thread SVG repaints, no per-petal compositor layers), stems grow with one composited `scaleY`, growth is gated per flower (`is-sprouting` / `is-blooming`), and finished animations are "baked" (`.done`) so the living garden costs only one composited layer per swaying stem. Small background/filler flowers animate petals per ring instead of one by one.
