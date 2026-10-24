import type { Git } from '../types'

// What `git status --porcelain=v1 --branch` prints: the "## branch...upstream
// [ahead 1, behind 2]" header, then one "XY path" row per changed file.
export function parseGit(stdout: string): NonNullable<Git> {
  const [head = '', ...rows] = stdout.split('\n')
  const line = head.replace(/^## (No commits yet on )?/, '')
  const name = line.split('...')[0]?.split(' ')[0] ?? ''
  const branch = name === '' || name === 'HEAD' ? 'detached' : name
  const counts = /\[(.*)\]$/.exec(line)?.[1] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(counts)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(counts)?.[1] ?? 0)
  const files = rows
    .filter(row => row.length > 3)
    .map(row => ({ status: row.slice(0, 2).trim() || '?', path: row.slice(3) }))
  return { branch, ahead, behind, files }
}
