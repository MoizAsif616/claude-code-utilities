import { expect, mock, test } from 'claude-code/testing'

const PRESENTATION = { isFullscreen: true, columns: 120 }
const COMPOSER = { kind: 'composer' } as const

function listLine(installed: string[]) {
  const model = (id: string, name: string, size_mb: number) => ({
    id, name, languages: ['English'], size_mb, ram_mb: 300, accuracy: 'good', speed: 'fast', installed: installed.includes(id),
  })
  return JSON.stringify({
    event: 'list',
    models: [model('moonshine-tiny', 'Moonshine Tiny', 30), { ...model('moonshine-base', 'Moonshine Base', 111), recommended: true }],
    active: installed[0] ?? null,
    venv_python: '/venv/bin/python',
    has_venv: installed.length > 0,
  })
}

type On = Parameters<Parameters<typeof test>[1]>[1]

// What a session's engine answers beneath the mod, which the kit leaves out.
function engineBasics(on: On, installed: { now: string[]; ran?: string[][]; store?: Record<string, unknown>; opened?: string[] }) {
  on('session.start', ($, e) => e)
  on('ui.toast', () => ({ value: undefined }))
  on('store.get', ($, e) => ({ value: installed.store?.[e.key] }))
  on('store.set', ($, e) => {
    if (installed.store) installed.store[e.key] = e.value
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    installed.opened?.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: {} }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    installed.ran?.push([...e.argv])
    const [command, id] = e.argv.slice(-2)
    if (command === 'use' && id) installed.now = [id, ...installed.now.filter(one => one !== id)]
    let stdout = `${listLine(installed.now)}\n`
    if (e.argv.includes('--version')) stdout = 'Python 3.10.12\n'
    else if (command === 'prune') stdout = '{"event":"done","pruned":[],"freed_mb":0}\n'
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
}

const START = { source: 'startup', cwd: '/tmp' } as never

const BAND = {
  plugin: 'hark',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9, rows: 0 }, view: {},
  },
} as const

const PICKER = {
  plugin: 'hark',
  component: 'Pane',
  requestId: 'hark-models',
  props: {
    title: 'Speech models', isFocused: true, bodyColumns: 100, placement: 'inline',
    scroll: { offset: 0, bodyRows: 12, rows: 0 }, view: {},
  },
} as const

async function settle(check: () => Promise<unknown>) {
  for (let i = 0; i < 100 && !(await check()); i++) await new Promise(resolve => setTimeout(resolve, 10))
}

test('with no model, /hark opens the picker; a download turns voice on when done', async ($, on) => {
  const installed = { now: [] as string[] }
  engineBasics(on, installed)
  let releaseEngine = () => {}
  on('process.spawn', async function* ($, e) {
    if (e.argv.includes('install')) {
      yield { stream: 'stdout' as const, text: '{"event":"progress","done":50,"total":100}\n' }
      installed.now = ['moonshine-base']
      yield { stream: 'stdout' as const, text: '{"event":"done"}\n' }
      return { value: { code: 0, signal: null } }
    }
    yield { stream: 'stdout' as const, text: '{"event":"ready","port":4242,"name":"Moonshine Base","load_ms":900}\n' }
    await new Promise<void>(resolve => (releaseEngine = resolve))
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  await $.session.start(START)

  const ran = await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })
  expect(ran.text).toContain('No speech model is installed yet')

  const picker = await $.ui.mount({ ...PICKER, surface: 'terminal' } as never)
  expect(await picker.find({ type: 'Text', text: /Speech models/ })).toBeDefined()
  await picker.press({ key: 'm-moonshine-base' })
  expect(await picker.find({ type: 'Text', text: /Download Moonshine Base\?/ })).toBeDefined()
  await picker.press({ key: 'bg' })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await settle(() => band.find({ key: 'record' }))
  expect(await band.find({ key: 'record' })).toBeDefined()

  await $.command.run({ command: 'hark', args: 'off', origin: COMPOSER, presentation: PRESENTATION })
  releaseEngine()
})

test('record, then Enter sends the transcript with the draft kept', async ($, on) => {
  engineBasics(on, { now: ['moonshine-base'] })
  const filled: string[] = []
  const posted: string[] = []
  let releaseEngine = () => {}
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '{"event":"ready","port":4242,"name":"Moonshine Base","load_ms":900}\n' }
    await new Promise<void>(resolve => (releaseEngine = resolve))
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', ($, e) => {
    const path = new URL(e.url).pathname
    posted.push(path)
    const body = path === '/stop' ? { text: 'run the tests', ms: 40 } : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.read', () => ({ value: { text: 'please', cursor: 6 } }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  let sent = ''
  on('prompt.submit', ($, e) => {
    sent = e.text
    return { text: e.text }
  })
  await $.session.start(START)

  const ran = await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })
  expect(ran.text).toContain('Voice input is on')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await settle(() => ui.find({ key: 'record' }))
  await ui.press({ key: 'record' })
  expect(posted).toContain('/start')
  expect(filled.at(-1)).toBe('please 🎙 listening…')
  expect(await ui.find({ key: 'stop' })).toBeDefined()

  await $.prompt.submit({ text: 'please 🎙 listening…', origin: COMPOSER, wait: false } as never)
  expect(posted).toContain('/stop')
  expect(sent).toBe('please run the tests')

  const off = await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })
  expect(off.text).toContain('model is unloaded')
  releaseEngine()
})

