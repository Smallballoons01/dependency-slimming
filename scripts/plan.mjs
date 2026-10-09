#!/usr/bin/env node
/**
 * plan.mjs — dependency-slimming audit planner.
 *
 * Detects which ecosystems a project directory contains and prints the exact
 * commands to run for a dependency audit. It never executes those commands,
 * never writes into the target project, and needs no network access and no
 * third-party packages.
 *
 * Usage:
 *   node scripts/plan.mjs <project-dir> [--json] [--depth 3] [--include-apply]
 *
 * Exit codes:
 *   0  at least one ecosystem detected
 *   1  usage error, missing directory, or nothing detected
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build', 'dist', 'out', 'vendor',
  '.venv', 'venv', '__pycache__', '.idea', '.gradle', '.mvn', 'coverage',
])

const MAX_EVIDENCE = 12

/**
 * Every command below was validated against a real project. Commands that
 * modify the project are kept in `apply` so the default plan stays read-only.
 */
const ECOSYSTEMS = [
  {
    id: 'node',
    label: 'Node.js / JavaScript',
    markers: ['package.json'],
    lockfiles: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'],
    notes: [
      'node_modules size is an install-size signal, not artifact size; measure the built bundle separately.',
      'On pnpm workspaces `du -sh node_modules/*` reports 0B for symlinked packages (measured: vitest, typescript, esbuild, playwright), so the ranking is pure noise — read node_modules/.pnpm instead.',
      'depcheck/knip over-report: a measured run flagged tailwindcss, @tailwindcss/typography and two @storybook addons as unused, all referenced only from CSS and .storybook config.',
      'source-map-explorer needs .map files; a measured Vite build shipped none, so check for them before relying on it.',
    ],
    readOnly: [
      { cmd: 'du -sh node_modules 2>/dev/null | cut -f1', why: 'Install-size baseline' },
      { cmd: 'du -sh node_modules/* 2>/dev/null | sort -rh | head -25', why: 'Largest installed packages' },
      { cmd: 'du -sh node_modules/.pnpm/* 2>/dev/null | sort -rh | head -25', why: 'Largest packages on pnpm (symlinks make the line above report 0B)' },
      { cmd: 'npx depcheck', why: 'Unused dependencies (fast pass)', network: true },
      { cmd: 'npx knip', why: 'Unused deps/files/exports (deep pass)', network: true },
      { cmd: 'npm ls <pkg>', why: 'Duplicate versions of one package' },
      { cmd: 'npm dedupe --dry-run', why: 'Preview dedupe gains without writing' },
      { cmd: 'npx source-map-explorer "dist/*.js"', why: 'Real shipped size per package (needs sourcemaps)', network: true },
    ],
    apply: [
      { cmd: 'npm install && npm ls --all', why: 'Regenerate the lockfile after manifest edits' },
      { cmd: 'npm dedupe', why: 'Actually collapse duplicate versions' },
    ],
  },
  {
    id: 'java-maven',
    label: 'Java / Maven',
    markers: ['pom.xml'],
    lockfiles: [],
    notes: [
      'dependency:analyze forks a test-compile lifecycle, so it compiles before analysing; on a pom-packaging aggregator module it only prints "Skipping pom project".',
      'In a multi-module build -DoutputFile is overwritten by each module; add -DappendOutput=true.',
      'A reactor with dozens of modules prints hundreds of lines: grepping and piping into head truncates the report before the offending module. Save the log, then locate the module (or scope the run with -pl).',
      'unused declared / used undeclared reports are advisory: annotation processors, SPI providers (JDBC drivers, Jackson modules, logging bindings) and reflection-loaded classes look unused but are required.',
      'Duplicate dependency declarations already surface as model warnings at the top of any mvn run.',
    ],
    readOnly: [
      { cmd: 'ls -lh target/*.jar build/libs/*.jar 2>/dev/null', why: 'Artifact size baseline' },
      { cmd: 'unzip -l target/app.jar | sort -k1 -rn | head -30', why: 'Inside a fat jar (BOOT-INF/lib for Spring Boot)' },
      { cmd: 'mvn -B dependency:tree -DoutputFile=/tmp/tree.txt -DappendOutput=true', why: 'Full dependency tree, all modules' },
      { cmd: 'mvn -B dependency:analyze-duplicate', why: 'Duplicate declarations in the POMs' },
      { cmd: 'mvn -B -DskipTests compile', why: 'Sanity check: bytecode analysis needs a module that compiles' },
      { cmd: 'mvn -B dependency:analyze', why: 'Unused declared / used undeclared (advisory)' },
      { cmd: 'mvn -B -pl <module> dependency:analyze', why: 'Scope the analysis to one module' },
      { cmd: 'java -Xlog:class+load:file=classload.log:time,uptime,tags -jar target/app.jar', why: 'Class-loading baseline for startup work' },
    ],
    apply: [
      { cmd: 'mvn -B -DskipTests package', why: 'Re-measure the artifact after manifest edits' },
    ],
  },
  {
    id: 'java-gradle',
    label: 'Java / Gradle',
    markers: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'],
    lockfiles: ['gradle.lockfile'],
    notes: [
      'Gradle has no built-in unused-dependency analysis; the dependency-analysis plugin provides it.',
      'runtimeClasspath is the configuration that matters for artifact size.',
    ],
    readOnly: [
      { cmd: './gradlew dependencies --configuration runtimeClasspath', why: 'Runtime dependency graph' },
      { cmd: './gradlew dependencyInsight --dependency <name> --configuration runtimeClasspath', why: 'Why a version was chosen' },
      { cmd: 'ls -lh build/libs/*.jar', why: 'Artifact size baseline' },
    ],
    apply: [
      { cmd: './gradlew build -x test', why: 'Re-measure after manifest edits' },
    ],
  },
  {
    id: 'go',
    label: 'Go',
    markers: ['go.mod'],
    lockfiles: ['go.sum'],
    notes: [
      'go mod tidy rewrites go.mod/go.sum: always use "go mod tidy -diff" (Go 1.23+) to inspect without writing.',
      'go mod graph in-degree is a hint, not a verdict: test-only helpers (go-spew, go-difflib) and "go@x.y" pseudo-nodes dominate the top of the list; filter with grep -v "^go@" and confirm with go mod why.',
      'go mod tidy keeps dependencies required by tests of the main module, so test libraries legitimately stay.',
      'Raw nm output is dominated by runtime metadata (runtime.pclntab, _type:*, go:func.*); filter to text symbols for real code weight.',
      'macOS has no timeout(1) by default; use gtimeout or an argument that makes the binary exit immediately.',
    ],
    readOnly: [
      { cmd: 'go version', why: 'Confirm -diff support (needs Go 1.23+)' },
      { cmd: 'go list -m all | wc -l', why: 'Module count baseline' },
      { cmd: 'go mod tidy -diff', why: 'Unused modules and stale go.sum entries, without writing' },
      { cmd: "go mod graph | awk '{print $2}' | grep -v '^go@' | sort | uniq -c | sort -rn | head -15", why: 'Most-depended-on modules (hint only)' },
      { cmd: 'go mod why -m <module>', why: 'Confirm whether a module is really needed' },
      { cmd: "go list -f '{{.ImportPath}} {{.Name}}' ./... | grep -w main", why: 'Locate main packages instead of assuming the repo root' },
      { cmd: 'go build -o /tmp/dep-audit-app <main-pkg> && ls -lh /tmp/dep-audit-app', why: 'Binary size baseline' },
      { cmd: 'go tool nm -size /tmp/dep-audit-app | awk \'$3=="T" || $3=="t"\' | sort -k2 -nr | head -20', why: 'Largest code symbols (text segment only)' },
      { cmd: "GODEBUG=inittrace=1 /tmp/dep-audit-app <instant-exit-flag> 2>&1 | grep '^init ' | sort -k5 -rn | head", why: 'Package init cost at startup' },
    ],
    apply: [
      { cmd: 'go mod tidy', why: 'Remove unused modules and stale go.sum lines (writes files)' },
      { cmd: 'go build -ldflags="-s -w" -o /tmp/dep-audit-app-slim <main-pkg>', why: 'Strip symbol table and DWARF; measure before adopting' },
    ],
  },
  {
    id: 'rust',
    label: 'Rust',
    markers: ['Cargo.toml'],
    lockfiles: ['Cargo.lock'],
    notes: [
      'cargo machete is a fast heuristic; cargo udeps is accurate but needs nightly.',
      'cargo machete also scans vendored/path crates (measured: its only finding sat in a vendor/ fork, not in the project itself).',
      'Duplicate major versions are normal and mostly not removable; check who pins them first.',
      'A missing [profile.release] section is common; on a measured 17 MB binary, strip alone removed 19.3%.',
    ],
    readOnly: [
      { cmd: 'cargo tree -d', why: 'Duplicate crate versions' },
      { cmd: 'cargo tree -i <crate>', why: 'Who pulls a crate in' },
      { cmd: 'cargo machete', why: 'Unused dependencies (needs cargo-machete)', network: true },
      { cmd: 'cargo build --release && ls -lh target/release/<bin>', why: 'Binary size baseline' },
      { cmd: 'cargo bloat --release --crates', why: 'Per-crate size attribution (needs cargo-bloat)', network: true },
    ],
    apply: [
      { cmd: 'cargo build --release', why: 'Re-measure after profile/feature edits' },
    ],
  },
  {
    id: 'python',
    label: 'Python',
    markers: [/^requirements.*\.txt$/, 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg'],
    lockfiles: ['poetry.lock', 'uv.lock', 'Pipfile.lock'],
    notes: [
      'Framework loading by string (Django INSTALLED_APPS, Celery tasks, Alembic, entry points) looks unused to static tools.',
      'Split dev/test/docs extras so production installs stop dragging jupyter/pytest along.',
      'deptry reports dependencies from [project.optional-dependencies] as unused unless the extras are configured (measured: pytest, hypothesis, pytest-mock).',
      'When the import name differs from the package name, deptry emits a paired false finding (measured: DEP001 dotenv + DEP002 python-dotenv) — fix it with package_module_name_map.',
    ],
    readOnly: [
      { cmd: 'du -sh "$(python -c \'import site; print(site.getsitepackages()[0])\')"/* 2>/dev/null | sort -rh | head -20', why: 'Largest installed packages' },
      { cmd: 'deptry .', why: 'Unused/missing/transitive dependency report', network: true },
      { cmd: 'pip-extra-reqs ./src', why: 'Requirements that nothing imports', network: true },
      { cmd: 'python -X importtime -c "import app" 2> /tmp/importtime.log', why: 'Import-time profile for startup work' },
      { cmd: "sort -t'|' -k2 -n /tmp/importtime.log | tail -20", why: 'Biggest import-time offenders' },
    ],
    apply: [
      { cmd: 'pip install --no-cache-dir -r requirements.txt', why: 'Reinstall after trimming requirements' },
    ],
  },
  {
    id: 'php',
    label: 'PHP / Composer',
    markers: ['composer.json'],
    lockfiles: ['composer.lock'],
    notes: [
      'Framework magic (Laravel facades/providers, Symfony bundles.php) makes grep-based unused detection unreliable.',
      'composer install --no-dev plus an authoritative classmap cuts both size and startup work.',
    ],
    readOnly: [
      { cmd: 'du -sh vendor', why: 'Install-size baseline' },
      { cmd: 'composer show -t', why: 'Dependency tree' },
      { cmd: 'composer why <pkg>', why: 'Who requires a package' },
      { cmd: 'composer-unused', why: 'Unused composer requirements (external tool)', network: true },
    ],
    apply: [
      { cmd: 'composer install --no-dev --optimize-autoloader --classmap-authoritative', why: 'Production install: smaller and faster to boot' },
    ],
  },
]

function matchesMarker(eco, name) {
  return eco.markers.some((m) => (typeof m === 'string' ? m === name : m.test(name)))
}

function scan(root, maxDepth) {
  const hits = new Map()
  const record = (eco, key, file) => {
    if (!hits.has(eco.id)) hits.set(eco.id, { eco, evidence: new Set(), lockfiles: new Set() })
    const entry = hits.get(eco.id)
    if (entry[key].size < MAX_EVIDENCE) entry[key].add(file)
  }

  const walk = (dir, depth) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(entry.name)) walk(full, depth + 1)
        continue
      }
      for (const eco of ECOSYSTEMS) {
        if (matchesMarker(eco, entry.name)) record(eco, 'evidence', full)
        else if (eco.lockfiles.includes(entry.name)) record(eco, 'lockfiles', full)
      }
    }
  }

  walk(root, 0)
  return hits
}

