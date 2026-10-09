#!/usr/bin/env node
/**
 * verify-commands.mjs — execute the commands this skill documents against the
 * fixtures in test/fixtures, so the documentation stays executable rather than
 * aspirational.
 *
 * Every case is read-only by construction: a snapshot of the fixture's source
 * files is taken before and after, and any difference fails the case. Build
 * output directories (target/, node_modules/, vendor/) are ignored on purpose.
 *
 * A missing toolchain is reported as SKIP with the reason, never as success.
 * Checks that download anything run only with --network.
 *
 * Usage:
 *   node scripts/verify-commands.mjs [--network] [--verbose]
 *
 * Exit codes: 0 = nothing failed, 1 = at least one check failed.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_ROOT = join(ROOT, 'test', 'fixtures')
const FLAGS = new Set(process.argv.slice(2))
const WITH_NETWORK = FLAGS.has('--network')
const VERBOSE = FLAGS.has('--verbose')

/** Directories a documented command may legitimately create. */
const MUTABLE = new Set(['node_modules', 'target', 'vendor', 'dist', 'build', '__pycache__', '.git', '.gradle'])

function have(tool) {
  const probe = spawnSync('bash', ['-lc', `command -v ${tool}`], { encoding: 'utf8' })
  return probe.status === 0 && (probe.stdout ?? '').trim().length > 0
}

function snapshot(dir) {
  const files = new Map()
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (MUTABLE.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const stat = statSync(full)
        files.set(relative(dir, full), `${stat.size}:${stat.mtimeMs}`)
      }
    }
  }
  walk(dir)
  return files
}

function unchanged(before, after, allowNew = []) {
  for (const [key, value] of before) if (after.get(key) !== value) return false
  for (const key of after.keys()) {
    if (before.has(key)) continue
    if (!allowNew.includes(key)) return false
  }
  return true
}

