# Validation log

What was actually executed before v1.0.0, in which environment, and what it changed.

Project names are deliberately omitted: the shape and scale of each target is what
makes the evidence meaningful, and the local paths prove nothing.

## Environment

| Tool | Version |
| --- | --- |
| OS | macOS (arm64) |
| Go | 1.27.1 |
| Java | OpenJDK 17.0.20 |
| Maven | 3.9.16 |
| Node | 26.8.2 |

## Targets

| Target | Shape | Why it was chosen |
| --- | --- | --- |
| Go service | 373 modules, 3 `cmd/*` main packages, 64 MB binary | Exercises the module graph, binary size attribution and init tracing at real scale |
| Maven multi-module framework | 41 reactor entries, Java 21 target | Exercises reactor-wide reporting, duplicate detection and `analyze` semantics |
| Maven single-module library | Java 17 target, 106-line dependency tree | The JDK matched, so `dependency:analyze` could actually produce findings |

All commands were read-only. In the Go repository, `git status --porcelain` was
captured before and after the run and was identical — `go mod tidy -diff` truly
writes nothing.

## Findings that changed the documentation

| Ran | Revealed | Documentation change |
| --- | --- | --- |
| `go mod tidy -diff` | 4 stale `go.sum` entry groups (`tablewriter`, `cobra`, `runewidth`, `uniseg`) plus removals | Detection must use `-diff`; dependency drift in `go.sum` is now a first-class category |
| `go mod graph \| awk '{print $2}' \| sort \| uniq -c \| sort -rn` | The top of the list was test-only helpers (`go-spew` 43, `go-difflib` 40) and `go@1.24` pseudo-nodes | Documented as a hint, not a verdict; added the `grep -v '^go@'` filter and `go mod why` confirmation |
| `go list -f '{{.ImportPath}} {{.Name}}' ./... \| grep -w main` | 3 main packages under `cmd/`, no root main | Removed the `go build .` assumption; the doc now locates the package first |
| `go build` / `go list` | `error obtaining VCS status ... Use -buildvcs=false` when the git environment is broken | Added the environment caveat; it is not a project defect |
| `go tool nm -size <bin>` | Top symbols were runtime metadata: `drbg.memory` 32 MB, `runtime.pclntab` 14 MB, `_type:*` 4 MB | Added the `awk '$3=="T" \|\| $3=="t"'` filter for real code weight |
| `go build -ldflags="-s -w"` | 67,595,266 → 47,145,330 bytes (**-30.2%**) | Replaced the vague "-20~30%" with the measured window and the pprof cost |
| `GODEBUG=inittrace=1 <bin> <instant-exit-flag>` | 312 packages initialized; largest `validator/v10` 2.1 MB / 20,344 allocs | Documented the exact column layout and the need for an instant-exit argument |
| `timeout 8 <bin>` | `timeout` and `gtimeout` are both absent on macOS | Added the macOS warning; the command silently produced nothing before |
| `mvn dependency:tree -DoutputFile=...` | 25 lines in a 41-entry reactor | Added `-DappendOutput=true`; re-run produced 4151 lines |
| `mvn dependency:analyze` | Forks `test-compile` (`>>> analyze > test-compile >>>`) — it compiles itself | Removed the planned "you must compile first" advice, which was wrong |
| `mvn dependency:analyze` on a `pom` module | `Skipping pom project` | Added the aggregator warning; a skip must not be read as "clean" |
| `mvn dependency:analyze` on Java 21 target with JDK 17 | `不支持发行版本 21`, zero analysis output | Added the toolchain-mismatch prerequisite |
| `mvn dependency:analyze` on the Java 17 library | `Used undeclared` + `Unused declared` + **`Non-test scoped test only`** | Added the third verdict category |
| Same run | `spring-boot-starter-webflux` and `spring-boot-starter-data-r2dbc` reported **unused** on a library where they are SPI auto-configuration entry points | Promoted to the canonical false-positive example at the top of the Java section |
| `mvn dependency:analyze-duplicate` | Reported a duplicate at module 35 of 41; `grep \| head -15` had hidden it entirely | Added the truncation trap; the same duplicate also appears in the free model warning at the top of any `mvn` run |
| `java -Xlog:class+load`, then `-XX:ArchiveClassesAtExit` + `-XX:SharedArchiveFile` | 411 classes loaded by Hello World; 160 KB archive; 410/411 classes then came from `shared objects file` | Verified the CDS verification method itself, and documented that the *timing* win is invisible at this scale |