function renderMarkdown(root, hits, includeApply) {
  const lines = ['# Dependency slimming — audit plan', '', `Root: \`${root}\``, '']
  const list = [...hits.values()]
  lines.push(`Detected ${list.length} ecosystem(s).`, '')
  for (const { eco, evidence, lockfiles } of list) {
    lines.push(`## ${eco.label}`, '')
    lines.push(`Evidence: ${[...evidence].join(', ')}`)
    if (lockfiles.size > 0) lines.push(`Lockfiles: ${[...lockfiles].join(', ')}`)
    lines.push('')
    lines.push('Notes:')
    for (const note of eco.notes) lines.push(`- ${note}`)
    lines.push('')
    lines.push('Read-only checks:')
    lines.push('')
    lines.push('| Command | Purpose |')
    lines.push('| --- | --- |')
    for (const c of eco.readOnly) lines.push(`| \`${c.cmd}\` | ${c.why}${c.network ? ' (network)' : ''} |`)
    if (includeApply) {
      lines.push('')
      lines.push('Apply only after the user approves (writes files):')
      lines.push('')
      lines.push('| Command | Purpose |')
      lines.push('| --- | --- |')
      for (const c of eco.apply) lines.push(`| \`${c.cmd}\` | ${c.why} |`)
    }
    lines.push('')
  }
  lines.push('Start with the read-only checks, report findings, and only then change manifests.')
  return lines.join('\n')
}

