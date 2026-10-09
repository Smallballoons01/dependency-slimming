# dependency-slimming

An [Agent Skill](https://agentskills.io) that finds the fat in your dependencies — and then in your startup.

Works in Claude Code, Codex, Cursor, Gemini CLI, WorkBuddy, DeepSeek Harness, and anything else that reads Agent Skills.

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## The problem

Every ecosystem rewards you for adding a dependency and charges you later:

| Symptom | What it usually is |
| --- | --- |
| The artifact keeps growing | An unused or already-replaced dependency still in the manifest, or dev-only packages shipped to production |
| `node_modules` / `vendor` / fat jar is huge | Duplicate versions of one library, or a heavyweight library doing a job the standard library already does |
| Cold start got slower | Classes and modules loaded for nothing, eager initialization, a fat jar re-read on every deploy |

The audit is easy to get wrong in a specific way: static tools **lie** about anything reached by reflection, SPI, annotation processors or dynamic imports. Deleting that "unused" dependency is how you turn a size win into an outage.

## What it does

A fixed five-step workflow — **measure → collect evidence → classify → verify → report** — across Node.js, Java (Maven/Gradle), Go, Rust, Python and PHP. Every finding lands in one of five buckets:

1. **Unused** — declared, never referenced (minus the false-positive classes above).
2. **Duplicated** — several versions of one library, or several libraries doing one job.
3. **Oversized with a lighter alternative** — moment → dayjs, PyTorch CUDA wheels → CPU, aws-sdk-go v1 → v2, and so on.
4. **Build-config bloat** — full-library imports, uncut locales, wrong dependency scopes, dev dependencies in the artifact.
5. **Startup cost** — pointless class/module loading, eager initialization, fat jars, no CDS.

## Install

```bash
node scripts/install.mjs --dry-run    # show what would be linked, write nothing
node scripts/install.mjs --apply      # link into every tool directory that already exists
```

Or copy this directory into any skills root by hand (`~/.claude/skills/`, `~/.codex/skills/`, `~/.cursor/skills/`, …).

Other options: `--copy` (copy instead of symlink), `--project DIR` (project-scoped root you can commit), `--target DIR`, `--uninstall`.

The installer only touches a tool whose own directory already exists, never overwrites an entry it does not own, and does nothing at all without `--apply`.

## Use

Ask in plain language — the skill's description is written to trigger on it:

> 这个项目的包越来越大了，帮我看看哪些依赖是多余的
>
> Why is our Java service so slow to start?
>
> Our Docker image is 1.2 GB. Where is it coming from?

You can also get the read-only audit plan without an agent:

```bash
node scripts/plan.mjs ~/my-project                 # markdown plan
node scripts/plan.mjs ~/my-project --json          # machine readable
node scripts/plan.mjs ~/my-project --include-apply # also show the write steps
```

The planner detects the ecosystems present and prints the exact commands, split into **read-only checks** and **changes that need approval**. It never executes anything.

## Safety model

- **Nothing is deleted without approval.** The skill reports first, and only then edits manifests.
- **Detection is read-only by construction** — `go mod tidy -diff` instead of `go mod tidy`, `npm dedupe --dry-run`, `mvn dependency:analyze-duplicate`, and so on.
- **Evidence before opinion** — findings quote the command and its output; no savings figure is invented from memory.
- **One category at a time**, each followed by build + tests + re-measure, so a failure is attributable.
- **Numbers are labelled** — measured values, typical industry values, and assumptions are never mixed silently.

## Layout

```
SKILL.md                              entry point: workflow, hard rules, report template
references/ecosystems.md              per-ecosystem commands and how to read them
references/replacements.md            heavyweight → lightweight replacement table
references/startup-optimization.md    startup: classes, CDS, lazy init, lazy images
scripts/plan.mjs                      read-only audit planner (no dependencies)
scripts/install.mjs                   link the skill into every AI tool
scripts/verify-commands.mjs           run the documented commands against test/fixtures
test/                                 node --test suites and per-ecosystem fixtures
VALIDATION.md                         what was verified on real projects, and how
```

## Validation

Every command in this skill was run against real projects before release, and the corrections that came out of it are baked into the docs — then locked in by tests so a future edit cannot silently undo them:

- `go mod tidy` rewrites manifests, so detection uses `go mod tidy -diff` (Go 1.23+). It also surfaced stale `go.sum` entries nobody had noticed.
- `mvn dependency:tree -DoutputFile` overwrites itself once per module in a reactor: `-DappendOutput=true` turned a 25-line report into 4151 lines.
- Long reactor output must not be piped into `head`; a duplicate declaration only appeared at module 35 of 41.
- `dependency:analyze` forks `test-compile` itself, skips `pom`-packaging modules, and reported `spring-boot-starter-webflux` as unused on a library where it is an SPI auto-configuration entry point — the false-positive example the docs now lead with.
- On a pnpm workspace, `du -sh node_modules/*` reported **0 B** for every symlinked package, so the ranking was pure noise.
- `depcheck` returned 5 findings on a real project; 4 were referenced only from CSS and `.storybook` config.
- `deptry` turned one dependency into five issues: a `dev` extra counted as unused, plus a paired finding for a package whose import name differs.
- `composer install --no-dev --optimize-autoloader --classmap-authoritative` cut vendor from 12 MB to 2.5 MB on the fixture.
- Java 21 projects can be analysed without touching your machine: Maven in a Temurin 21 container, with `--user` so your `~/.m2` keeps its ownership.

See [VALIDATION.md](VALIDATION.md) for the full evidence table, including what is still unverified.

Run the checks yourself:

```bash
npm test               # unit tests + documentation contracts
npm run verify         # documented commands vs fixtures, with a read-only proof
npm run verify:network # adds the Maven case
```

## Contributing

Issues and pull requests are welcome. Two rules for doc changes: every command must have been run at least once, and `node --test` must stay green — the tests assert the validated facts above.

## License

[MIT](LICENSE)
