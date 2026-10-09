# Sample report (synthetic)

This is the shape of the answer the skill produces. **Every number below is
invented** for a fictional project; a real report carries measured values and the
command that produced each one. Use this file to agree on the format, never as a
source of figures.

---

## Dependency slimming report · demo-api

**Baseline** — artifact 148 MB (fat jar) · 214 direct dependencies · cold start 8.4 s (median of 3)
**Target** — Node 20 service + one Java batch job, measured separately

| # | Dependency | Category | Evidence | Action | Expected gain | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `moment` | oversized, lighter alternative | present in `dist/` at 71 KB gz (`source-map-explorer`), 3 call sites | → `dayjs` | -69 KB gz | ⚠️ timezone plugin API differs |
| 2 | `lodash` (full) | oversized, config | 24 KB gz in bundle, only `get`/`debounce` used | → per-function import | -23 KB gz | ✅ mechanical |
| 3 | `request` | oversized + unmaintained | 14 import sites | → built-in `fetch` | -180 KB install | ⚠️ retry/interceptor code to write |
| 4 | `jackson-databind` 2.13 / 2.15 | duplicated | both versions on the runtime classpath (`dependency:tree -Dverbose`) | align via BOM | -0 (correctness) | ⚠️ regression test needed |
| 5 | `vip.demo:demo-monitor` | duplicated declaration | model warning at line 74 + `analyze-duplicate` listing | declare once | -0 | ✅ |
| 6 | `spring-boot-starter-test` | scope bloat | packaged into the runtime image | → `test` scope | -9 MB image | ✅ |
| 7 | `commons-io` | oversized, stdlib covers | 2 call sites (`FileUtils.copyFile`) | → `java.nio.file` | -0.5 MB jar | ✅ |
| 8 | no AppCDS archive | startup | 6,120 classes loaded at boot (`-Xlog:class+load`) | AppCDS training run | not promised — measure | ✅ |

### Not removed, deliberately

| Dependency | Why the tool flagged it | Why it stays |
| --- | --- | --- |
| `spring-boot-starter-webflux` | `dependency:analyze` reports "unused declared" | SPI auto-configuration entry point (`AutoConfiguration.imports`); nothing imports it in source |
| `org.postgresql:postgresql` | no source reference | loaded by the JDBC driver SPI at runtime |
| `lombok` | reported unused | annotation processor; needed at compile time (`provided` scope) |

### Execution order

1. **Safe removals and scope fixes** (#5, #6, #7) — verify with build + tests.
2. **Consolidations** (#4) — re-run `dependency:tree -Dverbose`, expect one version.
3. **Replacements** (#1, #2, #3) — one library per batch, diff the serialized output.
4. **Startup** (#8) — generate the archive in the image build, confirm with
   `grep -c 'shared objects file' classload.log`, then report the measured delta.

### What this report does not claim

- No savings total is promised: each row is either a measured size or a labelled
  typical value.
- Startup work is only listed as a direction; the number arrives after measuring.
