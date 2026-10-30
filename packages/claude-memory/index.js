/**
 * Host half of the Claude-memory bridge plugin.
 *
 * Registers three read-only, model-facing tools that let DSH read and search
 * the memory Claude Code keeps on this machine:
 *
 *   - per-project auto memory: ~/.claude/projects/<project>/memory/
 *     (a MEMORY.md index plus one file per memory)
 *   - user instructions: ~/.claude/CLAUDE.md
 *   - user rules: ~/.claude/rules/**.md
 *
 * The Claude config dir is $CLAUDE_CONFIG_DIR when set, else ~/.claude. The
 * <project> directory name is the project's git repository root path with every
 * non-alphanumeric character replaced by '-' (worktrees resolve to the main
 * repository, matching Claude Code). Nothing is ever written and no network is
 * used; file reads stay inside the Claude config dir.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'claude-memory'
export const inject = ['tools']

const DEFAULT_LIST_LIMIT = 30
const MAX_LIST_LIMIT = 500
const DEFAULT_SEARCH_LIMIT = 25
const MAX_SEARCH_LIMIT = 200
const DEFAULT_READ_LINES = 400
const MAX_READ_LINES = 2000
const MAX_QUERY_CHARS = 200
const MAX_SCAN_BYTES = 2 * 1024 * 1024
const MAX_READ_BYTES = 64 * 1024
const MAX_MATCHES_PER_FILE = 10
const MAX_LINE_CHARS = 240
const WALK_MAX_DEPTH = 4
const USER_FILES_LIMIT = 20

// ---------------------------------------------------------------------------
// Claude config dir, project slug, git root
// ---------------------------------------------------------------------------

/** The Claude config dir: $CLAUDE_CONFIG_DIR when set, else ~/.claude. */
export function claudeConfigDir(env = process.env) {
  const raw = typeof env.CLAUDE_CONFIG_DIR === 'string' ? env.CLAUDE_CONFIG_DIR.trim() : ''
  return raw === '' ? path.join(homedir(), '.claude') : path.resolve(raw)
}

/** Claude Code's <project> dir name: every non-alphanumeric character becomes '-'. */
export function projectSlug(target) {
  return String(target).replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * Walk up from `startDir` to the enclosing git repository root, or null when
 * there is none. A `.git` file (worktree) resolves to the main repository so
 * memory stays shared across worktrees, matching Claude Code.
 */
export async function findRepoRoot(startDir) {
  let dir = path.resolve(startDir)
  for (;;) {
    const marker = path.join(dir, '.git')
    let info
    try {
      info = await stat(marker)
    } catch {
      info = undefined
    }
    if (info?.isDirectory() === true) return dir
    if (info?.isFile() === true) {
      try {
        const text = await readFile(marker, 'utf8')
        const match = /^gitdir:\s*(.+?)\s*$/m.exec(text)
        if (match !== null) {
          const gitdir = path.resolve(dir, match[1])
          const worktree = /^(.*)[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/.exec(gitdir)
          if (worktree !== null) return worktree[1]
        }
      } catch {
        // unreadable .git file: treat this directory as the root
      }
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(target) {
  try {
    return (await stat(target)).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the memory project for a session directory. Candidates are the git
 * repository root (preferred) and the directory itself; the first one with an
 * existing memory dir wins. When neither exists, the repository root (or the
 * directory itself outside a repository) is reported as the expected location.
 */
export async function resolveMemoryProject(cwd, configDir) {
  const start = path.resolve(cwd)
  const candidates = []
  const repo = await findRepoRoot(start)
  if (repo !== null) candidates.push(repo)
  if (!candidates.includes(start)) candidates.push(start)
  for (const candidate of candidates) {
    const memoryDir = path.join(configDir, 'projects', projectSlug(candidate), 'memory')
    if (await isDirectory(memoryDir)) return { root: candidate, memoryDir, exists: true }
  }
  const root = candidates[0]
  return {
    root,
    memoryDir: path.join(configDir, 'projects', projectSlug(root), 'memory'),
    exists: false,
  }
}

// ---------------------------------------------------------------------------
// Memory files
// ---------------------------------------------------------------------------

/** Collect markdown files under a directory (depth-limited; skips large files). */
async function collectMarkdownFiles(dir, depth = 0) {
  const found = []
  if (depth > WALK_MAX_DEPTH) return found
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await collectMarkdownFiles(full, depth + 1)))
      continue
    }
    if (!entry.name.toLowerCase().endsWith('.md')) continue
    try {
      const info = await stat(full)
      if (info.isFile() && info.size <= MAX_SCAN_BYTES) {
        found.push({ file: full, size: info.size, mtimeMs: info.mtimeMs })
      }
    } catch {
      // unreadable entry: skip
    }
  }
  return found
}

function unquote(value) {
  const text = String(value).trim()
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1)
  }
  return text
}

function firstBodyLine(body) {
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line === '' || line === '---') continue
    return line.replace(/^#+\s*/, '').slice(0, 160)
  }
  return ''
}

