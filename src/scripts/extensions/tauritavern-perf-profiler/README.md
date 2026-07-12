# TauriTavern Performance Profiler

Local-only performance diagnostics for generation, chat loading, slow interactions, world-info scanning, and streamed generation.

## Usage

1. Open the `Perf` button in the lower-right corner.
2. Select **开始采集**.
3. Run one or more representative generations.
4. Export the JSON report.

The profiler records generation timing, observable world-info scan metrics, streamed chunk timing, frame delays, long tasks, and JS heap data when the WebView exposes it. It does not send data over the network.

When TauriTavern's optional core tracing is available, reports also include:

- World info prefetch, cache collection/cloning, sorting, entry preparation/hash, final clone, keyword scanning, token counting, inclusion groups, event listeners, and prompt building.
- Streaming cleanup, reasoning updates, output regex, Markdown repair/rendering, sanitization, DOM commits, scrolling, and stream event listeners.
- Generation setup, slash commands, extension listeners/interceptors, history regex, prompt assembly, request dispatch, and response waits.
- Chat payload reads/parsing, state application, itemized prompt loading, message rendering, and chat-change listeners.
- Slow browser interactions with input, processing, and presentation delays. Target metadata excludes input values and chat text.

Core tracing is inactive unless this profiler is capturing or the built-in TauriTavern Perf HUD is enabled.
