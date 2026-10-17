import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, PromptFilled, Register } from 'claude-code'

import type { HarkDownload, HarkModel, HarkPhase, HarkPickerView } from '../types'

const phase = atom({ plugin: 'hark', key: 'phase' } as const, 'off' as HarkPhase)
const modelName = atom({ plugin: 'hark', key: 'modelName' } as const, '')
const levels = atom({ plugin: 'hark', key: 'levels' } as const, [] as number[])
const seconds = atom({ plugin: 'hark', key: 'seconds' } as const, 0)
const download = atom({ plugin: 'hark', key: 'download' } as const, null as HarkDownload | null)
const models = atom({ plugin: 'hark', key: 'models' } as const, [] as HarkModel[])
const active = atom({ plugin: 'hark', key: 'active' } as const, null as string | null)
const view = atom({ plugin: 'hark', key: 'view' } as const, { kind: 'list' } as HarkPickerView)
const isPickerOpen = atom({ plugin: 'hark', key: 'isPickerOpen' } as const, false)
// Per model, the median wait from Stop to text measured on this machine, in ms.
const speeds = atom({ plugin: 'hark', key: 'speeds' } as const, {} as Record<string, number>)

// Palette shared with statusdeck and prettier.
const PILL_BG = '#202C34'
const PILL_LABEL = '#D4DCE2'
const PILL_TIMER = '#A7B3BD'
const ORANGE = '#F97316'
const PURPLE_LIGHT = '#C4B5FD'
const GREEN = '#22C55E'
const RED = '#FF6B6B'
const RED_DEEP = '#DC2626'
const WHITE = '#FFFFFF'
const QUIET = '#52525B'

const PICKER = 'hark-models'
const PLACEHOLDER = '🎙 listening…'
const BARS = 14
// Sounds people make between words, dropped from what hark heard.
const FILLER = /^(u+h+|u+h*m+|e+r|e+r+m+|h+m+|m{2,})$/i
const WELCOME =
  'hark is installed: speak your prompts instead of typing them.\n' +
  '  /hark          turn voice input on or off\n' +
  '  /hark-models   choose, download or delete a speech model'

type Listing = {
  models: HarkModel[]
  active: string | null
  venv_python: string
  has_venv: boolean
}

type EngineEvent =
  | { event: 'listening'; port: number }
  | { event: 'ready'; port: number; name: string; load_ms: number }
  | { event: 'partial'; text: string }
  | { event: 'level'; rms: number; seconds: number }
  | { event: 'error'; text: string }
  | { event: 'step'; text: string }
  | { event: 'progress'; done: number; total: number }
  | { event: 'done'; pruned?: string[]; freed_mb?: number }
  | ({ event: 'list' } & Listing)

// What the running session holds; a reload starts it over, as it does the
// engine child, and session.start puts the state atoms back to match.
const live: {
  python?: string[]
  venvPython?: string
  engine?: HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  installer?: HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  // The engine's port from its start, to stop it even while it loads.
  enginePort?: number
  // Its port once the model has loaded and it can record.
  port?: number
  // The model the engine runs.
  engineModel?: string
  draft: string
  base: string
  isWaitingToTurnOn: boolean
  // The person cancelled the running download; its loop ends at the next piece.
  isInstallCancelled: boolean
  // A model switch that came while recording, done once the recording ends.
  needsReload: boolean
  // The last prompt box write; each new one waits for it, so they land in order.
  writing: Promise<unknown>
} = {
  draft: '',
  base: '',
  isWaitingToTurnOn: false,
  isInstallCancelled: false,
  needsReload: false,
  writing: Promise.resolve(),
}

function script($: EngineInterface): string {
  return `${$.plugin.root}/engine/hark.py`
}

async function findPython($: EngineInterface): Promise<string[] | undefined> {
  if (live.python) return live.python
  for (const argv of [['python3'], ['python'], ['py', '-3']]) {
    const ran = await $.process.run([...argv, '--version']).catch(() => undefined)
    if (ran?.exitCode === 0 && /Python 3\.(9|1\d)/.test(ran.stdout + ran.stderr)) {
      live.python = argv
      return argv
    }
  }
  return undefined
}

