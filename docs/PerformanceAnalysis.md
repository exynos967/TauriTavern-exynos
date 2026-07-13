# TauriTavern 性能分析报告

## 1. 文档状态

- 分析日期：2026-07-14
- TauriTavern 分支：`optimization/performance`
- 最新实测代码：`b8ca3364`（OpenAI prefix tokenizer 增量计数）
- 最新实测构建：TauriTavern 2.1.1 `arm64-v8a` token-optimized Perf Release
- 最新性能样本：`tauritavern-perf-2026-07-13T18-24-53.017Z.json`
- 样本 SHA-256：`D4984BA278E60212F6FC8AE7CB52FDEC06CA43FDC0484C3A94CCC9AA26EB31E4`
- 测试设备：Android 15，360 x 792 CSS px，DPR 4，Android System WebView 149

原始性能 JSON 包含控件名称、监听器来源和用户文件路径，只保留在本地，不提交仓库。本文仅记录聚合指标和定位所需的源码标识。

本文区分三类结论：

1. **实机证实**：由 optimization-10 及后续 token-optimized 性能报告直接支持；
2. **源码证实**：已从源码和构建产物确认机制或根因，但尚未建立完整实机对照；
3. **待验证**：只有趋势或候选解释，不能作为既定事实。

Tauri/Wry 只替换了外壳和后端。SillyTavern 前端、事件监听器、正则、Markdown、DOM 和状态管理仍运行在 WebView 中，因此“原生客户端”不等于这些工作自动变快。

## 2. 执行摘要

### 2.1 当前判断

1. **TauriTavern 自身的 dry run 并发风暴已经解决。** optimization-10 的调度仍保持 latest-wins，没有重新出现并发执行证据。
2. **OpenAI 世界书 prefix Token 重复扫描已得到实机确认改善。** prefix native 调用平均从 124.2 ms 降至 26.1 ms，P95 从 540 ms 降至 49 ms；高 Token 调用任务的 Token 阶段平均下降 57.7%。
3. **当前第一持续功耗热点转为流式格式化与 Token 事件。** 新样本两次真实生成持续 183.3 s 和 280.5 s，累计处理 10,179 次 Token 事件和 2,713 次格式化更新；DOM/RSS、聊天切换和持久化仍是次级问题。

### 2.2 当前严重度排名

| 排名 | 热点 | 状态 | 用户表现 | 最新证据 |
| ---: | --- | --- | --- | --- |
| 1（P0） | 流式全量格式化与 Token 事件 | 实机证实 | 长输出期间持续发热、偶发掉帧 | 2 次生成 10,179 次 Token 事件、2,713 次格式化；生成窗口 CPU 平均 46.4% |
| 2（P1） | 世界书准备、扫描与 Token | 实机证实，已显著改善 | 大世界书生成前仍有短暂停顿 | 高 Token 调用任务世界书平均 1.46 s、最大 1.68 s；Token 平均 662.7 ms |
| 3（P1） | 常驻 DOM 与 WebView 内存基线 | 实机证实 | 菜单和抽屉偶发迟钝，长期使用余量不足 | DOM 平均 22,452；RSS 平均 477.8 MiB、峰值 643.3 MiB |
| 4（P2） | 设置、角色和世界书持久化 | 实机证实，主线程影响未证实 | 打开页面、切换角色或保存额外等待 | 历史样本 settings/get 平均 1.04 s；characters/edit 平均 1.51 s |
| 5（P2） | 长聊天连续翻页 | 待验证 | 快速滑动时楼层短暂空白 | 最新样本未触发 history prepend，缺少 200–1,000 楼专项复测 |

## 3. TauriTavern 当前热点

### 3.1 世界书条目准备

最新样本的 18 次世界书 trace 中，部分聊天切换预热 trace 没有完整 `entries-total` 汇总，因此分项样本数不同：

| 阶段 | 平均 | 最大 | 累计 / 样本数 |
| --- | ---: | ---: | ---: |
| world 数据收集 | 72.7 ms | 89.4 ms | 1.31 s / 18 |
| `WORLDINFO_ENTRIES_LOADED` 监听器 | 71.5 ms | 110.2 ms | 1.29 s / 18 |
| 排序 | 1.0 ms | 1.7 ms | 17.8 ms / 18 |
| decorator 解析、对象构造和 hash | 412.2 ms | 537.0 ms | 7.42 s / 18 |
| 最终 `structuredClone` | 51.0 ms | 63.1 ms | 918 ms / 18 |
| 完整 entries 阶段 | 608.1 ms | 782.4 ms | 8.51 s / 14 |

