import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

import {
  apply,
  claudeConfigDir,
  createToolDefinitions,
  findRepoRoot,
  parseMemoryFile,
  projectSlug,
  resolveMemoryProject,
  sessionCwd,
} from '../index.js'

// ---------------------------------------------------------------------------
// Fixture: a fake Claude config dir plus two git repos
// ---------------------------------------------------------------------------

const root = await mkdtemp(path.join(tmpdir(), 'dsh-claude-memory-'))
const configDir = path.join(root, 'claude')
const repo = path.join(root, 'work', 'my-repo')
const otherRepo = path.join(root, 'work', 'other-repo')
const slug = projectSlug(repo)
const otherSlug = projectSlug(otherRepo)
const memoryDir = path.join(configDir, 'projects', slug, 'memory')
const otherMemoryDir = path.join(configDir, 'projects', otherSlug, 'memory')

await mkdir(path.join(repo, '.git'), { recursive: true })
await mkdir(path.join(otherRepo, '.git'), { recursive: true })
await mkdir(memoryDir, { recursive: true })
await mkdir(otherMemoryDir, { recursive: true })
await mkdir(path.join(configDir, 'rules'), { recursive: true })
await writeFile(path.join(configDir, 'CLAUDE.md'), '# 全局准则\n\n先取证，再下结论。\n')
await writeFile(path.join(configDir, 'rules', 'lang.md'), '# lang\n\nmemory 用中文写。\n')
await writeFile(
  path.join(memoryDir, 'MEMORY.md'),
  '# Memory Index\n\n- [deploy-notes](deploy-notes.md) — 发版流程\n',
)
await writeFile(
  path.join(memoryDir, 'deploy-notes.md'),
  '---\nname: deploy-notes\ndescription: 发版流程与产物位置\nmetadata: \n  type: feedback\nmodified: 2026-10-20T08:00:00.000Z\n---\n\n发版前先跑 npm test 再打包。\n',
)
await writeFile(path.join(memoryDir, 'beta.md'), '# beta note\n\nBETA project detail\n')
const manyLines = Array.from({ length: 12 }, (_, i) => `批量命中 ${i + 1} 发版`)
await writeFile(path.join(memoryDir, 'many.md'), `# many\n\n${manyLines.join('\n')}\n`)
await writeFile(path.join(otherMemoryDir, 'gamma.md'), '# gamma\n\ngamma 特有内容 GAMMA\n')

process.env.CLAUDE_CONFIG_DIR = configDir
after(async () => {
  delete process.env.CLAUDE_CONFIG_DIR
  await rm(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cachedTools
function tools() {
  if (cachedTools === undefined) {
    const captured = []
    apply({ tools: { register: (definition) => { captured.push(definition); return () => {} } }, get: () => undefined })
    cachedTools = captured
  }
  return cachedTools
}

function tool(name) {
  const found = tools().find((definition) => definition.name === name)
  assert.ok(found, `tool ${name} is registered`)
  return found
}

function execAt(cwd) {
  return { agent: { session: { header: { cwd } } }, signal: new AbortController().signal }
}

const SCHEMA_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'description', 'title', 'default', 'examples',
])

function assertSupportedSchema(node, at = '$') {
  assert.equal(typeof node, 'object')
  for (const key of Object.keys(node)) {
    assert.ok(SCHEMA_KEYWORDS.has(key), `unsupported schema keyword "${key}" at ${at}`)
  }
  if (node.properties !== undefined) {
    for (const [key, value] of Object.entries(node.properties)) assertSupportedSchema(value, `${at}.${key}`)
  }
  if (node.items !== undefined) assertSupportedSchema(node.items, `${at}[]`)
}

// ---------------------------------------------------------------------------
// Tool contract
// ---------------------------------------------------------------------------

test('apply registers exactly the three memory tools with valid definitions', () => {
  const names = tools().map((definition) => definition.name).sort()
  assert.deepEqual(names, ['claude_memory_list', 'claude_memory_read', 'claude_memory_search'])
  for (const definition of tools()) {
    assert.equal(typeof definition.description, 'string')
    assert.ok(definition.description.length > 40, `${definition.name} has a model-facing description`)
    assert.equal(definition.parameters.type, 'object')
    assertSupportedSchema(definition.parameters)
    assert.deepEqual(definition.output.schema, { type: 'string' })
    assertSupportedSchema(definition.output.schema)
    assert.equal(typeof definition.output.render, 'function')
    assert.deepEqual(definition.output.render({}, 'hello'), [{ type: 'text', text: 'hello' }])
    assert.equal(typeof definition.execute, 'function')
    assert.notEqual(definition.name, 'run_code')
    if (definition.presentCall !== undefined) {
      const view = definition.presentCall({})
      assert.equal(view.card, 'generic')
      assert.equal(typeof view.title, 'string')
    }
  }
  assert.deepEqual(tool('claude_memory_search').parameters.required, ['query'])
  assert.deepEqual(tool('claude_memory_read').parameters.required, ['file'])
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('claudeConfigDir honors CLAUDE_CONFIG_DIR', () => {
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: configDir }), configDir)
  assert.ok(claudeConfigDir({}).endsWith(path.join('.claude')))
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: '  ' }), claudeConfigDir({}))
})