function parseLines(text: string): EngineEvent[] {
  return text
    .split('\n')
    .filter(line => line.trim().startsWith('{'))
    .map(line => JSON.parse(line) as EngineEvent)
}

/** Runs one management command (list, use, remove) and returns its last event. */
async function manage($: EngineInterface, args: string[]): Promise<EngineEvent> {
  const py = await findPython($)
  if (!py) return { event: 'error', text: 'Voice input needs Python 3.9 or newer, and none was found on PATH.' }
  const ran = await $.process.run([...py, script($), ...args], { timeoutMs: 180_000 })
  const events = parseLines(ran.stdout)
  return events.at(-1) ?? { event: 'error', text: ran.stderr.trim().split('\n').slice(-3).join('\n') || 'no answer' }
}

/** Reads the catalog and what is installed into the state the picker draws. */
async function refreshModels($: EngineInterface): Promise<Listing | string> {
  const answer = await manage($, ['list'])
  if (answer.event !== 'list') return answer.event === 'error' ? answer.text : 'unexpected answer'
  live.venvPython = answer.venv_python
  await update($, models, () => answer.models)
  await update($, active, () => answer.active)
  return answer
}

/** Writes the prompt box after every earlier write, so a late partial never lands over the final text. */
function fillPrompt($: EngineInterface, text: string): Promise<PromptFilled> {
  const write = live.writing.then(() => $.prompt.fill({ text }))
  live.writing = write.catch(() => undefined)
  return write
}

async function post(path: string, $: EngineInterface, port = live.port): Promise<Record<string, unknown>> {
  if (port === undefined) return { error: 'voice input is off' }
  const answer = await $.http
    .fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: '{}' })
    .catch(error => ({ ok: false, text: JSON.stringify({ error: String(error) }) }))
  try {
    return JSON.parse(answer.text) as Record<string, unknown>
  } catch {
    return { error: answer.text }
  }
}

// --- On and off ----------------------------------------------------------------

/** Starts the engine on the active model; with none, opens the picker unless `isQuiet`. */
async function turnOn($: EngineInterface, isQuiet = false): Promise<string> {
  if ((await read($, phase)) !== 'off') return `Voice input is already on (${await read($, modelName)}).`
  const found = await refreshModels($)
  if (typeof found === 'string') return `Voice input could not start: ${found}`
  const model = found.models.find(one => one.id === found.active)
  if (!model || !found.has_venv) {
    if (isQuiet) return ''
    live.isWaitingToTurnOn = true
    await openPicker($)
    return 'No speech model is installed yet. Pick one to download; voice input turns on when it is ready.'
  }
  live.isWaitingToTurnOn = false
  live.needsReload = false
  await update($, modelName, () => model.name)
  await update($, phase, () => 'loading')
  void runEngine($, found.venv_python, model.id)
  return `Voice input is on: loading ${model.name}.`
}

async function runEngine($: EngineInterface, venvPython: string, id: string) {
  const stream = $.process.spawn({ argv: [venvPython, script($), 'serve', id] })
  live.engine = stream
  live.engineModel = id
  let pending = ''
  let lastError = ''
  try {
    for await (const chunk of stream) {
      // A newer engine took over while this one was still loading: leaving
      // the loop kills this one before it can answer for the new model.
      if (live.engine !== stream) break
      if (chunk.stream === 'stderr') {
        const lines = chunk.text.trim().split('\n').filter(line => !/resampler|sample_rate|^\s*$/.test(line))
        if (lines.length > 0) lastError = lines.at(-1) ?? lastError
        continue
      }
      pending += chunk.text
      const cut = pending.lastIndexOf('\n')
      if (cut < 0) continue
      const complete = pending.slice(0, cut)
      pending = pending.slice(cut + 1)
      for (const event of parseLines(complete)) {
        if (live.engine !== stream) {
          if (event.event === 'listening' || event.event === 'ready') await post('/quit', $, event.port)
          break
        }
        if (event.event === 'error') lastError = event.text
        else await onEngineEvent($, event, id)
      }
    }
  } catch (error) {
    lastError = String(error)
  }
  if (live.engine !== stream) return
  live.engine = undefined
  live.enginePort = undefined
  live.port = undefined
  const was = await read($, phase)
  await update($, phase, () => 'off')
  if (was !== 'off') {
    if (was === 'recording') await fillPrompt($, live.draft)
    $.ui.toast(`Voice input stopped: ${lastError || 'the engine exited'}`)
  }
}

