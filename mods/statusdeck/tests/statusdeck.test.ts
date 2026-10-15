import type { RenderElement, SessionContextBreakdown, SessionMessage } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const hint = (text: string) =>
  ({
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: text },
  }) as const

// The slot at the right of the footer row, where the pills and cache draw.
const STATUS = { component: 'SessionMode', props: { modes: [] } } as const

const SPINNER = {
  component: 'Spinner',
  props: { word: 'Sauteing', message: null, suffix: '…', mode: 'responding' },
} as const

test('the hint line holds the mode and the model and effort buttons; the right slot the cache', async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'statusdeck',
      surface,
      ...hint('⏵⏵ auto mode on (shift+tab to cycle) · ? for shortcuts · ctrl+x tab to focus'),
    })
    expect(await ui.find({ type: 'Text', text: /◎ Auto/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'model' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'effort' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /for shortcuts|shift\+tab|ctrl\+x|⇧⇥/ })).toBeUndefined()
    await ui.unmount()
    const status = await $.ui.mount({ plugin: 'statusdeck', surface, ...STATUS })
    expect(await status.find({ type: 'Text', text: /^❄$/ })).toBeDefined()
    expect(await status.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    await status.unmount()
  }
})

test('the band above the prompt draws nothing while idle', async ($, on) => {
  mock.clock(on)
  let passed = 0
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    passed++
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band') as RenderElement
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'statusdeck', surface, ...BAND })
    expect(await ui.find({ type: 'Button', key: 'model' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /❄|⚡/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  }
  expect(passed).toBe(2)
})

test('the spinner line shows the word and no time or token count', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...SPINNER })
  expect(await ui.find({ type: 'Text', text: /Sauteing/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tokens|\ds\b/ })).toBeUndefined()
  await ui.unmount()
})

test('while a turn runs, its time and live tokens follow the effort in the footer', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band') as RenderElement
  })
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...hint('? for shortcuts') })
  expect(await ui.find({ type: 'Text', text: /⏱|tok/ })).toBeUndefined()
  await $.turn.start({ text: 'hi', turnId: 't1' })
  // The ticker runs every 160 ms, so the last tick lands at 1:15.04.
  await clock.advance(75100)
  expect(await ui.find({ type: 'Text', text: /^⏱ 1:15$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^↓ 0 tok$/ })).toBeDefined()
  await ui.unmount()
  // Above the prompt nothing of the mod's draws: no progress bar, no counts.
  const band = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /⏱|tok|▰|▱/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await band.unmount()
})

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const NO_READING = { startedAt: 0, context: { window: 200000 }, rateLimits: [] }
const SETTINGS = { modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }

test('an effort the engine could not give at launch fills in on the next poll', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
  mock.store(on)
  let model = ''
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: SETTINGS }))
  on('session.usage', () => ({ value: NO_READING }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...hint('? for shortcuts') })
  expect(await ui.find({ type: 'Text', text: /^medium$/ })).toBeUndefined()

  model = 'claude-opus-5-5[1m]'
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /^medium$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  await ui.unmount()
})

test('a launch with no reading yet shows the last 5h and 7d figures', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
  mock.store(on, {
    limits: {
      fiveHour: { percent: 42, resetsAt: '2026-10-15T12:00:00Z' },
      week: { percent: 17, resetsAt: '2026-10-20T00:00:00Z' },
    },
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: SETTINGS }))
  on('session.usage', () => ({ value: NO_READING }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...STATUS })
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /17%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /–/ })).toBeDefined()
  await ui.unmount()
})

test('a usage op that fails at launch does not stop the effort label', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: SETTINGS }))
  on('session.usage', () => ({ deny: 'not ready' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...hint('? for shortcuts') })
  expect(await ui.find({ type: 'Text', text: /^medium$/ })).toBeDefined()
  await ui.unmount()
})

const SUMMARY: SessionMessage = { role: 'user', text: 'the summary', toolUses: [] }
const WARM_READING = { startedAt: 0, context: { window: 1000000, tokens: 300000, percent: 30 }, rateLimits: [] }

