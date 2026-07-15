const prefetches = new Map();

export function startStartupPrefetch(key, loader) {
    const existing = prefetches.get(key);
    if (existing) {
        return existing;
    }

    const promise = Promise.resolve()
        .then(loader)
        .catch(error => {
            prefetches.delete(key);
            throw error;
        });

    promise.catch(() => {});
    prefetches.set(key, promise);
    return promise;
}

export async function consumeStartupPrefetch(key, loader) {
    const prefetch = prefetches.get(key);
    if (!prefetch) {
        return loader();
    }

    try {
        return await prefetch;
    } catch (error) {
        console.debug(`Startup prefetch "${key}" failed; retrying real load.`, error);
        return loader();
    } finally {
        if (prefetches.get(key) === prefetch) {
            prefetches.delete(key);
        }
    }
}