async function onEngineEvent($: EngineInterface, event: EngineEvent, id: string) {
  if (event.event === 'listening') {
    live.enginePort = event.port
  } else if (event.event === 'ready') {
    live.port = event.port
    await update($, phase, () => 'ready')
    void pruneOthers($, id)
  } else if (event.event === 'level') {
    await update($, levels, now => [...now, event.rms].slice(-BARS))
    await update($, seconds, () => event.seconds)
  } else if (event.event === 'partial') {
    if ((await read($, phase)) === 'recording') {
      await fillPrompt($, live.base + (dropFillers(event.text) || PLACEHOLDER))
    }
  }
}

/** Once `id` has loaded, deletes every other downloaded model, so only the one in use takes disk space. */
async function pruneOthers($: EngineInterface, id: string) {
  // A download still running loads its model when done, and prunes then.
  if (await read($, download)) return
  const known = await read($, models)
  const answer = await manage($, ['prune', id])
  if (answer.event === 'error') {
    $.ui.toast(`Could not delete the old models: ${answer.text}`)
    return
  }
  if (answer.event !== 'done' || !answer.pruned?.length) return
  await refreshModels($)
  const names = answer.pruned.map(one => known.find(model => model.id === one)?.name ?? one)
  $.ui.toast(`Deleted ${names.join(', ')} to free ${size(answer.freed_mb ?? 0)}.`)
}

async function turnOff($: EngineInterface): Promise<string> {
  const was = await read($, phase)
  if (was === 'off') return 'Voice input is already off.'
  if (was === 'recording') {
    await post('/cancel', $)
    await fillPrompt($, live.draft)
  }
  // The engine answers /quit from its start, so this stops one still loading too.
  await post('/quit', $, live.enginePort)
  const stream = live.engine
  live.engine = undefined
  live.enginePort = undefined
  live.port = undefined
  // Ending the loop kills the child; nothing to wait for.
  void stream?.return(undefined as never).catch(() => undefined)
  await update($, phase, () => 'off')
  return 'Voice input is off; the model is unloaded.'
}

/** Restarts the engine on the active model when voice input is on; mid-recording, once it ends. */
async function reload($: EngineInterface) {
  const now = await read($, phase)
  if (now === 'recording' || now === 'finishing') {
    live.needsReload = true
    return
  }
  live.needsReload = false
  if (now === 'off') return
  await turnOff($)
  await turnOn($)
}

// --- Recording -------------------------------------------------------------------

async function startRecording($: EngineInterface) {
  if ((await read($, phase)) !== 'ready' || live.port === undefined) {
    await openPicker($)
    return
  }
  const box = await $.prompt.read()
  live.draft = box.text
  live.base = live.draft.trim() === '' ? '' : `${live.draft.trimEnd()} `
  const started = await post('/start', $)
  if (started.error) {
    $.ui.toast(`Could not open the microphone: ${String(started.error)}`)
    return
  }
  await update($, levels, () => [])
  await update($, seconds, () => 0)
  await update($, phase, () => 'recording')
  await fillPrompt($, live.base + PLACEHOLDER)
}

/** Stops the recording and resolves the whole prompt: the draft plus what was said. */
async function finishRecording($: EngineInterface): Promise<{ text: string; heard: string }> {
  await update($, phase, () => 'finishing')
  const stopped = await post('/stop', $)
  await update($, phase, () => (live.port === undefined ? 'off' : 'ready'))
  if (live.needsReload) void reload($)
  const heard = typeof stopped.text === 'string' ? dropFillers(stopped.text.trim()) : ''
  if (stopped.error) $.ui.toast(`Transcription failed: ${String(stopped.error)}`)
  if (heard && typeof stopped.ms === 'number' && live.engineModel) void recordSpeed($, live.engineModel, stopped.ms)
  return { text: heard ? live.base + heard : live.draft, heard }
}