test('a compaction drops ctx to the recounted window and keeps the cache warm', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
  mock.store(on)
  let isCompacted = false
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: SETTINGS }))
  on('session.usage', (_$, e) =>
    isCompacted
      ? {
          value: {
            startedAt: 0,
            context: e.breakdown === undefined ? { window: 1000000 } : { window: 1000000, breakdown: { totalTokens: 43100 } as SessionContextBreakdown },
            rateLimits: [],
          },
        }
      : { value: WARM_READING },
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.compact', () => {
    isCompacted = true
    return { messages: [SUMMARY] }
  })
  await $.session.start(START)
  await $.session.measure({ context: WARM_READING.context, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...STATUS })
  expect(await ui.find({ type: 'Text', text: /30%/ })).toBeDefined()

  await clock.advance(5000)
  await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /30%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^4%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^⚡$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /60m/ })).toBeDefined()
  await ui.unmount()
})

test('ctx shows the figure /context counts, kept current between responses', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
  mock.store(on)
  let counted = 19
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: SETTINGS }))
  // The engine's own figure stays at the last response's 19% throughout.
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        window: 1000000,
        tokens: 190000,
        percent: 19,
        ...(e.breakdown === undefined
          ? {}
          : { breakdown: { totalTokens: counted * 10000, rawMaxTokens: 1000000, percentage: counted } as SessionContextBreakdown }),
      },
      rateLimits: [],
    },
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...STATUS })
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /^19%$/ })).toBeDefined()

  counted = 4
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /^4%$/ })).toBeDefined()
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: /^4%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^19%$/ })).toBeUndefined()
  await ui.unmount()
})

test('a model id that only gains [1m], or a switch away and back, keeps the cache warm', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
  mock.store(on)
  let model = 'claude-opus-5-5'
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: SETTINGS }))
  on('session.usage', () => ({ value: WARM_READING }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.start(START)
  await $.session.measure({ context: WARM_READING.context, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...STATUS })
  expect(await ui.find({ type: 'Text', text: /^⚡$/ })).toBeDefined()

  model = 'claude-opus-5-5[1m]'
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /^⚡$/ })).toBeDefined()

  model = 'claude-haiku-5-5'
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /^❄$/ })).toBeDefined()

  model = 'claude-opus-5-5'
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /^⚡$/ })).toBeDefined()
  await ui.unmount()
})

const AUTO_HINT = hint('⏵⏵ auto mode on (shift+tab to cycle) · ? for shortcuts')
const LIMITS = {
  limits: {
    fiveHour: { percent: 42, resetsAt: '2026-10-15T12:00:00Z' },
    week: { percent: 17, resetsAt: '2026-10-20T00:00:00Z' },
  },
}

test('each mode reads as one short word, and model and effort sit one space apart', async ($, on) => {
  mock.clock(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: SETTINGS }))
  on('session.usage', () => ({ value: NO_READING }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start(START)
  const cases = [
    ['⏵⏵ auto mode on (shift+tab to cycle)', '◎ Auto'],
    ['⏸ plan mode on (shift+tab to cycle)', '◐ Plan'],
    ['⏵⏵ accept edits on (shift+tab to cycle)', '◉ Accept edits'],
    ['manual mode on', '○ Manual'],
    ['⏵⏵ review mode on (shift+tab to cycle)', '● Review'],
  ] as const
  for (const [line, badge] of cases) {
    const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...hint(line) })
    expect(await ui.find({ type: 'Text', text: badge })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /mode on|\bon\b|shift\+tab/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^·$/ })).toBeUndefined()
    await ui.unmount()
  }
})

