# TauriTavern 性能分析报告

## 1. 文档状态

- 分析日期：2026-07-20
- 最终优化分支：`optimization/performance`
- 当前运行时代码：`optimization/performance@d21d79e0`（重建基线为 `upstream/dev@a16f1d2f`，保留上游默认关闭的轻量 Perf HUD）
- 诊断分支：`monitor@065f7ed6`（保留扩展性能分析器、自动采集、原生采样和详细诊断埋点）
- 最近一次历史构建：TauriTavern 2.1.1 `arm64-v8a`，代码 `426ce0e5`；APK SHA-256 `8E7682CD55AA58F7E65F2AE2D53D96761AB220BCD07BEACF9CCFF327233DC52A`；本次基线重建未构建 APK
- 最新量化对比运行时代码：`d0226330`（optimization-11；其中主题 unchanged-field guard 随后已回退）
- 最新量化对比样本：`tauritavern-perf-2026-07-14T06-16-12.117Z.json`
- 最新诊断样本：`tauritavern-perf-2026-07-15T17-36-32.084Z.json`
- 量化对比样本 SHA-256：`95350A45E63FA20BD08779A1D6CE004D9F94F40E97BE04380A94AD7A10679FDE`
- 测试设备：Android 15，360 x 792 CSS px，DPR 4，Android System WebView 149

原始性能 JSON 包含控件名称、监听器来源和本地文件路径，只保留在本地。本文仅记录聚合指标和必要的源码标识。

**如有需要，我可以提供性能样本。**

逐文件用途和 JSON 字段定义见与原始样本放在一起的 `性能样本说明.md`。

本文区分三类证据：

1. **实机证实**：由 Android 性能报告直接支持；
2. **契约验证**：已有自动化测试或新旧实现逐项等价测试，但缺少专项实机 A/B；
3. **待验证**：只有趋势或候选解释，不能作为既定事实。

历史样本用于说明优化收益。当前优化分支保留 dev 自带的轻量 Perf HUD，但默认不启用；完整性能分析器和自动采集仍只存在于 `monitor`。

## 2. 执行摘要

1. **最初版存在两个 P0。** 世界书 Token 重复扫描可造成 86.11–217.85 s 的生成前冻结；宿主缺少 dry run 合并保护时，多个完整 prompt 预览可以重叠执行并放大该成本。
2. **最终版没有已知且可稳定复现的 P0。** 世界书分钟级冻结已降为极端输入下的 P2 固定成本；已观测到的重叠 dry run 已由 latest-wins 消除。
3. **世界书是本轮最大收益。** 原始 Token 阶段 85.31–217.02 s，最终实测通常为亚秒级；按保守口径下降至少 98.9%。OpenAI prefix native 调用平均从 124.2 ms 降至 26.1 ms。
4. **流式主线程压力已显著下降，但最终版需要区分历史实测和当前策略。** optimization-11 历史样本中每千字符格式化、DOM commit 和长任务累计耗时分别下降 49.7%、54.0% 和 86.7%；最终版保留正文、reasoning 与计时器的 no-op DOM/property 写入跳过和隐藏页限频，同时保证 reasoning 最终态与 fade-in 仍完整提交。可见页面已恢复用户配置 FPS，因此高 FPS 下的最终收益仍需复测。
5. **早期“更凉”最直接的代码原因是旧移动端 10 FPS 上限。** `2363ea41` 将可见移动端预览限制为最多 10 FPS，`6ceb76b9` 随后为保持用户配置语义撤销该限制；历史 optimization-11 收益包含旧限频影响，因此恢复 30 FPS 后发热收益回落并不意外。
6. **轻量 Perf HUD 不是 performance 专属，但持久化开启时可能放大发热。** performance 与 upstream/dev 使用相同 HUD，默认不加载；若 `tt:perf=1`，则会持续运行 rAF、100ms event-loop timer、750ms HUD render 和 PerformanceObserver，必须用同一 APK 做关闭/开启 A/B，不能仅凭 JS callback 自报开销排除 native/compositor 唤醒。
7. **长聊天跟随最新 dev 的 full-history 基线，滚动问题保留结构性修复。** `a16f1d2f` 已移除 windowed mode，performance 不再恢复其状态、分页或测试；聊天 DOM 继续使用上游 truncation/offscreen containment，而滚动所有权、生成 follow intent、程序化滚动识别和显式新消息滚底保持统一。
8. **当前最高优先级是条件性 P1 的 UI 有效帧延迟。** 历史样本有数百毫秒峰值，但尚未在默认关闭 Perf HUD 的最终代码中稳定复现。
9. **最终版已在最新 dev 上重建并进入稳定阶段。** 已进入 dev 的世界书 Token、Prompt scheduler、build/Rust 契约不再重复携带；仅保留未上游的流式 canonical HTML 和 viewport 控制差异。