/** Drops "uh", "um" and their kind, keeping the sentence's punctuation and capitals whole. */
function dropFillers(text: string): string {
  const kept: string[] = []
  let isCapitalNext = false
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const bare = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    if (!FILLER.test(bare)) {
      kept.push(isCapitalNext ? word.replace(/\p{L}/u, letter => letter.toUpperCase()) : word)
      isCapitalNext = false
      continue
    }
    const before = kept.at(-1)
    const ending = word.slice(word.indexOf(bare) + bare.length)
    const isSentenceStart = before === undefined || /[.!?…]$/.test(before)
    if (before !== undefined) {
      // "it, uh." ends the sentence at "it."; "want, um, the" reads "want the".
      if (/[.!?…]/.test(ending) && !/[.!?…]$/.test(before)) kept[kept.length - 1] = before.replace(/[,;:]+$/, '') + ending.replace(/[^.!?…]/g, '')
      else if (ending.startsWith(',') && before.endsWith(',')) kept[kept.length - 1] = before.slice(0, -1)
    }
    if (isSentenceStart && /^\p{Lu}/u.test(bare)) isCapitalNext = true
  }
  return kept.join(' ')
}

/** Keeps the last ten waits from Stop to text for a model, and their median for the picker. */
async function recordSpeed($: EngineInterface, id: string, ms: number) {
  try {
    const all = ((await $.store.get('speed')) ?? {}) as Record<string, number[]>
    const recent = [...(all[id] ?? []), ms].slice(-10)
    await $.store.set('speed', { ...all, [id]: recent })
    await update($, speeds, now => ({ ...now, [id]: median(recent) }))
  } catch {
    // A speed that is not kept only leaves the picker showing the catalog's word.
  }
}

/** Remembers whether voice input is on, so the next session starts the same way. */
async function rememberOn($: EngineInterface, isOn: boolean) {
  try {
    await $.store.set('isOn', isOn)
  } catch {
    // Not kept: the next session starts with voice off, as it did before.
  }
}

async function stopByButton($: EngineInterface) {
  if ((await read($, phase)) !== 'recording') return
  const done = await finishRecording($)
  const filled = await fillPrompt($, done.text)
  // Whatever the box made of that write, the placeholder never stays behind.
  if (filled.text.includes(PLACEHOLDER)) await fillPrompt($, filled.text.replace(PLACEHOLDER, '').trimEnd())
  if (!done.heard) $.ui.toast("Didn't catch any speech.")
}

// --- The model picker --------------------------------------------------------------

async function openPicker($: EngineInterface) {
  await refreshModels($)
  await update($, view, () => ({ kind: 'list' }) as HarkPickerView)
  await update($, isPickerOpen, () => true)
  const count = (await read($, models)).length
  await $.ui.open({ id: PICKER, title: 'Speech models', focus: true, closeOnEscape: true, holdToasts: true, rows: count + 5 })
}

async function closePicker($: EngineInterface) {
  await update($, isPickerOpen, () => false)
  await $.ui.close({ id: PICKER })
}

async function show($: EngineInterface, next: HarkPickerView, focusKey: string) {
  await update($, view, () => next)
  await $.ui.focus({ requestId: PICKER, key: focusKey }).catch(() => undefined)
}

async function choose($: EngineInterface, model: HarkModel) {
  const loading = await read($, download)
  if (loading?.id === model.id) return show($, { kind: 'progress', id: model.id }, 'background')
  if (!model.installed) return show($, { kind: 'install', id: model.id }, 'download')
  return show($, { kind: 'installed', id: model.id }, (await read($, active)) === model.id ? 'back' : 'use')
}

async function useModel($: EngineInterface, model: HarkModel) {
  const answer = await manage($, ['use', model.id])
  if (answer.event === 'error') {
    $.ui.toast(answer.text)
    return
  }
  await refreshModels($)
  await show($, { kind: 'list' }, `m-${model.id}`)
  await reload($)
}

async function deleteModel($: EngineInterface, model: HarkModel) {
  if ((await read($, active)) === model.id && (await read($, phase)) !== 'off') await turnOff($)
  const answer = await manage($, ['remove', model.id])
  if (answer.event === 'error') $.ui.toast(answer.text)
  await refreshModels($)
  await show($, { kind: 'list' }, `m-${model.id}`)
}

