import type {
  HostContext,
  StorageDomainHandle,
  StorageDomainService,
} from './types.js'

export function createOptionalStorageTable<TableValue>(
  ctx: HostContext,
  domainSpec: unknown,
  selectTable: (handle: StorageDomainHandle) => TableValue,
) {
  let service: StorageDomainService | undefined
  let handle: StorageDomainHandle | null = null
  let tablePromise: Promise<TableValue | null> | null = null
  let epoch = 0

  const bind = (owner: HostContext, nextService: StorageDomainService): void => {
    service = nextService
    tablePromise = null
    const bindingEpoch = ++epoch

    owner.effect(() => async () => {
      if (epoch !== bindingEpoch) return
      service = undefined
      tablePromise = null
      epoch += 1
      const activeHandle = handle
      handle = null
      if (activeHandle !== null) {
        try { await activeHandle.close() } catch { /* persistence cleanup is best effort */ }
      }
    })
  }

  const bindAvailableService = (owner: HostContext): void => {
    const available = owner.storageDomain ?? owner.get('storageDomain')
    if (available !== undefined && typeof available.open === 'function') bind(owner, available)
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['storageDomain'], bindAvailableService)
  } else {
    bindAvailableService(ctx)
  }

  const getTable = (): Promise<TableValue | null> => {
    const available = service
    if (available === undefined) return Promise.resolve(null)
    if (tablePromise !== null) return tablePromise

    const openEpoch = epoch
    tablePromise = (async () => {
      try {
        const opened = await available.open(domainSpec)
        if (epoch !== openEpoch || service !== available) {
          try { await opened.close() } catch { /* stale handle cleanup is best effort */ }
          return null
        }
        handle = opened
        return selectTable(opened)
      } catch {
        return null
      }
    })()
    return tablePromise
  }

  return { getTable }
}