## 3. TauriTavern 最初热点与当前热点对比

### 3.1 TauriTavern 最初热点

“最初版”指本轮优化开始前、Schema 1–3 监视样本对应的 TauriTavern。严重度按用户影响、持续时间和触发频率重建；跨报告数据不视为严格 A/B。

| 排名 | 严重度 | 热点 | 优化前表现 | 根因判断 |
| ---: | --- | --- | --- | --- |
| 1 | P0 | 世界书 Token 重复扫描 | 约 5,363–5,428 条时，单次世界书阶段 86.11–217.85 s，界面长时间冻结 | prefix Token 多次从头计算，token-count 占世界书耗时约 99% |
| 2 | P0 | 重叠 dry run | 多个 prompt 预览可重叠执行完整 generation 准备 | 宿主缺少 latest-wins 合并保护，重复消耗世界书、Token 和 prompt 组装资源 |
| 3 | P1 | 移动端流式全量格式化与重复 DOM 提交 | 输出期间持续卡顿和发热 | chunk 到达时反复处理不断增长的完整输出，优化前主线程 busy ratio 约 14.2% |
| 4 | P1 | 长聊天一次性渲染与滚动竞争 | 快速翻页楼层短暂空白；发送或完成时可能跳顶 | 历史楼层批量插入不让出主线程，多条路径分别控制 viewport |
| 5 | P1 | 聊天切换预热与消息重绘 | 切换聊天约一秒无响应 | 预热执行了最终不会使用的 sort、prepare 和 clone；监听器平均约 812.1 ms |
| 6 | P1 | 按钮、菜单与 presentation delay | 点击后偶发数百毫秒没有有效帧 | 菜单点击链曾达 732 ms，事件派发延迟峰值 960.2 ms |
| 7 | P2 | DOM 与 WebView 内存基线 | 页面复杂或长期运行时放大布局、绘制和 GC 压力 | 少量消息时仍约 2.1 万 DOM 节点，RSS 约 375–532 MiB；未证明持续泄漏 |
| 8 | P2 | 设置与持久化等待 | 启动、角色切换和保存存在秒级异步等待 | 有累计耗时，但没有证据证明主要等待直接冻结主线程 |

### 3.2 TauriTavern 当前热点

最终优化版没有已知 P0。下表按再次出现时的处理优先级排序；“条件性 P1”表示历史样本和体感均有信号，但默认关闭 Perf HUD 时尚未稳定复现。

