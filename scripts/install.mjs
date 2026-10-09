#!/usr/bin/env node
/**
 * install.mjs — link this skill into every AI coding tool's skills root.
 *
 * A skill is just a directory; each tool looks for it under its own skills
 * root. This script writes one entry per detected tool, so editing this
 * checkout once updates every tool.
 *
 * Safety rules:
 *   - dry-run by default: nothing is written unless --apply is passed
 *   - a tool is only touched when that tool's own directory already exists
 *   - an existing entry that is not ours is reported, never overwritten
 *   - --uninstall only removes entries that point at this checkout
 *
 * Usage:
 *   node scripts/install.mjs [--apply] [--copy] [--uninstall] [--force]
 *                            [--home DIR] [--project DIR] [--target DIR]
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The skill's name comes from its frontmatter, so a rename of the clone's
 *  directory cannot change what gets installed. */
function readSkillName() {
  try {
    const text = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    const name = frontmatter && /^name:\s*(\S+)\s*$/m.exec(frontmatter[1])
    if (name) return name[1]
  } catch {
    /* fall through to the directory name */
  }
  return basename(SKILL_DIR)
}

const SKILL_NAME = readSkillName()

const TOOLS = [
  { name: 'Agent Skills (shared root)', root: '.agents' },
  { name: 'Claude Code', root: '.claude' },
  { name: 'Codex', root: '.codex' },
  { name: 'Cursor', root: '.cursor' },
  { name: 'Gemini CLI', root: '.gemini' },
  { name: 'WorkBuddy', root: '.workbuddy' },
  { name: 'OpenCode', root: '.config/opencode' },
]

function parse(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const valueOf = (flag) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
  }
  return {
    apply: flags.has('--apply'),
    copy: flags.has('--copy'),
    uninstall: flags.has('--uninstall'),
    force: flags.has('--force'),
    home: valueOf('--home') ?? homedir(),
    project: valueOf('--project'),
    target: valueOf('--target'),
  }
}

/** Return the install targets: one per tool that is actually present. */
function targets(opts) {
  if (opts.target) return [{ name: 'custom', path: resolve(opts.target) }]
  if (opts.project) {
    return [{ name: 'project scope', path: join(resolve(opts.project), '.agents', 'skills', SKILL_NAME) }]
  }
  const found = []
  for (const tool of TOOLS) {
    const toolDir = join(opts.home, tool.root)
    if (!existsSync(toolDir)) continue
    found.push({ name: tool.name, path: join(toolDir, 'skills', SKILL_NAME) })
  }
  return found
}

function inspect(path) {
  if (!existsSync(path) && !isDanglingLink(path)) return 'absent'
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      return resolve(readlinkSync(path)) === SKILL_DIR ? 'linked' : 'foreign-link'
    }
    return 'present'
  } catch {
    return 'absent'
  }
}

function isDanglingLink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function install(target, opts) {
  const state = inspect(target.path)
  if (state === 'linked' || (state === 'present' && !opts.force)) {
    return state === 'linked' ? 'already linked' : 'skipped (entry exists, use --force)'
  }
  if (state === 'foreign-link' && !opts.force) return 'skipped (points elsewhere, use --force)'
  if (!opts.apply) return opts.copy ? 'would copy' : 'would link'

  mkdirSync(dirname(target.path), { recursive: true })
  if (state !== 'absent') rmSync(target.path, { recursive: true, force: true })
  if (opts.copy) cpSync(SKILL_DIR, target.path, { recursive: true, dereference: true })
  else symlinkSync(SKILL_DIR, target.path, 'dir')
  return opts.copy ? 'copied' : 'linked'
}

function uninstall(target, opts) {
  const state = inspect(target.path)
  if (state === 'absent') return 'nothing to remove'
  if (state === 'linked') {
    if (!opts.apply) return 'would remove'
    rmSync(target.path, { recursive: true, force: true })
    return 'removed'
  }
  if (state === 'foreign-link') return 'skipped (points elsewhere)'
  return 'skipped (not a link owned by this checkout; remove it yourself)'
}

function main(argv) {
  const opts = parse(argv)
  const list = targets(opts)
  const mode = opts.uninstall ? 'uninstall' : opts.copy ? 'install (copy)' : 'install (symlink)'

  console.log(`Skill:  ${SKILL_DIR}`)
  console.log(`Mode:   ${mode}${opts.apply ? '' : ' — dry run, nothing will be written'}`)
  console.log('')

  if (list.length === 0) {
    console.log('No AI coding tool directory found. Nothing to do.')
    console.log('Pass --target DIR to choose a skills root explicitly, or --project DIR for project scope.')
    return 0
  }

  for (const target of list) {
    const result = opts.uninstall ? uninstall(target, opts) : install(target, opts)
    console.log(`${target.name.padEnd(28)} ${target.path}`)
    console.log(`${''.padEnd(28)} -> ${result}`)
  }

  if (!opts.apply) {
    console.log('')
    console.log('Re-run with --apply to make these changes.')
  }
  return 0
}

process.exit(main(process.argv.slice(2)))
