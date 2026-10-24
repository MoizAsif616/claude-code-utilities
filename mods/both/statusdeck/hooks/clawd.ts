import type { Mood } from '../types'

// Clawd, drawn in pixel units on a 48 by 19 track, one SVG per mood. The app
// runs the SMIL loops itself, so the mod redraws only when the mood changes.
// The body and eyes read on light and dark alike; the marks beside him (the
// "!", the sparkles, the "z") are mid tones that do too.

const BODY = '#D97757'
const EYE = '#141413'
const ALERT = '#D4A017'
const SPARKLE = '#639922'
const SLEEPY = '#888780'

// 24 px tall, the band's own line, at the track's 48:19 proportion.
export const CLAWD_WIDTH = 61
export const CLAWD_HEIGHT = 24

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 19" width="${CLAWD_WIDTH}" height="${CLAWD_HEIGHT}" shape-rendering="crispEdges">${body}</svg>`

const loop = (attr: string, values: string, dur: string, extra = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}" repeatCount="indefinite" ${extra}/>`

const move = (values: string, dur: string, extra = '') =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}" repeatCount="indefinite" additive="sum" ${extra}/>`

const rect = (x: number, y: number, w: number, h: number, fill: string, inner = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}">${inner}</rect>`

// Clawd's own box is x 0..16, y 3..15: a body 12 wide and 9 tall, arms at
// its sides, eyes three tall, and legs three long beneath.
const body = (armY = 6) =>
  rect(2, 3, 12, 9, BODY) + rect(0, armY, 2, 3, BODY) + rect(14, armY, 2, 3, BODY)

const legs = (anim = false) =>
  [3, 5, 10, 12]
    .map((x, i) => rect(x, 12, 1, 3, BODY, anim ? loop('height', i % 2 === 0 ? '3;1.5;3' : '1.5;3;1.5', '0.4s') : ''))
    .join('')

const blink = loop('height', '3;3;0.3;3', '4.5s', 'keyTimes="0;0.92;0.96;1"')
const openEyes = (inner = '') => rect(5, 6, 1, 3, EYE, inner) + rect(10, 6, 1, 3, EYE, inner)
const flatEyes = (y: number) => rect(4.5, y, 2, 0.7, EYE) + rect(9.5, y, 2, 0.7, EYE)

// Set down so his feet sit on the track's floor, with room above for a hop.
const at = (x: number, inner: string, motion = '') => `<g transform="translate(${x} 3)">${motion}${inner}</g>`

const MOODS: Record<Mood, { alt: string; source: string }> = {
  // Breathes and blinks; every so often shuffles a step to the side and back.
  idle: {
    alt: 'Clawd, idle',
    source: svg(
      at(
        4,
        `<g>${move('0 0;0 0.4;0 0', '3s')}${body()}${openEyes(blink)}</g>${legs()}`,
        move('0 0;0 0;4 0;4 0;0 0;0 0', '12s', 'keyTimes="0;0.55;0.6;0.85;0.9;1"'),
      ),
    ),
  },
  // Walks the track and back, legs going, body bobbing, eyes leading the way.
  working: {
    alt: 'Clawd, working',
    source: svg(
      at(
        0,
        `<g>${move('0 0;0 -0.6;0 0', '0.4s')}${body()}<g>${move('1 0;-1 0', '5s', 'calcMode="discrete" keyTimes="0;0.5"')}${openEyes()}</g></g>${legs(true)}`,
        move('0 0;32 0;0 0', '5s'),
      ),
    ),
  },
  // Hops in the middle with arms up and happy eyes; sparkles either side.
  done: {
    alt: 'Clawd, done',
    source: svg(
      at(
        16,
        `<g>${move('0 0;0 -3;0 0;0 0', '0.9s', 'keyTimes="0;0.18;0.36;1"')}${body(3)}<path d="M4.5 8.3 L5.5 6.8 L6.5 8.3 M9.5 8.3 L10.5 6.8 L11.5 8.3" stroke="${EYE}" stroke-width="0.8" fill="none"/>${legs()}</g>`,
        move('0 0;1.5 0;0 0;-1.5 0;0 0', '1.8s'),
      ) +
        `<path d="M8 5 l0.7 1.4 l1.4 0.7 l-1.4 0.7 l-0.7 1.4 l-0.7 -1.4 l-1.4 -0.7 l1.4 -0.7 z" fill="${SPARKLE}">${loop('opacity', '0;1;0', '0.9s')}</path>` +
        `<path d="M40 4 l0.7 1.4 l1.4 0.7 l-1.4 0.7 l-0.7 1.4 l-0.7 -1.4 l-1.4 -0.7 l1.4 -0.7 z" fill="${SPARKLE}">${loop('opacity', '1;0;1', '0.9s')}</path>`,
    ),
  },
  // Wiggles side to side and bounces, one arm waving, eyes wide; "!" beside him.
  attention: {
    alt: 'Clawd, needs you',
    source: svg(
      at(
        10,
        `<g>${move('0 0;0 -1;0 0', '0.5s')}${rect(2, 3, 12, 9, BODY)}${rect(0, 6, 2, 3, BODY)}${rect(14, 2, 2, 3, BODY, loop('y', '2;7;2', '0.6s'))}${rect(5, 5, 1, 4, EYE)}${rect(10, 5, 1, 4, EYE)}</g>${legs()}`,
        move('0 0;-1.5 0;0 0;1.5 0;0 0', '0.5s'),
      ) + `<g>${move('0 0;0 -1;0 0', '0.5s')}${rect(31, 4, 1.8, 8, ALERT)}${rect(31, 13.6, 1.8, 2, ALERT)}</g>`,
    ),
  },
  // Droops a step lower with flat eyes and lowered arms after a stop or error.
  stopped: {
    alt: 'Clawd, stopped',
    source: svg(
      at(
        4,
        `<g transform="translate(0 1)">${body(8)}${flatEyes(8)}</g>${legs()}`,
        move('0 0;-1 0;1 0;0 0;0 0', '1.6s', 'keyTimes="0;0.08;0.16;0.24;1"'),
      ),
    ),
  },
  // Eyes shut, slow breath, a "z" drifting up and fading beside him.
  sleep: {
    alt: 'Clawd, asleep',
    source: svg(
      at(4, `<g>${move('0 0;0 0.5;0 0', '5s')}${body(8)}${flatEyes(8.2)}</g>${legs()}`) +
        `<g>${move('0 0;2 -5', '3s')}<path d="M22 9 h3 l-3 3 h3" stroke="${SLEEPY}" stroke-width="0.8" fill="none">${loop('opacity', '1;0', '3s')}</path></g>`,
    ),
  },
}

export function clawd(mood: Mood): { alt: string; source: string } {
  return MOODS[mood]
}
