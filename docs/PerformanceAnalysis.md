# TauriTavern 性能分析报告

## 1. 文档状态

- 分析日期：2026-07-13
- TauriTavern 分支：`optimization/performance`
- 最新实测代码：`104c5a7b`（optimization-10）
- 最新实测构建：TauriTavern 2.1.1 `arm64-v8a` optimization-10 Perf Release
- 最新性能样本：`tauritavern-perf-2026-07-13T15-03-56.482Z.json`
- 样本 SHA-256：`E84DFF9837F203F68EE6FA8997192DA19C8C5DD3576CFA1634C38CE9BBF95DDB`
- 测试设备：Android 15，360 x 792 CSS px，DPR 4，Android System WebView 149
- 插件源码：`ST-Prompt-Template` 1.17.4.2，修复提交 `120e541`

原始性能 JSON 包含控件名称、扩展来源和用户文件路径，只保留在本地，不提交仓库。本文仅记录聚合指标和定位所需的源码标识。

本文区分三类结论：

1. **实机证实**：由 optimization-10 性能报告直接支持；
2. **源码证实**：已从源码和构建产物确认机制或根因，但尚未建立完整实机对照；
3. **待验证**：只有趋势或候选解释，不能作为既定事实。

Tauri/Wry 只替换了外壳和后端。SillyTavern 前端、第三方扩展、事件监听器、正则、Markdown、DOM 和状态管理仍运行在 WebView 中，因此“原生客户端”不等于这些工作自动变快。

## 2. 执行摘要

### 2.1 当前判断

1. **TauriTavern 自身的 dry run 并发风暴已经解决。** optimization-10 的调度仍保持 latest-wins，没有重新出现并发执行证据。
2. **`ST-Prompt-Template` 的决定性排序问题已通过 Android 实机复测。** `qf/jf/Gf` 关键监听器平均从 3,230.6 ms 降至 134.5 ms，最大值从 3,671.3 ms 降至 193.3 ms。
3. **插件不再是当前第一性能问题。** 插件全部慢监听器聚合时间从 65.37 s 降至 2.42 s，下降 96.3%；最新样本中已没有稳定的插件级数秒冻结。
4. **当前第一热点转为 TauriTavern 核心世界书路径。** 5,363 条世界书的 dry run 世界书阶段平均 1.97 s、最大 4.08 s；聊天切换预热监听器最大 1.44 s。
5. **报告归属到 `JS-Slash-Runner` 的耗时来自其装载的用户 iframe 脚本，排除出 TauriTavern 优化范围。** 压缩函数 `r` 对应通用事件桥接包装器，本身只校验参数并调用用户 listener；`chat_completion_prompt_ready` 8 次累计 1.87 s、最大 526.4 ms，不属于宿主核心性能缺陷。
6. **流式、DOM/RSS 与持久化仍需继续处理。** 新样本平均约 2.2 万 DOM 节点，流式全量格式化仍是持续功耗来源；发送按钮出现一次 877.8 ms 首帧延迟，按钮 handler 本身接近 0 ms。

### 2.2 当前严重度排名

| 排名 | 热点 | 状态 | 用户表现 | 最新证据 |
| ---: | --- | --- | --- | --- |
| 1（P0） | TauriTavern 世界书准备、扫描与 Token | 实机证实 | 大世界书生成前冻结，聊天切换变慢 | dry run 平均 1.97 s、最大 4.08 s；切换预热最大 1.44 s |
| 2（P1） | 流式全量格式化与 Token 事件 | 实机证实 | 长输出期间持续发热、偶发掉帧 | 4 次生成 14,436 chunks；格式化约 1.84 s，Token 事件约 1.48 s |
| 3（P1） | 常驻 DOM 与 WebView 内存基线 | 实机证实 | 菜单和抽屉偶发迟钝，长期使用余量不足 | DOM 平均 22,122；RSS 平均 357.0 MiB、峰值 573.2 MiB |
| 4（P2） | `ST-Prompt-Template` 剩余工作 | 实机证实，已非首要问题 | 消息渲染和聊天切换仍有百毫秒成本 | 关键监听器平均 134.5 ms、最大 193.3 ms |
| 5（P2） | 设置、角色和世界书持久化 | 实机证实，主线程影响未证实 | 打开页面、切换角色或保存额外等待 | 历史样本 settings/get 平均 1.04 s；characters/edit 平均 1.51 s |
| 6（P2） | 长聊天连续翻页 | 待验证 | 快速滑动时楼层短暂空白 | 最新样本未触发 history prepend，缺少 200–1,000 楼专项复测 |