test('projectSlug replaces every non-alphanumeric character with a dash', () => {
  assert.equal(projectSlug('/Users/me/dev/my-repo'), '-Users-me-dev-my-repo')
  assert.equal(projectSlug('/a/b.c_d'), '-a-b-c-d')
  assert.equal(projectSlug('/x/y/.claude/worktrees/w1'), '-x-y--claude-worktrees-w1')
})

test('findRepoRoot walks to the repository root and resolves worktrees to the main repo', async () => {
  const sub = path.join(repo, 'src', 'deep')
  await mkdir(sub, { recursive: true })
  assert.equal(await findRepoRoot(sub), repo)

  const main = path.join(root, 'wt-main')
  await mkdir(path.join(main, '.git', 'worktrees', 'w1'), { recursive: true })
  const checkout = path.join(root, 'wt-checkout')
  await mkdir(checkout, { recursive: true })
  await writeFile(path.join(checkout, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'w1')}\n`)
  assert.equal(await findRepoRoot(checkout), main)

  const loose = path.join(root, 'loose')
  await mkdir(loose, { recursive: true })
  assert.equal(await findRepoRoot(loose), null)
})

test('resolveMemoryProject prefers the repo root and falls back with an expected path', async () => {
  const sub = path.join(repo, 'pkg')
  await mkdir(sub, { recursive: true })
  const fromSub = await resolveMemoryProject(sub, configDir)
  assert.equal(fromSub.exists, true)
  assert.equal(fromSub.root, repo)
  assert.equal(fromSub.memoryDir, memoryDir)

  const main = path.join(root, 'wt-main')
  await mkdir(path.join(main, '.git', 'worktrees', 'w1'), { recursive: true })
  const wtMemoryDir = path.join(configDir, 'projects', projectSlug(main), 'memory')
  await mkdir(wtMemoryDir, { recursive: true })
  await writeFile(path.join(wtMemoryDir, 'wt.md'), '# wt\n\nworktree shares main memory\n')
  const checkout = path.join(root, 'wt-checkout')
  await mkdir(checkout, { recursive: true })
  await writeFile(path.join(checkout, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'w1')}\n`)
  const fromWorktree = await resolveMemoryProject(checkout, configDir)
  assert.equal(fromWorktree.exists, true)
  assert.equal(fromWorktree.root, main)
  assert.equal(fromWorktree.memoryDir, wtMemoryDir)

  const unmanaged = path.join(root, 'no-memory')
  await mkdir(unmanaged, { recursive: true })
  const missing = await resolveMemoryProject(unmanaged, configDir)
  assert.equal(missing.exists, false)
  assert.equal(missing.memoryDir, path.join(configDir, 'projects', projectSlug(unmanaged), 'memory'))
})

test('parseMemoryFile reads frontmatter and falls back gracefully', () => {
  const withFrontmatter = parseMemoryFile(
    '---\nname: deploy-notes\ndescription: 发版流程\nmetadata: \n  type: feedback\nmodified: 2026-10-20T08:00:00.000Z\n---\n\n正文\n',
    'fallback.md',
    0,
  )
  assert.equal(withFrontmatter.name, 'deploy-notes')
  assert.equal(withFrontmatter.description, '发版流程')
  assert.equal(withFrontmatter.type, 'feedback')
  assert.equal(withFrontmatter.modifiedMs, Date.parse('2026-10-20T08:00:00.000Z'))

  const plain = parseMemoryFile('# 标题行\n\n正文\n', 'plain.md', 1234)
  assert.equal(plain.name, 'plain.md')
  assert.equal(plain.description, '标题行')
  assert.equal(plain.type, null)
  assert.equal(plain.modifiedMs, 1234)

  const quoted = parseMemoryFile('---\ndescription: "带引号: 的说明"\n---\n', 'q.md', 1)
  assert.equal(quoted.description, '带引号: 的说明')
})

test('sessionCwd prefers the workingDirectory service, then the session header', () => {
  const ctx = { get: (name) => (name === 'workingDirectory' ? { get: () => '/svc/dir' } : undefined) }
  assert.equal(sessionCwd(ctx, execAt('/hdr/dir')), '/svc/dir')
  assert.equal(sessionCwd({ get: () => undefined }, execAt('/hdr/dir')), '/hdr/dir')
  assert.equal(sessionCwd({ get: () => undefined }, {}), process.cwd())
})

// ---------------------------------------------------------------------------
// claude_memory_list
// ---------------------------------------------------------------------------

