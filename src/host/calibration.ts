import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

import { createOptionalStorageTable } from './optional-storage.js'
import type { CalibrationRecord, HostContext, RuntimeConfig, StorageTable } from './types.js'
import { isRecord } from './types.js'

const declareDomain = defineDomain as unknown as (spec: unknown) => unknown
const declareDomainTable = domainTable as unknown as (keySchema: unknown, recordSchema: unknown) => unknown

const numericSchema = typeof z.number === 'function' ? z.number() : z.string()
const calibrationSchema = z.object({
  rateTokPerSec: numericSchema,
  latencyMs: numericSchema,
  calls: numericSchema,
  updatedAt: z.string(),
})

const statsDomainSpec = declareDomain({
  name: 'deepread_stats',
  version: 1,
  tables: { stats: declareDomainTable(z.string(), calibrationSchema) },
})

const MODEL_RATE_DEFAULTS = [
  { match: /deepseek/, rate: 100, latency: 700 },
  { match: /kimi|moonshot/, rate: 110, latency: 700 },
  { match: /glm|chatglm/, rate: 100, latency: 700 },
  { match: /qwen/, rate: 110, latency: 700 },
  { match: /doubao|seed/, rate: 90, latency: 800 },
  { match: /claude|anthropic/, rate: 70, latency: 900 },
  { match: /gemini/, rate: 80, latency: 800 },
  { match: /gpt|openai/, rate: 90, latency: 800 },
]

export const DEFAULT_RATE_TOK_PER_SEC = 100
const DEFAULT_LATENCY_MS = 800

export function createCalibrationRuntime(ctx: HostContext, tune: RuntimeConfig) {
  const state: {
    rateTokPerSec: number | null
    latencyMs: number | null
    calls: number
    updatedAt: string | null
    loaded: boolean
  } = { rateTokPerSec: null, latencyMs: null, calls: 0, updatedAt: null, loaded: false }
  const { getTable } = createOptionalStorageTable<StorageTable<string, CalibrationRecord>>(
    ctx,
    statsDomainSpec,
    (domain) => domain.table('stats'),
  )

  function calibratedRate(): number | null {
    return state.rateTokPerSec !== null && Number.isFinite(state.rateTokPerSec) && state.rateTokPerSec > 0 ? state.rateTokPerSec : null
  }

  function calibratedLatency(): number | null {
    return state.latencyMs !== null && Number.isFinite(state.latencyMs) && state.latencyMs > 0 ? state.latencyMs : null
  }

  function modelRateDefaults(): { rate: number; latency: number } {
    const selectionService = ctx.get('agentDefaultModel')
    const raw = selectionService?.currentSelection()
    const id = isRecord(raw) && typeof raw.model === 'string' ? raw.model.toLowerCase() : ''
    for (const candidate of MODEL_RATE_DEFAULTS) {
      if (candidate.match.test(id)) return { rate: candidate.rate, latency: candidate.latency }
    }
    return { rate: DEFAULT_RATE_TOK_PER_SEC, latency: DEFAULT_LATENCY_MS }
  }

  function effectiveRate(): number {
    return calibratedRate() ?? (tune.estTokensPerSecond > 0 ? tune.estTokensPerSecond : modelRateDefaults().rate)
  }

  function effectiveLatency(): number {
    return calibratedLatency() ?? (tune.estLatencyPerCallMs > 0 ? tune.estLatencyPerCallMs : modelRateDefaults().latency)
  }

  async function loadCalibration(): Promise<void> {
    if (state.loaded) return
    const table = await getTable()
    if (table === null) return
    state.loaded = true
    try {
      const record = table.get('default')
      if (isRecord(record) && typeof record.rateTokPerSec === 'number' && record.rateTokPerSec > 0) {
        state.rateTokPerSec = record.rateTokPerSec
        state.latencyMs = typeof record.latencyMs === 'number' && record.latencyMs > 0 ? record.latencyMs : null
        state.calls = typeof record.calls === 'number' ? record.calls : 0
        state.updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : null
      }
    } catch { /* unavailable persistence keeps process-local calibration */ }
  }

  async function persistCalibration(): Promise<void> {
    const table = await getTable()
    if (table === null) return
    try {
      await table.put('default', {
        rateTokPerSec: state.rateTokPerSec ?? effectiveRate(),
        latencyMs: state.latencyMs ?? DEFAULT_LATENCY_MS,
        calls: state.calls,
        updatedAt: state.updatedAt ?? new Date().toISOString(),
      })
    } catch { /* persistence is best effort */ }
  }

  function recordCalibration(rateTokPerSec: number, latencyMs: number): void {
    if (!Number.isFinite(rateTokPerSec) || rateTokPerSec <= 0) return
    const latency = Number.isFinite(latencyMs) && latencyMs > 0 ? Math.min(5000, Math.max(50, latencyMs)) : DEFAULT_LATENCY_MS
    state.calls += 1
    state.rateTokPerSec = state.rateTokPerSec === null ? rateTokPerSec : state.rateTokPerSec * 0.8 + rateTokPerSec * 0.2
    state.latencyMs = state.latencyMs === null ? latency : state.latencyMs * 0.8 + latency * 0.2
    state.updatedAt = new Date().toISOString()
    void persistCalibration()
  }

  return { calibratedRate, effectiveLatency, effectiveRate, loadCalibration, recordCalibration }
}
