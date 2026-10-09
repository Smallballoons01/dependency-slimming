/**
 * Behaviour tests for scripts/plan.mjs.
 *
 * The planner is the only executable part of this skill, so it is tested
 * against generated fixtures: no network, no toolchain, no real project.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLAN = join(HERE, '..', 'scripts', 'plan.mjs')

function fixture(layout) {
  const dir = mkdtempSync(join(tmpdir(), 'dep-plan-'))
  for (const [rel, content] of Object.entries(layout)) {
    const target = join(dir, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return dir
}

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [PLAN, ...args], { encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

test('prints a read-only plan for a Go project', () => {
  const dir = fixture({ 'go.mod': 'module example.com/demo\n\ngo 1.23\n', 'go.sum': '' })
  const { status, stdout } = run([dir])
  assert.equal(status, 0)
  assert.match(stdout, /Go/)
  assert.ok(stdout.includes('go mod tidy -diff'), 'must prefer the read-only tidy form')
  assert.ok(stdout.includes('go list -f'), 'must locate main packages instead of assuming ./')
  assert.ok(stdout.includes('go mod why -m'), 'must confirm high in-degree modules')
  assert.ok(!stdout.includes('Apply only after'), 'apply section stays hidden by default')
})

test('Go notes carry the validated caveats', () => {
  const dir = fixture({ 'go.mod': 'module example.com/demo\n' })
  const { stdout } = run(['--json', dir])
  const payload = JSON.parse(stdout)
  const go = payload.ecosystems.find((e) => e.id === 'go')
  const notes = go.notes.join('\n')
  assert.match(notes, /go mod tidy -diff/, 'must warn that plain tidy rewrites files')
  assert.match(notes, /go@/, 'must warn about go@ pseudo-nodes in the dependency graph')
  assert.match(notes, /pclntab|_type/, 'must warn that nm output is dominated by runtime metadata')
  assert.match(notes, /timeout/, 'must warn that macOS lacks timeout(1)')
})

test('Maven plan puts the compile prerequisite before analyze', () => {
  const dir = fixture({ 'pom.xml': '<project><modelVersion>4.0.0</modelVersion></project>' })
  const { status, stdout } = run([dir])
  assert.equal(status, 0)
  assert.match(stdout, /Java \/ Maven/)
  assert.ok(stdout.includes('appendOutput=true'), 'multi-module tree needs appendOutput')
  assert.ok(stdout.includes('dependency:analyze'))
  const compileAt = stdout.indexOf('dependency:analyze`')
  const compileHint = stdout.indexOf('-DskipTests compile')
  assert.ok(compileHint > -1 && compileHint < compileAt, 'compile must be listed before analyze')
  assert.match(stdout, /annotation processors/, 'must warn about analyze false positives')
  assert.match(stdout, /appendOutput|overwritten/, 'must explain the overwrite behaviour')
})

test('detects a multi-ecosystem monorepo', () => {
  const dir = fixture({
    'package.json': '{"name":"web"}',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'backend/go.mod': 'module example.com/api\n',
    'service/pom.xml': '<project/>',
    'api/Cargo.toml': '[package]\nname = "api"\n',
    'worker/requirements.txt': 'requests\n',
    'site/composer.json': '{}',
  })
  const { status, stdout } = run([dir])
  assert.equal(status, 0)
  for (const label of ['Node.js', 'Java / Maven', 'Go', 'Rust', 'Python', 'PHP']) {
    assert.ok(stdout.includes(label), `expected ${label} in the plan`)
  }
  assert.ok(stdout.includes('pnpm-lock.yaml'), 'lockfiles are reported as evidence')
})

test('JSON output is machine readable and keeps apply commands separate', () => {
  const dir = fixture({ 'pom.xml': '<project/>', 'pom2keep.txt': '' })
  const { status, stdout } = run(['--json', '--include-apply', dir])
  assert.equal(status, 0)
  const payload = JSON.parse(stdout)
  assert.equal(payload.ecosystems.length, 1)
  const [maven] = payload.ecosystems
  assert.equal(maven.id, 'java-maven')
  assert.ok(maven.apply.length > 0)
  assert.ok(maven.readOnly.every((c) => typeof c.cmd === 'string' && typeof c.why === 'string'))
})

test('the default plan never recommends a manifest-mutating command', () => {
  const dir = fixture({
    'go.mod': 'module example.com/demo\n',
    'pom.xml': '<project/>',
    'package.json': '{}',
    'requirements.txt': 'requests\n',
    'composer.json': '{}',
    'Cargo.toml': '[package]\nname="demo"\n',
  })
  const { stdout } = run(['--json', dir])
  const payload = JSON.parse(stdout)
  const mutating = [/^go mod tidy$/, /^npm install/, /^pip install/, /^composer install/, /^cargo update/]
  for (const eco of payload.ecosystems) {
    for (const { cmd } of eco.readOnly) {
      for (const pattern of mutating) {
        assert.doesNotMatch(cmd, pattern, `${eco.id} exposes a mutating command: ${cmd}`)
      }
    }
  }
})

test('fails with exit code 1 when nothing is detected', () => {
  const dir = fixture({ 'README.txt': 'nothing here' })
  const { status, stderr } = run([dir])
  assert.equal(status, 1)
  assert.match(stderr, /No supported ecosystem detected/)
})

test('fails with exit code 1 on a missing directory or bad usage', () => {
  assert.equal(run([join(tmpdir(), 'definitely-missing-dir-xyz')]).status, 1)
  assert.equal(run([]).status, 1)
})

test('ignores build output and vendored trees', () => {
  const dir = fixture({
    'node_modules/left-pad/package.json': '{}',
    'target/classes/pom.xml': '<project/>',
    'vendor/composer.json': '{}',
    'real/pom.xml': '<project/>',
  })
  const { stdout } = run(['--json', dir])
  const payload = JSON.parse(stdout)
  const evidence = payload.ecosystems.flatMap((e) => e.evidence)
  assert.equal(evidence.length, 1)
  assert.match(evidence[0], /real\/pom\.xml$/)
})