## 3. ST-Prompt-Template 根因

### 3.1 修复前实机定位

12:04 修复前样本中，Schema 9 的稳定监听器身份把压缩函数映射到了 `scripts/extensions/third-party/ST-Prompt-Template/dist/index.js`：

| 函数 | 源码处理器 | 事件 | 次数 | 累计耗时 | 平均 | 最大 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `qf` | `handleMessageRender` | `character_message_rendered` | 5 | 17.14 s | 3.43 s | 3.54 s |
| `qf` | `handleMessageRender` | `user_message_rendered` | 4 | 14.00 s | 3.50 s | 3.57 s |
| `qf` | `handleMessageRender` | `message_updated` | 2 | 4.47 s | 2.23 s | 2.27 s |
| `jf` | `handleChatCompletionReady` | `chat_completion_settings_ready` | 5 | 16.41 s | 3.28 s | 3.51 s |
| `Gf` | `handlePreloadWorldInfo` | `chat_id_changed` | 4 | 12.60 s | 3.15 s | 3.67 s |

上述五组累计 64.61 s，占全部慢监听器聚合时间的 92.8%。`ST-Prompt-Template` 所有监听器累计 65.37 s，占 93.9%。

一轮真实生成通常依次经过用户消息 `qf`、请求体准备 `jf` 和 AI 消息 `qf`。按修复前样本保守估算，插件给一轮生成增加约 9.5 秒关键路径等待：

```text
点击发送
  -> user_message_rendered / qf
  -> chat_completion_settings_ready / jf
  -> 模型流式输出
  -> character_message_rendered / qf
```

聊天切换同理：消息渲染只需 58.2–85.1 ms，但完整切换为 3.48–4.66 s，其中监听器占 3.25–4.36 s。

### 3.2 决定性排序错误

插件源码 `src/function/worldinfo.ts` 的旧实现：

```ts
function getWorldInfoSorter(entries: WorldInfoEntry[]) {
    return (a, b) => worldInfoSorter(
        a,
        b,
        Math.max(...entries.map(x =>
            x.position === world_info_position.atDepth ? x.depth : 0
        )),
    );
}
```

`Array.sort()` 每比较两个条目，就重新执行一次完整 `entries.map(...)` 和 `Math.max(...)`。对 5,363 条合成数据：

- 排序比较约 56,000 次；
- 每次比较扫描 5,363 条；
- 单次排序访问超过 3 亿个数组元素；
- 复杂度由正常的 `O(n log n)` 放大到接近 `O(n² log n)`。

插件的 `getEnabledWorldInfoEntries()` 还会先分别加载并排序每本启用世界书，再合并并排序完整数组，所以一次监听器可能执行多次高复杂度排序。

这解释了为什么问题在大型世界书和移动端尤其严重：Android WebView 的单核执行能力更弱，而 `qf/jf/Gf` 都会走世界书加载路径。

### 3.3 为什么报告显示为 await 等待

插件监听器约 99.6%–99.9% 的时间被记录为 `waitDurationMs`，但不能据此认为它只是在等待网络。

这些处理器是 `async` 函数。它们先 `await loadWorldInfo()`，随后执行同步排序；事件监视器只能把 Promise 返回后的整段时间归入 await 阶段。除首次聊天切换外，大部分 3 秒监听窗口没有重叠网络请求，排序仍发生在 WebView 主线程。

因此：

