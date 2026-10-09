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

- **Node, Rust, Python and PHP command sets** were not exercised against a real
  project in this round. They come from the tools' own documentation. Treat the
  first run in your repository as the validation.
- **CDS savings on a real application** were not measured; only the 411-class
  Hello World was. The documentation therefore avoids quoting a percentage.
- **Java 21 projects** could not be analysed on this machine (JDK 17 only), which
  is exactly why that prerequisite is now documented.
- **Lockfile-level accounting** (e.g. pnpm's symlinked `node_modules`) is described
  from tool behaviour, not from a measurement here.

## Reproducing the JVM half

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
