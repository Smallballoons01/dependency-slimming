# 启动优化手册（Startup Optimization）

先测后改：任何优化都要有启动基线（多次取中位）和改后复测。启动时间通常拆三段：**进程/JVM 初始化 → 类/模块加载 → 框架初始化**（Bean/路由/连接池）。分段定位再动手，别猜。

## Java / JVM（启动慢的最高发区）

### 1. 测量

- 类加载耗时与数量（JDK 9+）：`java -Xlog:class+load:file=classload.log:time,uptime,tags -jar app.jar`（JDK 8 用 `-verbose:class`）
  - `wc -l classload.log` 看总加载类数；按时间戳分布看加载集中在哪个阶段。实测 JDK 17 上一个 Hello World 就加载 **411 个类**，业务应用通常是它的几十倍。
  - CDS 生效的类来源显示为 `shared objects file`——`grep -c 'shared objects file' classload.log` 就是命中数，没命中说明 archive 失效（见下）。
- Spring Boot：Boot 2.4+ 配置 `BufferingApplicationStartup` 后可拉 `/actuator/startup`，拿到 Bean 级时间线；简单场景直接看启动日志分段。
- 端到端：`hyperfine --warmup 2 'java -jar app.jar'`，或"启动到端口就绪"的脚本计时。

### 2. 见效快、风险低（先做这批）

- 懒加载：`spring.main.lazy-initialization=true`。必须提前初始化的（调度器、MQ 监听、连接池预热、定时任务注册）用 `@Lazy(false)` 白名单兜住。⚠️ 配置错误会从启动期推迟到首个请求期才暴露——上线前跑全量 smoke。
- 砍自动配置：`@SpringBootApplication(exclude = {...})` 或 `spring.autoconfigure.exclude=...`；老版本顺手 `spring.jmx.enabled=false`。
- 收窄包扫描：`@ComponentScan` 指定具体包，避免从顶层根包全扫。
- 数据库元数据探测：确认 dialect 后可加 `spring.jpa.properties.hibernate.temp.use_jdbc_metadata_defaults=false`，跳过启动期连库探测（⚠️ 需明确指定 dialect）。
- 开发环境专用：`-XX:TieredStopAtLevel=1`（只用到 C1 编译，启动快但峰值吞吐低，别带去生产）。

### 3. CDS / AppCDS（类加载提速主力）

- 生成 archive（训练跑：正常启动 + 走一遍核心请求路径）：
  `java -XX:ArchiveClassesAtExit=app.jsa -jar app.jar`（JDK 13+）
  之后运行：`java -XX:SharedArchiveFile=app.jsa -jar app.jar`
- JDK 19+ 可用 `-XX:+AutoCreateSharedArchive -XX:SharedArchiveFile=app.jsa`：首跑自动生成，后续自动复用。
- 注意：archive 与 JVM 版本、classpath 绑定；产物变更后必须重新生成（放进镜像构建流程）。不匹配时 JVM 会静默回退——用上面 `shared objects file` 的命中数验证。
- **收益要看类规模，不要承诺固定百分比**：实测 JDK 17 + Hello World（411 个类）生成 160K 归档后命中 410/411，但启动耗时 0.03s 前后无差异——JVM 冷启动本身占了大头。类规模越大（几千个类、重框架）收益才显现，报告里必须给本项目的前后实测值。
- Spring Boot 3.3+ 官方内置 CDS 训练跑支持（`-Djarmode=tools`），可直接跟官方文档流程。

### 4. 部署形态（交付体验）

- 肥 jar → 分层镜像：`java -Djarmode=layertools -jar app.jar extract`，依赖层放低层吃缓存——发布从"重传整个 jar"变成"只推代码层"。
- 极致冷启动（serverless/CLI 场景才上）：GraalVM native image（启动几十 ms 级；代价：构建慢 + 反射配置维护）或 CRaC checkpoint/restore（毫秒级恢复；代价：运维复杂度）。按场景选，不要默认上。
- 运行时镜像：jlink 最小 JRE（`jdeps --print-module-deps` 算模块集）或 distroless。

### 5. 别踩的坑

- Spring 反射注入对类缺失的容忍度比编译高：删依赖、改懒加载后，编译能过但运行期才炸——必须全接口 smoke。
- 懒加载 ≠ 全面变快：首个请求变慢。权衡目标先问清（冷启动 vs 首请求延迟）。

## Node.js

- 测量：`hyperfine 'node dist/main.js'`；重 require 定位：入口临时对各大包 import 包 `console.time`，或 `node --cpu-prof` 看启动火焰图。
- 手段：
  - 重路由/重插件用 `await import()` 懒加载；顶层别 import ORM/SDK 等重库。
  - serverless：esbuild 单文件打包（原生模块 externalize）、按函数拆包、Provisioned Concurrency；Node 22+ 开 V8 编译缓存（`module.enableCompileCache()`）。
  - 顶层副作用清理：读文件/连库/注册逻辑移到惰性初始化。

## Python

- 测量：`python -X importtime -c "import app" 2> importtime.log`，然后 `sort -t'|' -k2 -n importtime.log | tail -20` 找 cumulative 大头。
- 手段：pandas/torch/transformers 等重库移进函数内 import；客户端惰性初始化；确认 gunicorn/uvicorn 的 preload 取舍（preload 换启动摊薄、牺牲隔离）。

## Go

- 测量：`GODEBUG=inittrace=1 ./app` 打印每个包的 init 耗时与内存分配。
- 手段：重 `init()` 改显式初始化；数据库 driver 的空导入（side-effect 注册）保留，其余重活搬出 init；审计 `_ "blank import"`。

## Rust

- 启动一般不是瓶颈；重初始化用 once_cell / LazyLock 惰性化即可。

## PHP

- `composer install --no-dev --classmap-authoritative -o`：权威 classmap 免运行期文件系统查找。
- opcache.preload（PHP 7.4+）预热框架核心类；生产镜像 `opcache.validate_timestamps=0`。