- EventEmitter 串行 `await` 放大了端到端延迟；
- 直接 CPU 根因在插件排序器；
- 全局并行化 EventEmitter 既不能消除 CPU 工作，又会破坏扩展顺序和最终请求体。

### 3.4 已完成修复与实机验收

插件分支：`optimization/worldbook-sort`

插件提交：`120e541 perf: precompute world info sort depth`

PR：`exynos967/ST-Prompt-Template#1`

修复只把排序期间不变的 `top` 预计算一次：

```ts
function getWorldInfoSorter(entries: WorldInfoEntry[]) {
    const top = Math.max(...entries.map(x =>
        x.position === world_info_position.atDepth ? x.depth : 0
    ));
    return (a, b) => worldInfoSorter(a, b, top);
}
```

不变项：

- depth、order、UID 比较规则不变；
- 世界书内容与激活结果不变；
- 事件注册和执行顺序不变；
- EJS、变量、副作用和最终请求体不变。

验证结果：

- 600 组随机和边界数据的新旧排序结果逐项一致；
- 5,363 条大数据集的新旧排序结果逐项一致；
- 代表性本地基准从 1,224.5 ms 降到 1.4 ms，约 850 倍；
- `npm run build` 通过，`dist/index.js` 和 source map 已更新。

排序函数的本地等价验证已由最新 Android 实机复测补全。相同设备、相同 5,363 条世界书下，关键监听器变化如下：

| 监听器 | 修复前 | 修复后 | 变化 |
| --- | ---: | ---: | ---: |
| `qf` / `character_message_rendered` 平均 | 3,427.3 ms | 172.0 ms | -95.0% |
| `qf` / `user_message_rendered` 平均 | 3,500.3 ms | 162.0 ms | -95.4% |
| `jf` / `chat_completion_settings_ready` 平均 | 3,282.0 ms | 103.0 ms | -96.9% |
| `Gf` / `chat_id_changed` 平均 | 3,150.0 ms | 128.1 ms | -95.9% |
| `qf/jf/Gf` 关键监听器整体平均 | 3,230.6 ms | 134.5 ms | -95.8% |
| `qf/jf/Gf` 最大值 | 3,671.3 ms | 193.3 ms | -94.7% |
| 插件全部慢监听器累计 | 65.37 s | 2.42 s | -96.3% |

聊天切换总耗时也从修复前的平均 4.03 s 降到 1.68 s。该指标还包含核心世界书预热、角色加载和其他扩展，不能把剩余 1.68 s 归给插件。

进程 CPU 平均值从 56.2% 降至 49.6%，但主线程 busy ratio 从 8.5% 升至 9.8%。由于两轮操作与输出不同，这只能说明 CPU 总体方向改善，不能把差值全部归因于插件修复。

结论：`120e541` 已消除插件的灾难级排序成本，`ST-Prompt-Template` 从 P0 根因降为百毫秒级次要成本。性能埋点不记录监听器业务结果，功能等价性仍以排序对照测试和后续请求体快照为准。

### 3.5 插件修复后的剩余候选

插件已不再是当前优化重点。只有在核心世界书路径优化后它重新进入前列，才按以下顺序处理：

1. `handleMessageRender()` 每处理一个楼层都会重新加载、克隆、解析并合并全部启用世界书；
2. `handlePreloadWorldInfo()` 会遍历世界书执行模板，再逐个重新处理可见楼层；
3. `processGenerateAfter()` 会依次处理请求体中每条消息的 before/main/after 模板；
4. Monaco 编辑器被静态导入，即使 `code_editor=false` 也会加载大型代码编辑模块；
5. `prepareContext()` 会合并并深拷贝变量，启用自动保存时还会等待聊天保存。

这些路径包含 EJS 副作用、变量修改和请求体变换，风险高于排序修复。只有后续样本证明它们重新成为主要占比时才能处理，不能预先缓存或跳过。

## 4. TauriTavern 当前热点

### 4.1 世界书条目准备

