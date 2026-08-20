export type Depth = 'quick' | 'deep' | 'book' | 'map' | 'feynman'
export type ExportFormat = 'none' | 'md' | 'mm' | 'html' | 'all'
export type HistoryKind = 'article' | 'book' | 'map' | 'feynman' | 'batch'

export interface Calibration {
  readonly rate: number
  readonly latency: number
}

export interface EstimateRow {
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly minutes: number
}

export type EstimateModes = Record<Depth, EstimateRow>

export interface HistoryRecord {
  readonly id: string
  readonly title: string
  readonly kind: HistoryKind
  readonly depth: string
  readonly source: string
  readonly chars: number
  readonly time: number
  readonly summary: string
  readonly thesis: string
}

export interface BudgetSuccess {
  readonly ok: true
  readonly chars: number
  readonly modes: readonly (EstimateRow & { readonly mode: string })[]
}

export function isBudgetSuccess(value: unknown): value is BudgetSuccess {
  return isRecord(value)
    && value.ok === true
    && typeof value.chars === 'number'
    && Array.isArray(value.modes)
    && value.modes.every((row) => isRecord(row)
      && typeof row.mode === 'string'
      && typeof row.calls === 'number'
      && typeof row.inputTokens === 'number'
      && typeof row.outputTokens === 'number'
      && typeof row.totalTokens === 'number'
      && typeof row.minutes === 'number')
}

export type BudgetState =
  | { readonly status: 'loading'; readonly line: string; readonly data: null }
  | { readonly status: 'error'; readonly line: string; readonly data: null }
  | { readonly status: 'done'; readonly line: ''; readonly data: BudgetSuccess }

export type UnknownRecord = Record<string, unknown>

export interface DeepreadResult extends UnknownRecord {
  readonly kind?: string
  readonly title?: string
  readonly summary?: string
  readonly thesis?: string
  readonly meta?: UnknownRecord
  readonly toc?: readonly unknown[]
  readonly questions?: readonly unknown[]
  readonly chapters?: readonly UnknownRecord[]
  readonly feynmanChapters?: readonly UnknownRecord[]
  readonly reviewPlan?: readonly UnknownRecord[]
  readonly arguments?: readonly UnknownRecord[]
  readonly quotes?: readonly UnknownRecord[]
  readonly concepts?: readonly UnknownRecord[]
  readonly actions?: readonly unknown[]
  readonly sections?: readonly UnknownRecord[]
}

export type SubmitDeepread = (instruction: string) => string | null

export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function errorMessage(value: unknown): string {
  return isRecord(value) && typeof value.message === 'string' ? value.message : String(value)
}