async function startInstall($: EngineInterface, model: HarkModel, isBackground: boolean) {
  if (await read($, download)) {
    $.ui.toast('Another model is still downloading; try again when it is done.')
    return
  }
  if (live.installer) {
    $.ui.toast('The cancelled download is still stopping; try again in a moment.')
    return
  }
  const py = await findPython($)
  if (!py) {
    $.ui.toast('Voice input needs Python 3.9 or newer, and none was found on PATH.')
    return
  }
  await update($, download, () => ({ id: model.id, name: model.name, step: 'Starting', done: 0, total: 0 }))
  if (isBackground) await closePicker($)
  else await show($, { kind: 'progress', id: model.id }, 'background')
  void runInstall($, py, model)
}

async function runInstall($: EngineInterface, py: string[], model: HarkModel) {
  const stream = $.process.spawn({ argv: [...py, script($), 'install', model.id] })
  live.installer = stream
  let pending = ''
  let outcome = ''
  try {
    for await (const chunk of stream) {
      // Leaving the loop kills the installer.
      if (live.isInstallCancelled) break
      if (chunk.stream === 'stderr') continue
      pending += chunk.text
      const cut = pending.lastIndexOf('\n')
      if (cut < 0) continue
      const complete = pending.slice(0, cut)
      pending = pending.slice(cut + 1)
      for (const event of parseLines(complete)) {
        if (event.event === 'step') {
          await update($, download, now => (now ? { ...now, step: event.text } : now))
        } else if (event.event === 'progress') {
          await update($, download, now => (now ? { ...now, done: event.done, total: event.total } : now))
        } else if (event.event === 'done') {
          outcome = 'done'
        } else if (event.event === 'error') {
          outcome = event.text
        }
      }
    }
  } catch (error) {
    outcome = outcome || String(error)
  }
  if (live.installer === stream) live.installer = undefined
  const isCancelled = live.isInstallCancelled && outcome !== 'done'
  live.isInstallCancelled = false
  if (isCancelled) {
    await manage($, ['discard', model.id])
    await refreshModels($)
    return
  }
  await update($, download, () => null)
  await refreshModels($)
  const current = await read($, view)
  const isWatching = (await read($, isPickerOpen)) && current.kind === 'progress' && current.id === model.id
  if (outcome !== 'done') {
    $.ui.toast(`Downloading ${model.name} failed: ${outcome || 'the download stopped'}`)
    if (isWatching) await show($, { kind: 'install', id: model.id }, 'download')
    return
  }
  if (isWatching) await show($, { kind: 'list' }, `m-${model.id}`)
  if (live.isWaitingToTurnOn) {
    if (isWatching) await closePicker($)
    await turnOn($)
    await rememberOn($, true)
  } else {
    $.ui.toast(`${model.name} is ready and in use.`)
    await reload($)
  }
}

/** Stops the running download at once; runInstall throws away what it fetched. */
async function cancelInstall($: EngineInterface) {
  const loading = await read($, download)
  if (!loading || !live.installer) return
  live.isInstallCancelled = true
  void live.installer.return(undefined as never).catch(() => undefined)
  await update($, download, () => null)
  $.ui.toast(`Cancelled downloading ${loading.name}.`)
  const current = await read($, view)
  if ((await read($, isPickerOpen)) && current.kind === 'progress') {
    await show($, { kind: 'install', id: current.id }, 'download')
  }
}