| 排名 | 严重度 | 当前热点 | 当前状态 | 最新证据或判断 |
| ---: | --- | --- | --- | --- |
| 1 | 条件性 P1 | 按钮、菜单与 presentation delay | 最值得关注的体验风险，等待稳定复现 | 历史菜单点击链 732 ms，事件派发延迟峰值 960.2 ms，`pointerleave` 最大 304 ms |
| 2 | P2 | 聊天加载与消息重绘 | 已改善，仍有约一秒固定等待 | chat load 812–1,393 ms；listeners 496–711 ms；`messages-redisplay` 最大 194.1 ms |
| 3 | P2 | 超大型世界书固定成本 | 分钟级冻结已解决，极端输入仍可感知 | 5,363 条真实生成世界书 832–1,044 ms；高 Token 任务最大约 1.68 s |
| 4 | P2 | DOM 与 WebView 内存基线 | 本轮未证明下降，也未证明持续泄漏 | DOM 平均 22,384；RSS 平均约 449.8 MiB，峰值约 601.9 MiB |
| 5 | P2 | 长生成 CPU 与偶发长任务 | 仅保留为诊断候选 | 历史完整监视构建进程 CPU 约 54.8%，但主线程 busy 仅 6.3%，缺少线程归因和 Perf HUD 关闭/开启 A/B |
| 6 | P2 | 长聊天 full-history 与连续翻页 | 采用最新 dev 基线，仍需极端规模复测 | windowed mode 已由上游删除；当前依赖 truncation、Show More、offscreen containment 与集中 viewport 控制，最新样本未覆盖 500–1,000 楼固定操作序列 |
| 7 | P3 | 设置与持久化异步等待 | 不值得为低优先级收益引入状态风险 | 主要为异步 I/O；跨请求 TTL 或进一步合并保存可能破坏 revision、CAS 和顺序 |

### 3.3 热点迁移与量化收益

| 区域 | 最初表现 | 最终表现 | 严重度变化 | 已解决多少 |
| --- | --- | --- | --- | --- |
| 世界书完整阶段 | 约 5,363–5,428 条时单次 86.11–217.85 s | 高 Token 任务平均 1.46 s、最大 1.68 s；真实生成约 0.8–1.0 s | P0 -> P2 | 按原始最小值与最终最大值保守计算，下降至少 98.0% |
| 世界书 Token | 单次 85.31–217.02 s，占世界书耗时约 99% | 真实生成平均约 199.3 ms；全部任务最大 968.8 ms | P0 -> P2 | 保守下降至少 98.9%，分钟级冻结根因已解决 |
| OpenAI prefix tokenizer | native 平均 124.2 ms、P95 540 ms、最大 735 ms | 平均 26.1 ms、P95 49 ms、最大 73 ms | P0 放大项 -> 已解决 | 平均 -79.0%，P95 -90.9%，最大值 -90.1% |
| 重叠 dry run | 多次完整 generation 准备可重叠 | 13 次 dry run 实际执行区间重叠为 0 | P0 -> 已解决 | 已观测到的执行重叠全部消除 |
| 世界书 entries prepare | 5,363 条平均 413.5 ms | 平均 200.6 ms、最大 225.8 ms | P1 -> P2 | 平均下降 51.5% |
| 移动端流式渲染 | 频繁处理增长中的完整输出并重复写 DOM | 正文、reasoning 与计时器跳过严格相同的 no-op 写入；隐藏页限制中间渲染；可见页恢复用户配置 FPS；最终态与 fade-in 保持完整提交 | P1 -> P2/观察 | 历史 optimization-11 样本为格式化 -49.7%、DOM -54.0%、长任务累计 -86.7%、主线程 busy -55.6%；其中包含旧移动端限频影响，新增 reasoning 覆盖尚无专项 A/B |
| 聊天切换预热 | 执行最终会丢弃的 sort、prepare 和 clone | 只保留 prefetch、lore 收集和 loaded 事件 | P1 -> P2 | listeners 平均 -26.0%；端到端平均 -4.2% |
| 长聊天渲染与滚动 | 一次性插入楼层，多条路径竞争 viewport | 跟随上游 full-history/truncated-DOM 基线与 offscreen containment；集中滚动所有权，区分用户与程序化滚动，并保留 generation follow intent | P1 -> P2 | 已知发送/完成跳顶竞态已修复；上游删除 windowed 后仍缺 200/500/1,000 楼实机 A/B |
| 按钮和菜单有效帧 | 偶发数百毫秒无有效帧 | 最终版尚无稳定复现和可靠 A/B | P1 -> 条件性 P1 | 尚未证明获得稳定收益，是当前第一剩余体验风险 |
| DOM/RSS 基线 | 约 2.1 万节点，RSS 约 375–532 MiB | DOM 平均 22,384，RSS 平均约 449.8 MiB | P2 -> P2 | 没有证据表明本轮降低基线 |
| 设置与持久化 | 存在秒级异步等待 | 保持原有状态与保存语义 | P2 -> P3 | 未直接优化，避免引入 revision 和保存顺序风险 |

