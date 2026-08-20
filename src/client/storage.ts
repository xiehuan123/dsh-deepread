import type { Calibration, HistoryKind, HistoryRecord } from './models.js'
import { isRecord } from './models.js'

export const HISTORY_KEY = 'dsh-deepread-history-v1'
export const CALIB_KEY = 'dsh-deepread-calib'
const HISTORY_MAX = 20
const HISTORY_KINDS: readonly HistoryKind[] = ['article', 'book', 'map', 'feynman', 'batch']
const DEFAULT_CALIBRATION: Calibration = { rate: 30, latency: 800 }

interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function currentStorage(): unknown {
  return globalThis.localStorage
}

function isBrowserStorage(value: unknown): value is BrowserStorage {
  return isRecord(value) && typeof value.getItem === 'function' && typeof value.setItem === 'function'
}

export function historyKindAllowed(kind: unknown): kind is HistoryKind {
  return typeof kind === 'string' && HISTORY_KINDS.includes(kind as HistoryKind)
}

function parseHistoryRecord(value: unknown): HistoryRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || !historyKindAllowed(value.kind)) return null
  return {
    id: value.id,
    title: value.title,
    kind: value.kind,
    depth: typeof value.depth === 'string' ? value.depth : '',
    source: typeof value.source === 'string' ? value.source : '',
    chars: typeof value.chars === 'number' && Number.isFinite(value.chars) ? value.chars : 0,
    time: typeof value.time === 'number' && Number.isFinite(value.time) ? value.time : 0,
    summary: typeof value.summary === 'string' ? value.summary : '',
    thesis: typeof value.thesis === 'string' ? value.thesis : '',
  }
}

export function readHistory(storageValue: unknown = currentStorage()): HistoryRecord[] {
  const storage = isBrowserStorage(storageValue) ? storageValue : undefined
  if (storage === undefined) return []
  try {
    const raw = storage.getItem(HISTORY_KEY)
    if (raw === null || raw === '') return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(parseHistoryRecord).filter((item): item is HistoryRecord => item !== null) : []
  } catch {
    return []
  }
}

export function writeHistory(record: HistoryRecord, storageValue: unknown = currentStorage()): void {
  const storage = isBrowserStorage(storageValue) ? storageValue : undefined
  if (storage === undefined) return
  try {
    const list = readHistory(storage)
    const index = list.findIndex((item) => item.id === record.id)
    if (index !== -1) list.splice(index, 1)
    list.unshift(record)
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX
    storage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    // Storage can be unavailable (privacy mode/quota); UI remains usable.
  }
}

export function readCalibration(storageValue: unknown = currentStorage()): Calibration {
  const storage = isBrowserStorage(storageValue) ? storageValue : undefined
  if (storage === undefined) return DEFAULT_CALIBRATION
  try {
    const raw = storage.getItem(CALIB_KEY)
    if (raw === null || raw === '') return DEFAULT_CALIBRATION
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return DEFAULT_CALIBRATION
    const rate = typeof parsed.rate === 'number' && Number.isFinite(parsed.rate) && parsed.rate > 0 ? parsed.rate : DEFAULT_CALIBRATION.rate
    const latency = typeof parsed.latency === 'number' && Number.isFinite(parsed.latency) && parsed.latency > 0 ? parsed.latency : DEFAULT_CALIBRATION.latency
    return { rate, latency }
  } catch {
    return DEFAULT_CALIBRATION
  }
}

export function writeCalibration(rate: number, latency: number, storageValue: unknown = currentStorage()): void {
  const storage = isBrowserStorage(storageValue) ? storageValue : undefined
  if (storage === undefined) return
  try {
    storage.setItem(CALIB_KEY, JSON.stringify({ rate, latency }))
  } catch {
    // Storage can be unavailable (privacy mode/quota); UI remains usable.
  }
}