const MOUNT_AT = async (...[$, on]: Parameters<TestBody>) => {
  mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
  mock.store(on, LIMITS)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: SETTINGS }))
  on('session.usage', () => ({ value: NO_READING }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start(START)
}

test('below the input only the status row draws: no hints, no mode labels', async ($, on) => {
  let engineGot: readonly string[] | undefined = undefined
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    engineGot = e.props.modes
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, e.props.modes.join(' & ')) as RenderElement
  })
  await MOUNT_AT($, on)
  for (const line of [
    'esc to interrupt · ? for shortcuts',
    'Press Ctrl-C again to exit',
    '⏵⏵ auto mode on (shift+tab to cycle) ← for agents ctrl+x tab to focus',
  ]) {
    const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...hint(line) })
    expect(await ui.find({ type: 'Text', text: /esc|Ctrl-C|shortcuts|agents|shift\+tab|ctrl\+x|mode on/ })).toBeUndefined()
    await ui.unmount()
  }
  const modes = await $.ui.mount({
    plugin: 'statusdeck',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['← for agents', 'focus'] },
  })
  expect(engineGot).toBeUndefined()
  expect(await modes.find({ type: 'Text', text: /agents|focus|·|&/ })).toBeUndefined()
  expect(await modes.find({ type: 'Text', text: ' ctx ' })).toBeDefined()
  await modes.unmount()
})

test('mode, two spaces, model and effort at the left; the pills and cache one row in the right slot', async ($, on) => {
  await MOUNT_AT($, on)
  for (const columns of [160, 50]) {
    const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...AUTO_HINT, viewport: { columns, rows: 40 } })
    // Exactly as wide as its words: a wider tree squeezes the engine's own
    // mode text before it into the model.
    const root = (await ui.find({ type: 'Box' }))?.props
    expect(root).toMatchObject({ flexShrink: 0 })
    expect(root).not.toHaveProperty('width')
    expect(root).not.toHaveProperty('flexWrap')
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBe('◎ Auto|Opus 5.5|medium')
    // The blanks are boxes of fixed width that never shrink, so a narrow
    // terminal cannot squeeze them out.
    expect((await ui.find({ key: 'gap-mode' }))?.props).toMatchObject({ width: 2, flexShrink: 0 })
    expect((await ui.find({ key: 'gap-effort' }))?.props).toMatchObject({ width: 1, flexShrink: 0 })
    await ui.unmount()

    const status = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...STATUS, viewport: { columns, rows: 40 } })
    expect((await status.findAll({ type: 'Text' })).map(t => t.text).join('|')).toBe(
      ' 5h |42%| 2h00m | 7d |17%| 4d14h | ctx |–| |❄| cold',
    )
    expect((await status.find({ key: 'gap-after-5h' }))?.props).toMatchObject({ width: 1, flexShrink: 0 })
    expect((await status.find({ key: 'right' }))?.props).not.toHaveProperty('flexWrap')
    await status.unmount()
  }
  // Narrower than the pills, they wrap flush right on the row they are given.
  const narrow = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...STATUS, viewport: { columns: 30, rows: 40 } })
  expect((await narrow.find({ key: 'right' }))?.props).toMatchObject({ flexWrap: 'wrap', justifyContent: 'flex-end' })
  await narrow.unmount()
})

test('pill colours: fixed background, label and timer, percentage on the used gradient', async ($, on) => {
  await MOUNT_AT($, on)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...STATUS, viewport: { columns: 160, rows: 40 } })
  const label = await ui.find({ type: 'Text', text: ' 5h ' })
  expect(label?.props).toMatchObject({ backgroundColor: '#202C34', color: '#D4DCE2' })
  expect((await ui.find({ type: 'Text', text: ' 2h00m ' }))?.props).toMatchObject({ backgroundColor: '#202C34', color: '#A7B3BD' })
  expect((await ui.find({ type: 'Text', text: ' cold' }))?.props).toMatchObject({ color: '#A7B3BD' })
  // 42% sits between the 0% and 50% stops: 84% of the way from #8BD5F5 to #9FDFB5.
  expect((await ui.find({ type: 'Text', text: '42%' }))?.props).toMatchObject({ backgroundColor: '#202C34', color: '#9cddbf' })
  expect((await ui.find({ type: 'Text', text: '17%' }))?.props).toMatchObject({ color: '#92d8df' })
  await ui.unmount()
  const left = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', ...AUTO_HINT, viewport: { columns: 160, rows: 40 } })
  expect((await left.find({ type: 'Text', text: 'Opus 5.5' }))?.props).toMatchObject({ color: '#F97316' })
  await left.unmount()
})