最新样本的 18 次世界书 trace 中，部分聊天切换预热 trace 没有完整 `entries-total` 汇总，因此分项样本数不同：

| 阶段 | 平均 | 最大 | 累计 / 样本数 |
| --- | ---: | ---: | ---: |
| world 数据收集 | 72.7 ms | 89.4 ms | 1.31 s / 18 |
| `WORLDINFO_ENTRIES_LOADED` 监听器 | 71.5 ms | 110.2 ms | 1.29 s / 18 |
| 排序 | 1.0 ms | 1.7 ms | 17.8 ms / 18 |
| decorator 解析、对象构造和 hash | 412.2 ms | 537.0 ms | 7.42 s / 18 |
| 最终 `structuredClone` | 51.0 ms | 63.1 ms | 918 ms / 18 |
| 完整 entries 阶段 | 608.1 ms | 782.4 ms | 8.51 s / 14 |

TauriTavern 核心的世界书排序只有约 1 ms，**不是** `ST-Prompt-Template` 的排序错误。两者必须分开：

- TauriTavern 核心慢在对象准备、hash、clone 和多轮扫描；
- 插件慢在比较器内部重复全数组扫描。

当前可考虑的低风险小改是合并两次连续 `map()`，减少中间数组和对象分配。更高收益的 prepared-entry cache 需要覆盖世界书保存、删除、导入、角色/人格/聊天绑定、设置变化和扩展事件修改，尚不具备足够失效证据。

### 4.2 世界书扫描与 Token

最新复测的 9 次完整 dry run（包含导出时的 current record）每次均处理 5,363 条世界书：

- entry scan 平均 540.5 ms，最大 731.1 ms；
- Token 平均 790.9 ms，最大 2.70 s；
- 完整世界书平均 1.97 s，最大 4.08 s；
- 通常递归扫描 3–4 轮。

相比 12:04 样本，dry run 平均值有所回升，但 4 次真实生成的世界书阶段平均 1.25 s，与前次 1.18 s 接近。两轮采集的 Token cache 热度、触发顺序和内容并不相同，因此不能据此认定现有优化回归；最大 2.70 s 表明冷/排队路径仍需进一步拆分。

剩余优化必须保留：

- 激活顺序；
- 概率和递归；
- timed effects；
- `ignoreBudget`；
- 动态宏；
- 最终插入内容和顺序。

### 4.3 聊天切换预热

核心 `scripts/world-info.js` 的 `CHAT_CHANGED` 监听器会调用 `getSortedEntries()` 预热世界书：

- 修复前 4 次累计 1.68 s，最大 459.4 ms；
- 修复后 4 次累计 3.22 s，最大 1.44 s。

插件排序修复后，这条核心预热路径已经成为聊天切换的第一热点。该结果随后被丢弃，但调用会填充原始世界书缓存并触发 `WORLDINFO_ENTRIES_LOADED`。不能简单删除或后台化，否则可能改变扩展观察顺序。更合理的后续方向是把“原始 world prefetch”和“生成专用 prepare/hash/clone”拆开，再验证首次生成是否仍完整执行相同事件和结果。

### 4.4 范围排除：JS-Slash-Runner 用户脚本

source map 将性能报告中的 `dist/index.js:191:28447`、压缩函数 `r` 精确映射到 `src/function/event.ts` 的 `register_listener_wrapper()`。该函数只负责：

1. 检查 iframe listener 是否仍在注册表中；
2. 将消息事件的 message ID 规范为数字；
3. 调用 iframe 用户脚本注册的 listener，并原样返回结果。

最新样本中相关聚合：

| 事件 | 次数 | 累计 | 最大 | 同步累计 | await 累计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `chat_completion_prompt_ready` | 8 | 1.87 s | 526.4 ms | 2.9 ms | 1.87 s |
| `worldinfo_entries_loaded` | 18 | 828.2 ms | 78.2 ms | 222.7 ms | 605.5 ms |
| `chat_id_changed` | 7 | 554.7 ms | 167.3 ms | 132.7 ms | 422.0 ms |

