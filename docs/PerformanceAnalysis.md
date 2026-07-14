# TauriTavern 性能分析报告

## 1. 文档状态

- 分析日期：2026-07-14
- TauriTavern 分支：`optimization/performance`
- 埋点基线分支：`perf`
- 当前运行时代码：`558f4278` 运行时优化 + Schema 11 性能监视器（默认自动采集、线程 CPU 与长任务归因；待新 APK 实测）
- 最新实测运行时代码：`d0226330`（该实测构建仍包含随后回退的主题 unchanged-field guard）
- 最新实测构建：TauriTavern 2.1.1 `arm64-v8a` optimization-11 Perf Release
- 最新性能样本：`tauritavern-perf-2026-07-14T06-16-12.117Z.json`
- 样本 SHA-256：`95350A45E63FA20BD08779A1D6CE004D9F94F40E97BE04380A94AD7A10679FDE`
- 测试设备：Android 15，360 x 792 CSS px，DPR 4，Android System WebView 149

原始性能 JSON 包含控件名称、监听器来源和用户文件路径，只保留在本地，不提交仓库。本文仅记录聚合指标和定位所需的源码标识。

本文区分三类结论：

1. **实机证实**：由 optimization-10、token-optimized 及 optimization-11 性能报告直接支持；
2. **契约验证**：已有自动化测试或新旧实现逐项等价测试，但缺少专项实机 A/B；
3. **待验证**：只有趋势或候选解释，不能作为既定事实。

`perf` 保存完整性能监视器和诊断埋点；`optimization/performance` 在其上承载运行时优化。文档提交不改变 APK 运行时代码，因此“当前分支 HEAD”和“最新实测运行时提交”需要分开理解。

Tauri/Wry 只替换了外壳和后端。SillyTavern 前端、事件监听器、正则、Markdown、DOM 和状态管理仍运行在 WebView 中，因此“原生客户端”不等于这些工作自动变快。

## 2. 执行摘要

### 2.1 当前判断

1. **TauriTavern 自身的 dry run 并发风暴已经解决。** optimization-10 的调度仍保持 latest-wins，没有重新出现并发执行证据。
2. **OpenAI 世界书 prefix Token 重复扫描已得到实机确认改善。** prefix native 调用平均从 124.2 ms 降至 26.1 ms，P95 从 540 ms 降至 49 ms；高 Token 调用任务的 Token 阶段平均下降 57.7%。
3. **世界书条目准备已完成第一轮低风险收敛。** 5,363 条场景的 prepare 曾从 413.5 ms 降至 200.6 ms；optimization-11 两次真实生成平均为 224.3 ms，完整 entries 平均为 367.3 ms，仍明显低于优化前基线。
4. **长聊天渲染、滚动所有权和发送/生成结束 viewport 已做结构性修复。** 自动化契约测试已覆盖楼层顺序、批次边界和 scroll lock；最新样本没有触发 history prepend，仍缺少 200–1,000 楼实机压力复测。
5. **聊天切换预热裁剪已获得实机方向性证据。** `chat-changed-listeners` 平均从 812.1 ms 降至 601.3 ms，下降 26.0%；端到端聊天加载平均从 1,131.3 ms 降至 1,084.0 ms，下降 4.2%，说明监听器内部无用工作减少，但 payload、消息渲染和其他监听器仍占据总时长。
6. **流式主线程成本已大幅缓解，但生成期持续 CPU 尚未解决。** 相近输出规模下，每千字符格式化、DOM commit 和长任务累计耗时分别下降 49.7%、54.0% 和 86.7%，主线程 busy ratio 从 14.2% 降至 6.3%；但两次真实生成的进程 CPU 仍平均约 54.8%，并出现 451–615 ms 偶发长任务。
7. **当前最直接的交互问题是按钮/菜单事件链和消息重绘。** 扩展菜单点击链记录到 732 ms，总体事件派发延迟峰值 960.2 ms；聊天加载仍需 812–1,393 ms，`messages-redisplay` 最大 194.1 ms。

### 2.2 当前严重度排名