// One serve engine per spawn, ready at once and alive until released.
function engines(on: On) {
  const spawned: string[] = []
  const releases: (() => void)[] = []
  on('process.spawn', async function* ($, e) {
    spawned.push(e.argv.at(-1) ?? '')
    yield { stream: 'stdout' as const, text: `{"event":"ready","port":${4242 + spawned.length},"name":"x","load_ms":1}\n` }
    await new Promise<void>(resolve => releases.push(resolve))
    return { value: { code: 0, signal: null } }
  })
  return { spawned, release: () => releases.forEach(one => one()) }
}

// Turns voice off and lets the background work (pruning, reloads) settle before the test ends.
async function finish($: Parameters<Parameters<typeof test>[1]>[0], engine: { release: () => void }) {
  await new Promise(resolve => setTimeout(resolve, 200))
  await $.command.run({ command: 'hark', args: 'off', origin: COMPOSER, presentation: PRESENTATION })
  engine.release()
  await new Promise(resolve => setTimeout(resolve, 200))
}

test('Stop with nothing said clears the listening placeholder', async ($, on) => {
  engineBasics(on, { now: ['moonshine-base'] })
  const engine = engines(on)
  const filled: string[] = []
  on('http.fetch', ($, e) => {
    const body = new URL(e.url).pathname === '/stop' ? { text: '', ms: 5 } : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  await $.session.start(START)
  await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await settle(() => ui.find({ key: 'record' }))
  await ui.press({ key: 'record' })
  expect(filled.at(-1)).toBe('🎙 listening…')
  await ui.press({ key: 'stop' })
  await settle(async () => filled.at(-1) === '')
  expect(filled.at(-1)).toBe('')
  await finish($, engine)
})

test('once a model loads, the other downloaded models are deleted', async ($, on) => {
  const installed = { now: ['moonshine-base', 'moonshine-tiny'], ran: [] as string[][] }
  engineBasics(on, installed)
  const engine = engines(on)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  await $.session.start(START)
  await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })

  await settle(async () => installed.ran.some(argv => argv.includes('prune')))
  expect(installed.ran.find(argv => argv.includes('prune'))?.slice(-2)).toEqual(['prune', 'moonshine-base'])
  await finish($, engine)
})

