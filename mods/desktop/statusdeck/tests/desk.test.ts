import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseSkills, withoutFunctions, withoutNames, withoutServers, withoutSkills } from '../hooks/context'

const band = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const

test('the desktop band holds the ctx and cache pills, rounded, and no dropdowns', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  expect(await ui.find({ type: 'Box', key: 'ctx' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^❄$/ })).toBeDefined()
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'ctx', props: { borderStyle: 'single' } })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'deck', props: { backgroundColor: undefined } })).toBeDefined()
  await ui.unmount()
})

test('every other surface, and a survey, keep the engine band', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band') as RenderElement
  })
  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'statusdeck', surface, ...band(200) })
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    expect(await ui.find({ type: 'Box', key: 'ctx' })).toBeUndefined()
    await ui.unmount()
  }
  const survey = band(200)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...survey, props: { ...survey.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

test('a narrow band drops the cache before ctx', async ($, on) => {
  mock.clock(on)
  const narrow = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(28) })
  expect(await narrow.find({ type: 'Text', text: /^❄$/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Box', key: 'ctx' })).toBeDefined()
  await narrow.unmount()
})

test('every colour is a theme colour, so light and dark both read', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  const themed = new Set(['claude', 'claudeShimmer', 'suggestion', 'success', 'warning', 'error', 'diffAdded', 'diffAddedWord', 'diffRemoved', 'diffRemovedWord', undefined])
  for (const text of await ui.findAll({ type: 'Text' })) {
    expect(themed.has(text.props.color as string | undefined)).toBe(true)
  }
  expect(await ui.find({ type: 'Text', text: /^❄$/, props: { color: 'error' } })).toBeDefined()
  await ui.unmount()
})

const clawdAlt = async (ui: { find: (q: { type: 'Svg' }) => Promise<{ props: { alt?: unknown } } | undefined> }) =>
  (await ui.find({ type: 'Svg' }))?.props.alt

test('Clawd works through a turn, celebrates for five seconds, then idles', async ($, on) => {
  on('env.get', () => ({ value: 'claude-desktop' }))
  const clock = mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  expect(await clawdAlt(ui)).toBe('Clawd, idle')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(await clawdAlt(ui)).toBe('Clawd, working')
  await $.turn.complete({ answer: 'ok', durationMs: 1000, reason: 'answer', turnId: 't1' } as never)
  expect(await clawdAlt(ui)).toBe('Clawd, done')
  await clock.advance(4900)
  expect(await clawdAlt(ui)).toBe('Clawd, done')
  await clock.advance(200)
  expect(await clawdAlt(ui)).toBe('Clawd, idle')
  await ui.unmount()
})

test('a stopped turn droops, and Clawd is the last thing a narrow band keeps', async ($, on) => {
  on('env.get', () => ({ value: 'claude-desktop' }))
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 10, reason: 'aborted', turnId: 't1' } as never)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(16) })
  expect(await clawdAlt(ui)).toBe('Clawd, stopped')
  expect(await ui.find({ type: 'Box', key: 'ctx' })).toBeUndefined()
  await ui.unmount()
})

test('an unmeasured band (1 column, as the desktop starts it) still draws everything', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(1) })
  expect(await clawdAlt(ui)).toBe('Clawd, idle')
  expect(await ui.find({ type: 'Box', key: 'ctx' })).toBeDefined()
  await ui.unmount()
})

test('every pill is a plain pill, no buttons', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  // The one button is the context panel's opener.
  expect((await ui.findAll({ type: 'Button' })).map(b => b.props.key)).toEqual(['open-context'])
  expect(await ui.find({ type: 'Box', key: 'ctx', props: { borderStyle: 'single' } })).toBeDefined()
  await ui.unmount()
})

const REPO = '## main...origin/main [ahead 1]\n M hooks/register.tsx\n?? notes.md\n'
const git = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('the git pill shows the branch and changed files, and is gone outside a repo', async ($, on) => {
  on('env.get', () => ({ value: 'claude-desktop' }))
  mock.clock(on)
  let isRepo = true
  on('process.run', () => (isRepo ? git(REPO) : git('', 128)))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 10, reason: 'answer', turnId: 't1' } as never)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  expect(await ui.find({ type: 'Text', text: /^⎇ main$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^±2$/, props: { color: 'warning' } })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'git-open' })).toBeUndefined()
  await ui.unmount()
  isRepo = false
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await $.turn.complete({ answer: 'ok', durationMs: 10, reason: 'answer', turnId: 't2' } as never)
  const outside = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  expect(await outside.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
  await outside.unmount()
})

test('a running turn shows its timer and tokens beside Clawd, gone once it ends', async ($, on) => {
  on('env.get', () => ({ value: 'claude-desktop' }))
  mock.clock(on)
  on('process.run', () => git('', 128))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  expect(await ui.find({ type: 'Text', text: /^⏱ 0:00$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^↓ 0$/ })).toBeDefined()
  await $.turn.complete({ answer: 'ok', durationMs: 10, reason: 'answer', turnId: 't1' } as never)
  expect(await ui.find({ type: 'Text', text: /⏱/ })).toBeUndefined()
  await ui.unmount()
})

