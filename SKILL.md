---
name: dependency-slimming
description: Audit and slim project dependencies across ecosystems (Node/npm/yarn/pnpm/bun, Java Maven/Gradle, Go, Rust, Python, PHP). Finds unused, duplicated, and oversized dependencies, recommends lighter replacements, and cuts build artifact size and startup time (fat jar, class loading, lazy init, CDS). Use when the user mentions dependency audit / 依赖瘦身 / 依赖检查, 包太大 / artifact or bundle too big, node_modules / fat jar / 二进制过大 / Docker 镜像瘦身, 启动慢 / slow startup / cold start, remove unused dependencies, or wants smaller artifacts and faster deploys.
---

# 依赖瘦身与启动优化（Dependency Slimming）

目标：更小的构建产物、更少的依赖、更快的启动。全程**证据驱动**：先量化基线，再给结论；改动前用户确认，改动后构建 + 测试 + 复测。

## 硬性规则（先读）

- **代码是使用事实的来源，lockfile 是体积事实的来源。** 两者都看，缺一不可。
- 静态工具对 反射 / SPI / 注解处理器 / 宏 / 动态 import / 字符串引用（XML、YAML、模板、框架配置）必然误报。这类发现一律标 **"需人工确认"**，不得直接判死。
- **每次只改一类问题**；每批改完必须：重新构建 → 跑测试 → 复测体积。测试不过，回滚该批。
- 未获用户确认前不删任何依赖——先出报告。
- 数字要诚实：引用实测值（du / unzip / 构建产物 / 启动计时）。没有实测就不要写预估收益；引用外部典型量级时必须注明是典型值、以项目实测为准。

## 工作流

### 1. 识别生态

| 生态 | 判定文件 |
|---|---|
| Node/JS | package.json（+ package-lock.json / yarn.lock / pnpm-lock.yaml / bun.lockb） |
| Java | pom.xml / build.gradle(.kts) / settings.gradle |
| Go | go.mod / go.sum |
| Rust | Cargo.toml / Cargo.lock |
| Python | requirements*.txt / pyproject.toml / Pipfile / poetry.lock / uv.lock |
| PHP | composer.json / composer.lock |

多生态仓库逐个处理；monorepo 对每个 workspace/package 单独过。

### 2. 量基线（改之前，否则无从证明"瘦了多少"）

至少记录：构建产物体积（jar / dist / 二进制 / vendor）、直接依赖数、安装目录体积（node_modules / site-packages / vendor / target）。用户关心启动时另记：冷启动耗时（hyperfine 或 3 次取中位）、类/模块加载数。报告里区分三种体积：**安装体积**（node_modules 等）、**产物体积**（真正发布的东西）、**镜像体积**（Docker 层），三者互不相等，混着说会产生假收益。

### 3. 收集证据

按生态从 `references/ecosystems.md` 取核心命令（只读对应小节）。先跑 1–3 条核心命令；大仓库的依赖树输出一律**排序 + 截断，只看 top**，禁止把全量树贴进上下文。

本包自带只读计划器，起手先跑它：`node <本 SKILL.md 所在目录>/scripts/plan.mjs <project-dir>`（`--json` 机器可读，`--include-apply` 才附带写操作）。它只识别生态并打印命令清单，不执行任何命令。

### 4. 分类归档（五类）

1. **未使用**：直接依赖声明但代码零引用（删除前去锁文件确认不会作为传递依赖被别人间接需要）。
2. **重复/冗余**：同库多版本共存；同用途多库并存（lodash+lodash-es、logback+log4j、两个 HTTP 客户端）。
3. **大而可换**：有公认更轻的替代（对照 `references/replacements.md`，逐条标 ✅安全 / ⚠️需确认 / 📋配置裁剪）。
4. **构建配置臃肿**：dev 依赖打进产物、全量 import、locale 未裁剪、scope 错误（如 servlet-api 非 provided）、资源文件全打包。
5. **启动成本**：启动即加载的类/模块、肥 jar、同步重 init（对照 `references/startup-optimization.md`）。

### 5. 报告（先给结论，等用户勾选）

```markdown
## 依赖瘦身报告 · <项目名>
基线：产物 X MB ｜ 直接依赖 N 个 ｜ 安装目录 Y MB ｜ 冷启动 T s
| # | 依赖 | 类别 | 证据（命令+关键输出） | 建议 | 预期收益 | 风险 |
|---|------|------|----------------------|------|----------|------|
| 1 | moment | 大而可换 | dist 内占 680KB(gz)，grep 命中 3 处 | → dayjs | -660KB(gz，典型值) | ⚠️ 时区插件 API 不同 |
建议执行顺序：① 安全删除 → ② 重复合并 → ③ 替换 → ④ 配置裁剪 → ⑤ 启动优化
```

### 6. 落地（用户确认后，按批执行）

改 manifest → 重新解析锁文件（npm install / go mod tidy / cargo update / mvn 等价操作）→ 构建 → 测试 → 复测体积 → 汇报前后对比表。单批失败回滚该批，不带病前进。

## 资源

| 文件 | 何时加载 |
|---|---|
| scripts/plan.mjs | 起手第一步：识别生态并生成只读命令清单 |
| references/ecosystems.md | 需要某生态的具体命令与解读时（只读对应小节） |
| references/replacements.md | 第 3 类"大而可换"出建议前 |
| references/startup-optimization.md | 用户关心启动慢/冷启动，或报告第 5 类时 |
