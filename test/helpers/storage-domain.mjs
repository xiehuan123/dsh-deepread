export function createFixtureStorageDomain(fixtures) {
  const observations = new Map()
  const rowsByDomain = new Map()
  for (const fixture of fixtures) {
    rowsByDomain.set(fixture.domain, new Map([[fixture.key, structuredClone(fixture.record)]]))
  }

  return {
    service: {
      async open(spec) {
        const observation = observations.get(spec.name) ?? {
          domain: spec.name,
          version: spec.version,
          tables: [],
          keys: [],
        }
        observations.set(spec.name, observation)
        const rows = rowsByDomain.get(spec.name) ?? new Map()
        rowsByDomain.set(spec.name, rows)

        return {
          async close() {},
          table(name) {
            observation.tables.push(name)
            return {
              get(key) {
                observation.keys.push(key)
                return rows.get(key)
              },
              async put(key, value) { rows.set(key, value) },
              async delete(key) { rows.delete(key) },
              entries() { return rows.entries() },
              keys() { return rows.keys() },
            }
          },
        }
      },
    },
    observed(domain) {
      return structuredClone(observations.get(domain))
    },
  }
}

export async function readStorageRecord(service, domainName, version, tableName, key) {
  const domain = await service.open({ name: domainName, version, tables: {} })
  try {
    return structuredClone(domain.table(tableName).get(key))
  } finally {
    await domain.close()
  }
}
