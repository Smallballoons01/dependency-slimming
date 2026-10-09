/**
 * Documentation contract tests.
 *
 * A skill is mostly prose, so the prose itself is the product. These tests keep
 * the package coherent (frontmatter, resource map, repo conventions) and lock in
 * the facts that were validated against real Go and Java projects, so a later
 * edit cannot silently reintroduce a wrong or destructive instruction.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'coverage'])

function collectDocs(dir = ROOT, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectDocs(full, acc)
    else if (entry.name.endsWith('.md')) acc.push(full)
  }
  return acc
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  assert.ok(match, 'SKILL.md must start with YAML frontmatter')
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1]] = kv[2].trim()
  }
  return fields
}

const docs = collectDocs()

test('the package ships the files the convention expects', () => {
  for (const rel of ['SKILL.md', 'README.md', 'README.zh.md', 'LICENSE', 'package.json']) {
    assert.ok(existsSync(join(ROOT, rel)), `missing ${rel}`)
  }
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.license, 'MIT')
  assert.match(read('LICENSE'), /^MIT License/m)
  assert.equal(pkg.private, true, 'keeps the package from being published to npm by accident')
})

test('SKILL.md frontmatter is well formed and discoverable', () => {
  const skill = read('SKILL.md')
  const fields = frontmatter(skill)
  assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'skill name must be kebab-case')
  assert.ok(fields.description, 'description drives discovery and must exist')
  assert.ok(fields.description.length >= 120, 'description is too short to match real requests')
  assert.ok(fields.description.length <= 1200, 'description is too long to stay scannable')
  assert.match(fields.description, /dependency/i)
  assert.match(fields.description, /瘦身|slimming/i)
  // The frontmatter is the single source of truth for the name: a clone may
  // rename the directory, so every user-facing artifact must agree with it.
  for (const rel of ['README.md', 'README.zh.md', 'package.json']) {
    assert.ok(read(rel).includes(fields.name), `${rel} must mention the skill name "${fields.name}"`)
  }
})

test('every resource SKILL.md points at exists', () => {
  const skill = read('SKILL.md')
  const referenced = [...skill.matchAll(/references\/[\w.-]+\.md/g)].map((m) => m[0])
  assert.ok(referenced.length >= 3, 'the skill must defer detail to reference files')
  for (const rel of new Set(referenced)) {
    assert.ok(existsSync(join(ROOT, rel)), `SKILL.md references missing file ${rel}`)
    assert.ok(read(rel).trim().length > 200, `${rel} is effectively empty`)
  }
})

test('no machine-specific paths or secrets leak into the docs', () => {
  const forbidden = [
    /\/Users\/[A-Za-z0-9._-]+/,
    /\/home\/[a-z][\w-]*/,
    /[A-Za-z]:\\\\Users\\\\/,
    /ghp_[A-Za-z0-9]{20,}/,
    /sk-[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ]
  for (const file of docs) {
    const text = readFileSync(file, 'utf8')
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${relative(ROOT, file)} leaks ${pattern}`)
    }
  }
})

test('the Go guidance keeps the read-only and filtering corrections', () => {
  const text = read('references/ecosystems.md')
  assert.match(text, /go mod tidy -diff/, 'plain go mod tidy rewrites go.mod; the read-only form is required')
  assert.match(text, /go@/, 'the graph contains go@x.y pseudo-nodes that must be filtered out')
  assert.match(text, /pclntab|_type/, 'nm output is dominated by runtime metadata, not removable code')
  assert.match(text, /timeout/, 'macOS ships no timeout(1); the doc must say so')
  assert.match(text, /go tool nm -size -sort size|sort -k2 -nr/, 'symbol-level size attribution must be documented')
  assert.match(text, /-buildvcs=false/, 'the reproducible VCS stamping failure and its workaround must stay')
  assert.match(text, /main module does not need/, 'go mod why semantics must be explained, not guessed')
})

test('the Java guidance keeps the reactor and analyzer corrections', () => {
  const text = read('references/ecosystems.md')
  assert.match(text, /appendOutput=true/, 'multi-module -DoutputFile overwrites itself without appendOutput')
  assert.match(text, /Skipping pom project|packaging/, 'pom-packaging modules produce no analysis')
  assert.match(text, /head|截断|truncat/i, 'long reactor output must not be piped into head blindly')
  assert.match(text, /annotation processor|注解处理器/, 'analyze false positives are the top removal hazard')
  assert.match(text, /NF==4/, 'unzip -l ranks its own summary line first unless it is filtered')
  assert.match(text, /dependency:tree -Dverbose/, 'verbose trees still work on plugin 3.9.0 and stay documented')
  assert.match(text, /duplicate-finder/, 'same-class-in-two-jars detection is the high-value check')
  assert.match(text, /jdeps/, 'runtime image trimming via jdeps must stay documented')
  assert.match(text, /\.m2\/repository/, 'local-repo size attribution ranks dependencies without downloading')
  assert.match(text, /仲裁/, 'a version split in the tree does not mean two jars in the artifact')
  assert.match(text, /BOOT-INF\/classes/, 'static data baked into classes is its own bloat category')
  assert.match(text, /spring\.datasource\.type/, 'config-referenced dependencies must be re-checked before removal')
})

test('the startup guidance keeps the current Spring Boot layering tooling', () => {
  const text = read('references/startup-optimization.md')
  assert.match(text, /jarmode=tools/, 'layertools is deprecated; the current form must be documented')
  assert.match(text, /shared objects file/, 'CDS effectiveness must be verified, not assumed')
})

test('apply-phase commands are always separated from read-only detection', () => {
  const skill = read('SKILL.md')
  assert.match(skill, /未获用户确认前不删|before.*confirm|用户确认/i)
  const go = read('references/ecosystems.md')
  assert.match(go, /go mod tidy -diff/, 'detection must use the non-mutating form')
})

test('docs stay UTF-8 text without replacement characters', () => {
  for (const file of docs) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /\uFFFD/, `${relative(ROOT, file)} contains a decoding error`)
    assert.ok(statSync(file).size > 0)
  }
})