因此，现有数据证明耗时来自 JS-Slash-Runner 装载的 iframe 用户脚本 listener，不能归因于 TauriTavern 核心或 JS-Slash-Runner 桥接算法。Slash Command 自动化样本集中在采集开始后约 107–137 秒，而上述 prompt-ready 慢监听窗口位于约 437–854 秒，两者没有时间重叠；`/buttons` 用户等待不是这些监听器的根因。

源码审计另行发现 `eventOn/eventMakeFirst/eventMakeLast/eventOnce` 返回的 `stop()` 使用包装函数反查原始 listener，可能导致手动卸载失效。但本次性能报告没有出现 registration ID 持续增长或重复监听证据，iframe `pagehide` 仍会调用 `eventClearAll()` 完成清理；该问题与 526.4 ms 慢监听也没有直接关系，因此按 YAGNI 不在本轮修改。

该项不进入 TauriTavern 后续优化计划，也不为其增加宿主埋点。若用户脚本自身需要排查，应在 JS-Slash-Runner 或脚本内部单独诊断。TauriTavern 不能并行、缓存或跳过通用桥接，否则会改变脚本顺序、变量状态和最终请求体。

### 4.5 流式生成

最新 4 次真实生成：

- 14,436 个 chunks；
- 约 3,309 次预览处理；
- 格式化累计约 1.84 s；
- Token 事件监听累计约 1.48 s；
- DOM commit 累计约 480 ms。

移动端限频已经把多个 chunk 合并为一次预览，单次格式化明显变轻。它现在更像持续功耗来源，而不是稳定数秒冻结。

低风险候选：流式统计只维护首时间、末时间和计数，不再保存每个 chunk 的 timestamp。高风险候选包括增量 Markdown/sanitize、跳过 `STREAM_TOKEN_RECEIVED` 或强制覆盖用户 FPS，暂不实施。

### 4.6 DOM 与内存

- DOM 平均 22,122，P95 22,246，单次峰值 38,142；
- 同屏消息平均约 10 条；
- RSS 平均 357.0 MiB，峰值 573.2 MiB；
- JS heap P95 约 468.3 MiB。

发送按钮出现一次 877.8 ms Event Timing，handler 接近 0 ms、首个有效帧为 874.7 ms；扩展菜单最大 651.3 ms，handler 仅 0.1 ms。两者更像布局、绘制或同帧任务阻塞，而不是按钮回调本身缓慢。

单次峰值不能证明内存泄漏。卸载隐藏设置页或扩展 DOM 可能破坏表单状态、同步 DOM 查询和 MutationObserver；必须先补模块级节点归属、detached node 和固定循环后的 idle 回落数据。

### 4.7 设置与持久化

| 路径 | 次数 | 平均 | 最大 |
| --- | ---: | ---: | ---: |
| `/api/settings/get` | 15 | 1.04 s | 6.17 s |
| `/api/settings/patch` | 14 | 376 ms | 873 ms |
| `/api/characters/edit` | 4 | 1.51 s | 2.71 s |

这些请求会增加启动、角色切换和插件流程等待，但多数为异步 I/O，当前没有证据证明它们直接冻结主线程。

宿主已经对同时发生的 `get_sillytavern_settings` 做 in-flight dedupe。跨请求 TTL 可能让 Quick Reply、世界书和设置页读取旧 revision，因此不应只凭累计耗时增加缓存。

## 5. 已验证的优化效果

### 5.1 optimization-9 与 optimization-10

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

### 5.2 已落地改动

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

动态宏、概率、timed effects、扩展事件、世界书激活顺序和最终请求体仍由每次真正执行的完整流程计算。

## 6. 后续优化计划

### P0：收敛 TauriTavern 世界书固定成本

1. 先评估合并 entries prepare 两次 `map()` 的实际收益；
2. 给聊天切换预热拆分 prefetch、扩展事件、prepare/hash/clone 阶段；
3. 单独记录 Tokenizer 队列等待、native 执行和 exact dedupe 命中，解释 2.70 s 最大值；
4. 只有建立完整 revision/失效模型后才考虑 prepared-entry cache；
5. 用冻结输入双执行比较激活条目、顺序、Token budget 和最终请求体。