/** Minimal fake install tree so du/npm have something real to read. */
function makeNodeModules(workspace) {
  for (const [name, version] of [['left-pad', '1.3.0'], ['rimraf', '5.0.5']]) {
    const dir = join(workspace, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name, version, main: 'index.js', license: 'MIT' }, null, 2)}\n`,
    )
    writeFileSync(join(dir, 'index.js'), 'module.exports = () => {}\n')
    // Pad the tree a little so `du` reports a non-zero size.
    writeFileSync(join(dir, 'README.md'), 'x'.repeat(4096))
  }
}

const CASES = [
  {
    ecosystem: 'node',
    fixture: 'node',
    tools: ['node', 'npm'],
    setup: makeNodeModules,
    checks: [
      { name: 'du -sh node_modules', cmd: 'du -sh node_modules', shell: true, expectStatus: 0, outputMatches: /\d/ },
      { name: 'du -sh node_modules/* | sort -rh | head', cmd: 'du -sh node_modules/* | sort -rh | head -5', shell: true, expectStatus: 0, outputMatches: /left-pad/ },
      { name: 'npm ls --depth=0', cmd: 'npm', args: ['ls', '--depth=0'], expectStatus: 0, stdoutIncludes: 'left-pad' },
      { name: 'npm ls <pkg>', cmd: 'npm', args: ['ls', 'left-pad'], expectStatus: 0, stdoutIncludes: 'left-pad' },
    ],
  },
  {
    ecosystem: 'go',
    fixture: 'go',
    tools: ['go'],
    checks: [
      { name: 'go mod tidy -diff', cmd: 'go', args: ['mod', 'tidy', '-diff'], expectStatus: 0, stdoutEmpty: true },
      {
        name: "go list -f '{{.ImportPath}} {{.Name}}' ./... | grep -w main",
        cmd: "go list -f '{{.ImportPath}} {{.Name}}' ./... | grep -w main",
        shell: true,
        expectStatus: 0,
        outputMatches: /main$/m,
      },
    ],
  },
  {
    ecosystem: 'go',
    fixture: 'go-unused',
    tools: ['go'],
    // Positive detection: the fixture declares a module it never imports, wired
    // through a local `replace` so it resolves without network access.
    checks: [
      {
        name: 'go mod tidy -diff (finds the unused require)',
        cmd: 'go',
        args: ['mod', 'tidy', '-diff'],
        expectStatus: 1,
        stdoutIncludes: 'require example.com/leftover',
      },
      {
        name: 'go mod why -m <module>',
        cmd: 'go',
        args: ['mod', 'why', '-m', 'example.com/leftover'],
        expectStatus: 0,
        outputMatches: /main module does not need module/,
      },
    ],
  },
  {
    ecosystem: 'gradle',
    fixture: 'gradle',
    // Gradle ships on the GitHub runners; elsewhere point GRADLE_BIN at a cached
    // distribution (e.g. ~/.gradle/wrapper/dists/gradle-8.9-bin/*/gradle-8.9/bin/gradle).
    tools: [process.env.GRADLE_BIN ?? 'gradle'],
    bins: { gradle: process.env.GRADLE_BIN ?? 'gradle' },
    checks: [
      {
        name: 'gradle dependencies --configuration runtimeClasspath',
        cmd: 'gradle',
        args: ['--offline', '--no-daemon', '--console=plain', 'dependencies', '--configuration', 'runtimeClasspath'],
        expectStatus: 0,
        outputMatches: /runtimeClasspath/,
      },
      {
        name: 'gradle dependencyInsight --dependency <name>',
        cmd: 'gradle',
        args: ['--offline', '--no-daemon', '--console=plain', 'dependencyInsight', '--dependency', 'does-not-exist', '--configuration', 'runtimeClasspath'],
        expectStatus: 0,
      },
    ],
  },
  {
    ecosystem: 'rust',
    fixture: 'rust',
    tools: ['cargo'],
    // cargo build legitimately generates a lockfile; nothing else may change.
    allowNew: ['Cargo.lock'],
    checks: [
      { name: 'cargo tree', cmd: 'cargo', args: ['tree'], expectStatus: 0, stdoutIncludes: 'dep-fixture-rust' },
      { name: 'cargo tree -d', cmd: 'cargo', args: ['tree', '-d'], expectStatus: 0 },
      {
        name: 'cargo build --release',
        cmd: 'cargo',
        args: ['build', '--release'],
        expectStatus: 0,
        expectFile: 'target/release/dep-fixture-rust',
      },
    ],
  },
  {
    ecosystem: 'python',
    fixture: 'python',
    tools: ['python3'],
    checks: [
      {
        name: 'python -X importtime',
        cmd: 'python3',
        args: ['-X', 'importtime', '-c', 'import json'],
        expectStatus: 0,
        stderrMatches: /import time:/,
      },
      {
        name: "sort -t'|' -k2 -n importtime.log | tail",
        cmd: 'python3 -X importtime -c "import json" 2> {log} && sort -t\'|\' -k2 -n {log} | tail -3',
        shell: true,
        expectStatus: 0,
        outputMatches: /import time:/,
      },
    ],
  },
  {
    ecosystem: 'php',
    fixture: 'php',
    tools: ['composer'],
    checks: [
      { name: 'composer validate', cmd: 'composer', args: ['validate', '--no-check-publish'], expectStatus: 0 },
    ],
  },
  {
    ecosystem: 'java-maven',
    fixture: 'java',
    tools: ['mvn'],
    needsNetwork: true,
    checks: [
      {
        name: 'mvn -DskipTests compile',
        cmd: 'mvn',
        args: ['-B', '-q', '-DskipTests', 'compile'],
        expectStatus: 0,
        expectFile: 'target/classes/demo/App.class',
      },
      {
        name: 'mvn dependency:tree -DappendOutput=true',
        cmd: 'mvn',
        args: ['-B', '-q', 'dependency:tree', '-DoutputFile=/tmp/dep-verify-tree.txt', '-DappendOutput=true'],
        expectStatus: 0,
      },
      {
        name: 'mvn dependency:analyze-duplicate',
        cmd: 'mvn',
        args: ['-B', 'dependency:analyze-duplicate'],
        expectStatus: 0,
        outputMatches: /No duplicate dependencies found|List of duplicate/,
      },
      {
        name: 'mvn dependency:analyze',
        cmd: 'mvn',
        args: ['-B', 'dependency:analyze'],
        expectStatus: 0,
      },
      {
        name: 'mvn package && unzip -l (summary line filtered)',
        cmd: "mvn -B -q -DskipTests package && unzip -l target/*.jar | awk 'NF==4' | sort -k1 -rn | head -3",
        shell: true,
        expectStatus: 0,
        outputMatches: /demo\/App\.class|META-INF/,
      },
    ],
  },
]

function substitute(command, logPath) {
  return command.replaceAll('{log}', logPath)
}

function runCheck(check, cwd, logPath, caseDef) {
  if (check.shell) {
    return spawnSync(substitute(check.cmd, logPath), { cwd, shell: true, encoding: 'utf8' })
  }
  const binary = caseDef.bins?.[check.cmd] ?? check.cmd
  return spawnSync(binary, check.args ?? [], { cwd, encoding: 'utf8' })
}

function evaluate(check, result, cwd) {
  const status = result.status ?? -1
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (check.expectStatus !== undefined && status !== check.expectStatus) {
    return `exit ${status}, expected ${check.expectStatus}${VERBOSE ? `\n${stderr.slice(0, 400)}` : ''}`
  }
  if (check.stdoutIncludes && !stdout.includes(check.stdoutIncludes)) {
    return `stdout does not contain ${JSON.stringify(check.stdoutIncludes)}`
  }
  if (check.stdoutEmpty && stdout.trim() !== '') {
    return `stdout should be empty, got: ${stdout.trim().split('\n')[0]}`
  }
  if (check.outputMatches && !check.outputMatches.test(stdout + stderr)) {
    return `output does not match ${check.outputMatches}`
  }
  if (check.stderrMatches && !check.stderrMatches.test(stderr)) {
    return `stderr does not match ${check.stderrMatches}`
  }
  if (check.expectFile && !existsSync(join(cwd, check.expectFile))) {
    return `expected file not produced: ${check.expectFile}`
  }
  return null
}

const rows = []
let failed = 0

for (const caseDef of CASES) {
  const missing = caseDef.tools.filter((tool) => !have(tool))
  if (missing.length > 0) {
    rows.push({ ecosystem: caseDef.ecosystem, name: '(whole case)', status: 'SKIP', reason: `missing tool: ${missing.join(', ')}` })
    continue
  }
  if (caseDef.needsNetwork && !WITH_NETWORK) {
    rows.push({ ecosystem: caseDef.ecosystem, name: '(whole case)', status: 'SKIP', reason: 'needs --network' })
    continue
  }

  const base = mkdtempSync(join(tmpdir(), 'dep-verify-'))
  const workspace = join(base, caseDef.fixture)
  const logPath = join(base, 'importtime.log')
  try {
    cpSync(join(FIXTURE_ROOT, caseDef.fixture), workspace, { recursive: true })
    if (caseDef.setup) caseDef.setup(workspace)
    const before = snapshot(workspace)

    for (const check of caseDef.checks) {
      const started = Date.now()
      const result = runCheck(check, workspace, logPath, caseDef)
      const problem = evaluate(check, result, workspace)
      rows.push({
        ecosystem: caseDef.ecosystem,
        name: check.name,
        status: problem ? 'FAIL' : 'PASS',
        reason: problem ?? '',
        ms: Date.now() - started,
      })
      if (problem) failed += 1
    }

    const after = snapshot(workspace)
    if (!unchanged(before, after, caseDef.allowNew)) {
      rows.push({ ecosystem: caseDef.ecosystem, name: '(read-only contract)', status: 'FAIL', reason: 'fixture files changed' })
      failed += 1
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

const width = Math.max(...rows.map((row) => row.name.length), 10)
for (const row of rows) {
  const detail = row.reason ? ` — ${row.reason}` : row.ms !== undefined ? ` (${row.ms} ms)` : ''
  console.log(`${row.status.padEnd(4)} ${row.ecosystem.padEnd(11)} ${row.name.padEnd(width)}${detail}`)
}

const passed = rows.filter((row) => row.status === 'PASS').length
const skipped = rows.filter((row) => row.status === 'SKIP').length
console.log('')
console.log(`${passed} passed, ${failed} failed, ${skipped} skipped${WITH_NETWORK ? '' : ' (network checks off; add --network)'}`)
process.exit(failed > 0 ? 1 : 0)