## 4. 已落地优化与最终验证

### 4.1 运行时优化清单

| 方向 | 主要提交 | 已完成改动 | 结果与行为边界 |
| --- | --- | --- | --- |
| 世界书 Token | `12b17bb3`、`2683e713`、`4bfec501` | 批量精确计数，并在达到 budget 后停止无效前缀计算；将安全连续 prefix 选择提取为纯逻辑并补行为测试 | 保留激活顺序、动态宏回退、概率、budget 命中和 `ignoreBudget` 语义 |
| Token 调度 | `79b9ab5d`、`227b9d92`、`26e18fc0`、`c1654ea6` | identical request single-flight、prefix native 单并发和精确 DTO identity | 不跨 settled 结果复用，不合并不同 DTO |
| Prefix 算法 | `b8ca3364` | OpenAI/tiktoken 累计前缀增量计数 | URL、DTO、返回数组、`stop_at` 和非 OpenAI 路径不变 |
| 世界书准备 | `10ef622b` | decorator、对象构造和 hash 合为单次遍历 | prepare 平均 -51.5%；hash 输入、属性顺序和最终对象逐项等价 |
| Prompt 预览 | `274241b5` | 重叠 dry run 改为 latest-wins | 真正执行时仍调用完整 dry run generation 路径 |
| 流式预览 | `2363ea41`、`6ceb76b9` | 保留隐藏页面 4 FPS 上限；可见页面恢复用户配置的 streaming FPS | 不跳过 Token 事件，不改变网络 chunk、事件或最终消息完整格式化；不再强制移动端 10 FPS |
| 流式 DOM | `558f4278`、`fa529664`、`02e65485` | 正文和 reasoning 跳过严格相同 HTML 的中间态 no-op commit；reasoning dataset、标题、计时文本及 generation timer 仅在值变化时写入 | fade-in 保持原路径；reasoning 完成时强制执行 final commit，不改变最终消息 HTML |
| 聊天切换 | `98945c45` | 预热阶段不再计算无人使用的 sorted/prepared entries | prefetch、事件载荷、await 顺序和完整生成路径不变 |
| Full-history 聊天 | `upstream/dev@a16f1d2f` | 不再携带旧 windowed payload；使用上游完整聊天数据、truncation、Show More、离屏 containment 和消息 HTML 单次解析 | 不修改聊天存储、消息文本、请求体或 renderer 事件边界 |
| Android JSONL | `6f9cf978` | staging 只发送有界原始字节帧，避免 JSON byte array IPC 内存峰值 | JSONL 字节内容、offset、最终文件大小和清理语义由契约测试保护 |
| Android buildSrc | `3b6eb60f` | 删除旧 `app/kotlin` 重复插件源码与临时 source-set 屏蔽，只保留 `client/kotlin` 唯一实现 | `RustPlugin` 实现类名、task 语义、`pnpm` 调用和 Tauri `beforeBuildCommand` 保持不变；最新 `arm64-v8a` APK 构建通过 |
| Viewport | `0d60fd7f`、`cd717315`、`9e8f81a3`、`130d3457`、`d21d79e0` | 集中滚动所有权，识别异步程序化滚动，保护显式导航优先级，并用双帧 settle 处理 `last_mes`/containment 重测量 | 发送、流式、完成、主动上滑和 Show More 保持确认过的语义 |
| 分支边界与命令契约 | `575cb253`、`b9b473a2` | 从性能分支撤销独立 session persistence 行为，并将 prefix tokenizer command 登记到统一 invoke 类型 | 设置/聊天选择持久化恢复 dev 基线；tokenizer URL、DTO 和返回结构不变 |
| 最终交付 | `7fe9e6e4`、`a16f1d2f`、`d21d79e0` | 扩展性能分析器继续隔离在 `monitor`；performance 从最新 upstream/dev 重建，只保留尚未上游的流式和 viewport 差异 | HUD 默认关闭；不恢复 windowed mode，不重复携带已合并 PR，不改变请求体 |