/**
 * Parse the lightweight YAML frontmatter Claude Code writes on memory files
 * (name, description, metadata.type, modified). Falls back to the file name,
 * its first body line, and the file mtime.
 */
export function parseMemoryFile(text, fallbackName, mtimeMs = 0) {
  const meta = {}
  let body = text
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end !== -1) {
      body = text.slice(end + 4)
      let section = ''
      for (const raw of text.slice(3, end).split('\n')) {
        if (raw.trim() === '') continue
        const indented = /^\s/.test(raw)
        const kv = /^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw)
        if (kv === null) {
          section = ''
          continue
        }
        const key = kv[1]
        const value = unquote(kv[2])
        if (!indented) {
          section = value === '' ? key : ''
          if (key === 'name' || key === 'description' || key === 'modified') meta[key] = value
          continue
        }
        if (section === 'metadata' && (key === 'type' || key === 'modified')) meta[key] = value
      }
    }
  }
  const modifiedMs = meta.modified !== undefined ? Date.parse(meta.modified) : Number.NaN
  return {
    name: meta.name !== undefined && meta.name !== '' ? meta.name : fallbackName,
    description: meta.description !== undefined && meta.description !== '' ? meta.description : firstBodyLine(body),
    type: meta.type !== undefined && meta.type !== '' ? meta.type : null,
    modifiedMs: Number.isFinite(modifiedMs) ? modifiedMs : mtimeMs,
  }
}

/** Read every markdown memory in one memory dir, newest first. */
async function scanMemoryDir(memoryDir) {
  const files = await collectMarkdownFiles(memoryDir)
  const entries = []
  for (const file of files) {
    let text
    try {
      text = await readFile(file.file, 'utf8')
    } catch {
      continue
    }
    entries.push({
      path: file.file,
      size: file.size,
      ...parseMemoryFile(text.replace(/^﻿/, ''), path.basename(file.file), file.mtimeMs),
    })
  }
  entries.sort((a, b) => b.modifiedMs - a.modifiedMs)
  return entries
}

/** User-level memory files: ~/.claude/CLAUDE.md and ~/.claude/rules/**.md. */
async function scanUserFiles(configDir) {
  const entries = []
  const claudeMd = path.join(configDir, 'CLAUDE.md')
  if (await isFile(claudeMd)) {
    try {
      const info = await stat(claudeMd)
      const text = await readFile(claudeMd, 'utf8')
      entries.push({
        path: claudeMd,
        size: info.size,
        kind: 'user instructions',
        ...parseMemoryFile(text.replace(/^﻿/, ''), 'CLAUDE.md', info.mtimeMs),
      })
    } catch {
      // unreadable: skip
    }
  }
  for (const file of await collectMarkdownFiles(path.join(configDir, 'rules'))) {
    try {
      const text = await readFile(file.file, 'utf8')
      entries.push({
        path: file.file,
        size: file.size,
        kind: 'user rule',
        ...parseMemoryFile(text.replace(/^﻿/, ''), path.basename(file.file), file.mtimeMs),
      })
    } catch {
      // unreadable: skip
    }
  }
  entries.sort((a, b) => b.modifiedMs - a.modifiedMs)
  return entries
}