TauriTavern 核心的世界书排序只有约 1 ms，不是当前热点。核心成本主要来自对象准备、hash、clone 和多轮扫描。

提交 `10ef622b` 已把 entries prepare 的两次连续 `map()` 合为一次遍历，减少一份 5,363 条中间数组及第二轮对象展开。新实现仍在添加 `hash` 前对 `{ ...entry, decorators, content }` 执行相同的 `JSON.stringify`；等价测试覆盖原有 hash 字段、空内容、嵌套数据和属性顺序。Schema 10 Android 实机复测中，同为 5,363 条的 `entries-prepare` 平均从 413.5 ms 降至 195.6 ms，降低 52.7%；完整世界书平均从 1.747 s 降至 1.345 s，降低 23.0%。该对照仍会受触发条目和 Token cache 热度影响，但准备阶段的降幅已经脱离噪声范围。

更高收益的 prepared-entry cache 需要覆盖世界书保存、删除、导入、角色/人格/聊天绑定、设置变化和事件修改，尚不具备足够失效证据。

### 3.2 世界书扫描与 Token

Schema 10 报告 `tauritavern-perf-2026-07-13T17-12-14.103Z.json` 共记录 217 次 tokenizer native 调用：

- `count_openai_token_prefixes` 52 次，累计 6.458 s，平均 124.2 ms，P95 540 ms，最大 735 ms；
- `count_openai_tokens_batch` 165 次，累计 4.204 s，平均 25.5 ms，P95 48 ms，最大 472 ms；
- broker 排队累计只有 118 ms，单次最大 4 ms；
- 世界书 Token 阶段随激活内容从约 40–126 ms 波动到 1.37–1.82 s。

数据证明主要耗时不是 JS broker 队列，而是 Tauri transport 与 Rust native 分词的合计。原 prefix 实现对每个累计后缀从头计算完整字符串，64 条批次会重复扫描越来越长的共同前缀。

提交 `9a99d2c8` 将性能报告升级为 Schema 10，为 `count_openai_tokens_batch` 和 `count_openai_token_prefixes` 记录 `cache/dedupe/transport` outcome、broker 限流队列等待和 transport 时长。样本不包含 model、文本、messages、DTO 或 dedupe key，采集关闭时不读取时钟。这里的 transport 仍是 Tauri IPC 与 Rust native 执行的合计，尚不能单独表示 tokenizer 内部 CPU。

后续优化把 prefix 计数下沉为 `TokenizerRepository` 的窄接口。OpenAI/tiktoken 路径利用 tokenizer 的稳定正则分段边界，只保留可能受下一个后缀影响的末尾片段并重新编码；已确定稳定的共同前缀不再重复扫描。其他 tokenizer 后端继续使用原始完整消息计数。外部 URL、`model/base/suffixes/stop_at` DTO、`token_counts` 返回数组和达到 `stop_at` 后填充剩余结果的语义均未改变。

等价测试覆盖 `gpt-4o`、`gpt-4`、`gpt-3.5-turbo-0301`、`o1`，以及空片段、连续空白、换行、标点、中文、emoji、组合字符和类 special-token 文本，每组 64 个累计后缀均逐项对照原完整重算。Windows Debug 合成压力基准中，6 轮交替测试由 26.21 s 降至 0.755 s，约为原耗时的 2.9%；该结果只用于验证复杂度下降，不代表 Android 实机最终倍率。

本地 7.20 MB SillyTavern 世界书夹具包含 839 条、其中 715 条启用，正文约 229 万字符。Windows Release 下，启用顺序前 64 条（约 53.6 万字符）的累计 prefix 计数从 1,742.3 ms 降至 184.3 ms，约快 9.46 倍；最长 64 条（约 98.3 万字符）从 3,423.7 ms 降至 115.2 ms，约快 29.72 倍。两组共 128 个累计结果均与旧完整重算逐项一致。该夹具只在本地读取，正文和关键词未进入日志、源码或提交。

Schema 10 Android 实机复测进一步确认了收益：

