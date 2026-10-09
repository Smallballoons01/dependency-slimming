# 各生态检测手册（Ecosystem Playbook）

按需加载：只读当前生态的小节。所有命令输出**排序 + 截断，只看 top N**；先 `--dry-run` / 查看模式，确认后再落盘。

## Node.js / JS（npm / yarn / pnpm / bun）

清单：package.json + 锁文件（package-lock.json / yarn.lock / pnpm-lock.yaml / bun.lockb）

体积（分三层量，报告里分开写）：
1. 安装体积（npm / yarn）：`du -sh node_modules | cut -f1`；top 依赖：`du -sh node_modules/* 2>/dev/null | sort -rh | head -25`
   - ⚠️ **pnpm 上这条命令给出的是纯噪声**：实测一个 pnpm 工作区里 `du -sh node_modules/*` 对 vitest / typescript / esbuild / @playwright **全部输出 `0B`**（都是符号链接，`du` 不计链接内容），排序结果毫无意义。pnpm 必须改看实体目录：`du -sh node_modules/.pnpm/* | sort -rh | head -25`（同一项目实测真实大户：`@openai/codex` 242M、`@anthropic-ai/claude-agent-sdk` 210M、`@embedded-postgres` 145M）。
2. 真实打进产物的体积：`npx source-map-explorer "dist/*.js"` —— **先确认 `.map` 存在**（`ls dist/assets/*.map`）。实测一个 Vite 项目 dist 里 **0 个 sourcemap**（构建未开 `build.sourcemap`），此命令根本跑不起来；这种情况改用 rollup-plugin-visualizer（vite）/ webpack-bundle-analyzer，或先在 CI 打开 sourcemap 再分析。**node_modules 大 ≠ 产物大**（同一项目单个 index chunk 就有 5.6MB，值得单独归因）。
3. 单依赖在产物中的占比：source-map-explorer 按文件下钻，或 bundle-analyzer treemap。

未使用：
- 快查：`npx depcheck`（扫 require/import/配置文件引用）。
  - ⚠️ **实测误报率很高**：某真实项目 39 个依赖报出 5 条"未使用"，其中 `tailwindcss`、`@tailwindcss/typography`（只被 CSS/配置引用）、`@storybook/addon-a11y`、`@storybook/addon-docs`（只被 `.storybook/main.ts` 里的字符串引用）**全是误报**。**depcheck 的输出是待确认清单，不是删除清单。**
- 深查：`npx knip`（顺带查未用文件/导出/依赖，monorepo 支持 workspace）。
- 落锤前复核：grep 源码 import/require；检查 package.json scripts、worker 线程、动态 import、CSS 与构建配置（`tailwind.config`、`.storybook/`、`postcss.config`）里的字符串引用、@types 包。

重复/冗余：
- `npm ls <pkg>` 看多版本；`npm dedupe --dry-run` 预览合并收益；`npm ls --all | grep -c deduped` 可快速量出重复压力（实测一个前端项目 52 处 deduped）。
- pnpm：`pnpm why <pkg>`（实测输出带 `[deduped]` 标记，能直接看出哪条路径已去重）；pnpm 的 node_modules 是符号链接农场，**du 统计会误导**（见上文 1. 的 0B 实测），体积以 `node_modules/.pnpm` 实体目录或锁文件为准。
- 常见共病：lodash 与 lodash-es 及 lodash.* 每方法包并存；moment 与 dayjs 并存；两套 UI 库；core-js@2 与 @3 并存；两个日期库。

Monorepo：逐个 workspace 的 package.json 检查；提升（hoisting）会掩盖重复，用 `npm ls <pkg> -w` / `pnpm why` 按 package 下钻。

Serverless/冷启动专项见 references/startup-optimization.md。

## Java（Maven / Gradle）

清单：pom.xml / build.gradle(.kts)；版本锁：gradle.lockfile / Maven dependencyManagement。

体积：
1. 产物：`ls -lh target/*.jar build/libs/*.jar`
2. 肥 jar 内部构成（Spring Boot 看 BOOT-INF/lib）：`unzip -l target/app.jar | sort -k1 -rn | head -30`
3. 依赖树：`mvn dependency:tree -Dverbose`（输出大，配合 `grep` 或 `-Dincludes=组:构件` 下钻）；Gradle：`./gradlew dependencies --configuration runtimeClasspath`；冲突下钻 `./gradlew dependencyInsight --dependency <名> --configuration runtimeClasspath`

