import type { IncomingMessage, ServerResponse } from 'node:http'

export interface Config {
  timeoutMs?: number
  chunkChars?: number
  maxParts?: number
  maxInputChars?: number
  cacheEnabled?: boolean
  cacheTtlHours?: number
  estTokensPerSecond?: number
  estLatencyPerCallMs?: number
  backgroundMinChars?: number
}

export interface RuntimeConfig {
  timeoutMs: number
  chunkChars: number
  maxParts: number
  maxInputChars: number
  cacheEnabled: boolean
  cacheTtlHours: number
  estTokensPerSecond: number
  estLatencyPerCallMs: number
  backgroundMinChars: number
}

export type DeepreadDepth = 'quick' | 'deep' | 'map' | 'feynman' | 'book'
export type OutputLanguage = 'zh' | 'en' | 'auto'
export type ExportFormat = 'none' | 'md' | 'mm' | 'html' | 'all'
export type SourceKind = 'url' | 'file' | 'pdf' | 'text'
export type CacheStatus = 'hit' | 'miss' | 'fallback' | 'disabled'

export interface DeepreadInput {
  url?: string
  text?: string
  path?: string
  depth?: DeepreadDepth
  export?: ExportFormat
  refresh?: boolean
  focus?: string
  language?: OutputLanguage
  estimate?: boolean
  batch?: DeepreadBatchInput[]
}

export interface DeepreadBatchInput {
  title?: string
  url?: string
  path?: string
  text?: string
  focus?: string
}

export interface StageMetadata {
  resolveMs: number
  extractMs: number
  llmMs: number
  calls: number
}

export interface PdfStats {
  pages: number
  samplePages: number
  sampleChars: number
  sampleTokens: number
}

export interface CacheRecord {
  url: string
  text: string
  fetchedAt: string
}

export interface CalibrationRecord {
  rateTokPerSec: number
  latencyMs: number
  calls: number
  updatedAt: string
}

export interface SourceResult {
  text: string
  source: string
  sourceKind: SourceKind
  cache?: CacheStatus
  fetchedAt?: string
  note?: string
  extractMs?: number
  pdfStats?: PdfStats
}

export interface ResultMetadata {
  source: string
  sourceKind: SourceKind | 'batch'
  chars: number
  chunks: number
  depth: DeepreadDepth | 'batch'
  durationMs?: number
  note?: string
  stages?: StageMetadata
  files?: Partial<Record<'md' | 'mm' | 'html', string>>
  cache?: CacheStatus
  fetchedAt?: string
  estimate?: EstimateResult | BatchEstimateResult
  pdfStats?: PdfStats
}

export interface EstimateCall {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  minutes: number
  minutesFormula: string
  estTokensPerSecond: number
  estLatencyPerCallMs: number
  calibrated: boolean
}

export interface EstimateResult {
  chars: number
  modes: Array<EstimateCall & { mode: string; note: string }>
  estTokensPerSecond: number
  estLatencyPerCallMs: number
  calibrated: boolean
  sampled?: boolean
  note?: string
}

export interface BatchEstimateResult {
  batch: true
  items: Array<{ index: number; title: string; source: string; chars: number; quick: EstimateCall }>
  finalCall: EstimateCall
  totalCalls: number
  totalTokens: number
  totalMinutes: number
  estTokensPerSecond: number
  estLatencyPerCallMs: number
  calibrated: boolean
}

export interface AnalysisChapter {
  title: string
  summary: string
  thesis: string
  arguments: Array<{ claim: string; evidence: string; quote: string; source: string }>
  quotes: Array<{ text: string; context: string; source: string }>
}

export interface MapItem {
  type: string
  claim: string
  evidence: string
  source: string
  confidence: string
  relations: Array<{ to: string; type: string }>
}

export interface BatchDocumentResult {
  index: number
  title: string
  summary: string
  thesis: string
  arguments: Array<{ claim: string; evidence: string; quote: string; source: string }>
  quotes: Array<{ text: string; context: string; source: string }>
  concepts: Array<{ term: string; explanation: string }>
  source: string
  sourceKind: string
  chars: number
}

export interface FeynmanChapterResult {
  index: number
  title: string
  points: Array<{ claim: string; data: string; evidence: string }>
  chapterMap: string
  explanation: string
  gaps: string[]
  corrections: string[]
}

