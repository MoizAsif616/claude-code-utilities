import type { Settings } from '../types'

export const DEFAULTS: Settings = {
  isEnabled: true,
  prompt: { width: 70, lines: 6, time: true },
  response: { width: 85, fold: true },
  code: { width: 75 },
}

export type Section = 'prompt' | 'response' | 'code'

type Field =
  | { kind: 'number'; min: number; max: number; about: string }
  | { kind: 'switch'; about: string }
  | { kind: 'choice'; options: readonly string[]; about: string }

// Every setting a command takes, in the order its help lists them.
export const FIELDS: { [S in Section]: Record<string, Field> } = {
  prompt: {
    width: { kind: 'number', min: 30, max: 100, about: 'widest the prompt pill gets, in % of the terminal' },
    lines: { kind: 'number', min: 1, max: 50, about: 'lines of a long prompt shown before it folds' },
    time: { kind: 'switch', about: 'the time under each prompt' },
  },
  response: {
    width: { kind: 'number', min: 40, max: 100, about: 'widest replies and tool output get, in % of the terminal' },
    fold: { kind: 'switch', about: 'fold runs of reads and searches into one line' },
  },
  code: {
    width: { kind: 'number', min: 30, max: 100, about: 'widest an edit\'s added and removed lines get, in % of the terminal' },
  },
}

export const COMMANDS: { [S in Section]: { name: string; description: string; example: string } } = {
  prompt: { name: 'prettier-prompt', description: 'Prompt pill: width, lines, time', example: 'width 60 lines 4' },
  response: { name: 'prettier-response', description: 'Replies and tool output: width, fold', example: 'width 80 fold off' },
  code: { name: 'prettier-code', description: 'Code diffs: width', example: 'width 70' },
}

export const EXPAND_HINT = 'Press ctrl+o to see full tool calls, their output and long prompts; ctrl+o again to go back.'

function fieldValue(field: Field, value: unknown): string {
  if (field.kind === 'switch') return value === true ? 'on' : 'off'
  return String(value)
}

function fieldRange(field: Field): string {
  if (field.kind === 'number') return `${field.min}–${field.max}`
  if (field.kind === 'switch') return 'on | off'
  return field.options.join(' | ')
}

// The settings a stored value holds, every missing or invalid one at its default.
export function mergeSettings(stored: unknown): Settings {
  const out: Settings = structuredClone(DEFAULTS)
  if (stored === null || typeof stored !== 'object') return out
  const s = stored as Record<string, unknown>
  if (typeof s.isEnabled === 'boolean') out.isEnabled = s.isEnabled
  for (const section of Object.keys(FIELDS) as Section[]) {
    const given = s[section]
    if (given === null || typeof given !== 'object') continue
    const target = out[section] as Record<string, unknown>
    for (const [key, field] of Object.entries(FIELDS[section])) {
      const v = (given as Record<string, unknown>)[key]
      if (field.kind === 'number' && typeof v === 'number' && v >= field.min && v <= field.max) target[key] = v
      if (field.kind === 'switch' && typeof v === 'boolean') target[key] = v
      if (field.kind === 'choice' && typeof v === 'string' && field.options.includes(v)) target[key] = v
    }
  }
  return out
}

export type Applied = { settings: Settings; changed: string[]; errors: string[] }

// Applies `width 60 lines 4` (pairs of name and value) to one section.
export function applyArgs(settings: Settings, section: Section, args: string): Applied {
  const out: Settings = structuredClone(settings)
  const target = out[section] as Record<string, unknown>
  const fields = FIELDS[section]
  const words = args.trim().toLowerCase().split(/\s+/).filter(w => w !== '')
  const changed: string[] = []
  const errors: string[] = []
  for (let i = 0; i < words.length; i += 2) {
    const name = words[i] ?? ''
    const raw = words[i + 1]
    const field = fields[name]
    if (field === undefined) {
      errors.push(`\`${name}\` is not a setting here; the settings are ${Object.keys(fields).map(k => `\`${k}\``).join(', ')}`)
      continue
    }
    if (raw === undefined) {
      errors.push(`\`${name}\` needs a value: ${fieldRange(field)}`)
      continue
    }
    if (field.kind === 'number') {
      const n = Number(raw.replace(/%$/, ''))
      if (!Number.isInteger(n) || n < field.min || n > field.max) {
        errors.push(`\`${name}\` must be a whole number from ${field.min} to ${field.max}`)
        continue
      }
      target[name] = n
    } else if (field.kind === 'switch') {
      if (raw !== 'on' && raw !== 'off') {
        errors.push(`\`${name}\` must be on or off`)
        continue
      }
      target[name] = raw === 'on'
    } else {
      if (!field.options.includes(raw)) {
        errors.push(`\`${name}\` must be one of ${field.options.join(', ')}`)
        continue
      }
      target[name] = raw
    }
    changed.push(`${name} ${raw.replace(/%$/, '')}`)
  }
  return { settings: out, changed, errors }
}

// What a command prints with no arguments: each setting, its value and what it does.
export function describeSection(settings: Settings, section: Section): string {
  const { name, example } = COMMANDS[section]
  const values = settings[section] as Record<string, unknown>
  const lines = Object.entries(FIELDS[section]).map(
    ([key, field]) => `- \`${key} ${fieldValue(field, values[key])}\` ${field.about} (${fieldRange(field)})`,
  )
  return [...lines, '', `To change: \`/${name} ${example}\``].join('\n')
}

// What /prettier prints with no arguments: the switch, the three commands, the key.
export function describeAll(settings: Settings): string {
  return [
    `prettier is **${settings.isEnabled ? 'on' : 'off'}**. \`/prettier on\`, \`/prettier off\`, \`/prettier reset\` (every setting back to its default).`,
    '',
    ...(Object.keys(COMMANDS) as Section[]).map(s => `- \`/${COMMANDS[s].name}\` ${COMMANDS[s].description.toLowerCase()}`),
    '',
    EXPAND_HINT,
  ].join('\n')
}