function usage() {
  return 'Usage: node scripts/plan.mjs <project-dir> [--json] [--depth N] [--include-apply]'
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const args = argv.filter((a) => !a.startsWith('--'))
  const depthFlag = argv.indexOf('--depth')
  const depth = depthFlag >= 0 ? Number.parseInt(argv[depthFlag + 1], 10) : 3

  if (args.length !== 1 || flags.has('--help')) {
    console.error(usage())
    return 1
  }
  const root = resolve(args[0])
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`Not a directory: ${root}`)
    return 1
  }

  const hits = scan(root, Number.isFinite(depth) && depth >= 0 ? depth : 3)
  if (hits.size === 0) {
    console.error(`No supported ecosystem detected under ${root} (depth ${depth}).`)
    return 1
  }

  if (flags.has('--json')) {
    const payload = {
      root,
      depth,
      ecosystems: [...hits.values()].map(({ eco, evidence, lockfiles }) => ({
        id: eco.id,
        label: eco.label,
        evidence: [...evidence],
        lockfiles: [...lockfiles],
        notes: eco.notes,
        readOnly: eco.readOnly,
        apply: flags.has('--include-apply') ? eco.apply : [],
      })),
    }
    console.log(JSON.stringify(payload, null, 2))
  } else {
    console.log(renderMarkdown(root, hits, flags.has('--include-apply')))
  }
  return 0
}

process.exit(main(process.argv.slice(2)))
