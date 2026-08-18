export function createOptionalStorageTable(ctx, domainSpec, selectTable) {
    let service;
    let handle = null;
    let tablePromise = null;
    let epoch = 0;
    const bind = (owner, nextService) => {
        service = nextService;
        tablePromise = null;
        const bindingEpoch = ++epoch;
        owner.effect(() => async () => {
            if (epoch !== bindingEpoch)
                return;
            service = undefined;
            tablePromise = null;
            epoch += 1;
            const activeHandle = handle;
            handle = null;
            if (activeHandle !== null) {
                try {
                    await activeHandle.close();
                }
                catch { /* persistence cleanup is best effort */ }
            }
        });
    };
    const bindAvailableService = (owner) => {
        const available = owner.storageDomain ?? owner.get('storageDomain');
        if (available !== undefined && typeof available.open === 'function')
            bind(owner, available);
    };
    if (typeof ctx.inject === 'function') {
        ctx.inject(['storageDomain'], bindAvailableService);
    }
    else {
        bindAvailableService(ctx);
    }
    const getTable = () => {
        const available = service;
        if (available === undefined)
            return Promise.resolve(null);
        if (tablePromise !== null)
            return tablePromise;
        const openEpoch = epoch;
        tablePromise = (async () => {
            try {
                const opened = await available.open(domainSpec);
                if (epoch !== openEpoch || service !== available) {
                    try {
                        await opened.close();
                    }
                    catch { /* stale handle cleanup is best effort */ }
                    return null;
                }
                handle = opened;
                return selectTable(opened);
            }
            catch {
                return null;
            }
        })();
        return tablePromise;
    };
    return { getTable };
}