| 排名 | 热点 | 状态 | 用户表现 | 最新证据 |
| ---: | --- | --- | --- | --- |
| 1（P0） | 生成期间持续进程 CPU 与偶发超长任务 | 部分缓解，根因仍需拆分 | 长输出期间持续发热，偶发半秒级冻结 | 真实生成 CPU 平均约 54.8%；主线程 busy 已降至 6.3%，但最大长任务仍为 615 ms |
| 2（P1） | 按钮、菜单事件链与 presentation delay | 实机证实，尚未解决 | 点击扩展菜单、选择器或其他按钮后迟迟不出有效帧 | 扩展菜单点击链 732 ms；事件派发延迟峰值 960.2 ms；`pointerleave` 最大 304 ms |
| 3（P1） | 聊天加载与消息重新渲染 | 已改善，仍有明显等待 | 切换聊天时约一秒无响应，消息区域重绘卡顿 | chat load 812–1,393 ms；listeners 496–711 ms；`messages-redisplay` 最大 194.1 ms |
| 4（P1） | 世界书扫描与剩余固定成本 | 已显著改善，当前为次级问题 | 大世界书生成前仍有约一秒准备 | 5,363 条真实生成世界书 832–1,044 ms；entries 平均 367.3 ms |
| 5（P1） | 常驻 DOM 与 WebView 内存基线 | 实机证实，未证明泄漏 | 页面复杂时放大布局、绘制和长期发热压力 | DOM 平均 22,384；RSS 平均约 449.8 MiB、峰值约 601.9 MiB |
| 6（P2） | 长聊天连续翻页 | 已优化，待专项实机验证 | 快速滑动时楼层短暂空白 | 已分批渲染并集中滚动控制；最新样本仍未触发 history prepend |

## 3. TauriTavern 当前热点

### 3.1 世界书条目准备

最新 token-optimized 样本包含 8 次成功世界书 trace，5,363 条场景的条目准备阶段如下：

| 阶段 | 平均 | 最大 | 累计 / 样本数 |
| --- | ---: | ---: | ---: |
| world 数据收集 | 46.2 ms | 54.1 ms | 369.2 ms / 8 |
| `WORLDINFO_ENTRIES_LOADED` 监听器 | 48.6 ms | 64.1 ms | 388.7 ms / 8 |
| 排序 | 1.8 ms | 9.4 ms | 14.5 ms / 8 |
| decorator 解析、对象构造和 hash | 200.6 ms | 225.8 ms | 1.60 s / 8 |
| 最终 `structuredClone` | 36.6 ms | 45.4 ms | 293.0 ms / 8 |
| 完整 entries 阶段 | 334.0 ms | 378.7 ms | 2.67 s / 8 |

TauriTavern 核心的世界书排序只有约 1 ms，不是当前热点。核心成本主要来自对象准备、hash、clone 和多轮扫描。

提交 `10ef622b` 已把 entries prepare 的两次连续 `map()` 合为一次遍历，减少一份 5,363 条中间数组及第二轮对象展开。新实现仍在添加 `hash` 前对 `{ ...entry, decorators, content }` 执行相同的 `JSON.stringify`；等价测试覆盖原有 hash 字段、空内容、嵌套数据和属性顺序。Schema 10 Android 实机复测中，同为 5,363 条的 `entries-prepare` 平均从 413.5 ms 降至 200.6 ms，降低 51.5%；完整世界书阶段平均降至 334.0 ms。该对照仍会受事件监听器和设备状态影响，但准备阶段的降幅已经脱离噪声范围。

更高收益的 prepared-entry cache 需要覆盖世界书保存、删除、导入、角色/人格/聊天绑定、设置变化和事件修改，尚不具备足够失效证据。

### 3.2 世界书扫描与 Token

Schema 10 报告 `tauritavern-perf-2026-07-13T17-12-14.103Z.json` 共记录 217 次 tokenizer native 调用：

- `count_openai_token_prefixes` 52 次，累计 6.458 s，平均 124.2 ms，P95 540 ms，最大 735 ms；
- `count_openai_tokens_batch` 165 次，累计 4.204 s，平均 25.5 ms，P95 48 ms，最大 472 ms；
- broker 排队累计只有 118 ms，单次最大 4 ms；
- 世界书 Token 阶段随激活内容从约 40–126 ms 波动到 1.37–1.82 s。

数据证明主要耗时不是 JS broker 队列，而是 Tauri transport 与 Rust native 分词的合计。原 prefix 实现对每个累计后缀从头计算完整字符串，64 条批次会重复扫描越来越长的共同前缀。

提交 `9a99d2c8` 将性能报告升级为 Schema 10，为 `count_openai_tokens_batch` 和 `count_openai_token_prefixes` 记录 `cache/dedupe/transport` outcome、broker 限流队列等待和 transport 时长。样本不包含 model、文本、messages、DTO 或 dedupe key，采集关闭时不读取时钟。这里的 transport 仍是 Tauri IPC 与 Rust native 执行的合计，尚不能单独表示 tokenizer 内部 CPU。

