export function createFixtureStorageDomain(fixtures) {
  const fixtureByDomain = new Map(fixtures.map((fixture) => [fixture.domain, fixture]))
  const observations = new Map()

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
        const fixture = fixtureByDomain.get(spec.name)
        const rows = new Map()
        if (fixture !== undefined) rows.set(fixture.key, structuredClone(fixture.record))

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