未使用（Maven 自带）：
- `mvn dependency:analyze` 会 **fork `test-compile` 生命周期**（输出里可见 `>>> dependency:analyze > test-compile >>>`），所以它**自己会先编译**，不需要手动加 compile 前置。代价是它继承了整个构建：**项目在你本机 JDK 上编译不过，它就什么也分析不出来**（实测某项目 target 21、本机 JDK 17 → `不支持发行版本 21`，analyze 零输出）。先确认 `java -version` 与项目 target 匹配。
- **pom 聚合模块会被跳过**：只打印 `Skipping pom project`。多模块仓库里先确认模块 `<packaging>` 不是 pom，否则会把"跳过"误读成"没问题"（实测某框架的 `mate-biz`、`mate-common` 都是 pom 聚合层）。
- 结论行共四类：**"Used undeclared dependencies found:"**（未声明却在用，靠传递依赖侥幸工作——要补声明，否则升级传递依赖会碎）、**"Unused declared dependencies found:"**（声明未用）、**"Non-test scoped test only dependencies found:"**（只有测试用到却是 compile scope，应降到 test scope 或删）、**"[INFO] No dependency problems found"**（干净，实测某 jar 模块即此结果）。
- **JDK 版本不匹配时不要改项目**：项目 target 21 而本机只有 17/26 时，最快的办法是用容器跑（`--user` + 挂载到 `/m2` 是为了不产生 root 属主的 `.m2` 文件）：
  ```bash
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "$PWD":/work -w /work -v ~/.m2:/m2 -e HOME=/tmp \
    maven:3.9-eclipse-temurin-21 \
    mvn -B -Dmaven.repo.local=/m2/repository -DskipTests dependency:analyze
  ```
  实测：同一 Java 21 项目在本机 JDK 17 报 `不支持发行版本 21`、在 JDK 26 报编译器插件 `TypeTag :: UNKNOWN`，而这条容器命令编译并通过分析。⚠️ 用 `--user $(id -u):$(id -g)` 才不会在宿主机 `~/.m2` 里留下 root 属主文件。
- ⚠️ **"未使用"≠可删**：实测某 R2DBC 扩展库的 analyze 把 `spring-boot-starter-webflux`、`spring-boot-starter-data-r2dbc` 判成 unused——而它们是 SPI 自动配置入口（写在 `AutoConfiguration.imports` 里），源码中根本没有对应 import。这就是下面误报源的真实样本：**先判断是不是 SPI / 反射 / 注解处理器，再决定删**。
- **必知误报源**：lombok/mapstruct 等注解处理器；JDBC 驱动、Jackson modules、日志实现等 SPI；Spring/Hibernate 反射加载的类——这些会被判"未使用"。保留，必要时改 scope（如 runtime）而不是删。
- 多模块 `-DoutputFile` 会被每个模块**互相覆盖**：必须加 `-DappendOutput=true`（实测 41 条 reactor 从 25 行恢复到 4151 行）。
- ⚠️ **截断陷阱**：几十个模块的 reactor 输出几百行，`grep ... | head` 会在结论出现前截断——实测某处重复声明在第 35/41 个模块才出现，`head -15` 完全看不到。先 `> /tmp/log` 落盘，再定位模块，或用 `-pl` 收窄。
- Gradle 无内置分析：推荐 `com.autonomousapps.dependency-analysis` 插件。

重复类/版本冲突：
- **重复声明**有两个来源，都有效：① 任何 `mvn` 运行头部的模型警告 `'...must be unique: g:a:jar -> duplicate declaration of version (?) @ line N'`（免费，但只给行号）；② `mvn dependency:analyze-duplicate` 的 `List of duplicate dependencies defined in <dependencies/>`（给出清单，逐模块跑）。实测同一处重复（同一 `<dependencies>` 里声明两次 `mate-monitor-starter`）两者都能抓到。
- `mvn dependency:tree -Dverbose` 看 omitted for conflict；要抓真坑用 basepom 的 duplicate-finder-maven-plugin 找**不同 jar 里的同名类**（类加载顺序决定行为）。
- 高发冲突：slf4j 多实现并存（logback+log4j-over-slf4j+slf4j-simple）、javax ↔ jakarta 混用、guava/jackson 多版本。

打包/部署形态：
- servlet-api 等容器提供的依赖 → scope=provided，别打进 war/jar。
- Spring Boot 镜像分层：`java -Djarmode=layertools -jar app.jar extract` → 依赖层独立缓存（发布只推代码层）。
- 运行时镜像瘦身：jlink（`jdeps --print-module-deps` 算最小模块集）或 distroless/JRE-only 基础镜像。

## Go

清单：go.mod + go.sum。