// --- Hooks -------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, phase, () => 'off')
    await update($, download, () => null)
    await update($, isPickerOpen, () => false)
    // Clears the status line entry an earlier version of hark left behind.
    $.ui.status(undefined)
    await $.command.register({
      name: 'hark',
      description: 'Turn voice input on or off',
      immediate: true,
    })
    await $.command.register({ name: 'hark-models', description: 'Choose, download or delete a speech model' })
    const started = await next(e)
    // Once per machine: say what hark is and the two commands that drive it.
    try {
      if ((await $.store.get('welcomed')) !== true) {
        const shown = await $.session
          .append({ message: { type: 'system', content: [{ type: 'text', text: WELCOME }] } })
          .then(() => true)
          .catch(() => false)
        if (!shown) $.ui.toast(WELCOME.split('\n')[0] ?? 'hark is installed')
        await $.store.set('welcomed', true)
      }
    } catch {
      // A missing welcome must not keep hark from starting.
    }
    try {
      const measured = ((await $.store.get('speed')) ?? {}) as Record<string, number[]>
      await update($, speeds, () => Object.fromEntries(Object.entries(measured).map(([id, waits]) => [id, median(waits)])))
      // Voice input was on when the last session ended: load it again, quietly.
      if ((await $.store.get('isOn')) === true) void turnOn($, true)
    } catch {
      // Without the store, hark starts off, as it always did.
    }
    return started
  })

  on('session.end', async ($, e, next) => {
    await post('/quit', $, live.enginePort)
    return next(e)
  })

  on('command.run', { command: 'hark' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const isOn = (await read($, phase)) !== 'off'
    if (wanted === 'on' || (wanted === '' && !isOn)) {
      const text = await turnOn($)
      await rememberOn($, (await read($, phase)) !== 'off')
      return { text }
    }
    const text = await turnOff($)
    await rememberOn($, false)
    return { text }
  })

  on('command.run', { command: 'hark-models' }, async $ => {
    await openPicker($)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PICKER) {
      await update($, isPickerOpen, () => false)
      await update($, view, () => ({ kind: 'list' }) as HarkPickerView)
    }
    return next(e)
  })

  // Enter while recording: stop, transcribe what is left, and send the prompt.
  on('prompt.submit', async ($, e, next) => {
    const isOurs = e.command === undefined && e.isMeta === undefined && e.origin.kind === 'composer'
    if (!isOurs || (await read($, phase)) !== 'recording') return next(e)
    const done = await finishRecording($)
    if (!done.heard && done.text.trim() === '') return { drop: "Didn't catch any speech, so nothing was sent." }
    return next({ ...e, text: done.text })
  }).catch(($, e, next) =>
    // If finishing failed, never send the placeholder as part of the prompt.
    next.called ? next(e) : next({ ...e, text: e.text.replace(PLACEHOLDER, '').trim() || e.text }),
  )

  // The voice line above the prompt: "hark: <model>" and the live bars on the
  // left, the Record or Stop button at the right end.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, phase)
    const loading = await read($, download)
    const showsDownload = loading !== null && !(await read($, isPickerOpen))
    if (now === 'off' && !showsDownload) return next(e)

    const left = [<Text key="label" color={PILL_LABEL}>hark: </Text>]
    if (now === 'off') {
      left.push(<Text key="name" color={PILL_TIMER}>voice off</Text>)
    } else {
      // The name opens the picker, as /hark-models does.
      left.push(
        <Button key="name" plain hover={{ backgroundColor: PILL_BG }} onPress={() => openPicker($)}>
          <Text color={PILL_LABEL} bold hover={{ backgroundColor: PILL_BG, color: WHITE }}>{await read($, modelName)}</Text>
        </Button>,
      )
    }
    if (now === 'loading') left.push(<Text key="loading" color={PILL_TIMER}>  loading…</Text>)
    if (now === 'recording') {
      left.push(<Text key="gap"> </Text>)
      for (const [index, rms] of padLevels(await read($, levels)).entries()) {
        left.push(<Text key={`bar-${index}`} color={ORANGE}>{barGlyph(rms)}</Text>)
      }
      left.push(<Text key="clock" color={PILL_TIMER}>  {clock(await read($, seconds))}</Text>)
    }
    if (showsDownload && loading) {
      left.push(<Text key="download" color={PILL_TIMER}>   ⬇ {loading.name} {bar(loading)} </Text>)
      left.push(
        <Button key="cancel-download" plain hover={{ backgroundColor: RED_DEEP, color: WHITE }} onPress={() => cancelInstall($)}>
          <Text color={RED} bold hover={{ backgroundColor: RED_DEEP, color: WHITE }}>{' ✕ '}</Text>
        </Button>,
      )
    }

    let right
    if (now === 'ready' || now === 'finishing') {
      right = (
        <Box key="record-box">
        <Button key="record" plain hover={{ backgroundColor: PILL_BG, color: RED }} onPress={() => startRecording($)}>
          <Text backgroundColor={PILL_BG} color={RED} bold hover={{ backgroundColor: PILL_BG, color: RED }}>{' ● Record '}</Text>
        </Button>
        </Box>
      )
    } else if (now === 'recording') {
      right = (
        <Box key="stop-box">
        <Button key="stop" plain hover={{ backgroundColor: RED_DEEP, color: WHITE }} onPress={() => stopByButton($)}>
          <Text backgroundColor={RED_DEEP} color={WHITE} bold hover={{ backgroundColor: RED_DEEP, color: WHITE }}>{' ■ Stop '}</Text>
        </Button>
        </Box>
      )
    }

    return (
      <Box width={e.props.bodyColumns} justifyContent="space-between">
        <Box key="left">{left}</Box>
        {right ?? <Box key="right" />}
      </Box>
    )
  })

  // The model picker: a list driven by the arrows, and a question per model.
  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, models)
    const inUse = await read($, active)
    const current = await read($, view)
    const loading = await read($, download)
    const width = Math.max(40, e.props.bodyColumns)
    const footer = (hint: string) => <Text key="footer" color={QUIET}>{hint}</Text>

    if (current.kind === 'list') {
      const nameWidth = 24
      const fixed = 2 + nameWidth + 9 + 11 + 11
      const speedWidth = width - fixed >= 11 ? 11 : 0
      const languageWidth = width - fixed - speedWidth >= 13 ? 13 : 0
      const measured = await read($, speeds)
      const focusKey = `m-${inUse ?? list.find(one => one.recommended)?.id ?? list[0]?.id}`
      return (
        <Box flexDirection="column">
          <Text key="head" bold>Speech models</Text>
          <Text key="columns" color={QUIET}>
            {'  ' + fit('Model', nameWidth) + fit('Languages', languageWidth) + fit('Download', 9) + fit('RAM', 11) + fit('Speed', speedWidth) + 'Accuracy'}
          </Text>
          {list.map(model => (
            <Button key={`m-${model.id}`} plain autoFocus={`m-${model.id}` === focusKey ? true : undefined} onPress={() => choose($, model)}>
              <Text color={GREEN}>{model.id === inUse ? '✓ ' : '  '}</Text>
              <Text bold={model.id === inUse}>{fit(model.name, nameWidth)}</Text>
              <Text color={PILL_TIMER}>{fit(shortLanguages(model), languageWidth)}</Text>
              <Text>{fit(size(model.size_mb), 9)}</Text>
              <Text color={PILL_TIMER}>{fit(`~${size(model.ram_mb)}`, 11)}</Text>
              {measured[model.id] === undefined ? (
                <Text color={QUIET}>{fit(model.speed.replace(' on CPU', ''), speedWidth)}</Text>
              ) : (
                <Text color={PILL_LABEL}>{fit(waitText(measured[model.id]), speedWidth)}</Text>
              )}
              <Text color={accuracyColor(model.accuracy)}>{loading?.id === model.id ? `⬇ ${percent(loading)}` : model.accuracy}</Text>
            </Button>
          ))}
          {footer('↑↓ select · Enter choose · Esc close')}
        </Box>
      )
    }

    const model = list.find(one => one.id === current.id)
    if (!model) return footer('That model is gone. Esc close')
    const wait = (await read($, speeds))[model.id]
    const facts =
      `${size(model.size_mb)} download · about ${size(model.ram_mb)} RAM · ${allLanguages(model)} · ${model.accuracy} accuracy` +
      (wait === undefined ? '' : ` · text ${waitText(wait)} after Stop on this machine`)
    const back = <Button key="back" label="Back" onPress={() => show($, { kind: 'list' }, `m-${model.id}`)} />

    if (current.kind === 'install') {
      return (
        <Box flexDirection="column">
          <Text key="ask" bold>Download {model.name}?</Text>
          <Text key="facts" color={PILL_TIMER}>{facts}</Text>
          <Box key="actions" marginTop={1}>
            <Button key="download" label="Download" variant="primary" autoFocus onPress={() => startInstall($, model, false)} />
            <Button key="bg" label="Download in background" onPress={() => startInstall($, model, true)} />
            {back}
          </Box>
          {footer('←→ select · Enter choose · Esc close')}
        </Box>
      )
    }
    if (current.kind === 'progress') {
      return (
        <Box flexDirection="column">
          <Text key="ask" bold>Downloading {model.name}</Text>
          <Text key="step" color={PILL_TIMER}>{loading?.id === model.id ? loading.step : 'Finishing'}</Text>
          {loading?.id === model.id && <Text key="bar" color={PURPLE_LIGHT}>{bar(loading)}</Text>}
          <Box key="actions" marginTop={1}>
            <Button key="background" label="Continue in background" autoFocus onPress={() => closePicker($)} />
            <Button key="cancel" plain hover={{ backgroundColor: RED_DEEP, color: WHITE }} onPress={() => cancelInstall($)}>
              <Text color={RED} bold hover={{ backgroundColor: RED_DEEP, color: WHITE }}>{' ✕ Cancel download '}</Text>
            </Button>
          </Box>
          {footer('←→ select · Enter choose · Esc keeps it downloading in the background')}
        </Box>
      )
    }
    if (current.kind === 'delete') {
      return (
        <Box flexDirection="column">
          <Text key="ask" bold>Delete {model.name}?</Text>
          <Text key="facts" color={PILL_TIMER}>Frees {size(model.size_mb)}. You can download it again later.</Text>
          <Box key="actions" marginTop={1}>
            <Button key="delete" label="Delete" autoFocus onPress={() => deleteModel($, model)} />
            <Button key="cancel" label="Cancel" onPress={() => show($, { kind: 'installed', id: model.id }, 'back')} />
          </Box>
          {footer('←→ select · Enter choose · Esc close')}
        </Box>
      )
    }
    const isInUse = model.id === inUse
    return (
      <Box flexDirection="column">
        <Text key="ask" bold>{model.name} {isInUse ? <Text color={GREEN}>✓ in use</Text> : <Text color={PILL_TIMER}>installed</Text>}</Text>
        <Text key="facts" color={PILL_TIMER}>{facts}</Text>
        <Box key="actions" marginTop={1}>
          {!isInUse && <Button key="use" label="Use this model" variant="primary" autoFocus onPress={() => useModel($, model)} />}
          <Button key="delete" label="Delete" onPress={() => show($, { kind: 'delete', id: model.id }, 'cancel')} />
          {back}
        </Box>
        {footer('←→ select · Enter choose · Esc close')}
      </Box>
    )
  })
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length >= width) return `${text.slice(0, width - 2)}… `
  return text.padEnd(width, ' ')
}

