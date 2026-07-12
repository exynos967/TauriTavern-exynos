const MOBILE_MIN_INTERVAL_MS = 100;
const HIDDEN_MIN_INTERVAL_MS = 250;

/**
 * Resolves the interval for expensive streaming preview renders.
 * Network chunks and stream events remain unthrottled.
 * @param {object} options Render policy inputs.
 * @param {number} options.configuredFps User-configured streaming FPS.
 * @param {boolean} options.mobile Whether the UI is using the mobile layout.
 * @param {boolean} options.hidden Whether the document is hidden.
 * @returns {number} Render interval in milliseconds.
 */
export function getStreamingRenderInterval({ configuredFps, mobile, hidden }) {
    const fps = Number(configuredFps);
    const configuredInterval = Number.isFinite(fps) && fps > 0 ? 1000 / fps : 1000;

    if (hidden) {
        return Math.max(configuredInterval, HIDDEN_MIN_INTERVAL_MS);
    }

    if (mobile) {
        return Math.max(configuredInterval, MOBILE_MIN_INTERVAL_MS);
    }

    return configuredInterval;
}