主题 unchanged-field guard 已回退：缺少专项收益证据，且可能削弱重复应用主题时的视觉状态同步语义。

### 4.2 最终版本验证

| 验证项 | 结果 |
| --- | --- |
| 分支隔离 | 优化分支保留 dev 轻量 Perf HUD；`monitor@065f7ed6` 继续保存扩展分析器、自动采集、详细归因和原生性能采样 |
| 优化保留 | 最新 dev 已包含 world-info/tokenizer、Prompt scheduler、highlight、regex、drawer、startup prefetch 等能力；performance 额外保留 chat scroll controller 和 streaming policy，不恢复 windowed message batches |
| 前端 | frontend guardrails、TypeScript、logging boundaries 和 Rust crate boundaries 均通过 |
| 契约测试 | 788 项：785 通过、3 跳过、0 失败；包含最新 dev 契约以及 streaming canonical HTML、动态 hidden interval、scroll priority、程序化滚动和双帧 force settle 覆盖 |
| Rust | 本次没有修改 Rust；Rust crate boundary 检查通过，最新 upstream Rust/build 契约由基线直接继承 |
| Android | 历史 `optimization/performance@426ce0e5` APK 构建与签名验证通过；本次重建按要求未构建 APK |
| 实机边界 | 最新 APK 尚未安装复测；最终滚动修复此前已完成实机问题复测，新增 reasoning no-op 写入优化由契约测试保护但尚无专项性能 A/B |

## 5. 后续优化策略

最终版没有主动推进的 P0，也没有默认继续实施的高风险改造。后续工作由稳定复现和验收指标触发。

| 优先级 | 方向 | 启动条件 | 当前决定 |
| --- | --- | --- | --- |
| 条件性 P1 | 按钮、菜单与消息重绘延迟 | 默认关闭 Perf HUD 时存在可重复步骤，且非网络型首个有效帧持续超过 250 ms | 先复现，再启用轻量 HUD 或使用 `monitor` 关联 input、handler、listener、长任务和 presentation delay |
| P2 | 聊天加载与极端世界书固定成本 | 固定数据集下稳定超过第 7 节目标 | 只考虑可证明结果等价的局部优化 |
| P2 | DOM/RSS 基线 | 20 次固定循环后节点或 RSS 持续增长且 idle 不回落 | 先定位模块所有权和 detached node，不直接卸载隐藏 DOM |
| P2 | 长生成 CPU 与偶发长任务 | 默认关闭 Perf HUD 时稳定复现发热或 >200 ms 长任务 | 做 Perf HUD 关闭/开启及 `monitor` 固定场景 A/B，并取得线程和 phase 归因 |
| P2 | 长聊天连续翻页 | 200、500 或 1,000 楼连续翻页稳定出现空白或长帧 | 复测分页 IPC、batch render、图片/iframe hydration 和 viewport anchor |
| P3 | 设置与持久化 | 证明异步 I/O 阻塞主线程或形成稳定交互延迟 | 暂不增加跨请求 TTL，不改变 revision、CAS 或保存顺序 |

执行约束：