test('a full context turns the ctx gauge and percent red, and the pill stays plain', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-23T10:00:00Z') })
  mock.store(on)
  on('env.get', () => ({ value: 'claude-desktop' }))
  on('process.run', () => git('', 128))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 90 }, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  expect(await ui.find({ type: 'Text', text: /^90%$/, props: { color: 'error' } })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'fill', props: { height: '100%', backgroundColor: 'error' } })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ctx-open' })).toBeUndefined()
  await ui.unmount()
})

test('the time and tokens line under an answer draws nothing on the desktop only', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'Baked for 3s') as RenderElement
  })
  const props = { word: 'Baked', durationMs: 3000 } as never
  const desk = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', component: 'TurnDuration', props })
  expect(await desk.find({ type: 'Text', text: /Baked/ })).toBeUndefined()
  await desk.unmount()
  const term = await $.ui.mount({ plugin: 'statusdeck', surface: 'terminal', component: 'TurnDuration', props })
  expect(await term.find({ type: 'Text', text: /Baked/ })).toBeDefined()
  await term.unmount()
})

test('the ctx gauge fills by tenths and changes colour with them', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-23T10:00:00Z') })
  mock.store(on)
  on('env.get', () => ({ value: 'claude-desktop' }))
  on('process.run', () => git('', 128))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 34, tokens: 68000 }, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'statusdeck', surface: 'desktop', ...band(200) })
  expect(await ui.find({ type: 'Box', key: 'fill', props: { height: '40%', backgroundColor: 'diffAddedWord' } })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'gauge', props: { borderStyle: 'round', overflow: 'hidden', borderColor: 'diffAddedWord' } })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^34%$/, props: { color: 'diffAddedWord' } })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^68\.0k \/ 200\.0k$/ })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'ctx-after', props: { display: 'none' } })).toBeDefined()
  await ui.unmount()
})


const LISTING = `- alpha: Does alpha things.
- beta: Does beta things,
  over two lines.
- tools:gamma: A namespaced one.`

test('the skill listing is read whole and sent without the skills turned off', () => {
  expect(parseSkills(LISTING).map(s => s.name)).toEqual(['alpha', 'beta', 'tools:gamma'])
  const kept = withoutSkills(LISTING, new Set(['beta']))
  expect(kept).toContain('- alpha:')
  expect(kept).not.toContain('beta')
  expect(kept).toContain('- tools:gamma:')
})

test('tool names, ToolSearch functions and server instructions of what is off are dropped', () => {
  expect(withoutNames('Read\nmcp__demo__ping\nWrite', new Set(['mcp__demo__ping']))).toBe('Read\nWrite')
  const found = '<function>{"description": "x", "name": "mcp__demo__ping"}</function>\n<function>{"name": "Read"}</function>'
  expect(withoutFunctions(found, new Set(['mcp__demo__ping']))).toBe('<function>{"name": "Read"}</function>')
  const instructions = '# MCP Server Instructions\n\n## demo\nUse demo well.\n\n## other\nKeep this.\n'
  const kept = withoutServers(instructions, new Set(['demo']))
  expect(kept).not.toContain('Use demo well.')
  expect(kept).toContain('Keep this.')
})

test('the panel lists MCP tools, keeps the app’s own locked, and applies a toggle that then refuses the tool', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('env.get', () => ({ value: 'claude-desktop' }))
  on('process.run', () => git('', 128))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('tool.list', () => ({
    value: [
      { name: 'mcp__demo__ping', description: 'Ping the demo', mcp: true },
      { name: 'mcp__ccd_session__mark_chapter', description: 'App plumbing', mcp: true },
      { name: 'Read', description: 'Read a file', mcp: false },
    ],
  }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let called = 0
  on('tool.call', () => (called++, { result: 'pong' }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true } as never)
  const pane = await $.ui.mount({
    plugin: 'statusdeck',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'statusdeck-context',
    props: { title: 'Context', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  expect(await pane.find({ type: 'Button', key: 'server-toggle:demo' })).toBeDefined()
  // The desktop app's own server shows, required, with no toggle.
  expect(await pane.find({ type: 'Button', key: 'server-toggle:ccd_session' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /required/ })).toBeDefined()
  await pane.press({ key: 'server-toggle:demo' })
  expect(await pane.find({ type: 'Text', text: /^1 change not applied$/ })).toBeDefined()
  // Not applied yet: the tool still runs.
  await $.tool.call({ tool: 'mcp__demo__ping' } as never)
  expect(called).toBe(1)
  await pane.press({ key: 'apply' })
  expect(await pane.find({ type: 'Text', text: /not applied/ })).toBeUndefined()
  const refused = await $.tool.call({ tool: 'mcp__demo__ping' } as never)
  expect(called).toBe(1)
  expect(JSON.stringify(refused)).toContain('turned off')
  await pane.unmount()
})