/** Every project directory under <configDir>/projects with a memory dir. */
async function listMemoryProjects(configDir) {
  const projectsRoot = path.join(configDir, 'projects')
  let entries
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const memoryDir = path.join(projectsRoot, entry.name, 'memory')
    if (await isDirectory(memoryDir)) projects.push({ slug: entry.name, memoryDir })
  }
  return projects
}

// ---------------------------------------------------------------------------
// Scope resolution and argument validation
// ---------------------------------------------------------------------------

function sessionCwdOf(ctx, exec) {
  const session = exec?.agent?.session
  if (session !== undefined && session !== null) {
    try {
      const workingDirectory = ctx?.get?.('workingDirectory')
      if (workingDirectory !== undefined && typeof workingDirectory.get === 'function') {
        const current = workingDirectory.get(session)
        if (typeof current === 'string' && current !== '') return current
      }
    } catch {
      // fall through to the session header
    }
    const headerCwd = session.header?.cwd
    if (typeof headerCwd === 'string' && headerCwd !== '') return headerCwd
  }
  return process.cwd()
}

/** Exposed for tests; prefer the tools' own resolution. */
export { sessionCwdOf as sessionCwd }

function expandTilde(target) {
  if (target === '~') return homedir()
  if (target.startsWith('~/')) return path.join(homedir(), target.slice(2))
  return target
}

/**
 * Expand the `project` argument into memory dirs to read.
 * Returns { description, projects, missing } where `missing` carries a
 * human-readable note when nothing matched.
 */
async function resolveMemoryScope(ctx, exec, projectArg, configDir) {
  if (projectArg === 'all') {
    const projects = await listMemoryProjects(configDir)
    return { description: 'all projects', projects, missing: null }
  }
  if (projectArg === 'current') {
    const project = await resolveMemoryProject(sessionCwdOf(ctx, exec), configDir)
    if (!project.exists) {
      return {
        description: `project ${project.root}`,
        projects: [],
        missing: `No Claude memory directory exists for ${project.root} (expected ${project.memoryDir}). Use project "all" to browse every project.`,
      }
    }
    return {
      description: `project ${project.root}`,
      projects: [{ slug: projectSlug(project.root), memoryDir: project.memoryDir }],
      missing: null,
    }
  }
  if (projectArg.startsWith('~') || projectArg.startsWith('/') || projectArg.includes('/')) {
    const expanded = path.resolve(expandTilde(projectArg))
    const project = await resolveMemoryProject(expanded, configDir)
    if (!project.exists) {
      return {
        description: `project ${expanded}`,
        projects: [],
        missing: `No Claude memory directory exists for ${expanded} (expected ${project.memoryDir}).`,
      }
    }
    return {
      description: `project ${project.root}`,
      projects: [{ slug: projectSlug(project.root), memoryDir: project.memoryDir }],
      missing: null,
    }
  }
  const memoryDir = path.join(configDir, 'projects', projectArg, 'memory')
  if (await isDirectory(memoryDir)) {
    return { description: `project ${projectArg}`, projects: [{ slug: projectArg, memoryDir }], missing: null }
  }
  const all = await listMemoryProjects(configDir)
  const similar = all
    .map((p) => p.slug)
    .filter((slug) => slug.includes(projectArg))
    .slice(0, 5)
  return {
    description: `project ${projectArg}`,
    projects: [],
    missing: `No project directory ${JSON.stringify(projectArg)} under ${path.join(configDir, 'projects')}.${
      similar.length > 0 ? ` Similar: ${similar.join(', ')}` : ''
    }`,
  }
}

function stringArg(value, key) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`"${key}" must be a non-empty string`)
  }
  return value.trim()
}