## What was not validated locally

Stated plainly so the docs are not read as more tested than they are:

## Round 2 — the remaining ecosystems

Environment added for this round: cargo 1.98.1, uv 0.11.14, Docker 29.4.3, OpenJDK 26.

| Target | Shape | What was run | Result |
| --- | --- | --- | --- |
| pnpm workspace (frontend) | 1.4 GB `node_modules`, pnpm 11 | `du -sh node_modules/*`, `du -sh node_modules/.pnpm/*`, `pnpm why react` | `du` reported **0 B** for vitest / typescript / esbuild / @playwright (symlinks), so the ranking was noise; `.pnpm` showed the real weights (242 MB, 210 MB, 145 MB) |
| Vite app in that workspace | `dist/` with no `.map` files | `ls dist/assets/*.map`, source-map-explorer feasibility | Build shipped **0 sourcemaps**, so the documented command cannot run; largest chunk 5.6 MB |
| npm project | 4 dev dependencies, lockfile present | `npx depcheck`, `npm ls --all \| grep -c deduped` | depcheck returned 5 findings, **4 of them provably false** (tailwind, two storybook addons); 52 `deduped` entries |
| Rust TUI | 35 direct dependencies, existing release binary | `cargo tree -d`, `cargo tree -i`, `cargo machete` (installed to /tmp), `strip` | `bitflags` 1.3.2 vs 2.11.0 duplicate; machete's only finding sat in `vendor/`; strip alone removed **19.3%** of a 17.0 MB binary |
| Python project | Python 3.13 venv, pyproject with a dev extra | `deptry` via `uvx`, `du -sh site-packages/*`, `python -X importtime` | deptry: 5 findings, the 3 dev-extra ones false; `python-dotenv` produced a paired DEP001+DEP002; pandas import cost 704 ms; `py_mini_racer` 61 MB outsized `pandas` 47 MB |
| PHP fixture (Docker) | composer 2, monolog + guzzle + a phpunit dev dependency | `composer install`, `show -t`, `why`, then `--no-dev --optimize-autoloader --classmap-authoritative` | vendor **12 MB → 2.5 MB (-79%)** |
| Java 21 module (Docker) | `mate-base` from a 41-entry reactor | `dependency:analyze` under Temurin 21 | Compiled, then reported `No dependency problems found` |

**No JDK 21 is installed on this machine**, contrary to expectation: `/usr/libexec/java_home`,
`/Library/Java`, sdkman/jenv/asdf/mise, IDE bundles and a Spotlight search all came up empty;
only OpenJDK 17 and 26 are present. JDK 26 cannot compile the project either
(`maven-compiler-plugin` fails with `TypeTag :: UNKNOWN`), so running Maven in a
Temurin 21 container is now the documented remedy.

This round also produced the fixture suite: `test/fixtures/` plus
`scripts/verify-commands.mjs`, which runs the documented commands against those
fixtures, compares a source snapshot before and after to prove the commands are
read-only, and reports a missing toolchain as SKIP rather than success.

## Round 3 — Java and Go completeness

Both ecosystems were taken past "the command runs" to "the command is asserted in CI".