### P1：降低流式稳态 CPU

1. 删除仅用于统计的逐 chunk timestamp 数组；
2. 继续记录 regex、Markdown、sanitize 和 DOM commit 的输入长度与成本；
3. 不跳过 Token 事件，不省略最终完整格式化；
4. 以每千字符 CPU time、长任务和最终 HTML 一致性验收。

### P1：定位 DOM 所有权

1. 按核心模块和扩展统计 DOM 节点；
2. 记录 detached node；
3. 记录设置页、扩展菜单和抽屉首次展开成本；
4. 做 20 次生成/切换循环后的 idle 回落测试。

### P2：补齐持久化和长聊天证据

1. settings 请求记录调用方、请求体字节数、序列化、磁盘读取、修复和写入阶段；
2. history prepend 记录分页 IPC、每批 render、图片/iframe hydration 和滚动锚点；
3. 覆盖 200、500 和 1,000 楼快速连续翻页。

## 7. 暂缓的高风险方案

以下方案没有实施，因为当前无法证明行为等价：

1. **取消已经进入 Rust `spawn_blocking` 的 Token 请求。** 需要 request ID、取消 DTO、错误语义和 tokenizer 协作检查点。
2. **全局并行 EventEmitter 或跳过慢监听器。** 会改变扩展顺序、变量可见性、Slash Command 结果和最终请求体。
3. **给 settings/get 增加跨请求 TTL。** 可能返回旧 revision；现有 in-flight dedupe 已覆盖同时请求。
4. **进一步合并 settings/patch。** 可能改变 CAS 冲突、失败重试和保存顺序。
5. **跳过流式事件或强制降低用户 FPS。** 会破坏扩展契约或预期显示行为。
6. **卸载隐藏设置页或扩展 DOM。** 可能破坏同步查询、表单状态和 MutationObserver。
7. **跨生成复用完整 prompt 或世界书结果。** 动态宏、概率、timed effects 和扩展事件可能变化。
8. **增量 Markdown/HTML pipeline。** 跨 chunk 语法、正则和 sanitize 等价性尚未建立。

## 8. 不可破坏的行为契约

所有优化必须满足：

1. 最终请求体字段、顺序敏感数组、世界书内容和 provider metadata 与基线一致；
2. 世界书激活顺序、概率、递归、timed effects、`ignoreBudget` 和宏替换语义不变；
3. EventEmitter 注册顺序和 await 语义默认不变；
4. 最终消息必须经过完整正则、Markdown、sanitize、扩展事件和保存流程；
5. 发送、生成结束、聊天切换和历史 prepend 不得抢占用户 viewport；
6. windowed chat 的楼层 ID、编辑、删除、swipe 和 prompt backfill 语义不变；
7. 第三方扩展依赖的事件名、DOM 钩子、API 路径和存储结构不静默变化；
8. 缓存只影响性能，失效或冷启动时必须回退到正确的完整计算。

建议对高风险优化建立双执行验证：同一冻结输入分别运行基线和优化实现，比较 canonical JSON、消息数组、世界书片段、采样参数和 provider metadata，不能只比较 Token 总数或字符串长度。

## 9. 验收目标与复测矩阵

### 9.1 工程目标

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

### 9.2 数据规模

- 世界书：0 / 500 / 4,500 / 5,500+ 条；
- 聊天：10 / 200 / 500 / 1,000 楼；
- 输出：500 / 2,000 / 4,000 字符；
- 扩展：最小扩展集 / 用户实际扩展集；
- 自动化：Quick Reply 关闭 / 用户实际配置；
- 插件：`ST-Prompt-Template` 修复前 / 修复后。

### 9.3 状态与验证项

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

## 10. 数据来源与限制

### 10.1 性能样本