- prefix native 调用 27 次，平均 26.1 ms、P95 49 ms、最大 73 ms；上一份同设备报告分别为 124.2 ms、540 ms 和 735 ms，下降 79.0%、90.9% 和 90.1%；
- 生成过程中 Token 调用不少于 30 次的任务，Token 阶段平均从 1,567.6 ms 降至 662.7 ms，下降 57.7%；完整世界书阶段平均从 2,523.8 ms 降至 1,462.2 ms，下降 42.1%；
- 两次真实生成的世界书阶段平均 820.0 ms，较上一份报告的 963.8 ms 下降 14.9%；Token 阶段平均 151.2 ms，下降 34.1%；
- 119 次 tokenizer 调用全部成功，broker queue 单次最大 4 ms，旧实现的 0.5–0.7 s prefix 尖峰未再出现。

真实生成样本只有 2 次，输出内容、激活条目和 cache 热度也不完全一致，因此 14.9% 和 34.1% 只能作为方向性证据；prefix 调用分布和高调用任务的改善更直接支持本次优化有效。

剩余优化必须保留：

- 激活顺序；
- 概率和递归；
- timed effects；
- `ignoreBudget`；
- 动态宏；
- 最终插入内容和顺序。

### 3.3 聊天切换预热

核心 `scripts/world-info.js` 的 `CHAT_CHANGED` 监听器会调用 `getSortedEntries()` 预热世界书。最新样本 3 次累计 1.55 s、最大 998.3 ms，其中同步执行仅累计 3.9 ms，约 1.55 s 来自等待异步流程。

这条预热路径仍是聊天切换的主要等待项。其结果随后被丢弃，但调用会填充原始世界书缓存并触发 `WORLDINFO_ENTRIES_LOADED`。不能简单删除或后台化，否则可能改变事件观察顺序。更合理的后续方向是把“原始 world prefetch”和“生成专用 prepare/hash/clone”拆开，再验证首次生成是否仍完整执行相同事件和结果。

### 3.4 流式生成

最新 2 次真实生成持续 183.3 s 和 280.5 s：

- 10,179 次 Token 事件监听，累计约 1.52 s；
- 2,713 次格式化更新，累计约 2.49 s；
- regex、Markdown、sanitize 分别累计约 436 ms、919 ms 和 1.06 s；
- DOM commit 累计约 610 ms；
- 生成窗口 CPU 平均 46.4%，主线程 busy ratio 平均 14.3%。

移动端限频已经把多个 chunk 合并为一次预览，单次格式化明显变轻。它现在更像持续功耗来源，而不是稳定数秒冻结。

低风险候选：流式统计只维护首时间、末时间和计数，不再保存每个 chunk 的 timestamp。高风险候选包括增量 Markdown/sanitize、跳过 `STREAM_TOKEN_RECEIVED` 或强制覆盖用户 FPS，暂不实施。

### 3.5 DOM 与内存

- DOM 平均 22,452，单次峰值 34,932；
- 同屏消息平均约 10 条；
- RSS 平均 477.8 MiB，峰值 643.3 MiB；
- WebView 在本轮把 JS heap 固定报告为约 98.2 MiB，缺少波动，不能与旧报告直接比较。

本轮保留的 100 条最慢交互中没有 `send_but` 样本，因此不能用它验证或否定此前发送按钮的 877.8 ms 首帧延迟。可识别目标中最慢的是 AI 响应配置交互 224 ms，其中 handler 约 59.5 ms、presentation delay 约 152.2 ms；按钮卡顿仍更像布局、绘制或同帧任务阻塞，而不是 click 输入本身缓慢。

单次峰值不能证明内存泄漏。卸载隐藏设置页 DOM 可能破坏表单状态、同步 DOM 查询和 MutationObserver；必须先补模块级节点归属、detached node 和固定循环后的 idle 回落数据。

### 3.6 设置与持久化

| 路径 | 次数 | 平均 | 最大 |
| --- | ---: | ---: | ---: |
| `/api/settings/get` | 15 | 1.04 s | 6.17 s |
| `/api/settings/patch` | 14 | 376 ms | 873 ms |
| `/api/characters/edit` | 4 | 1.51 s | 2.71 s |

这些请求会增加启动、角色切换和设置流程等待，但多数为异步 I/O，当前没有证据证明它们直接冻结主线程。