| Target | What was run | Result |
| --- | --- | --- |
| Spring Boot gateway (Java 21, built in a Temurin 21 container) | `mvn -pl mate-gateway -am -DskipTests package`, then jar inspection | Produced an **87 MB fat jar with 174 `BOOT-INF/lib` entries**; real heavyweights: `nacos-client` 14.9 MB, `byte-buddy` 9.0 MB, `bcprov-jdk18on` 8.9 MB, `redisson` 2.9 MB |
| The same jar | `unzip -l … \| sort -k1 -rn \| head` vs `awk 'NF==4'` | The unfiltered ranking put `unzip`'s **own summary line** (`91928424  356 files`) first; the filtered form is now the documented command |
| The same jar | `java -Djarmode=layertools … list`, `java -Djarmode=tools … list-layers` | Both list the four layers, but `layertools` prints a **deprecation warning**; the docs now lead with `-Djarmode=tools` |
| The same jar, started for 12 s | `java -Xlog:class+load:file=… -jar app.jar` | **14,120 classes** loaded, **1,458** of them from the CDS archive — the real order of magnitude next to the 411-class Hello World |
| Maven single-module library | `mvn org.basepom.maven:duplicate-finder-maven-plugin:check` | Runs across compile/runtime/test classpaths; no duplicate classes in that project |
| The same library | `mvn dependency:tree -Dverbose`, `-Dincludes=io.r2dbc`, `jdeps --print-module-deps` | `-Dverbose` still emits `omitted for duplicate` on plugin 3.9.0; `-Dincludes` scopes correctly; jdeps reported `java.base,java.desktop` |
| Gradle (cached 8.9 distribution) | `dependencies --configuration runtimeClasspath`, `dependencyInsight` | Both succeed offline; the fixtures now assert them in CI |
| Go service | `go mod why -m` on a used and an unused module | Import chain `internal/handler → github.com/google/uuid`; `(main module does not need module …)` for the unused one |
| Go service | `go build` with a broken git environment, then `GOFLAGS=-buildvcs=false` | **Reproduced**: the default build fails with `error obtaining VCS status: exit status 128`; with the flag it succeeds and `go version -m <bin>` reports zero `vcs.*` lines |
| New `go-unused` fixture | `go mod tidy -diff` | Exits **1** and prints the real diff removing `require example.com/leftover v0.0.0`; the clean fixture exits 0 silently — so the exit code is a usable CI gate |

The CI run on a clean Ubuntu runner now executes **21 checks with 0 skips**, covering
Node, Go (including positive detection), Gradle, Rust, Python, PHP and Maven.

## What was still not validated

- `knip`, `cargo udeps`, `cargo bloat`, `pip-check-reqs` and `composer-unused`
  were not run (nightly or extra installs required); they remain documented from
  their own tool docs.
- `source-map-explorer` / `webpack-bundle-analyzer` were not executed end to end,
  because no inspected project shipped sourcemaps.
- **CDS savings on a real application** were still not measured: the real app's
  class-loading volume was (14,120 classes), but its before/after startup saving
  was not, so the documentation avoids quoting a percentage.
- Java analysis ran on single modules and one container build, not across the
  whole 41-module reactor.
- The fat-jar checks (`jarmode`, class-load logging, duplicate-finder) were run by
  hand against a real project; CI covers the Maven and Gradle fixtures instead.

## Reproducing everything

```bash
npm test                      # unit tests + documentation contracts
npm run verify                # documented commands vs fixtures, offline toolchains
npm run verify:network        # adds the Maven fixture case
```

The CDS and class-loading claims can be re-checked on any machine with a JDK:

```bash
mkdir -p /tmp/dep-startup && cd /tmp/dep-startup
printf 'public class Hello { public static void main(String[] a) { System.out.println("up"); } }\n' > Hello.java
javac Hello.java

java -Xlog:class+load:file=c1.log Hello
wc -l c1.log                                    # classes loaded at startup

java -XX:ArchiveClassesAtExit=app.jsa Hello     # training run
java -XX:SharedArchiveFile=app.jsa -Xlog:class+load:file=c2.log Hello
grep -c 'shared objects file' c2.log            # classes served from the archive
```