提交 `b8ca3364` 已把 prefix 计数下沉为 `TokenizerRepository` 的窄接口。OpenAI/tiktoken 路径利用 tokenizer 的稳定正则分段边界，只保留可能受下一个后缀影响的末尾片段并重新编码；已确定稳定的共同前缀不再重复扫描。其他 tokenizer 后端继续使用原始完整消息计数。外部 URL、`model/base/suffixes/stop_at` DTO、`token_counts` 返回数组和达到 `stop_at` 后填充剩余结果的语义均未改变。

等价测试覆盖 `gpt-4o`、`gpt-4`、`gpt-3.5-turbo-0301`、`o1`，以及空片段、连续空白、换行、标点、中文、emoji、组合字符和类 special-token 文本，每组 64 个累计后缀均逐项对照原完整重算。Windows Debug 合成压力基准中，6 轮交替测试由 26.21 s 降至 0.755 s，约为原耗时的 2.9%；该结果只用于验证复杂度下降，不代表 Android 实机最终倍率。

本地 7.20 MB SillyTavern 世界书夹具包含 839 条、其中 715 条启用，正文约 229 万字符。Windows Release 下，启用顺序前 64 条（约 53.6 万字符）的累计 prefix 计数从 1,742.3 ms 降至 184.3 ms，约快 9.46 倍；最长 64 条（约 98.3 万字符）从 3,423.7 ms 降至 115.2 ms，约快 29.72 倍。两组共 128 个累计结果均与旧完整重算逐项一致。该夹具只在本地读取，正文和关键词未进入日志、源码或提交。

Schema 10 Android 实机复测进一步确认了收益：

- prefix native 调用 27 次，平均 26.1 ms、P95 49 ms、最大 73 ms；上一份同设备报告分别为 124.2 ms、540 ms 和 735 ms，下降 79.0%、90.9% 和 90.1%；
- 生成过程中 Token 调用不少于 30 次的任务，Token 阶段平均从 1,567.6 ms 降至 662.7 ms，下降 57.7%；完整世界书阶段平均从 2,523.8 ms 降至 1,462.2 ms，下降 42.1%；
- 两次真实生成的世界书阶段平均 820.0 ms，较上一份报告的 963.8 ms 下降 14.9%；Token 阶段平均 151.2 ms，下降 34.1%；
- 119 次 tokenizer 调用全部成功，broker queue 单次最大 4 ms，旧实现的 0.5–0.7 s prefix 尖峰未再出现。

真实生成样本只有 2 次，输出内容、激活条目和 cache 热度也不完全一致，因此 14.9% 和 34.1% 只能作为方向性证据；prefix 调用分布和高调用任务的改善更直接支持本次优化有效。

optimization-11 的两次真实生成仍使用 5,363 条候选、约 91 条激活条目：完整世界书分别为 832.2 ms 和 1,044.3 ms，平均 938.3 ms；上一份两次真实生成平均为 820.0 ms。entries 阶段平均从 362.9 ms 变为 367.3 ms，仅增加 1.2%；主要波动来自 entry scan 和 Token 计数。两轮都只有 2 次真实生成，且上一轮 Token 计数自身就在 48.7–253.8 ms 间波动，因此不能据此判定世界书回归。当前 0.8–1.0 s 已满足约 5,000 条完整阶段 P95 小于 3 s 的工程目标，但仍会形成生成前可感知停顿。

剩余优化必须保留：

- 激活顺序；
- 概率和递归；
- timed effects；
- `ignoreBudget`；
- 动态宏；
- 最终插入内容和顺序。

### 3.3 聊天切换预热

核心 `scripts/world-info.js` 的 `CHAT_CHANGED` 监听器会预热世界书。提交 `98945c45` 已把该预热裁剪为“原始 world prefetch + 四类 lore 收集 + `WORLDINFO_ENTRIES_LOADED` 事件”；事件载荷、串行 await 和异常隔离保持原样，只有返回值无人使用的排序、decorator/hash 和最终 clone 被跳过。正常生成仍通过 `getSortedEntries()` 执行完整流程。

optimization-11 共记录 5 次成功聊天加载：端到端耗时 812.1–1,392.8 ms，平均 1,084.0 ms；`chat-changed-listeners` 为 496.0–711.3 ms，平均 601.3 ms。上一份报告对应平均分别为 1,131.3 ms 和 812.1 ms，因此监听器阶段下降 26.0%，端到端只下降 4.2%。其中一次 payload read 达到 586.4 ms，消息渲染约 74.8–217.3 ms，说明预热裁剪已经生效，但聊天切换剩余等待分散在载荷读取、消息渲染和其他监听器中。