function optionalStringArg(value, key) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`"${key}" must be a non-empty string when given`)
  }
  return value.trim()
}

function numberArg(value, fallback, max, key, min = 1) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`"${key}" must be a finite number`)
  }
  const n = Math.floor(value)
  if (n < min || n > max) throw new Error(`"${key}" must be between ${min} and ${max}`)
  return n
}

function throwIfAborted(exec) {
  if (exec?.signal?.aborted === true) throw new Error('claude-memory: canceled')
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatTime(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function snippet(text, max = 100) {
  const one = String(text).replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`
}

/** Path as the model should see it: config-dir relative, ~-based, or absolute. */
function displayPath(target, configDir) {
  const rel = path.relative(configDir, target)
  if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel
  const home = homedir()
  if (target === home) return '~'
  if (target.startsWith(home + path.sep)) return `~${target.slice(home.length)}`
  return target
}

function typeLabel(entry) {
  if (entry.type !== null && entry.type !== undefined) return entry.type
  if (/^MEMORY\.md$/i.test(path.basename(entry.path))) return 'index'
  return 'memory'
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const RENDER_TEXT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

const PROJECT_PARAM = {
  type: 'string',
  description:
    '"current" (default) = the session\'s project, resolved to its git repository root like Claude Code does; "all" = every project; a project path; or a directory name under the Claude projects dir.',
}

export function createToolDefinitions(ctx) {
  const listTool = {
    name: 'claude_memory_list',
    description:
      'List the memories Claude Code saved on this machine, newest first. Sources: per-project auto memory (~/.claude/projects/<project>/memory — the MEMORY.md index plus one file per memory), user-level instructions (~/.claude/CLAUDE.md), and user rules (~/.claude/rules). Each entry shows modified time, memory type (user/feedback/project/reference when recorded), a file path usable with claude_memory_read, and the description.',
    parameters: {
      type: 'object',
      properties: {
        project: PROJECT_PARAM,
        limit: { type: 'number', description: `Maximum entries to show (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}).` },
      },
      additionalProperties: false,
    },
    output: RENDER_TEXT,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'List Claude memory', kind: 'other' }),
    async execute(args, exec) {
      const configDir = claudeConfigDir()
      const limit = numberArg(args?.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, 'limit')
      const projectArg = optionalStringArg(args?.project, 'project') ?? 'current'
      const scope = await resolveMemoryScope(ctx, exec, projectArg, configDir)

      const groups = []
      let total = 0
      for (const project of scope.projects) {
        throwIfAborted(exec)
        const entries = await scanMemoryDir(project.memoryDir)
        total += entries.length
        groups.push({ slug: project.slug, memoryDir: project.memoryDir, entries })
      }
      groups.sort((a, b) => (b.entries[0]?.modifiedMs ?? 0) - (a.entries[0]?.modifiedMs ?? 0))

      const userFiles = await scanUserFiles(configDir)
      const lines = []
      if (projectArg === 'current') {
        const root = scope.projects[0] !== undefined ? scope.projects[0].memoryDir : null
        lines.push(`Claude memory for ${scope.description}`)
        if (root !== null) {
          lines.push(`memory dir: ${displayPath(root, configDir)} — ${total} entries`)
        }
      } else {
        lines.push(
          `Claude memory — ${scope.description}: ${groups.length} project(s) with memory, ${total} entries (newest first, showing up to ${limit})`,
        )
      }
      if (scope.missing !== null) lines.push('', scope.missing)
      lines.push('')

      let shown = 0
      let remaining = 0
      for (const group of groups) {
        if (shown >= limit) {
          remaining += group.entries.length
          continue
        }
        lines.push(`## ${group.slug} — ${group.entries.length} entries (${displayPath(group.memoryDir, configDir)})`)
        for (const entry of group.entries) {
          if (shown >= limit) {
            remaining += 1
            continue
          }
          const desc = entry.description !== '' ? ` — ${snippet(entry.description)}` : ''
          lines.push(
            `${formatTime(entry.modifiedMs)}  [${typeLabel(entry)}]  ${displayPath(entry.path, configDir)}${desc}`,
          )
          shown += 1
        }
        lines.push('')
      }
      if (remaining > 0) lines.push(`… ${remaining} more entries not shown (raise limit or use claude_memory_search)`)

      if (userFiles.length > 0) {
        lines.push('', '## user (~/.claude)')
        for (const entry of userFiles.slice(0, USER_FILES_LIMIT)) {
          const desc = entry.description !== '' ? ` — ${snippet(entry.description)}` : ''
          lines.push(
            `${formatTime(entry.modifiedMs)}  [${entry.kind}]  ${displayPath(entry.path, configDir)}${desc}`,
          )
        }
      }
      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    },
  }

  const searchTool = {
    name: 'claude_memory_search',
    description:
      'Search the full text of Claude Code memories (per-project auto memory files, user CLAUDE.md and rules) for a case-insensitive substring. Returns matching files newest first with line numbers and matching lines. Use claude_memory_list first to discover what exists.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to find (case-insensitive).' },
        project: PROJECT_PARAM,
        limit: { type: 'number', description: `Maximum matching lines to show (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).` },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: RENDER_TEXT,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: typeof args?.query === 'string' ? `Search Claude memory: ${snippet(args.query, 60)}` : 'Search Claude memory',
      kind: 'search',
    }),
    async execute(args, exec) {
      const query = stringArg(args?.query, 'query').slice(0, MAX_QUERY_CHARS)
      const limit = numberArg(args?.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, 'limit')
      const projectArg = optionalStringArg(args?.project, 'project') ?? 'current'
      const configDir = claudeConfigDir()
      const scope = await resolveMemoryScope(ctx, exec, projectArg, configDir)

      const files = []
      for (const project of scope.projects) {
        for (const file of await collectMarkdownFiles(project.memoryDir)) {
          files.push({ ...file, project: project.slug })
        }
      }
      const claudeMd = path.join(configDir, 'CLAUDE.md')
      if (await isFile(claudeMd)) {
        try {
          const info = await stat(claudeMd)
          if (info.size <= MAX_SCAN_BYTES) files.push({ file: claudeMd, size: info.size, mtimeMs: info.mtimeMs, project: 'user' })
        } catch {
          // skip
        }
      }
      for (const file of await collectMarkdownFiles(path.join(configDir, 'rules'))) {
        files.push({ ...file, project: 'user' })
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs)

      const needle = query.toLowerCase()
      const results = []
      let totalMatches = 0
      for (const file of files) {
        throwIfAborted(exec)
        let text
        try {
          text = await readFile(file.file, 'utf8')
        } catch {
          continue
        }
        const lines = text.replace(/^﻿/, '').split(/\r?\n/)
        const matches = []
        let fileMatchCount = 0
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].toLowerCase().includes(needle)) {
            totalMatches += 1
            fileMatchCount += 1
            if (matches.length < MAX_MATCHES_PER_FILE) {
              matches.push({ lineNo: i + 1, text: snippet(lines[i].trim(), MAX_LINE_CHARS) })
            }
          }
        }
        if (matches.length > 0) {
          const meta = parseMemoryFile(text, path.basename(file.file), file.mtimeMs)
          results.push({ file, meta, matches, fileMatchCount })
        }
      }

      const lines = []
      lines.push(
        `Claude memory search ${JSON.stringify(query)} — ${scope.description} · ${totalMatches} matching line(s) in ${results.length} of ${files.length} files (newest first)`,
      )
      if (scope.missing !== null) lines.push('', scope.missing)
      let shown = 0
      for (const result of results) {
        if (shown >= limit) break
        lines.push(
          '',
          `${displayPath(result.file.file, configDir)}  [${typeLabel({ ...result.meta, path: result.file.file })} · ${formatTime(result.meta.modifiedMs)}]`,
        )
        for (const match of result.matches) {
          if (shown >= limit) break
          lines.push(`  ${match.lineNo}: ${match.text}`)
          shown += 1
        }
        if (shown < limit && result.fileMatchCount > result.matches.length) {
          lines.push(`  … ${result.fileMatchCount - result.matches.length} more matches in this file (use claude_memory_read)`)
        }
      }
      if (totalMatches === 0) {
        lines.push('', `No matches for ${JSON.stringify(query)} (searched ${files.length} files).`)
      } else if (shown < totalMatches) {
        lines.push('', `… ${totalMatches - shown} more matching line(s) not shown.`)
      }
      return lines.join('\n').trim()
    },
  }

  const readTool = {
    name: 'claude_memory_read',
    description:
      'Read one Claude Code memory file with line numbers (paths come from claude_memory_list or claude_memory_search). file accepts a path relative to the Claude config dir (e.g. projects/<project>/memory/MEMORY.md), an absolute path, or a ~/ path; it must stay inside the Claude config dir. offset (1-based first line) and limit page through long files.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Memory file to read (relative to the Claude config dir, absolute, or ~/...).' },
        offset: { type: 'number', description: '1-based first line to read (default 1).' },
        limit: { type: 'number', description: `Maximum lines to read (default ${DEFAULT_READ_LINES}, max ${MAX_READ_LINES}).` },
      },
      required: ['file'],
      additionalProperties: false,
    },
    output: RENDER_TEXT,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: typeof args?.file === 'string' ? `Read Claude memory: ${snippet(args.file, 60)}` : 'Read Claude memory',
      kind: 'read',
    }),
    async execute(args, exec) {
      throwIfAborted(exec)
      const fileArg = stringArg(args?.file, 'file')
      const offset = numberArg(args?.offset, 1, Number.MAX_SAFE_INTEGER, 'offset')
      const limit = numberArg(args?.limit, DEFAULT_READ_LINES, MAX_READ_LINES, 'limit')
      const configDir = claudeConfigDir()

      let target = expandTilde(fileArg)
      target = path.isAbsolute(target) ? path.resolve(target) : path.resolve(configDir, target)
      const rel = path.relative(configDir, target)
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`"file" must point inside the Claude config dir (${configDir}); got ${JSON.stringify(fileArg)}`)
      }
      let info
      try {
        info = await stat(target)
      } catch {
        throw new Error(`cannot read ${JSON.stringify(fileArg)}: file not found`)
      }
      if (!info.isFile()) throw new Error(`cannot read ${JSON.stringify(fileArg)}: not a file`)
      if (info.size > MAX_SCAN_BYTES) throw new Error(`cannot read ${JSON.stringify(fileArg)}: file is too large (${info.size} bytes)`)

      const text = (await readFile(target, 'utf8')).replace(/^﻿/, '')
      const meta = parseMemoryFile(text, path.basename(target), info.mtimeMs)
      const allLines = text.split(/\r?\n/)
      const start = Math.min(offset, allLines.length)
      const out = []
      let bytes = 0
      let i = start - 1
      for (; i < allLines.length && out.length < limit; i += 1) {
        const rendered = `${String(i + 1).padStart(5)}→ ${allLines[i].slice(0, 4000)}`
        bytes += Buffer.byteLength(rendered, 'utf8') + 1
        if (bytes > MAX_READ_BYTES) break
        out.push(rendered)
      }
      const header = `${displayPath(target, configDir)}  [${typeLabel({ ...meta, path: target })} · modified ${formatTime(
        meta.modifiedMs,
      )}]  ${allLines.length} line(s)`
      const footer = i < allLines.length
        ? `(showing lines ${start}-${i} of ${allLines.length} — page with offset/limit)`
        : null
      return [header, '', ...out, ...(footer !== null ? ['', footer] : [])].join('\n').trim()
    },
  }

  return [listTool, searchTool, readTool]
}

export function apply(ctx) {
  for (const definition of createToolDefinitions(ctx)) {
    ctx.tools.register(definition)
  }
}
