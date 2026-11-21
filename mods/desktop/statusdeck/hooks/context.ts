import type { ContextItem } from '../types'

// Plain-text helpers for the context panel: reading the skill listing the
// engine sends, and taking turned-off skills, tools and servers out of the
// texts the model reads. None of them touches `$`.

// MCP servers the desktop app itself runs on (its session, turn and window
// plumbing): the app does not work without them, so they cannot be turned off.
const LOCKED_SERVERS = /^ccd_/

// "mcp__server__tool" names its server; a built-in tool names none.
export function serverOf(tool: string): string | null {
  const m = /^mcp__(.+?)__/.exec(tool)
  return m?.[1] ?? null
}

export function shortTool(tool: string): string {
  const server = serverOf(tool)
  return server === null ? tool : tool.slice(`mcp__${server}__`.length)
}

export function isLockedTool(tool: string): boolean {
  const server = serverOf(tool)
  return server !== null && LOCKED_SERVERS.test(server)
}

// The listing is one "- name: description" entry per skill, a description
// running on over the lines that follow until the next entry. A name holds
// no spaces but may hold colons ("plugin:skill"), so it runs to the colon
// and space that open the description.
export function parseSkills(text: string): ContextItem[] {
  const skills: ContextItem[] = []
  for (const block of text.split(/^(?=- )/m)) {
    const m = /^- (\S+): ([\s\S]*)$/.exec(block.trim())
    if (m === null) continue
    const description = (m[2] ?? '').split('\n')[0] ?? ''
    skills.push({ name: m[1] ?? '', description: description.trim() })
  }
  return skills
}

export function withoutSkills(text: string, off: ReadonlySet<string>): string {
  if (off.size === 0) return text
  return text
    .split(/^(?=- )/m)
    .filter(block => {
      const m = /^- (\S+): /.exec(block)
      return m === null || !off.has(m[1] ?? '')
    })
    .join('')
}

// The deferred-tool notices list one tool name per line.
export function withoutNames(text: string, off: ReadonlySet<string>): string {
  if (off.size === 0) return text
  return text
    .split('\n')
    .filter(line => !off.has(line.trim()))
    .join('\n')
}

// The system prompt's MCP instructions: one "## server" block per server.
export function withoutServers(text: string, off: ReadonlySet<string>): string {
  if (off.size === 0 || !text.includes('# MCP Server Instructions')) return text
  return text
    .split(/^(?=## )/m)
    .filter(block => {
      const m = /^## (.+)$/m.exec(block)
      return m === null || !block.startsWith('## ') || !off.has((m[1] ?? '').trim())
    })
    .join('')
}

// ToolSearch answers with one "<function>{...}</function>" line per tool.
export function withoutFunctions(text: string, off: ReadonlySet<string>): string {
  if (off.size === 0) return text
  return text
    .split('\n')
    .filter(line => {
      const m = /"name":\s*"([^"]+)"/.exec(line)
      return m === null || !line.includes('<function>') || !off.has(m[1] ?? '')
    })
    .join('\n')
}