### 3.4 流式生成

optimization-11 的 2 次真实生成持续 120.6 s 和 148.3 s，共输出 4,924 字符：

- 7,200 次 Token 事件监听累计 754.1 ms；
- 1,641 次格式化更新累计 1,230.6 ms；
- regex、Markdown、sanitize 分别累计 226.9 ms、444.6 ms 和 516.5 ms；
- 实际 DOM commit 1,098 次，累计 275.2 ms；543 次严格相同 HTML 没有再次写入 DOM，跳过比例 33.1%；
- 两次生成共记录 22 个长任务、累计 3,071 ms，最大分别为 451 ms 和 615 ms；
- 生成窗口主线程 busy ratio 加权平均约 6.3%，进程 CPU 平均约 54.8%。

与上一份相近输出规模的 5,023 字符相比，按每千字符归一化：Token 事件、格式化、DOM commit 和长任务累计耗时分别下降 49.3%、49.7%、54.0% 和 86.7%，长任务数量下降 94.3%，主线程 busy ratio 下降 55.6%。提交 `558f4278` 的 no-op DOM commit 去重已经获得实机证据；移动端预览限频与 DOM 去重共同把流式路径从高密度主线程卡顿降为较轻的持续工作。

但进程 CPU 从上一份真实生成窗口约 46.4% 上升到约 54.8%，且仍存在半秒级偶发长任务。当前数据说明“流式格式化/DOM 写入”不再能单独解释发热：剩余 CPU 需要区分 WebView/宿主其他线程、事件监听器、GC、同时发生的交互和 profiler 自身成本。设备没有提供电池温度、电流和电压，暂时不能直接证明发热已经改善。

低风险候选仍包括：流式统计只维护首时间、末时间和计数，不再保存每个 chunk 的 timestamp。高风险候选包括增量 Markdown/sanitize、跳过 `STREAM_TOKEN_RECEIVED` 或强制覆盖用户 FPS，继续暂缓。

### 3.5 DOM 与内存

- DOM 平均 22,384，范围 19,873–25,111；
- 同屏消息平均约 12 条，最大 31 条；
- RSS 平均约 449.8 MiB，峰值约 601.9 MiB；
- WebView 在本轮把 JS heap 固定报告为约 202.2 MiB，仍缺少波动，不能与旧报告的固定值直接比较。

本轮按钮与菜单卡顿比内存泄漏更直接：扩展菜单点击链记录到 732 ms，可观测事件派发延迟峰值为 960.2 ms；`pointerleave` 最慢 304 ms，其中 input delay 292.6 ms。慢交互列表会把同一次物理操作拆成 `pointerdown/mousedown/click/pointerleave` 等多条事件，不能把条数直接相加，但这些峰值足以证明按钮有效帧目标仍未达标。`messages-redisplay` 5 次为 61.7–194.1 ms，也会在聊天切换和消息重绘时放大迟钝感。

单次峰值不能证明内存泄漏。卸载隐藏设置页 DOM 可能破坏表单状态、同步 DOM 查询和 MutationObserver；必须先补模块级节点归属、detached node 和固定循环后的 idle 回落数据。

### 3.6 设置与持久化

| 路径 | 次数 | 平均 | 最大 |
| --- | ---: | ---: | ---: |
| `/api/settings/get` | 15 | 1.04 s | 6.17 s |
| `/api/settings/patch` | 14 | 376 ms | 873 ms |
| `/api/characters/edit` | 4 | 1.51 s | 2.71 s |

这些请求会增加启动、角色切换和设置流程等待，但多数为异步 I/O，当前没有证据证明它们直接冻结主线程。

宿主已经对同时发生的 `get_sillytavern_settings` 做 in-flight dedupe。跨请求 TTL 可能让 Quick Reply、世界书和设置页读取旧 revision，因此不应只凭累计耗时增加缓存。

## 4. 已落地优化与验证

### 4.1 分阶段效果