1. 任何问题先在默认关闭 Perf HUD 时复现；轻量 HUD 与 `monitor` 只用于复现后的专项归因。
2. 每次只修改一个可验证机制，并使用固定输入做前后 A/B。
3. 世界书和 prompt 优化必须比较激活条目、顺序、Token budget、动态宏和最终请求体。
4. UI 优化必须同时验证 input delay、handler time 和首个有效帧。
5. 没有稳定复现、模块归因或行为等价证明时，不继续修改核心路径。

## 6. 风险边界

### 6.1 暂缓的高风险方案

以下方案没有实施，因为当前无法证明行为等价：

1. 取消已经进入 Rust `spawn_blocking` 的 Token 请求；
2. 全局并行 EventEmitter 或跳过慢监听器；
3. 给 settings/get 增加跨请求 TTL；
4. 进一步合并 settings/patch；
5. 跳过流式事件或强制降低用户 FPS；
6. 卸载隐藏设置页 DOM；
7. 跨生成复用完整 prompt 或世界书结果；
8. 增量 Markdown/HTML pipeline。

### 6.2 不可破坏的行为契约

1. 最终请求体字段、顺序敏感数组、世界书内容和 provider metadata 与基线一致；
2. 世界书激活顺序、概率、递归、timed effects、`ignoreBudget` 和宏替换语义不变；
3. EventEmitter 注册顺序和 await 语义默认不变；
4. 最终消息经过完整正则、Markdown、sanitize、宿主事件和保存流程；
5. 发送、生成结束、聊天切换和历史 prepend 不得抢占用户 viewport；
6. full-history chat 的楼层 ID、编辑、删除、swipe、truncation 和 Show More 语义不变；
7. 现有事件名、DOM 钩子、API 路径和存储结构不静默变化；
8. 缓存失效或冷启动时必须回退到正确的完整计算。

## 7. 验收目标

| 场景 | 工程目标 |
| --- | --- |
| 普通按钮 | P95 首个有效帧 < 100 ms，非网络型最大 < 250 ms |
| 发送到请求 dispatch | 5,000 条热缓存 P95 < 2 s；无 >1 s 未知监听器 |
| 聊天切换 | 监听器 P95 < 500 ms；1–20 可见楼层完整加载 P95 < 1.5 s |
| 世界书 | 约 5,000 条 Token P95 < 2 s，完整阶段 P95 < 3 s |
| 流式稳态 | 每秒无 >200 ms 长任务；最终结果完整一致 |
| 长聊天翻页 | 每批主线程 < 50 ms；连续翻页无 >250 ms 输入阻塞 |
| 内存 | 20 次循环后无单调增长；idle 回落 RSS 增量 < 50 MiB |

固定复测规模：世界书 0 / 500 / 4,500 / 5,500+ 条；聊天 10 / 200 / 500 / 1,000 楼；输出 500 / 2,000 / 4,000 字符。验证冷/热启动、冷/热 Token cache、dry run 后真实生成、底部跟随/主动上滑、后台恢复、请求体 canonical diff、最终消息 HTML、世界书激活顺序、事件结果、viewport、长任务、RSS 和 DOM。

## 8. 数据来源与限制

### 8.1 性能样本