| 导出时间（UTC） | Schema | 用途 |
| --- | ---: | --- |
| 2026-07-12 16:46:01 | 1 | 世界书、流式和帧基础指标 |
| 2026-07-12 17:45:31 | 2 | 增加慢交互 |
| 2026-07-12 18:53:40 | 3 | 增加聊天加载、楼层操作和慢监听器 |
| 2026-07-13 06:41:15 | 4 | 增加运行时、网络和原生健康采样 |
| 2026-07-13 09:18:01 | 9 | optimization-9 优化前基线 |
| 2026-07-13 12:04:56 | 9 | optimization-10、插件修复前基线 |
| 2026-07-13 15:03:56 | 9 | `ST-Prompt-Template` 修复后复测 |

optimization-9 样本 SHA-256：`6BB9093AA27964B4FBE0315B88A9F31835AD63E569B66C63D20C8F75FDA989FC`。

插件修复前样本 SHA-256：`42FE59A5E04C9AFE8C96030AF36401EE57F97CA87E2CC0FB899599F56EB70142`。

### 10.2 最新样本覆盖

- 采集持续 15.33 分钟；
- 9 次完整 dry run，其中 1 次位于导出时的 current record；
- 4 次真实生成；
- 4 次聊天切换；
- 881 个健康样本；
- 143 个慢监听器观测，保留最近 100 条明细；
- 5,363 条世界书；
- Android 前台可见样本 876 个，后台样本 5 个。

### 10.3 限制

1. 各轮采集的操作序列、输出内容、Token cache 热度和采集时长不完全一致；
2. `superseded` 记录的生命周期不能当作 dry run 实际执行耗时，应使用 generation trace；
3. 慢监听器累计时间可能包含父监听器等待嵌套命令，不能当作独立 CPU time 相加；
4. 当前设备未暴露电池温度、电流和电压；
5. RSS 峰值不能单独证明内存泄漏；
6. 最新样本没有触发 history prepend，也没有覆盖大型聊天快速连续翻页；
7. Slash Command 的 `buttons`、嵌套 `run/if` 会包含用户等待，自动化累计时长不能直接当作 CPU time；本轮这些命令与 prompt-ready 慢监听没有时间重叠；
8. 插件排序结果已通过本地等价测试，但最新样本没有保存最终请求体快照，不能仅凭性能报告完成端到端功能等价证明。

## 11. 埋点缺口

Schema 9 已覆盖 generation、世界书、流式、聊天加载、交互、网络、监听器稳定身份、扩展来源、Slash Command、Quick Reply 和 Android CPU fallback。剩余缺口：

1. Prompt Manager dry run 的触发来源、合并次数、排队时间和实际执行次数；
2. Tokenizer 队列深度、排队时间、native 执行时间和 exact dedupe 命中；
3. 世界书 prepared-entry cache 所需的 revision 和失效来源；
4. DOM 节点模块归属和 detached node；
5. settings 请求调用方、字节数和磁盘阶段；
6. history prepend 的图片/iframe hydration 和滚动锚点偏移；
7. profiler 开启/关闭的 CPU、内存和输入延迟 A/B；
8. 设备允许时的电池温度、电流和电压。

## 12. 最终结论

- TauriTavern 的 dry run 并发和世界书 Token 风暴已经得到数量级改善；
- `ST-Prompt-Template` 的比较器全数组重复扫描已经修复并通过 Android 复测，关键监听器平均下降 95.8%；
- 当前第一性能问题转为 TauriTavern 核心世界书对象准备、扫描、Token 和聊天切换预热；
- `JS-Slash-Runner` 只是在当前埋点中承载慢 listener 的桥接归属；真正耗时来自其装载的用户脚本，已排除出 TauriTavern 优化范围；
- 流式稳态 CPU 和 DOM/RSS 基线仍会造成发热与按钮 presentation delay；
- settings 和持久化是次级异步成本，不能用有状态风险的 TTL 缓存草率处理；
- 后续优化必须以最终请求体、世界书激活、消息 HTML、变量状态、事件顺序和 viewport 等价为前提。