| 阶段 | 关键指标 | 结果 | 证据等级 |
| --- | --- | --- | --- |
| optimization-9 -> optimization-10 | 5,363 条 dry run Token 平均 1,295.6 -> 459.8 ms | -64.5% | 实机证实 |
| optimization-9 -> optimization-10 | 5,363 条 dry run 世界书平均 2,517.9 -> 1,331.3 ms | -47.1% | 实机证实 |
| entries prepare 单遍历 | prepare 平均 413.5 -> 200.6 ms | -51.5% | 实机证实 |
| prefix tokenizer 增量计数 | native 平均 124.2 -> 26.1 ms；P95 540 -> 49 ms | -79.0% / -90.9% | 实机证实 |
| 高 Token 调用任务 | Token 平均 1,567.6 -> 662.7 ms；世界书平均 2,523.8 -> 1,462.2 ms | -57.7% / -42.1% | 实机证实 |
| Prompt Manager latest-wins | dry run 实际执行区间重叠降为 0 | 消除重叠执行 | 实机证实 |
| 长聊天分批渲染与滚动控制 | 楼层顺序、批次边界、scroll lock 和 viewport 契约通过 | 行为保持 | 契约验证，缺专项实机压力复测 |
| 移动端流式预览限频 | 最终完整渲染和策略测试通过 | 降低预览刷新次数 | 契约验证；尚无独立开关 A/B |
| 聊天切换预热裁剪 | 保留 prefetch、lore 收集和 loaded 事件，跳过丢弃的 sort/prepare/clone | listeners 平均 812.1 -> 601.3 ms（-26.0%）；端到端平均 -4.2% | 实机方向性证据 |
| 流式 no-op DOM commit | 相同 HTML 不重复写入；fade-in 和最终态强制提交 | 543 / 1,641 次更新跳过 DOM 写入；每千字符 DOM 耗时 -54.0% | 实机证实 |

不同报告的采集时长、操作、输出内容和 Token cache 热度并不完全一致。CPU、RSS 和真实生成总时长只作为方向性证据；同为 5,363 条的阶段耗时、tokenizer 调用分布和契约测试更适合判断单项收益。

### 4.2 运行时优化清单

| 方向 | 提交 | 已完成改动 | 行为边界 |
| --- | --- | --- | --- |
| 世界书 Token | `12b17bb3`、`2683e713` | 批量精确计数，并在达到 budget 后停止无效前缀计算 | 保留精确结果、budget 命中和 `ignoreBudget` 语义 |
| Token 调度 | `79b9ab5d`、`227b9d92`、`26e18fc0`、`c1654ea6` | identical request single-flight、prefix native 单并发和精确 DTO identity | 不跨 settled 结果复用，不合并不同 DTO |
| Token 算法 | `b8ca3364` | OpenAI/tiktoken 累计前缀增量计数 | URL、DTO、返回数组、`stop_at` 和非 OpenAI 路径不变 |
| 世界书准备 | `10ef622b` | decorator、对象构造和 hash 合为单次遍历 | hash 输入、属性顺序和最终对象逐项等价 |
| Prompt 预览 | `274241b5` | 重叠 dry run 改为 latest-wins | 真正执行时仍调用完整 `Generate('normal', {}, true)` |
| 流式预览 | `2363ea41` | 移动端限制中间预览刷新频率 | 不跳过 Token 事件，最终消息完整格式化 |
| 长聊天 | `c9d427c6` | 楼层分批渲染并让出主线程 | 楼层 ID、顺序和 windowed payload 不变 |
| viewport | `7558fdd5`、`dae0540b` | 统一滚动所有权，发送、生成结束和 prepend 保留用户位置 | 尊重 scroll lock，不改变显式滚动命令 |
| 聊天切换 | `98945c45` | 预热阶段不再计算无人使用的 sorted/prepared entries | prefetch、事件载荷、await 顺序和完整生成路径不变 |
| 流式 DOM | `558f4278` | 跳过严格相同 HTML 的 no-op DOM commit | 完整格式化、fade-in、最终态和外部 DOM 修正保持原路径 |

动态宏、概率、timed effects、宿主事件、世界书激活顺序和最终请求体仍由每次真正执行的完整流程计算。

主题 unchanged-field guard 已回退：显式应用主题时恢复原有字段赋值及 CSS、DOM、action 重放。该 guard 只影响低频主题切换，没有专项实机收益证据，却可能削弱“重复应用同一主题以重新同步视觉状态”的原有语义，因此不继续保留。

### 4.3 性能监视器覆盖

`perf` 基线及本分支后续提交已覆盖世界书、generation、流式阶段、聊天加载、慢交互、长聊天 prepend、事件监听器、Quick Reply、Slash Command、网络、Android CPU/RSS、长任务、DOM、Tokenizer broker queue/transport/cache/dedupe。Schema 11 进一步增加：

