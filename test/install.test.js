/**
 * Tests for scripts/install.mjs.
 *
 * Every test runs against a throwaway HOME, so the real `~/.claude` and friends
 * are never touched. The installer's safety promises are asserted directly:
 * dry run by default, only existing tools, foreign entries never overwritten.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL = join(REPO, 'scripts', 'install.mjs')
const SKILL_NAME = /^name:\s*(\S+)\s*$/m.exec(readFileSync(join(REPO, 'SKILL.md'), 'utf8'))[1]

function fakeHome(tools = []) {
  const home = mkdtempSync(join(tmpdir(), 'dep-install-'))
  for (const tool of tools) mkdirSync(join(home, tool), { recursive: true })
  return home
}

function run(args) {
  return execFileSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8' })
}

const linkIn = (home, tool) => join(home, tool, 'skills', SKILL_NAME)

test('writes nothing without --apply', () => {
  const home = fakeHome(['.claude'])
  const output = run(['--home', home])
  assert.match(output, /dry run, nothing will be written/)
  assert.match(output, /would link/)
  assert.ok(!existsSync(linkIn(home, '.claude')), 'dry run must not create the link')
})

test('links every tool that exists and only those', () => {
  const home = fakeHome(['.claude', '.codex'])
  run(['--home', home, '--apply'])

  for (const tool of ['.claude', '.codex']) {
    const link = linkIn(home, tool)
    assert.ok(lstatSync(link).isSymbolicLink(), `${tool} should be a symlink`)
    assert.equal(resolve(readlinkSync(link)), REPO)
  }
  assert.ok(!existsSync(join(home, '.cursor')), 'a tool that is not installed must not be created')
})

test('is idempotent', () => {
  const home = fakeHome(['.claude'])
  run(['--home', home, '--apply'])
  const second = run(['--home', home, '--apply'])
  assert.match(second, /already linked/)
  assert.equal(resolve(readlinkSync(linkIn(home, '.claude'))), REPO)
})

test('never overwrites an entry it does not own', () => {
  const home = fakeHome(['.claude'])
  const link = linkIn(home, '.claude')
  mkdirSync(dirname(link), { recursive: true })
  const foreign = mkdtempSync(join(tmpdir(), 'dep-foreign-'))
  execFileSync('ln', ['-s', foreign, link])

  const output = run(['--home', home, '--apply'])
  assert.match(output, /points elsewhere/)
  assert.equal(resolve(readlinkSync(link)), resolve(foreign), 'foreign link must survive')

  run(['--home', home, '--apply', '--force'])
  assert.equal(resolve(readlinkSync(link)), REPO, '--force replaces it')
})

test('uninstalls only what it installed', () => {
  const home = fakeHome(['.claude'])
  run(['--home', home, '--apply'])
  const output = run(['--home', home, '--uninstall', '--apply'])
  assert.match(output, /removed/)
  assert.ok(!existsSync(linkIn(home, '.claude')))
})

test('supports an explicit target and reports an empty machine', () => {
  const home = fakeHome([])
  const output = run(['--home', home])
  assert.match(output, /No AI coding tool directory found/)

  const target = join(home, 'elsewhere', 'skills', SKILL_NAME)
  run(['--target', target, '--apply'])
  assert.equal(resolve(readlinkSync(target)), REPO)
})
