# 大依赖 → 小依赖替换表（Replacements）

使用规则：
- 体积数字是**典型量级**（min+gz 或安装体积），用于判断方向；**报告里必须用项目实测值替换**，并注明来源。
- 标记含义：✅ = 公认安全替换；⚠️ = 收益明确但有 API/行为差异，需回归测试；📋 = 不换库，用配置裁剪现状依赖。
- 动手前先 `grep` 旧包的引用面：命中几处就直接换；命中成百处就列分批计划，别一口吞。
- 换完必跑构建 + 测试；前端替换重点回归：日期格式化输出、序列化结果逐字节 diff。

## Node / JS

| 现状 | 替代 | 为什么更小 | 风险 |
|---|---|---|---|
| moment（默认带全部 locale，约 70KB gz 级；装包 ~19MB） | dayjs（~2KB gz）/ date-fns（tree-shakeable） | 按需、无 locale 负担 | ⚠️ 时区/UTC 走插件体系；复杂 format 语法有差异 |
| moment-timezone | Intl.DateTimeFormat / dayjs timezone 插件 | 复用内置 IANA 数据 | ⚠️ 历史时间与 IANA 数据版本差异需验证 |
| moment（📋 短期不换库） | moment-locales-webpack-plugin / webpack IgnorePlugin 裁 locale | 砍掉绝大多数 locale 体积 | ✅ 纯配置，零代码改动 |
| lodash 全量（~25KB gz） | lodash-es 按函数导入，或原生 ES（flat/flatMap/Object.entries/structuredClone） | tree-shake 后通常 <5KB | ✅ 多为机械替换，逐函数迁移 |
| underscore | 原生 ES | 同上 | ✅ |
| axios（~13KB gz） | 原生 fetch / ky / ofetch | fetch 零运行时 | ⚠️ 拦截器/超时/重试需自封装或由替代库提供 |
| request（已停止维护） | 原生 fetch（Node 18+）/ got | 维护性 + 体积 | ⚠️ API 差异，但源库已死，迁是净收益 |
| jQuery（~30KB gz） | 原生 DOM / 轻量 helper | 现代浏览器 API 已齐 | ⚠️ 老项目插件生态别动；新代码停用、逐步清退 |
| 全量图标包（font-awesome 整包 css+fonts 等） | unplugin-icons / react-icons 按需 SVG | 只打用到的图标 | ✅ |
| core-js@2 + core-js@3 并存 | 统一 3.x + 按 browserslist 现代目标 | 去重复 polyfill | ⚠️ 先确认最低浏览器目标 |
| classnames 与 clsx 并存 | 保留一个 | 去重 | ✅ |

## Java

| 现状 | 动作 | 说明 | 风险 |
|---|---|---|---|
| fastjson | jackson-databind（Spring 已自带） | 去掉一整套 JSON 栈 + 安全历史差 | ⚠️ 反序列化行为差异要回归 |
| guava 与 commons-lang3 并存 | 保留一个 | 功能大量重叠 | ⚠️ 按实际用到的函数面选择 |
| log4j 1.x / 多套日志实现并存 | logback（Boot 默认）或 log4j2，slf4j 单门面 | 去冲突 + 安全 | ✅ 注意排除旧桥接包，防止循环桥接 |
| spring-boot-starter-data-jpa 但只跑 SQL | spring-boot-starter-jdbc | 去掉 Hibernate 全家（肥 jar 里常是最大头之一） | ⚠️ 失去 ORM，评估改造成本 |
| POI 全量读写 Excel | poi-ooxml + SXSSF 流式写；纯只读场景可评估 fastexcel | 内存与体积双降 | ⚠️ API 迁移 |
| commons-io 仅用了 Files.copy 等零星功能 | java.nio.file | JDK 已覆盖大部分 | ✅ |
| servlet-api 被打进 jar/war | scope=provided | 体积 + 防冲突 | ✅ |
| 📋 starter-web 拖着不用的 tomcat | 排除 tomcat 换 undertow/jetty，或评估 webflux | 按需选容器 | ⚠️ 容器行为差异需压测 |
| 📋 仅构建期需要的依赖（lombok、mapstruct、代码生成） | scope=provided / annotationProcessorPaths | 不进运行时 classpath | ✅ |