1. 应用加载性能扩展后默认自动开始采集，仍保留手动停止、重新开始、清空和导出；
2. 每个健康样本记录当前 generation record、trace run、dry run、阶段和相对耗时；
3. 长任务保存时间区间、generation 归属及重叠的慢 phase，便于定位半秒卡顿发生在哪个阶段；
4. slow interaction 保留原始事件，同时按 `interactionId` 或同时间事件聚合，并关联重叠长任务；
5. chat load 新增 `chat-state-prepare`、selection sync、chat-created 和 first-message listener 阶段；
6. Android native sampler 每 10 次采样补一次最多 32 个线程的 CPU ticks，并在前端计算线程 CPU 百分比；
7. 报告记录 profiler callback 累计耗时、回调次数和 snapshot 构建耗时，用于估算监视器自身成本。

Schema 11 只增加诊断字段和默认启动行为，不改变生成请求、事件 await、聊天载荷、最终消息或请求体。

## 5. 后续优化计划

### P0：定位生成期间持续 CPU 与偶发超长任务

1. 删除 `Generate()` 中仅用于控制台 TPS 统计的逐 chunk timestamp 数组，改为首时间、末时间和计数；
2. Schema 11 已把健康采样、长任务、慢 phase 和 generation trace 关联，下一份报告验证 451–615 ms 长任务的具体阶段；
3. Schema 11 已增加宿主线程 CPU ticks 和 profiler callback 开销；仍需用同一固定场景做 profiler 开启/关闭 A/B；
4. 继续记录 regex、Markdown、sanitize、Token 事件和 DOM commit 的输入长度与成本，不跳过事件、不省略最终完整格式化；
5. 以每千字符 CPU time、无 >200 ms 稳态长任务、最终 HTML 和请求体一致性验收。

### P1：收敛按钮、菜单与消息重绘延迟

1. 将慢交互与同时间窗的长任务、listener、DOM 数量、布局/绘制延迟关联；
2. 优先覆盖扩展菜单、顶部扩展选择器、发送按钮和聊天切换；
3. 区分 input delay、handler 和 presentation delay，避免只优化 click handler 而没有改善有效帧；
4. 对 `messages-redisplay` 按消息数、DOM 新增量和图片/iframe hydration 拆分。

### P1：继续收敛世界书固定成本

1. prefix tokenizer 已完成 Schema 10 实机复测，不再优先修改其算法；
2. 聊天切换预热裁剪已完成，先实机复测再决定是否继续处理；
3. 只有建立完整 revision/失效模型后才考虑 prepared-entry cache；
4. 用冻结输入双执行比较激活条目、顺序、Token budget 和最终请求体。

### P1：定位 DOM 所有权与内存基线

1. 按核心模块统计 DOM 节点；
2. 记录 detached node；
3. 记录设置页、菜单和抽屉首次展开成本；
4. 做 20 次生成/切换循环后的 idle 回落测试。

### P2：补齐持久化和长聊天证据

1. settings 请求记录调用方、请求体字节数、序列化、磁盘读取、修复和写入阶段；
2. history prepend 已覆盖分页 IPC、每批 render 和滚动锚点，下一步补图片/iframe hydration；
3. 用现有埋点覆盖 200、500 和 1,000 楼快速连续翻页。

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
| 2026-07-14 06:16:12 | 10 | 聊天预热与流式 DOM 优化后的 optimization-11 实机复测；构建中主题 guard 随后已回退 |

optimization-9 样本 SHA-256：`6BB9093AA27964B4FBE0315B88A9F31835AD63E569B66C63D20C8F75FDA989FC`。

tokenizer 优化后样本 SHA-256：`D4984BA278E60212F6FC8AE7CB52FDEC06CA43FDC0484C3A94CCC9AA26EB31E4`。

optimization-11 样本 SHA-256：`95350A45E63FA20BD08779A1D6CE004D9F94F40E97BE04380A94AD7A10679FDE`。

### 9.2 最新样本覆盖

- 采集持续约 7.2 分钟；
- 9 次完整记录，导出时另有 1 次未完成 current dry run；
- 2 次真实生成、7 次 superseded dry run、5 次聊天加载和 5 次 `messages-redisplay`；
- 428 个健康样本和 52 个 interaction 聚合；慢交互保留最近 100 条明细；
- 5,363 条世界书；
- 流式格式化 profiler 共观测 1,641 次，保留 300 条明细、丢弃 1,341 条明细；阶段累计值仍覆盖全部观测。

### 9.3 限制