/** Up to three languages by name; past that the main one and a count: "English +98". */
function shortLanguages(model: HarkModel): string {
  const count = model.language_count ?? model.languages.length
  if (count <= 3) return model.languages.join(', ')
  return `${model.languages[0]} +${count - 1}`
}

/** Every language by name where the catalog names them all, else "English and 98 more". */
function allLanguages(model: HarkModel): string {
  const count = model.language_count ?? model.languages.length
  if (count === model.languages.length) return model.languages.join(', ')
  return `${model.languages.join(', ')} and ${count - model.languages.length} more`
}

/** A wait in ms as the picker shows it: "0.4 s". */
function waitText(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function size(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`
}

function percent(loading: HarkDownload): string {
  return loading.total > 0 ? `${Math.floor((loading.done / loading.total) * 100)}%` : '…'
}

function bar(loading: HarkDownload): string {
  if (loading.total <= 0) return loading.step
  const fraction = loading.done / loading.total
  const filled = Math.max(0, Math.min(12, Math.round(fraction * 12)))
  return `${'█'.repeat(filled)}${'░'.repeat(12 - filled)} ${percent(loading)}`
}

function accuracyColor(accuracy: string): string {
  if (accuracy === 'best' || accuracy === 'excellent') return GREEN
  if (accuracy === 'very good') return '#9FDFB5'
  if (accuracy === 'good') return PILL_LABEL
  return PILL_TIMER
}

function clock(total: number): string {
  const whole = Math.floor(total)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function padLevels(heard: number[]): number[] {
  return [...Array<number>(Math.max(0, BARS - heard.length)).fill(0), ...heard]
}

function loudness(rms: number): number {
  return Math.min(1, Math.sqrt(rms * 14))
}

function barGlyph(rms: number): string {
  const steps = '▁▂▃▄▅▆▇█'
  return steps[Math.min(7, Math.round(loudness(rms) * 7))] ?? '▁'
}
