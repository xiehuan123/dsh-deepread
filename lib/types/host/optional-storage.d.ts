import type { HostContext, StorageDomainHandle } from './types.js';
export declare function createOptionalStorageTable<TableValue>(ctx: HostContext, domainSpec: unknown, selectTable: (handle: StorageDomainHandle) => TableValue): {
    getTable: () => Promise<TableValue | null>;
};