宿主已经对同时发生的 `get_sillytavern_settings` 做 in-flight dedupe。跨请求 TTL 可能让 Quick Reply、世界书和设置页读取旧 revision，因此不应只凭累计耗时增加缓存。

## 4. 已验证的优化效果

### 4.1 optimization-9 与 optimization-10

| 指标 | optimization-9 | optimization-10 | 结论 |
| --- | ---: | ---: | --- |
| dry run 实际执行区间重叠 | 存在 | 0 次 | latest-wins 生效 |
| 5,363 条 dry run Token 平均 | 1,295.6 ms | 459.8 ms | 降低 64.5% |
| 5,363 条 dry run 世界书平均 | 2,517.9 ms | 1,331.3 ms | 降低 47.1% |
| 5,363 条 dry run generation 平均 | 3,069.0 ms | 1,665.3 ms | 降低 45.7% |
| 真实生成世界书平均 | 2,463.3 ms | 1,177.5 ms | 降低 52.2% |
| CPU 平均 / P95 | 63.1% / 88.0% | 56.0% / 78.9% | 方向性改善 |
| 主线程 busy ratio 平均 | 10.9% | 8.6% | 方向性改善 |
| 每秒长任务平均 | 133.3 ms | 86.5 ms | 方向性改善 |
| RSS 平均 | 357.8 MiB | 335.1 MiB | 降低 6.3% |

两次采集的时长、操作和输出内容不同，CPU、内存与真实生成指标只能作为方向性证据。同为 5,363 条的 dry run 对照更适合表示单任务收益。

### 4.2 已落地改动

| 提交 | 改动 | 行为边界 |
| --- | --- | --- |
| `274241b5` | Prompt Manager dry run latest-wins 调度 | 实际执行仍调用完整 `Generate('normal', {}, true)` |
| `79b9ab5d` | 完全相同的世界书前缀 Token 请求共享 in-flight Promise | settled 后删除，不复用旧结果 |
| `227b9d92` | 原生前缀 Token 任务限制为单并发 | 不同 DTO 仍逐个执行并返回各自结果 |
| `26e18fc0`、`c1654ea6` | 完整 DTO JSON 作为 prefix Token dedupe identity | 避免哈希碰撞错误合并请求 |
| `12b17bb3` | 批量精确 world-info Token 计数 | 保留精确计数结果 |
| `2683e713` | 按 Token budget 提前停止前缀计数 | 保留预算命中及 `ignoreBudget` 语义 |
| `2363ea41` | 移动端限制流式预览刷新 | 最终消息仍完整渲染 |
| `c9d427c6` | 长聊天楼层分批渲染 | 楼层 ID 和顺序不变 |
| `7558fdd5`、`dae0540b` | 集中滚动控制并保留 viewport | 尊重用户 scroll lock |
| `10ef622b` | entries prepare 合并为单次遍历 | hash 输入、属性顺序和最终对象逐项等价 |
| `9a99d2c8` | Tokenizer broker 队列与 transport 精准埋点 | 只读观测，不修改 DTO、策略、结果或异常 |
| `b8ca3364` | OpenAI prefix tokenizer 增量计数 | DTO、返回数组、stop_at 语义及非 OpenAI 后端路径不变 |

动态宏、概率、timed effects、宿主事件、世界书激活顺序和最终请求体仍由每次真正执行的完整流程计算。

## 5. 后续优化计划

### P0：降低流式稳态 CPU

1. 删除仅用于统计的逐 chunk timestamp 数组；
2. 继续记录 regex、Markdown、sanitize 和 DOM commit 的输入长度与成本；
3. 不跳过 Token 事件，不省略最终完整格式化；
4. 以每千字符 CPU time、长任务和最终 HTML 一致性验收。

### P1：继续收敛世界书固定成本

1. prefix tokenizer 已完成 Schema 10 实机复测，不再优先修改其算法；
2. 给聊天切换预热拆分 prefetch、宿主事件、prepare/hash/clone 阶段；
3. 只有建立完整 revision/失效模型后才考虑 prepared-entry cache；
4. 用冻结输入双执行比较激活条目、顺序、Token budget 和最终请求体。

### P1：定位 DOM 所有权

1. 按核心模块统计 DOM 节点；
2. 记录 detached node；
3. 记录设置页、菜单和抽屉首次展开成本；
4. 做 20 次生成/切换循环后的 idle 回落测试。