test('switching models mid-recording switches once the recording ends', async ($, on) => {
  engineBasics(on, { now: ['moonshine-base', 'moonshine-tiny'] })
  const engine = engines(on)
  on('http.fetch', ($, e) => {
    const body = new URL(e.url).pathname === '/stop' ? { text: 'hello', ms: 5 } : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => ({ isFilled: true, text: e.text, cursor: e.text.length }))
  await $.session.start(START)
  await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await settle(() => ui.find({ key: 'record' }))
  await ui.press({ key: 'record' })

  await $.command.run({ command: 'hark-models', args: '', origin: COMPOSER, presentation: PRESENTATION })
  const picker = await $.ui.mount({ ...PICKER, surface: 'terminal' } as never)
  await picker.press({ key: 'm-moonshine-tiny' })
  await picker.press({ key: 'use' })
  expect(engine.spawned).toEqual(['moonshine-base'])

  await ui.press({ key: 'stop' })
  await settle(async () => engine.spawned.length === 2)
  expect(engine.spawned).toEqual(['moonshine-base', 'moonshine-tiny'])
  await finish($, engine)
})

test('clicking the model name in the voice line opens the picker', async ($, on) => {
  const opened: string[] = []
  engineBasics(on, { now: ['moonshine-base'], opened })
  const engine = engines(on)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  await $.session.start(START)
  await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await settle(() => band.find({ key: 'name' }))
  await band.press({ key: 'name' })
  expect(opened).toEqual(['hark-models'])
  await finish($, engine)
})

test('the ✕ beside the download bar cancels the download and discards it', { timeoutMs: 15_000 }, async ($, on) => {
  const installed = { now: ['moonshine-base'], ran: [] as string[][] }
  engineBasics(on, installed)
  const clock = mock.clock(on)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  let isKilled = false
  let releaseEngine = () => {}
  on('process.spawn', async function* ($, e) {
    if (e.argv.includes('serve')) {
      yield { stream: 'stdout' as const, text: '{"event":"ready","port":4242,"name":"Moonshine Base","load_ms":1}\n' }
      await new Promise<void>(resolve => (releaseEngine = resolve))
      return { value: { code: 0, signal: null } }
    }
    try {
      // A download sends progress until something ends it.
      for (let done = 1; ; done++) {
        yield { stream: 'stdout' as const, text: `{"event":"progress","done":${done},"total":100}\n` }
        await clock.sleep(250)
      }
    } finally {
      isKilled = true
    }
  })
  await $.session.start(START)
  await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await settle(() => band.find({ key: 'record' }))

  await $.command.run({ command: 'hark-models', args: '', origin: COMPOSER, presentation: PRESENTATION })
  const picker = await $.ui.mount({ ...PICKER, surface: 'terminal' } as never)
  await picker.press({ key: 'm-moonshine-tiny' })
  // The download sleeps on the mocked clock between pieces, so the press settles.
  await picker.press({ key: 'bg' })

  await settle(() => band.find({ key: 'cancel-download' }))
  await band.press({ key: 'cancel-download' })
  expect(await band.find({ key: 'cancel-download' })).toBeUndefined()
  // The next piece ends the loop, which kills the installer and discards it.
  await clock.advance(250)
  await settle(async () => installed.ran.some(argv => argv.includes('discard')))
  expect(isKilled).toBe(true)
  expect(installed.ran.find(argv => argv.includes('discard'))?.slice(-2)).toEqual(['discard', 'moonshine-tiny'])
  expect(installed.now).toEqual(['moonshine-base'])
  releaseEngine()
  await clock.settle()
})

// One recording with the engine answering /stop with `stop`; returns what the box shows after.
async function recordOnce($: Parameters<Parameters<typeof test>[1]>[0], on: On, stop: Record<string, unknown>, store: Record<string, unknown> = {}) {
  const installed = { now: ['moonshine-base'], store }
  engineBasics(on, installed)
  const engine = engines(on)
  const filled: string[] = []
  on('http.fetch', ($, e) => {
    const body = new URL(e.url).pathname === '/stop' ? stop : { ok: true }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  await $.session.start(START)
  await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  await settle(() => band.find({ key: 'record' }))
  await band.press({ key: 'record' })
  await band.press({ key: 'stop' })
  return { filled, engine, band }
}

test('fillers are dropped from what hark heard', { timeoutMs: 20_000 }, async ($, on) => {
  const stop = { text: 'Uh, I want, um, the file. Hmm.', ms: 300 }
  const { filled, engine, band } = await recordOnce($, on, stop)
  expect(filled.at(-1)).toBe('I want the file.')
  const cases: [string, string][] = [
    ['So um the thing is', 'So the thing is'],
    ['Do it, uh.', 'Do it.'],
    ['Erm, hmm, okay let us go', 'Okay let us go'],
    ['I err on the side of caution, mm-hmm', 'I err on the side of caution, mm-hmm'],
    ['Uhh. Next one?', 'Next one?'],
  ]
  for (const [heard, shown] of cases) {
    stop.text = heard
    await band.press({ key: 'record' })
    await band.press({ key: 'stop' })
    expect(filled.at(-1)).toBe(shown)
  }
  await finish($, engine)
})

test('the measured wait after Stop shows in the picker', async ($, on) => {
  const store: Record<string, unknown> = {}
  const { engine } = await recordOnce($, on, { text: 'hello', ms: 420 }, store)
  await settle(async () => store.speed !== undefined)
  expect(store.speed).toEqual({ 'moonshine-base': [420] })
  await $.command.run({ command: 'hark-models', args: '', origin: COMPOSER, presentation: PRESENTATION })
  const picker = await $.ui.mount({ ...PICKER, surface: 'terminal' } as never)
  expect(await picker.find({ type: 'Text', text: /0\.4 s/ })).toBeDefined()
  await finish($, engine)
})

test('voice input that was on comes back on in the next session; off stays off', async ($, on) => {
  const store: Record<string, unknown> = { isOn: true }
  engineBasics(on, { now: ['moonshine-base'], store })
  const engine = engines(on)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  await $.session.start(START)
  await settle(async () => engine.spawned.length === 1)
  expect(engine.spawned).toEqual(['moonshine-base'])

  await $.command.run({ command: 'hark', args: 'off', origin: COMPOSER, presentation: PRESENTATION })
  expect(store.isOn).toBe(false)
  await $.command.run({ command: 'hark', args: 'on', origin: COMPOSER, presentation: PRESENTATION })
  expect(store.isOn).toBe(true)
  await finish($, engine)
})

test('turning off while the model still loads stops that engine at once', async ($, on) => {
  engineBasics(on, { now: ['moonshine-base'] })
  const quits: string[] = []
  let release = () => {}
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '{"event":"listening","port":5151}\n' }
    await new Promise<void>(resolve => (release = resolve))
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', ($, e) => {
    if (e.url.endsWith('/quit')) quits.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  await $.session.start(START)
  await $.command.run({ command: 'hark', args: '', origin: COMPOSER, presentation: PRESENTATION })
  await settle(async () => false)
  await $.command.run({ command: 'hark', args: 'off', origin: COMPOSER, presentation: PRESENTATION })
  expect(quits).toEqual(['http://127.0.0.1:5151/quit'])
  release()
})