## Python

| 现状 | 替代 | 为什么更小 | 风险 |
|---|---|---|---|
| opencv-python | opencv-python-headless（服务端） | 去 libGL/GTK 系统依赖 | ✅ 无 GUI 需求即换 |
| tensorflow（默认含 CUDA） | tensorflow-cpu（CPU 服务） | 少 GB 级 CUDA 库 | ✅ 无 GPU 机器即换 |
| torch（pip 默认拉 CUDA 版，2GB+ 级） | `pip install torch --index-url https://download.pytorch.org/whl/cpu` | CPU 轮子 200MB 级 | ✅ CPU 推理部署最常见的一刀 |
| torch 推理场景 | 导出 ONNX → onnxruntime | 数百 MB → 几十 MB | ⚠️ 算子覆盖与精度验证 |
| pandas（60MB 级安装）但只做 CSV 读写/简单聚合 | stdlib csv / numpy | 视用法砍掉大头 | ⚠️ 用面广就别动；先 grep import 面 |
| jupyter/ipython/pytest 出现在运行时依赖 | 挪到 dev extras | 生产安装少几十至上百 MB | ✅ |
| 📋 安装体积 | `--no-cache-dir` + 多阶段构建 + slim 基础镜像 | 不换库也砍安装与镜像体积 | ✅ |

## PHP

| 现状 | 动作 | 说明 | 风险 |
|---|---|---|---|
| symfony/symfony 整包 | 拆成用到的 symfony/* 组件 | 整包拖全组件 | ⚠️ 逐组件迁移 |
| guzzle 与框架自带 HTTP client 并存 | 保留一个 | 去重 | ✅ |
| dev 工具在 require | 移到 require-dev | 生产 --no-dev 直接不装 | ✅ |
| 📋 自动加载 | --classmap-authoritative -o | 体积小改 + 启动更快 | ✅ |

## Rust

| 现状 | 动作 | 说明 | 风险 |
|---|---|---|---|
| openssl | rustls（reqwest: default-features=false, features=["rustls-tls"]） | 静态编译更小、交叉编译容易 | ⚠️ 私有 CA / FIPS 场景先确认 |
| tokio features="full" | 按需（rt-multi-thread, net, macros, time…） | 砍掉没用到的子系统 | ✅ 编译期保证 |
| image 默认全 codec | features=["png","jpeg"]（按需） | 编译时间 + 二进制双降 | ✅ |
| chrono（视用面） | time crate / std::time | 依赖链更短 | ⚠️ 优先级低，别为换而换 |
| lazy_static | once_cell / std::sync::LazyLock（1.80+） | 少一个依赖 | ✅ |
| 📋 [profile.release] | opt-level="z" 或 "s"、lto="fat" 或 "thin"、codegen-units=1、strip="symbols"、panic="abort" | 合计常见 -30~60% 二进制体积 | ⚠️ panic="abort" 禁用 catch_unwind；z 偏体积、s 偏均衡，需压测取舍 |

## Go

| 现状 | 动作 | 说明 | 风险 |
|---|---|---|---|
| aws-sdk-go（v1 整包） | aws-sdk-go-v2 按服务模块 | v1 把所有服务都编进来 | ⚠️ API 有变化，逐服务迁移 |
| viper | stdlib flag/env 或 koanf | viper 拖 afero/cast/mapstructure 等一大串 | ⚠️ 热更新/多格式配置需求先确认 |
| 多个 YAML 库并存（sigs.k8s.io/yaml + gopkg.in/yaml.v2/v3） | 保留一个 | 去重 | ✅ 注意 sigs 版本是 json→yaml 桥，语义不同 |
| logrus | log/slog（stdlib，Go 1.21+） | 去依赖 + 结构化日志 | ✅ 接口近似 |
| 📋 二进制 | `-ldflags="-s -w"`；镜像用 distroless/static 基础镜像 | 二进制 -20~30% + 镜像瘦身 | ✅ 符号表按需保留（排障机器可留未剥符号副本） |