### P2：补齐持久化和长聊天证据

1. settings 请求记录调用方、请求体字节数、序列化、磁盘读取、修复和写入阶段；
2. history prepend 记录分页 IPC、每批 render、图片/iframe hydration 和滚动锚点；
3. 覆盖 200、500 和 1,000 楼快速连续翻页。

## 6. 暂缓的高风险方案

以下方案没有实施，因为当前无法证明行为等价：

1. **取消已经进入 Rust `spawn_blocking` 的 Token 请求。** 需要 request ID、取消 DTO、错误语义和 tokenizer 协作检查点。
2. **全局并行 EventEmitter 或跳过慢监听器。** 会改变事件顺序、变量可见性、Slash Command 结果和最终请求体。
3. **给 settings/get 增加跨请求 TTL。** 可能返回旧 revision；现有 in-flight dedupe 已覆盖同时请求。
4. **进一步合并 settings/patch。** 可能改变 CAS 冲突、失败重试和保存顺序。
5. **跳过流式事件或强制降低用户 FPS。** 会破坏事件契约或预期显示行为。
6. **卸载隐藏设置页 DOM。** 可能破坏同步查询、表单状态和 MutationObserver。
7. **跨生成复用完整 prompt 或世界书结果。** 动态宏、概率、timed effects 和宿主事件可能变化。
8. **增量 Markdown/HTML pipeline。** 跨 chunk 语法、正则和 sanitize 等价性尚未建立。

## 7. 不可破坏的行为契约

所有优化必须满足：

1. 最终请求体字段、顺序敏感数组、世界书内容和 provider metadata 与基线一致；
2. 世界书激活顺序、概率、递归、timed effects、`ignoreBudget` 和宏替换语义不变；
3. EventEmitter 注册顺序和 await 语义默认不变；
4. 最终消息必须经过完整正则、Markdown、sanitize、宿主事件和保存流程；
5. 发送、生成结束、聊天切换和历史 prepend 不得抢占用户 viewport；
6. windowed chat 的楼层 ID、编辑、删除、swipe 和 prompt backfill 语义不变；
7. 现有事件名、DOM 钩子、API 路径和存储结构不静默变化；
8. 缓存只影响性能，失效或冷启动时必须回退到正确的完整计算。

建议对高风险优化建立双执行验证：同一冻结输入分别运行基线和优化实现，比较 canonical JSON、消息数组、世界书片段、采样参数和 provider metadata，不能只比较 Token 总数或字符串长度。

## 8. 验收目标与复测矩阵

### 8.1 工程目标

| 场景 | 目标 |
| --- | --- |
| 普通按钮 | P95 首个有效帧 < 100 ms，非网络型最大 < 250 ms |
| 发送到请求 dispatch | 5,000 条热缓存 P95 < 2 s；无 >1 s 未知监听器 |
| 聊天切换 | 监听器 P95 < 500 ms；1–20 可见楼层完整加载 P95 < 1.5 s |
| 世界书 | 约 5,000 条 Token P95 < 2 s，完整阶段 P95 < 3 s |
| 流式稳态 | 每秒无 >200 ms 长任务；最终结果完整一致 |
| 长聊天翻页 | 每批主线程 < 50 ms；连续翻页无 >250 ms 输入阻塞 |
| 内存 | 20 次循环后无单调增长；idle 回落 RSS 增量 < 50 MiB |

这些是当前设备上的工程目标，不是浏览器标准阈值，需随固定基线调整。

### 8.2 数据规模

- 世界书：0 / 500 / 4,500 / 5,500+ 条；
- 聊天：10 / 200 / 500 / 1,000 楼；
- 输出：500 / 2,000 / 4,000 字符；
- 自动化：Quick Reply 关闭 / 用户实际配置；

### 8.3 状态与验证项

- 冷启动和热启动；
- 冷 Token cache 和热 cache；
- dry run 后真实生成；
- 用户停留底部和主动向上阅读；
- 前台、后台恢复和长时间连续生成；
- 最终请求体 canonical diff；
- 最终消息 HTML 和纯文本；
- 世界书激活条目及顺序；
- 事件顺序、变量结果和 viewport；
- 长任务、busy ratio、格式化次数、RSS 和 DOM；
- 设备支持时记录温度、电流和电压。

## 9. 数据来源与限制

### 9.1 性能样本

