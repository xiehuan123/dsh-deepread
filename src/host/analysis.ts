import type { DeepreadBatchInput, DeepreadDepth, DeepreadInput, ExportFormat, OutputLanguage } from './types.js'
import { isRecord } from './types.js'

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseBatchItem(value: unknown): DeepreadBatchInput | null {
  if (!isRecord(value)) return null
  const item: DeepreadBatchInput = {}
  for (const key of ['title', 'url', 'path', 'text', 'focus'] as const) {
    const field = optionalString(value[key])
    if (field !== undefined) item[key] = field
  }
  return item
}

export function parseDeepreadInput(value: unknown): DeepreadInput {
  if (!isRecord(value)) return {}
  const input: DeepreadInput = {}
  for (const key of ['url', 'text', 'path', 'focus'] as const) {
    const field = optionalString(value[key])
    if (field !== undefined) input[key] = field
  }
  if (typeof value.refresh === 'boolean') input.refresh = value.refresh
  if (typeof value.estimate === 'boolean') input.estimate = value.estimate
  input.depth = normalizeDepth(value.depth)
  input.export = normalizeExportFormat(value.export)
  input.language = normalizeLanguage(value.language)
  if (Array.isArray(value.batch)) input.batch = value.batch.map(parseBatchItem).filter((item): item is DeepreadBatchInput => item !== null)
  return input
}

export function normalizeDepth(value: unknown): DeepreadDepth {
  return value === 'quick' || value === 'map' || value === 'feynman' || value === 'book' ? value : 'deep'
}

export function normalizeExportFormat(value: unknown): ExportFormat {
  return value === 'md' || value === 'mm' || value === 'html' || value === 'all' ? value : 'none'
}

export function normalizeLanguage(value: unknown): OutputLanguage {
  return value === 'en' || value === 'zh' ? value : 'auto'
}
