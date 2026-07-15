// @ts-check

import { initializeBridge } from '../../../tauri-bridge.js';
import { installBackendErrorBridge } from './backend-error-bridge.js';
import { waitForBackendReady } from './backend-readiness.js';

export async function initializeTauriIntegration(context, interceptors, downloadBridge) {
    await initializeBridge();
    await installBackendErrorBridge();
    await waitForBackendReady();

    // Re-apply runtime patches in case third-party code recreated fetch/jQuery or download bindings after bootstrap.
    interceptors.patchFetch();
    interceptors.patchJQueryAjax();
    downloadBridge.patchWindow();
}
