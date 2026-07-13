# TauriTavern Performance Profiler

Local-only performance diagnostics for generation, chat loading, slow interactions, world-info scanning, and streamed generation.

## Usage

1. Open the `Perf` button in the lower-right corner.
2. Select **开始采集**.
3. Run one or more representative generations.
4. Export the JSON report.

The profiler records generation timing, observable world-info scan metrics, streamed chunk timing, frame delays, long tasks, and JS heap data when the WebView exposes it. It does not send data over the network.

Schema 10 reports additionally include:

- Stable slow-listener attribution: registration mode/order, source module, extension ID, synchronous time, awaited time, aggregate totals, and dropped-record counts. Release-minified function names are not used as the primary identity.
- Strong generation trace correlation: generation, world-info, and stream traces use explicit run IDs. Late or standalone traces are exported as `unattributedTraces` instead of being attached by overlapping timestamps.
- Quick Reply and slash-command timing: trigger, ordering, numeric Quick Reply ID, privacy-safe source hashes, command names, success, and duration.
- Per-render streaming formatting: input/processed/formatted character counts, final-frame status, and regex/Markdown/sanitize/DOM timing deltas.
- Per-batch history prepend timing: message range/count, render/DOM/scroll-anchor cost, height change, and frame-yield status.
- Runtime interaction, network, event-loop, DOM, resident-memory, and process CPU samples. Android process CPU falls back to process ticks plus wall time when access to global `/proc/stat` is restricted.
- Tokenizer invoke outcomes, concurrency-queue wait, and native transport duration without request DTOs, model names, text, messages, or dedupe keys.

## Privacy and overhead

- Reports do not include chat text, generated text, input values, Quick Reply labels/scripts, slash-command arguments, command results, or settings payloads.
- Quick Reply set/source identities are deterministic non-plaintext hashes for local correlation, not cryptographic anonymization. Request records contain method, origin category, and path without query strings or bodies.
- Source attribution strips desktop workspace prefixes and keeps repository-relative module paths where possible. Registration stacks are captured only for generation, message, chat, world-info, streaming, settings, and extension-startup events; other events retain low-cost registration metadata.
- Expensive runtime hooks, per-render phase snapshots, automation timing, history batch timing, and Tokenizer invoke timing are inactive while capture is stopped. Event registration metadata is recorded once when a listener is registered so Release builds can be attributed later.
- Listener, automation, formatting, history, network, invoke, interaction, and health collections are bounded. Reports include observed/stored/dropped counts where truncation is relevant.

When TauriTavern's optional core tracing is available, reports also include:

- World info prefetch, cache collection/cloning, sorting, entry preparation/hash, final clone, keyword scanning, token counting, inclusion groups, event listeners, and prompt building.
- Streaming cleanup, reasoning updates, output regex, Markdown repair/rendering, sanitization, DOM commits, scrolling, and stream event listeners.
- Generation setup, slash commands, extension listeners/interceptors, history regex, prompt assembly, request dispatch, and response waits.
- Chat payload reads/parsing, state application, itemized prompt loading, message rendering, and chat-change listeners.
- Slow browser interactions with input, processing, and presentation delays. Target metadata excludes input values and chat text.

Core tracing is inactive unless this profiler is capturing or the built-in TauriTavern Perf HUD is enabled.