1. 各轮采集的操作序列、输出内容、Token cache 热度和采集时长不完全一致；
2. `superseded` 记录的生命周期不能当作 dry run 实际执行耗时，应使用 generation trace；
3. 慢监听器累计时间可能包含父监听器等待嵌套命令，不能当作独立 CPU time 相加；
4. 当前设备未暴露电池温度、电流和电压；
5. RSS 峰值不能单独证明内存泄漏；
6. 最新样本没有触发 history prepend，也没有覆盖大型聊天快速连续翻页；
7. Slash Command 的 `buttons`、嵌套 `run/if` 会包含用户等待，自动化累计时长不能直接当作 CPU time；本轮这些命令与 prompt-ready 慢监听没有时间重叠；
8. prefix tokenizer 已通过本地等价测试，但最新样本没有保存最终请求体快照，不能仅凭性能报告完成端到端功能等价证明；
9. 最新样本只有 2 次真实生成，CPU、流式和真实生成阶段对照只能作为方向性证据；
10. slow interaction 会为同一次物理操作保留多个 pointer/mouse/click 事件，不能把条数或时长直接相加；
11. 最新实机样本只有进程级 CPU，不能把差值归因于某一模块；Schema 11 已增加低频线程采样，但尚未获得 Android 实机数据。

## 10. 埋点缺口

当前代码为 Schema 11，最新实机样本仍为 Schema 10。Schema 11 已补默认自动采集、generation context、长任务/phase 关联、交互聚合、聊天细分、线程 CPU 和 profiler 自身开销。剩余缺口：

1. Prompt Manager dry run 的触发来源、合并次数、排队时间和实际执行次数；
2. Rust tokenizer 内部模型加载和实际 encode CPU 的进一步拆分；线程采样只能定位线程，不能直接定位函数；
3. 世界书 prepared-entry cache 所需的 revision 和失效来源；
4. DOM 节点模块归属和 detached node；
5. settings 请求调用方、字节数和磁盘阶段；
6. history prepend 的图片/iframe hydration；
7. profiler 开启/关闭的 CPU、内存和输入延迟固定场景 A/B；
8. 设备允许时的电池温度、电流和电压。

## 11. 最终结论

- TauriTavern 的 dry run 并发和世界书 Token 风暴已经得到数量级改善；
- 世界书 entries prepare 已完成单遍历优化，Android 实机平均下降 51.5%；
- OpenAI prefix tokenizer 的重复扫描已通过 Schema 10 Android 实机复测，高 Token 调用任务的 Token 阶段平均下降 57.7%，旧有 0.5–0.7 s 单次尖峰未再出现；
- 长聊天分批渲染、集中滚动所有权和 viewport 保持已经落地并通过契约测试，但仍缺少大聊天实机压力复测；
- 聊天切换预热已跳过无人使用的 sort/prepare/clone，optimization-11 中 listeners 平均下降 26.0%，但端到端聊天加载只下降 4.2%；
- 流式严格相同 HTML 的 no-op DOM commit 已去重，实机跳过 33.1% DOM 写入；相近输出规模下每千字符格式化和 DOM commit 耗时分别下降 49.7% 和 54.0%；
- 当前最严重问题依次是：生成期间持续进程 CPU 与偶发 451–615 ms 长任务、按钮/菜单事件链和 presentation delay、约一秒的聊天加载与消息重绘；
- 流式主线程 busy ratio 已下降 55.6%，原“流式全量格式化/DOM 重复提交”不再是唯一 P0 根因；剩余 CPU 必须补线程归因和 profiler A/B 后再优化；
- Schema 11 已默认自动开始采集，并补线程 CPU、generation context、长任务/phase、交互聚合和 profiler 开销；这些字段需由下一版 APK 实机验证；
- 世界书 5,363 条真实生成已稳定在约 0.8–1.0 s，仍可感知但已降为次级问题；DOM/RSS 基线仍会放大布局、绘制和长期运行压力；
- settings 和持久化是次级异步成本，不能用有状态风险的 TTL 缓存草率处理；
- 后续优化必须以最终请求体、世界书激活、消息 HTML、变量状态、事件顺序和 viewport 等价为前提。

## 12. 相对原始 TauriTavern 的优化收益

本节的“原始 TauriTavern”指本轮优化开始前、已接入只读监视器的 Schema 1–3 运行时；“当前实测版本”指 `d0226330` 的 optimization-11 Schema 10 Android 构建。该构建包含的主题 guard 随后已回退，但本节引用的生成、聊天和世界书数据不依赖主题切换。两者设备和世界书规模接近，但操作序列、激活内容和 cache 热度不完全相同，因此只有同口径 A/B 使用精确百分比，跨报告结果使用保守下界。