未使用（编译器级准确，无 Java 那类误报——Go 未 import 就编不进来）：
- `go mod tidy -diff`（**Go 1.23+，只读**）：直接 `go mod tidy` 会改写 go.mod/go.sum，检测阶段绝不能用。实测它除无用模块外还会暴露 **go.sum 残留条目**（某 373 模块服务一次查出 tablewriter / cobra / runewidth / uniseg 残链）——这属于依赖漂移，报告里单列一类。
- `go mod tidy` 会保留主模块测试所需的依赖，测试库留在 go.mod 属正常，不要当冗余删。
- 下钻：`go mod why -m <module>`（打印引用链；输出 "main module does not need" = 可删）。
- 入度榜只是**提示不是结论**：`go mod graph | awk '{print $2}' | grep -v '^go@' | sort | uniq -c | sort -rn | head -15`。实测榜首常是 test-only 助手（go-spew、go-difflib、testify、go-cmp）与 `go@x.y` 伪节点；先滤掉 `go@`，再对候选逐个 `go mod why` 确认。
- main 包定位：`go list -f '{{.ImportPath}} {{.Name}}' ./... | grep -w main`——别假设仓库根就是 main（实测一个后端项目有 3 个 `cmd/*` main）。
- ⚠️ 环境坑：`go list` / `go build` 会因 git 调用失败而报 `error obtaining VCS status ... Use -buildvcs=false`。这是环境问题不是项目问题，确认 git 可用，或用 `GOFLAGS=-buildvcs=false` 绕开。

体积：
- `go build -o /tmp/app <main-pkg> && ls -lh /tmp/app`
- 符号级归因：`go tool nm -size /tmp/app | sort -k2 -nr | head -20`（nm 的 size 列是十进制，可直接数值排序），或 `go tool nm -size -sort size /tmp/app | head -20`（`-sort size` 为**降序**，取 head）。
- **只看文本段**：原始榜单被运行时元数据淹没——实测一个 64M 二进制的 top 是 `crypto/internal/fips140/drbg.memory` 32MB、`runtime.pclntab` 14MB、`_type:*` 4MB、`go:func.*` 2.6MB；这些不是可删代码，而是依赖图撑起来的类型/反射元数据。真实代码重量用 `go tool nm -size /tmp/app | awk '$3=="T" || $3=="t"' | sort -k2 -nr | head -20`。
- 剥符号实测：同一二进制加 `-ldflags="-s -w"` 后 67.6MB → 47.1MB（**-30.2%**；代价：pprof/调试符号受限，发生产前实测）。
- UPX 慎用：启动解压开销 + 杀软误报，仅分发场景评估。

重依赖高发：k8s.io/client-go + apimachinery；aws-sdk-go v1 整包（→ v2 分服务模块）；viper（拖 afero/cast/mapstructure 等一大串）；多个 YAML 库并存。

启动 init 成本：`GODEBUG=inittrace=1 /tmp/app <会立刻退出的入参> 2>&1 | grep '^init ' | sort -k5 -rn | head`（第 3 列 = 出现时刻，第 5 列 = clock 自耗时，行尾还有 bytes/allocs）。实测一个服务启动时 **312 个包 init**，最大的 `validator/v10` 2.1MB / 20344 allocs。⚠️ macOS 默认没有 `timeout(1)`（通常也没有 `gtimeout`），别用它包住服务型二进制——用非法 flag 之类会立刻退出的入参。

## Rust

清单：Cargo.toml + Cargo.lock；target/ 是体积放大器（CI 缓存用 cargo-sweep/cargo clean 管理）。

未使用：
- `cargo machete`（秒级启发式，可能漏宏引用；`cargo install cargo-machete` 约 50 秒）；准确版 `cargo udeps`（需 nightly）。
  - ⚠️ **它会扫进 vendored / path 依赖**：实测某项目唯一一条 findings 落在 `vendor/portable-pty`（上游 fork 的代码），而不是项目自己的 crate——这种要么忽略，要么去上游提 PR，不要在本地 Cargo.toml 里删。
- 被 derive/宏引用的 crate（serde、tokio 的 macros feature 等）可能误报——删前 `cargo build` 验证。

重复版本：
- `cargo tree -d`（同 crate 多版本共存）；`cargo tree -i <crate>` 反查引用方。实测某 TUI 项目 `bitflags` v1.3.2（来自 png）与 v2.11.0 并存——major 不同通常**不可合并**，报告里要区分"可合并"与"只能接受"。
- 多版本多为 major 不兼容（如 rand 0.7/0.8），逐个 upgrade 或用 `-p` 钉住。

体积：
- `cargo build --release && ls -lh target/release/<bin>`
- **`[profile.release]` 缺失是常态**（实测某项目 Cargo.toml 里完全没有该节）。实测一个 17.0MB 的 Rust TUI 二进制：仅 `strip` 就去掉 **19.3%**（→ 13.7MB）。组合拳（opt-level/lto/strip/panic=abort，常见合计 -30~60%）见 references/replacements.md 的 Rust 小节；收益必须按项目实测，不要照搬。
- 逐 crate 归因：`cargo bloat --release --crates`；函数级：`cargo bloat --release -n 20`。

