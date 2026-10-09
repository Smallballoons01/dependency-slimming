# dependency-slimming

一个 [Agent Skill](https://agentskills.io)：把依赖里的水分挤出来，再顺手治一治启动慢。

支持 Claude Code、Codex、Cursor、Gemini CLI、WorkBuddy、DeepSeek Harness，以及任何遵循 Agent Skills 标准的工具。

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## 要解决的问题

每个生态都在鼓励你加依赖，账单晚点才来：

| 症状 | 通常的真实原因 |
| --- | --- |
| 包一路变大 | 已经没人用的依赖还留在清单里；dev 依赖被打进生产产物 |
| `node_modules` / `vendor` / 肥 jar 巨大 | 同一个库的多份版本共存；重量级库在做标准库就能做的事 |
| 冷启动越来越慢 | 启动时加载了一堆用不上的类/模块；同步初始化过重；肥 jar 每次部署重读 |

而这类审计有一个**特定姿势的坑**：凡是靠 反射 / SPI / 注解处理器 / 动态 import 触达的依赖，静态工具都会**误判为"未使用"**。照着删，就是把一次体积优化变成一次线上事故。

## 它做什么

固定五步：**量基线 → 收证据 → 分类 → 验证 → 报告**，覆盖 Node.js、Java（Maven/Gradle）、Go、Rust、Python、PHP。所有发现归入五类：

1. **未使用** —— 声明了但代码零引用（扣除上面那类误报）。
2. **重复/冗余** —— 同库多版本，或多库干同一件事。
3. **大而可换** —— moment → dayjs、PyTorch CUDA 轮子 → CPU、aws-sdk-go v1 → v2 等。
4. **构建配置臃肿** —— 全量 import、locale 未裁剪、scope 写错、dev 依赖进了产物。
5. **启动成本** —— 无谓的类/模块加载、急切初始化、肥 jar、没上 CDS。

## 安装

```bash
node scripts/install.mjs --dry-run    # 先看会改什么，不写任何东西
node scripts/install.mjs --apply      # 软链到所有已存在的工具目录
```

也可以直接把目录拷进任意 skills 根（`~/.claude/skills/`、`~/.codex/skills/`、`~/.cursor/skills/` …）。

其他参数：`--copy`（复制而非软链）、`--project DIR`（项目级、可提交进仓库）、`--target DIR`、`--uninstall`。

安装器只动**已经存在**的工具目录，不覆盖不属于本仓库的条目，且不加 `--apply` 时一个字节都不写。

## 使用

直接用自然语言提需求即可（skill 的 description 就是按这些说法写的触发词）：

> 这个项目的包越来越大了，帮我看看哪些依赖是多余的
>
> 我们 Java 服务启动太慢了，能优化吗
>
> Docker 镜像 1.2G，都是啥占的？

不接 agent 也能拿到只读审计计划：

```bash
node scripts/plan.mjs ~/my-project                 # markdown 计划
node scripts/plan.mjs ~/my-project --json          # 机器可读
node scripts/plan.mjs ~/my-project --include-apply # 连写操作一起列出
```

计划器识别项目里的生态，输出精确命令，并**把只读检查与需要批准的写操作分栏**。它自己从不执行任何命令。

## 安全模型

- **未获批准不删任何东西**：先出报告，再改清单。
- **检测天然只读**：`go mod tidy -diff` 而不是 `go mod tidy`；`npm dedupe --dry-run`；`mvn dependency:analyze-duplicate` 等。
- **证据先于观点**：结论必须附命令与输出，收益数字不得凭记忆编造。
- **一次只改一类**，每批之后必须构建 + 测试 + 复测，失败可归因。
- **数字分类标注**：实测值、行业典型值、假设值三者不得混着说。

## 目录结构

```
SKILL.md                              入口：工作流、硬性规则、报告模板
references/ecosystems.md              各生态命令与解读
references/replacements.md            大依赖 → 小依赖替换表
references/startup-optimization.md    启动优化：类加载、CDS、懒加载、分层镜像
scripts/plan.mjs                      只读审计计划生成器（零依赖）
scripts/install.mjs                   安装到各 AI 工具
scripts/verify-commands.mjs           拿 test/fixtures 实跑文档里的命令
test/                                 node --test 测试与各生态 fixture
VALIDATION.md                         在真实项目上验证了什么、怎么验的
```

## 验证

发布前，本文档里的每条命令都在真实项目上跑过；由此产出的修正已经写回文档，并用测试锁定，避免以后被改回去：

- `go mod tidy` 会改写清单，所以检测阶段改用 `go mod tidy -diff`（Go 1.23+）。它还顺手暴露出没人注意到的 `go.sum` 残留条目。
- `mvn dependency:tree -DoutputFile` 在多模块 reactor 里会被逐模块覆盖：加上 `-DappendOutput=true` 后，报告从 25 行变成 4151 行。
- 长的 reactor 输出不能直接管道给 `head`：某处重复声明直到第 41 个模块中的第 35 个才出现。
- `dependency:analyze` 自己会 fork `test-compile`、会跳过 pom 聚合模块，并且曾把一个库的 `spring-boot-starter-webflux` 判为"未使用"——而它是 SPI 自动配置入口。这正是文档现在开篇强调的误报样本。
- pnpm 工作区里 `du -sh node_modules/*` 对每个符号链接包都报 **0B**，照它排序得到的是纯噪声。
- `depcheck` 在一个真实项目上给出 5 条结论，其中 4 条只被 CSS 与 `.storybook` 配置引用。
- `deptry` 把一条依赖拆成五个问题：dev extra 被判未使用，导入名与包名不同的那条又产生成对假发现。
- fixture 上 `composer install --no-dev --optimize-autoloader --classmap-authoritative` 让 vendor 从 12M 降到 2.5M。
- Java 21 项目无需动你的机器：用 Temurin 21 容器跑 Maven，加 `--user` 就不会污染 `~/.m2` 的属主。

完整证据表（含仍未验证的事项）见 [VALIDATION.md](VALIDATION.md)。

自己跑一遍：

```bash
npm test               # 单元测试 + 文档契约
npm run verify         # 用 fixture 实跑文档命令，并校验只读
npm run verify:network # 追加 Maven 用例
```

CI 每次推送都会在同一套检查上跑一遍，干净的 Ubuntu runner 覆盖全部六个生态——目前 21 项、0 跳过。

## 贡献

欢迎 issue 与 PR。文档改动两条规矩：每条命令必须至少真跑过一次；`node --test` 必须保持通过（测试里就断言着上面这些已验证事实）。

## 许可证

[MIT](LICENSE)