| 导出时间（UTC） | Schema | 用途 |
| --- | ---: | --- |
| 2026-07-12 16:46:01 | 1 | 世界书、流式和帧基础指标 |
| 2026-07-12 17:45:31 | 2 | 增加慢交互 |
| 2026-07-12 18:53:40 | 3 | 增加聊天加载、楼层操作和慢监听器 |
| 2026-07-13 06:41:15 | 4 | 增加运行时、网络和原生健康采样 |
| 2026-07-13 09:18:01 | 9 | optimization-9 优化前基线 |
| 2026-07-13 12:04:56 | 9 | optimization-10 复测 |
| 2026-07-13 15:03:56 | 9 | 世界书与流式复测 |
| 2026-07-13 17:12:14 | 10 | prefix tokenizer 优化前 native 调用基线 |
| 2026-07-13 18:24:53 | 10 | prefix tokenizer 优化后 Android 实机复测 |

optimization-9 样本 SHA-256：`6BB9093AA27964B4FBE0315B88A9F31835AD63E569B66C63D20C8F75FDA989FC`。

tokenizer 优化后样本 SHA-256：`D4984BA278E60212F6FC8AE7CB52FDEC06CA43FDC0484C3A94CCC9AA26EB31E4`。

### 9.2 最新样本覆盖

- 采集持续约 10.5 分钟；
- 7 次完整记录，导出时另有 1 次 current dry run；
- 2 次真实生成、3 次聊天加载和 3 次楼层操作；
- 611 个健康样本；
- 91 个慢监听器观测，慢交互保留最近 100 条明细；
- 119 次 tokenizer native 调用；
- 5,363 条世界书；
- Android 前台可见样本 604 个，后台样本 7 个。

### 9.3 限制

1. 各轮采集的操作序列、输出内容、Token cache 热度和采集时长不完全一致；
2. `superseded` 记录的生命周期不能当作 dry run 实际执行耗时，应使用 generation trace；
3. 慢监听器累计时间可能包含父监听器等待嵌套命令，不能当作独立 CPU time 相加；
4. 当前设备未暴露电池温度、电流和电压；
5. RSS 峰值不能单独证明内存泄漏；
6. 最新样本没有触发 history prepend，也没有覆盖大型聊天快速连续翻页；
7. Slash Command 的 `buttons`、嵌套 `run/if` 会包含用户等待，自动化累计时长不能直接当作 CPU time；本轮这些命令与 prompt-ready 慢监听没有时间重叠；
8. prefix tokenizer 已通过本地等价测试，但最新样本没有保存最终请求体快照，不能仅凭性能报告完成端到端功能等价证明；
9. 最新样本只有 2 次真实生成，CPU、流式和真实生成阶段对照只能作为方向性证据。

## 10. 埋点缺口

当前代码和最新实机样本均为 Schema 10，已覆盖 generation、世界书、流式、聊天加载、交互、网络、监听器稳定身份、Slash Command、Quick Reply、Android CPU fallback，以及 Tokenizer broker queue/transport/cache/dedupe。剩余缺口：

1. Prompt Manager dry run 的触发来源、合并次数、排队时间和实际执行次数；
2. Rust tokenizer 内部模型加载和实际 encode CPU 的进一步拆分；
3. 世界书 prepared-entry cache 所需的 revision 和失效来源；
4. DOM 节点模块归属和 detached node；
5. settings 请求调用方、字节数和磁盘阶段；
6. history prepend 的图片/iframe hydration 和滚动锚点偏移；
7. profiler 开启/关闭的 CPU、内存和输入延迟 A/B；
8. 设备允许时的电池温度、电流和电压。

## 11. 最终结论

- TauriTavern 的 dry run 并发和世界书 Token 风暴已经得到数量级改善；
- OpenAI prefix tokenizer 的重复扫描已通过 Schema 10 Android 实机复测，高 Token 调用任务的 Token 阶段平均下降 57.7%，旧有 0.5–0.7 s 单次尖峰未再出现；
- 当前第一持续功耗问题是流式格式化和 Token 事件；DOM/RSS 基线仍会造成发热与按钮 presentation delay；
- settings 和持久化是次级异步成本，不能用有状态风险的 TTL 缓存草率处理；
- 后续优化必须以最终请求体、世界书激活、消息 HTML、变量状态、事件顺序和 viewport 等价为前提。