| 导出时间（UTC） | Schema | 用途 |
| --- | ---: | --- |
| 2026-07-12 16:46:01 | 1 | 世界书、流式和帧基础指标 |
| 2026-07-12 17:45:31 | 2 | 慢交互 |
| 2026-07-12 18:53:40 | 3 | 聊天加载、楼层操作和慢监听器 |
| 2026-07-13 06:41:15 | 4 | 运行时、网络和原生健康采样 |
| 2026-07-13 09:18:01 | 9 | optimization-9 优化前基线 |
| 2026-07-13 12:04:56 | 9 | optimization-10 复测 |
| 2026-07-13 15:03:56 | 9 | 世界书与流式复测 |
| 2026-07-13 17:12:14 | 10 | prefix tokenizer 优化前 native 调用基线 |
| 2026-07-13 18:24:53 | 10 | prefix tokenizer 优化后 Android 实机复测 |
| 2026-07-14 06:16:12 | 10 | 聊天预热与流式 DOM 优化后的 optimization-11 复测 |
| 2026-07-14 07:59:16 | 11 | 自动采集、生成前阶段和长任务诊断 |
| 2026-07-14 11:46:24 | 11 | 按钮、菜单和消息重绘延迟诊断 |
| 2026-07-14 16:33:54 | 11 | 聊天滚动与 viewport 跟随诊断 |
| 2026-07-14 17:07:17 | 11 | 聊天滚动修复后的细化诊断 |
| 2026-07-15 17:36:32 | 11 | 最终分支发热与综合运行态诊断 |

其他关键 SHA-256：optimization-9 `6BB9093AA27964B4FBE0315B88A9F31835AD63E569B66C63D20C8F75FDA989FC`；tokenizer 优化后 `D4984BA278E60212F6FC8AE7CB52FDEC06CA43FDC0484C3A94CCC9AA26EB31E4`。

各文件的覆盖字段、采集状态和建议用途见性能样本目录中的 `性能样本说明.md`。

### 8.2 主要限制

1. 各轮操作序列、输出内容、Token cache 热度和采集时长不完全一致；
2. 最新量化对比样本只有 2 次真实生成，CPU 和阶段对照只能作为方向性证据；
3. 最新样本没有覆盖大型聊天快速连续翻页；
4. 进程 CPU 不能归因到具体线程或函数，历史完整监视样本还包含分析器自身开销；
5. RSS 峰值不能单独证明内存泄漏；
6. 设备未暴露电池温度、电流和电压；
7. 性能报告没有保存最终请求体快照，端到端等价性以自动化契约和源码审查为主。

## 9. 最终结论

- 最初版的两个 P0 已退出最高风险区：世界书分钟级冻结降为 P2 极端输入成本，重叠 dry run 已解决；
- 世界书 Token 保守下降至少 98.9%，prefix native 平均下降 79.0%，entries prepare 平均下降 51.5%；
- 历史 optimization-11 样本中流式每千字符格式化和 DOM commit 分别下降 49.7% 和 54.0%，主线程 busy ratio 下降 55.6%；最终版恢复可见页用户配置 FPS，并将 no-op 写入跳过覆盖到 reasoning 与计时器，同时强制保留 reasoning 最终提交；新增覆盖仍需专项复测；
- 早期移动端 10 FPS 限制已因行为语义撤销，是发热收益回落的高置信度解释；当前不能把 no-op DOM 优化等同于持续变化输出下的低功耗模式；
- performance 已跟随 upstream 删除 windowed mode；full-history/truncated-DOM、offscreen containment、集中滚动所有权和 viewport 保持仍然落地，已知发送与完成跳顶问题已修复；
- 最新 dev 的 Android JSONL 原始字节 staging、消息 HTML 单次解析、renderer handoff、输入框布局修复和 LAN Sync 覆盖策略已同步；
- 最终版没有已知 P0，当前排名第一的是尚未稳定复现的条件性 P1 UI 有效帧延迟；
- 聊天加载、极端世界书、DOM/RSS、长生成 CPU 归因和极端长聊天均为 P2，持久化为 P3；
- 优化分支保留 dev 默认关闭的轻量 Perf HUD；扩展分析器、自动采集、线程归因和原生采样保存在 `monitor`；若设备持久化了 `tt:perf=1`，必须先关闭 HUD 完成同场景 A/B；
- session persistence 行为已从性能分支剥离，Android buildSrc 已收敛为唯一插件源码集合；
- 后续优化必须以最终请求体、世界书激活、消息 HTML、事件顺序和 viewport 等价为前提。