test('claude_memory_list shows the current project memories and user files', async () => {
  const output = await tool('claude_memory_list').execute({}, execAt(repo))
  assert.match(output, new RegExp(slug))
  assert.match(output, /deploy-notes\.md/)
  assert.match(output, /\[feedback\]/)
  assert.match(output, /发版流程与产物位置/)
  assert.match(output, /MEMORY\.md/)
  assert.match(output, /\[index\]/)
  assert.match(output, /## user \(~\/\.claude\)/)
  assert.match(output, /CLAUDE\.md/)
  assert.match(output, /rules\/lang\.md/)
})

test('claude_memory_list covers every project with "all" and bare slugs', async () => {
  const all = await tool('claude_memory_list').execute({ project: 'all' }, execAt(repo))
  assert.match(all, new RegExp(slug))
  assert.match(all, new RegExp(otherSlug))
  assert.match(all, /gamma\.md/)
  const bySlug = await tool('claude_memory_list').execute({ project: otherSlug }, execAt(repo))
  assert.match(bySlug, /gamma\.md/)
})

test('claude_memory_list reports a missing project helpfully', async () => {
  const loose = path.join(root, 'loose')
  await mkdir(loose, { recursive: true })
  const output = await tool('claude_memory_list').execute({}, execAt(loose))
  assert.match(output, /No Claude memory directory exists/)
  assert.match(output, /"all"/)
})

test('claude_memory_list respects the limit and validates arguments', async () => {
  const limited = await tool('claude_memory_list').execute({ project: 'all', limit: 1 }, execAt(repo))
  assert.match(limited, /more entries not shown/)
  await assert.rejects(tool('claude_memory_list').execute({ limit: 0 }, execAt(repo)), /"limit" must be between 1 and 500/)
  await assert.rejects(tool('claude_memory_list').execute({ limit: 501 }, execAt(repo)), /"limit" must be between 1 and 500/)
  await assert.rejects(tool('claude_memory_list').execute({ limit: 'many' }, execAt(repo)), /"limit" must be a finite number/)
})

// ---------------------------------------------------------------------------
// claude_memory_search
// ---------------------------------------------------------------------------

test('claude_memory_search finds matches with line numbers, newest files first', async () => {
  const output = await tool('claude_memory_search').execute({ query: '发版' }, execAt(repo))
  assert.match(output, /deploy-notes\.md/)
  assert.match(output, /发版前先跑 npm test 再打包。/)
  assert.match(output, /deploy-notes\.md[\s\S]*:\s/m)
  assert.doesNotMatch(output, /gamma\.md/)
  assert.match(output, /more matches in this file/)
})

test('claude_memory_search is case-insensitive and reaches other projects with "all"', async () => {
  const output = await tool('claude_memory_search').execute({ query: 'beta' }, execAt(repo))
  assert.match(output, /beta\.md/)
  assert.match(output, /BETA project detail/)

  const all = await tool('claude_memory_search').execute({ query: 'gamma', project: 'all' }, execAt(repo))
  assert.match(all, /gamma\.md/)
  assert.match(all, /GAMMA/)

  const user = await tool('claude_memory_search').execute({ query: '先取证' }, execAt(repo))
  assert.match(user, /CLAUDE\.md/)
})

test('claude_memory_search reports no matches and validates the query', async () => {
  const output = await tool('claude_memory_search').execute({ query: 'no-such-string-xyz' }, execAt(repo))
  assert.match(output, /No matches/)
  await assert.rejects(tool('claude_memory_search').execute({}, execAt(repo)), /"query" must be a non-empty string/)
  await assert.rejects(
    tool('claude_memory_search').execute({ query: 'x', limit: 5000 }, execAt(repo)),
    /"limit" must be between 1 and 200/,
  )
})

// ---------------------------------------------------------------------------
// claude_memory_read
// ---------------------------------------------------------------------------

test('claude_memory_read returns numbered lines and pages with offset/limit', async () => {
  const rel = path.join('projects', slug, 'memory', 'deploy-notes.md')
  const output = await tool('claude_memory_read').execute({ file: rel }, execAt(repo))
  assert.match(output, /\[feedback · modified /)
  assert.match(output, /1→ ---/)
  assert.match(output, /9→ 发版前先跑 npm test 再打包。/)

  const paged = await tool('claude_memory_read').execute({ file: rel, offset: 9, limit: 1 }, execAt(repo))
  assert.match(paged, /9→ 发版前先跑 npm test 再打包。/)
  assert.match(paged, /page with offset\/limit/)

  const absolute = await tool('claude_memory_read').execute({ file: path.join(memoryDir, 'beta.md') }, execAt(repo))
  assert.match(absolute, /beta note/)
})

test('claude_memory_read confines reads to the Claude config dir and reports missing files', async () => {
  await assert.rejects(
    tool('claude_memory_read').execute({ file: '../outside.md' }, execAt(repo)),
    /must point inside the Claude config dir/,
  )
  await assert.rejects(
    tool('claude_memory_read').execute({ file: '/etc/hosts' }, execAt(repo)),
    /must point inside the Claude config dir/,
  )
  await assert.rejects(
    tool('claude_memory_read').execute({ file: 'projects/nope/memory/missing.md' }, execAt(repo)),
    /file not found/,
  )
  await assert.rejects(tool('claude_memory_read').execute({}, execAt(repo)), /"file" must be a non-empty string/)
})