| 区域 | 原始表现 | 当前表现 | 已解决多少 | 当前判断 |
| --- | --- | --- | --- | --- |
| Prompt Manager dry run | 多次预览可重叠执行，重复完成完整 generation 准备 | optimization-10 的 13 次 dry run 实际执行区间重叠为 0；同规模 dry run generation 平均 3,069.0 -> 1,665.3 ms | 观测到的执行重叠全部消除；平均耗时下降 45.7% | 主要机制已解决，仍保留当前任务完成后的最后一次重跑 |
| 世界书完整阶段 | 约 5,363–5,428 条时单次 86.11–217.85 s | 5,363 条高 Token 调用任务平均 1.46 s、最大 1.68 s | 按原始最小值与当前最大值保守计算，下降至少 98.0% | 灾难级冻结已解决，生成前仍有约 1–2 s 固定成本 |
| 世界书 Token 预算 | 原始 token-count 单次 85.31–217.02 s，占世界书耗时约 99% | optimization-11 真实生成平均 199.3 ms、最大 221.0 ms；全部任务最大 968.8 ms | 按原始最小值与当前全部任务最大值保守计算，下降至少 98.9% | 已从分钟级降到通常亚秒级，是本轮最大收益 |
| OpenAI prefix tokenizer | native 平均 124.2 ms、P95 540 ms、最大 735 ms | 平均 26.1 ms、P95 49 ms、最大 73 ms | 平均下降 79.0%，P95 下降 90.9%，最大值下降 90.1% | 重复扫描根因已解决，broker queue 已不是瓶颈 |
| 世界书 entries prepare | 5,363 条平均 413.5 ms | 平均 200.6 ms、最大 225.8 ms | 平均下降 51.5% | 第一轮低风险分配优化完成；hash、clone 仍有剩余成本 |
| 移动端流式预览 | chunk 到达期间频繁处理不断增长的完整输出 | 7,200 次 Token 事件对应 1,641 次格式化；543 次相同 HTML 跳过 DOM 写入 | 相近输出下每千字符格式化 -49.7%、DOM -54.0%、长任务累计 -86.7%、主线程 busy -55.6% | 主线程卡顿大幅缓解；持续进程 CPU 与偶发半秒长任务尚未解决 |
| 聊天切换预热 | 为预取世界书执行完整 sort、prepare 和 clone，最终结果被丢弃 | 只保留 prefetch、lore 收集和 loaded 事件 | listeners 平均 -26.0%；端到端平均 -4.2% | 无用准备机制已解决，剩余瓶颈在 payload、渲染和其他监听器 |
| 长聊天楼层渲染 | 历史楼层一次性插入，快速翻页时主线程长时间无法呈现新楼层 | 改为小批次插入并在批次间让出主线程，分页 IPC、batch render 和锚点已有埋点 | 已消除一次性大批渲染机制；性能百分比尚无实机证据 | 机制已优化，仍需 200/500/1,000 楼连续翻页复测 |
| 发送、结束输出和滚动 | 多条路径可各自强制滚动，出现跳到顶部或抢占用户 viewport | 滚动所有权集中管理，发送、生成结束和 prepend 尊重 scroll lock 并保留 viewport | 两个已知跳转触发场景已处理；该项是行为正确性修复，不适合换算性能百分比 | 契约测试通过，需继续做长聊天回归 |
| DOM 与 WebView 内存 | 少量消息时仍常驻约 2.1 万 DOM 节点，RSS 约 375–532 MiB | DOM 平均 22,384，RSS 平均约 449.8 MiB、峰值约 601.9 MiB | 没有证据表明本轮降低了基线 | 尚未解决，必须先补模块归属和循环回落数据 |
| 设置与持久化 | settings/get、patch 和 character edit 存在秒级异步等待 | 本轮未修改有状态缓存和保存顺序 | 0 个已证实的性能问题被本轮直接消除 | 尚未优化，维持低优先级以避免 revision 和保存语义风险 |
| 普通按钮 presentation delay | 偶发点击后数百毫秒才出现有效帧 | 扩展菜单点击链 732 ms、事件派发延迟峰值 960.2 ms、`pointerleave` 最大 304 ms | 没有可靠前后 A/B | 当前第二严重问题；需关联同帧长任务、监听器、布局和绘制 |

总体上，本轮已经解决了最严重的三类结构性问题：世界书分钟级 Token 风暴、Prompt Manager 重叠 dry run，以及长聊天一次性渲染/多点滚动竞争。聊天切换无用准备和流式 no-op DOM commit 也已获得 optimization-11 实机证据。当前最严重的剩余问题是生成期间持续进程 CPU 与偶发超长任务，其次是按钮/菜单有效帧延迟和约一秒的聊天加载；世界书固定成本、DOM/RSS 基线和持久化等待已经降为后续分项。