feature 卫生：重 crate 默认全 feature（tokio "full"、image 全编解码、reqwest 默认 openssl）→ `default-features = false` + 按需 features。

## Python

清单：requirements*.txt / pyproject.toml（poetry/uv/setuptools/PDM）/ Pipfile；conda 是 environment.yml。

未使用：
- `deptry .`（读 pyproject/requirements，快）；或 pip-check-reqs 的 `pip-extra-reqs ./src`（多余依赖）/ `pip-missing-reqs ./src`（缺失依赖，顺带修）。
  - ⚠️ **dev/extras 组会被判"未使用"**：实测某项目把 pytest / hypothesis / pytest-mock 写在 `[project.optional-dependencies] dev` 里，deptry 仍报 3 条 `DEP002 defined as a dependency but not used`——全是误报。分析带 extras 的项目必须显式告诉它分析哪组依赖，否则这份报告不能用。
  - ⚠️ **包名 ≠ 导入名会产生成对的假发现**：实测 `python-dotenv` 同时被报 `DEP001 'dotenv' imported but missing from the dependency definitions` 与 `DEP002 'python-dotenv' defined but not used`——同一条真依赖被算成两个问题。用 `package_module_name_map` 配映射即可；deptry 打印的 `Assuming the corresponding module name of package X is Y` 就是在提示哪些包需要配。
- 误报源：字符串引用的框架装载（Django INSTALLED_APPS、Celery 任务、Alembic、插件 entry points、`__import__`）。

体积：
- site-packages top：`du -sh "$(python -c 'import site; print(site.getsitepackages()[0])')"/* 2>/dev/null | sort -rh | head -20`
  - 实测一个量化项目：`py_mini_racer` 61M > `pandas` 47M > `numpy` 23M > `lxml` 19M——**靠依赖名猜不出体积，必须实测**（嵌入式 JS 引擎这类冷门包常常比知名大库还大）。
- 单包信息：`pip show <pkg> | grep -E "^(Name|Version|Location)"`
- Docker 场景：`pip install --no-cache-dir`、多阶段构建、slim/distroless 基础镜像；CUDA 全家桶换 CPU 轮子（见 replacements.md，往往一刀减 GB 级）。

依赖分层：dev/test/docs 拆到 extras 或独立 requirements；生产安装不带 jupyter/ipython/pytest。

## PHP

清单：composer.json + composer.lock；vendor/ 是体积来源。

未使用：
- composer-unused（PHAR 或 dev 依赖安装）全扫；框架魔法（Laravel 门面/服务提供者注册、Symfony bundles.php、模板/配置里引用的服务）会误报，逐个确认。

体积与依赖树：
- `du -sh vendor`；`composer show -t`（树）；`composer why <pkg>`（谁在依赖它）；`composer why-not <pkg> <版本>`（约束排查）。
- 生产安装：`composer install --no-dev --optimize-autoloader --classmap-authoritative`（classmap 权威模式同时是启动优化，见 startup 文档）。实测一个只多一个 `phpunit` dev 依赖的 fixture：vendor 从 **12M 降到 2.5M（-79%）**——这是 PHP 项目性价比最高的一刀。
- 噪声：项目未声明 `version` 时，几乎每条 composer 命令都会打印 `Could not detect the root package (…) version, defaulting to '1.0.0'`，属正常现象，别当错误写进报告。

高发：symfony/symfony 整包 → 拆组件；guzzle 与框架自带 HTTP client 并存；dev 工具误入 require。

## 跨生态通用

- **Docker 层序**：先 COPY 清单+锁文件 → 安装依赖 → 再 COPY 源码。代码改动不再触发依赖重装（部署提速最便宜的一招）。
- **体积预算进 CI**：JS 用 size-limit；其他生态用脚本比对产物大小/依赖数，超阈值即 fail。防回归比一次瘦身更重要。
- 依赖更新机器人（renovate/dependabot）+ 定期审计；删依赖同时缩小漏洞与许可证暴露面（可顺带跑 osv-scanner，属相邻能力不强塞进报告）。
- ⚠️ **macOS/BSD 上没有 `timeout(1)`**（往往也没有 `gtimeout`）：拿它包住审计命令会直接失败或静默无输出——本次验证中连踩三次。需要限时就选一个会立刻退出的入参，或用工具自带的超时参数。
- **本仓库自带 `node scripts/verify-commands.mjs`**：用 `test/fixtures/` 里的微型项目实跑本文档的命令，并在运行前后比对源码快照以证明只读；工具链缺失会明确 SKIP（不会假装成功）。改完本文档先跑它，加 `--network` 才会执行需要下载的用例。