export interface DeepreadResult {
  kind: 'article' | 'book' | 'map' | 'feynman' | 'estimate' | 'batch' | 'background'
  title: string
  summary: string
  thesis: string
  meta?: ResultMetadata
  arguments?: Array<{ claim: string; evidence: string; quote: string; source: string }>
  quotes?: Array<{ text: string; context: string; source: string }>
  concepts?: Array<{ term: string; explanation: string }>
  questions?: string[]
  structure?: string[]
  chapters?: AnalysisChapter[]
  citations?: Array<{ claim: string; source: string; quote: string }>
  estimate?: EstimateResult | BatchEstimateResult
  items?: MapItem[] | BatchDocumentResult[]
  comparison?: {
    comparison: Array<{ theme: string; positions: Array<{ doc: string; view: string }> }>
    conflicts: Array<{ theme: string; positions: Array<{ doc: string; view: string }> }>
    complementarity: string
    synthesis: string
  }
  jobId?: string
  label?: string
  coreQuestion?: string
  coreConclusions?: string[]
  dataPoints?: Array<{ value: string; period: string; subject: string; baseline: string; source: string; location: string }>
  caveats?: string[]
  mermaid?: string
  xmindOutline?: string
  recallQuestions?: string[]
  toc?: string[]
  feynmanChapters?: FeynmanChapterResult[]
  bookMap?: string
  finalExplanation?: string
  reviewPlan?: Array<{ interval: string; focus: string; method: string }>
}

export interface AbortLike {
  readonly aborted: boolean
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: unknown
}

export interface LlmService {
  listProviders(): unknown
  listModels(provider: string): Promise<unknown>
  stream(options: unknown): AsyncIterable<unknown>
}

export interface FileService {
  resolve(path: string, options?: { cwd?: string }): Promise<unknown>
  readBytes(target: unknown, encoding?: unknown, maxBytes?: number): Promise<Uint8Array>
  readText(target: unknown): Promise<string>
  writeText(target: unknown, content: string): Promise<void>
}

export interface StorageTable<Key, RecordValue> {
  get(key: Key): unknown
  put(key: Key, value: RecordValue): void | Promise<void>
  delete(key: Key): void | Promise<void>
  entries(): Iterable<[unknown, unknown]>
}

export interface StorageDomainHandle {
  table(name: 'articles'): StorageTable<string, CacheRecord>
  table(name: 'stats'): StorageTable<string, CalibrationRecord>
  close(): void | Promise<void>
}

export interface StorageDomainService {
  open(spec: unknown): Promise<StorageDomainHandle>
}

export interface WebFetchResult {
  statusCode: number
  body?: { kind?: string; content?: string }
}

export interface WebService {
  fetch(options: { url: string }): Promise<WebFetchResult>
}

export interface JobController {
  signal?: AbortLike
  progress?(line: string): void
  update?(value: unknown): void
}

export interface JobsService {
  start(options: Record<string, unknown>): Promise<string>
}

export interface WebServerService {
  register(route: {
    kind: 'exact'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): Promise<void>
  }): () => void
}

export interface SkillRegistration {
  name: string
  description: string
  content: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  source: 'bundled'
  resourceBase: { kind: 'directory'; path: string }
}

export interface SkillsService {
  register(skill: SkillRegistration): () => void
}

export interface HostInjectionFiber {
  dispose(): void | Promise<void>
}

export interface ToolLike {
  name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
  [key: string]: unknown
}

export interface HostContext {
  fs?: unknown
  llm?: unknown
  tools: { register(tool: ToolLike): () => void }
  skills?: SkillsService
  webServer?: WebServerService
  storageDomain?: StorageDomainService
  effect(register: () => void | (() => void | Promise<void>)): void
  inject?(
    dependencies: readonly string[],
    callback: (ctx: HostContext) => void,
  ): HostInjectionFiber
  get(name: 'web'): WebService | undefined
  get(name: 'webServer'): WebServerService | undefined
  get(name: 'storageDomain'): StorageDomainService | undefined
  get(name: 'jobs'): JobsService | undefined
  get(name: 'agentDefaultModel'): { currentSelection(): unknown } | undefined
  get(name: string): unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isHostContext(value: unknown): value is HostContext {
  if (!isRecord(value) || !isRecord(value.tools)) return false
  const fileServiceValid = value.fs === undefined || isRecord(value.fs)
  const llmServiceValid = value.llm === undefined || isRecord(value.llm)
  return fileServiceValid && llmServiceValid
    && typeof value.effect === 'function'
    && typeof value.get === 'function'
    && typeof value.tools.register === 'function'
}

export function isBinaryFileService(value: unknown): value is Pick<FileService, 'resolve' | 'readBytes'> {
  return isRecord(value)
    && typeof value.resolve === 'function'
    && typeof value.readBytes === 'function'
}

export function isTextFileService(value: unknown): value is Pick<FileService, 'resolve' | 'readText'> {
  return isRecord(value)
    && typeof value.resolve === 'function'
    && typeof value.readText === 'function'
}

export function isFileWriter(value: unknown): value is Pick<FileService, 'resolve' | 'writeText'> {
  return isRecord(value)
    && typeof value.resolve === 'function'
    && typeof value.writeText === 'function'
}

export function isLlmCatalogService(value: unknown): value is Pick<LlmService, 'listProviders' | 'listModels'> {
  return isRecord(value)
    && typeof value.listProviders === 'function'
    && typeof value.listModels === 'function'
}

export function isLlmStreamService(value: unknown): value is Pick<LlmService, 'stream'> {
  return isRecord(value)
    && typeof value.stream === 'function'
}

export function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error)
}
