// DeepRead 精读助手 — Node half（官方 bundle 插件 Cordis entry）
// 依赖 @deepseek-ai/* 与 zod 由宿主 profile 树提供（见 package.json peerDependencies）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

export const Config = Schema.object({
  timeoutMs: Schema.number().default(900000),
  chunkChars: Schema.number().default(6000),
  maxParts: Schema.number().default(20),
  maxInputChars: Schema.number().default(400000),
  cacheEnabled: Schema.boolean().default(true),
  cacheTtlHours: Schema.number().default(168),
  // 0 = 未显式配置：估算自动按当前模型族默认速率（仅当尚无运行时实测校准时）；>0 显式覆盖。
  estTokensPerSecond: Schema.number().default(0),
  estLatencyPerCallMs: Schema.number().default(0),
  backgroundMinChars: Schema.number().default(9000),
})

// URL 抓取全文缓存领域声明：与官方 workspaceDomainSpec 同构——zod schema 即
// 持久化边界校验，defineDomain 声明领域身份/版本/表；落盘到 $DSH_HOME/storages/。
const urlCacheRecord = z.object({
  url: z.string(),
  text: z.string(),
  fetchedAt: z.string(), // ISO-8601
})

const deepreadCacheDomainSpec = defineDomain({
  name: 'deepread_url_cache',
  version: 1,
  tables: { articles: domainTable(z.string(), urlCacheRecord) },
})

// 运行时自校准领域：滚动平均（指数加权）的实测速率/延迟，跨进程持久。
// 数值 schema 用 z.number()；宿主若只有精简 zod shim（如测试）则降级为 z.string() 占位（schema 仅用于后端校验，不参与测试断言）。
const statsNumSchema = typeof z.number === 'function' ? z.number() : z.string()
const statsRecord = z.object({
  rateTokPerSec: statsNumSchema,
  latencyMs: statsNumSchema,
  calls: statsNumSchema,
  updatedAt: z.string(), // ISO-8601
})

const deepreadStatsDomainSpec = defineDomain({
  name: 'deepread_stats',
  version: 1,
  tables: { stats: domainTable(z.string(), statsRecord) },
})

export const name = 'deepread'
// webServer 为硬依赖：面板直调 API 依赖它，且必须等它就绪后 apply 才注册路由，
// 否则可选获取会因服务时序静默跳过注册（面板收到 404）。
export const inject = ['fs', 'llm', 'tools', 'web', 'agentDefaultModel', 'sandboxPolicy', 'webServer']

export function apply(ctx, config) {
  const cfg = config !== null && typeof config === 'object' ? config : {}
  const tune = {
    timeoutMs: num(cfg.timeoutMs, 900000),
    chunkChars: num(cfg.chunkChars, 6000),
    maxParts: num(cfg.maxParts, 20),
    maxInputChars: num(cfg.maxInputChars, 400000),
    cacheEnabled: typeof cfg.cacheEnabled === 'boolean' ? cfg.cacheEnabled : true,
    cacheTtlHours: typeof cfg.cacheTtlHours === 'number' && Number.isFinite(cfg.cacheTtlHours) && cfg.cacheTtlHours >= 0 ? cfg.cacheTtlHours : 168,
    estTokensPerSecond: num(cfg.estTokensPerSecond, 0),
    estLatencyPerCallMs: num(cfg.estLatencyPerCallMs, 0),
    backgroundMinChars: num(cfg.backgroundMinChars, 9000),
  }
  const CACHE_TTL_MS = tune.cacheTtlHours * 3600 * 1000
  const CACHE_MAX_ENTRIES = 200
  const CHUNK_CHARS = tune.chunkChars
  const MAX_PARTS = tune.maxParts
  const web = ctx.get('web')

  // ---- 运行时自校准：实测 tok/s 与首字延迟的指数加权滚动平均（apply 闭包内共享）。
  // 跨批次（batchFlow）同样通过 callModelJson 累计。首样本直接采用；之后 new = old*0.8 + sample*0.2。
  const calibration = { rateTokPerSec: null, latencyMs: null, calls: 0, updatedAt: null, loaded: false }
  // 每次 callModelJson 累计调用次数与总耗时，供 computeResult 计算 meta.stages（按差值归属到单次运行）。
  const llmCallStats = { calls: 0, ms: 0 }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v)
  }

  function calibratedRate() {
    return typeof calibration.rateTokPerSec === 'number' && Number.isFinite(calibration.rateTokPerSec) && calibration.rateTokPerSec > 0 ? calibration.rateTokPerSec : null
  }

  function calibratedLatency() {
    return typeof calibration.latencyMs === 'number' && Number.isFinite(calibration.latencyMs) && calibration.latencyMs > 0 ? calibration.latencyMs : null
  }

  // 冷启动默认速率：无实测校准、且用户未显式配置时，按当前所选模型族给基准值。
  // 运行时每次成功调用都会实测 tok/s 并指数加权覆盖（recordCalibration），默认值只在冷启动起作用。
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
  const DEFAULT_RATE_TOK_PER_SEC = 100
  const DEFAULT_LATENCY_MS = 800

  function modelRateDefaults() {
    const sel = selectedModel()
    const id = sel !== null && typeof sel.model === 'string' ? sel.model.toLowerCase() : ''
    for (const d of MODEL_RATE_DEFAULTS) {
      if (d.match.test(id)) return { rate: d.rate, latency: d.latency }
    }
    return { rate: DEFAULT_RATE_TOK_PER_SEC, latency: DEFAULT_LATENCY_MS }
  }

  function effectiveRate() {
    const r = calibratedRate()
    if (r !== null) return r
    if (tune.estTokensPerSecond > 0) return tune.estTokensPerSecond
    return modelRateDefaults().rate
  }

  function effectiveLatency() {
    const l = calibratedLatency()
    if (l !== null) return l
    if (tune.estLatencyPerCallMs > 0) return tune.estLatencyPerCallMs
    return modelRateDefaults().latency
  }

  let statsTablePromise = null
  function getStatsTable() {
    if (statsTablePromise === null) {
      statsTablePromise = (async () => {
        const storageDomain = ctx.get('storageDomain')
        if (storageDomain === undefined || typeof storageDomain.open !== 'function') return null
        try {
          const domain = await storageDomain.open(deepreadStatsDomainSpec)
          return domain.table('stats')
        } catch (err) {
          return null // 存储后端不可用：仅保留进程内校准
        }
      })()
    }
    return statsTablePromise
  }

  async function loadCalibration() {
    if (calibration.loaded) return
    calibration.loaded = true
    const table = await getStatsTable()
    if (table === null) return
    try {
      const rec = table.get('default')
      if (rec !== undefined && rec !== null && typeof rec.rateTokPerSec === 'number' && rec.rateTokPerSec > 0) {
        calibration.rateTokPerSec = rec.rateTokPerSec
        calibration.latencyMs = typeof rec.latencyMs === 'number' && rec.latencyMs > 0 ? rec.latencyMs : null
        calibration.calls = typeof rec.calls === 'number' ? rec.calls : 0
        calibration.updatedAt = typeof rec.updatedAt === 'string' ? rec.updatedAt : null
      }
    } catch (err) { /* 读取失败：忽略 */ }
  }

  async function persistCalibration() {
    const table = await getStatsTable()
    if (table === null) return
    try {
      await table.put('default', {
        rateTokPerSec: calibration.rateTokPerSec,
        latencyMs: calibration.latencyMs === null ? 800 : calibration.latencyMs,
        calls: calibration.calls,
        updatedAt: calibration.updatedAt === null ? new Date().toISOString() : calibration.updatedAt,
      })
    } catch (err) { /* 写回失败：仅保留内存校准 */ }
  }

  function recordCalibration(rateTokPerSec, latencyMs) {
    if (!Number.isFinite(rateTokPerSec) || rateTokPerSec <= 0) return
    const lat = Number.isFinite(latencyMs) && latencyMs > 0 ? clamp(latencyMs, 50, 5000) : 800
    calibration.calls++
    calibration.rateTokPerSec = calibration.rateTokPerSec === null ? rateTokPerSec : calibration.rateTokPerSec * 0.8 + rateTokPerSec * 0.2
    calibration.latencyMs = calibration.latencyMs === null ? lat : calibration.latencyMs * 0.8 + lat * 0.2
    calibration.updatedAt = new Date().toISOString()
    void persistCalibration()
  }

  // ---- URL 缓存：优先 storageDomain（官方领域 KV，跨进程持久），
  // 服务缺失（如 headless profile 未挂 storage 组合包）时降级为进程内 Map。
  const memCache = new Map()
  let domainHandle = null
  let cacheTablePromise = null
  ctx.effect(() => () => { if (domainHandle !== null) void domainHandle.close() })

  function getCacheTable() {
    if (cacheTablePromise === null) {
      cacheTablePromise = (async () => {
        const storageDomain = ctx.get('storageDomain')
        if (storageDomain === undefined || typeof storageDomain.open !== 'function') return null
        try {
          const domain = await storageDomain.open(deepreadCacheDomainSpec)
          domainHandle = domain
          return domain.table('articles')
        } catch (err) {
          return null // 存储后端不可用：降级为进程内缓存，不影响精读主流程
        }
      })()
    }
    return cacheTablePromise
  }

  function isStale(fetchedAt) {
    const t = Date.parse(fetchedAt)
    // >= 保证 TTL=0（等效不缓存）在毫秒精度下也是确定过期的
    return !Number.isFinite(t) || Date.now() - t >= CACHE_TTL_MS
  }

  async function readCacheEntry(url, ignoreTtl) {
    const table = await getCacheTable()
    if (table === null) {
      const rec = memCache.get(url)
      if (rec === undefined) return null
      return ignoreTtl !== true && isStale(rec.fetchedAt) ? null : rec
    }
    const rec = table.get(url)
    if (rec === undefined) return null
    if (ignoreTtl !== true && isStale(rec.fetchedAt)) {
      try { await table.delete(url) } catch (err) { /* 过期清理失败无碍 */ }
      return null
    }
    return rec
  }

  async function writeCacheEntry(url, text) {
    const rec = { url, text, fetchedAt: new Date().toISOString() }
    const table = await getCacheTable()
    if (table === null) {
      memCache.set(url, rec)
      return
    }
    try {
      await table.put(url, rec)
      // 过期清理 + 数量上限（entries() 是内存快照，安全迭代）
      const expired = []
      let kept = []
      for (const [k, v] of table.entries()) {
        if (isStale(v.fetchedAt)) expired.push(k)
        else kept.push({ key: k, fetchedAt: v.fetchedAt })
      }
      for (const k of expired) { try { await table.delete(k) } catch (err) { /* 清理失败无碍 */ } }
      if (kept.length > CACHE_MAX_ENTRIES) {
        kept.sort((a, b) => (a.fetchedAt < b.fetchedAt ? -1 : 1))
        for (const item of kept.slice(0, kept.length - CACHE_MAX_ENTRIES)) {
          try { await table.delete(item.key) } catch (err) { /* 清理失败无碍 */ }
        }
      }
    } catch (err) {
      // 缓存写入失败不影响主流程：静默降级
    }
  }

  function str(v, fallback) {
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
  }

  function num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
  }

  function arr(v) {
    if (Array.isArray(v)) return v
    if (typeof v === 'string' && v.trim() !== '') return [v.trim()]
    return []
  }

  // 修复模型 JSON 的经典毛病：字符串内未转义的换行/回车/Tab
  function repairJson(text) {
    let out = ''
    let inStr = false
    let esc = false
    for (const ch of String(text)) {
      if (esc) { out += ch; esc = false; continue }
      if (ch === '\\') { out += ch; esc = true; continue }
      if (ch === '"') { inStr = !inStr; out += ch; continue }
      if (inStr) {
        if (ch === '\n') { out += '\\n'; continue }
        if (ch === '\r') { out += '\\r'; continue }
        if (ch === '\t') { out += '\\t'; continue }
      }
      out += ch
    }
    return out
  }

  function parseJson(text) {
    let cleaned = String(text).trim()
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const attempts = [cleaned]
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) attempts.push(cleaned.slice(start, end + 1))
    for (const raw of attempts) {
      const repaired = repairJson(raw)
      for (const candidate of [raw, repaired, raw.replace(/,\s*([}\]])/g, '$1'), repaired.replace(/,\s*([}\]])/g, '$1')]) {
        try { return JSON.parse(candidate) } catch (error) { /* keep going */ }
      }
    }
    return null
  }

  function splitChunks(text, size) {
    const paras = String(text).split(/\n{2,}|\r\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    const chunks = []
    let current = ''
    for (const para of paras) {
      if (para.length > size) {
        if (current.trim() !== '') { chunks.push(current.trim()); current = '' }
        let rest = para
        while (rest.length > size) {
          let cut = rest.slice(0, size)
          let found = -1
          for (let k = cut.length - 1; k > Math.floor(size * 0.5); k--) {
            const ch = cut[k]
            if (ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '.' || ch === '!' || ch === '?' || ch === ';') { found = k + 1; break }
          }
          if (found > 0) cut = cut.slice(0, found)
          chunks.push(cut.trim())
          rest = rest.slice(cut.length)
        }
        if (rest.trim() !== '') current = rest.trim()
      } else if ((current === '' ? 0 : current.length + 2) + para.length > size) {
        chunks.push(current.trim())
        current = para
      } else {
        current = current === '' ? para : current + '\n\n' + para
      }
    }
    if (current.trim() !== '') chunks.push(current.trim())
    return chunks
  }

  function selectedModel() {
    const sel = ctx.get('agentDefaultModel')
    if (sel !== undefined && typeof sel.currentSelection === 'function') {
      const s = sel.currentSelection()
      if (s !== null && typeof s === 'object' && typeof s.provider === 'string' && typeof s.model === 'string') {
        return { provider: s.provider, model: s.model, reasoningEffort: s.reasoningEffort }
      }
    }
    return null
  }

  async function pickConfig() {
    const cfg = selectedModel()
    if (cfg !== null) return cfg
    const providers = ctx.llm.listProviders()
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error('没有可用的模型 Provider，无法执行精读分析')
    }
    const first = providers[0]
    const models = await ctx.llm.listModels(first.id)
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error('Provider "' + first.id + '" 下没有可用模型')
    }
    return { provider: first.id, model: models[0].id }
  }

  async function callModel(cfg, system, userText, maxTokens, signal) {
    const options = {
      provider: cfg.provider,
      model: cfg.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      temperature: 0.2,
      maxTokens,
    }
    // 不转发 reasoningEffort：结构化 JSON 输出不需要长思考，推理会吃光小输出预算导致空结果
    let text = ''
    let failure = null
    for await (const chunk of ctx.llm.stream(options)) {
      if (signal !== undefined && signal !== null && signal.aborted) throw new Error('任务已取消')
      if (chunk === null || chunk === undefined) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (chunk.type === 'finish') {
        const reason = chunk.reason
        if (reason !== null && typeof reason === 'object' && (reason.kind === 'error' || reason.kind === 'aborted')) {
          const f = reason.failure
          failure = f !== null && typeof f === 'object' ? str(f.message, str(f.code, '模型调用失败')) : '模型调用失败'
        }
      }
    }
    if (failure !== null) throw new Error('模型调用失败：' + failure)
    if (text.trim() === '') throw new Error('模型返回了空结果')
    return text
  }

  // 判定输出是否被 token 预算截断：JSON 解析失败且文本未正常闭合（对象/数组中途断开）。
  function looksTruncated(text) {
    const t = String(text).trim()
    if (t === '') return false
    const last = t[t.length - 1]
    return last !== '}' && last !== ']'
  }

  // 带重试的 JSON 调用：按失败类型分类重试。底层错误（上游失败、空结果）与
  // 截断输出会逐步加大输出预算（×1.5，硬顶 16000），纯格式问题用校正提示
  // 同预算重试；最终失败时保留每个 attempt 的真实原因，不做无信息的吞没。
  async function callModelJson(cfg, system, userText, maxTokens, signal) {
    const MAX_BUDGET = 16000
    let prompt = userText
    let budget = maxTokens
    const history = []
    const callStarted = Date.now()
    for (let attempt = 0; attempt < 3; attempt++) {
      let text = ''
      let error = null
      const t0 = Date.now()
      try {
        text = await callModel(cfg, system, prompt, budget, signal)
        // 运行时自校准：实测吞吐与首字延迟（估计），仅对成功调用采样。
        const elapsedMs = Math.max(1, Date.now() - t0)
        const tokens = estimateTokens(text)
        const seconds = elapsedMs / 1000
        if (text.trim() !== '' && tokens > 0) {
          const rateTokPerSec = tokens / seconds
          // latency ≈ 耗时 - 生成耗时（产出 token ÷ 速率），夹在 50..5000ms
          const generationMs = rateTokPerSec > 0 ? (tokens / rateTokPerSec) * 1000 : elapsedMs
          recordCalibration(rateTokPerSec, elapsedMs - generationMs)
        }
      } catch (err) {
        error = err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err)
      }
      const parsed = error === null ? parseJson(text) : null
      history.push({ text, error })
      if (parsed !== null) {
        llmCallStats.calls++
        llmCallStats.ms += Date.now() - callStarted
        return parsed
      }
      const truncated = error === null && looksTruncated(text)
      if (error !== null || truncated) {
        budget = Math.min(Math.ceil(budget * 1.5), MAX_BUDGET)
      }
      if (error !== null) {
        prompt = userText + '\n\n[系统校正] 上一次调用失败（' + error + '），已加大输出预算。请重新只输出一个合法的 JSON 对象：不要任何解释或额外文字。'
      } else if (truncated) {
        prompt = userText + '\n\n[系统校正] 你上一次的输出在 JSON 中途被截断（输出预算不足）。请大幅压缩篇幅——arguments 最多 6 条、quotes 最多 4 条、concepts 最多 5 条、questions 最多 4 条，每条只写一句话——并输出完整闭合的 JSON 对象，末尾以 } 结束。'
      } else {
        prompt = userText + '\n\n[系统校正] 你上一次的输出无法解析为 JSON（可能混入了解释文字、Markdown 围栏、尾随逗号，或字符串内直接换行）。请重新只输出一个合法的 JSON 对象：不要任何解释或额外文字，字符串内不要直接换行（多行文本用 \\n 转义），引号正确转义，末尾不要有逗号。'
      }
    }
    llmCallStats.calls++
    llmCallStats.ms += Date.now() - callStarted
    const kinds = history.map((h) => {
      if (h.error !== null) return '底层错误（' + h.error + '）'
      if (looksTruncated(h.text)) return '输出被截断'
      if (String(h.text).trim() === '') return '空输出'
      return 'JSON 解析失败'
    })
    const tail = String(history[history.length - 1].text).trim()
    const shown = tail.length > 160 ? tail.slice(-160) : tail
    throw new Error('模型输出 3 次均未得到合法 JSON：' + kinds.join('；') + (shown === '' ? '' : '。末次输出尾部：' + shown))
  }

  // ---------- PDF 文本提取（纯 JS：inflate + ToUnicode） ----------
  function bytesToLatin1(bytes) {
    let s = ''
    const CH = 32768
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)))
    }
    return s
  }

  function latin1ToBytes(s) {
    const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff
    return bytes
  }

  function inflateRaw(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    let pos = 0
    let bitBuf = 0
    let bitCnt = 0
    const out = []
    function readBits(n) {
      while (bitCnt < n) {
        if (pos >= bytes.length) throw new Error('inflate: unexpected EOF')
        bitBuf |= bytes[pos++] << bitCnt
        bitCnt += 8
      }
      const v = bitBuf & ((1 << n) - 1)
      bitBuf >>>= n
      bitCnt -= n
      return v
    }
    const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
    const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
    const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
    const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
    const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
    function buildHuffman(lengths) {
      const maxLen = Math.max.apply(null, lengths)
      const blCount = new Array(maxLen + 1).fill(0)
      for (const l of lengths) if (l > 0) blCount[l]++
      let code = 0
      const nextCode = new Array(maxLen + 1).fill(0)
      for (let bits = 1; bits <= maxLen; bits++) {
        code = (code + blCount[bits - 1]) << 1
        nextCode[bits] = code
      }
      const table = {}
      for (let sym = 0; sym < lengths.length; sym++) {
        const len = lengths[sym]
        if (len === 0) continue
        const c = nextCode[len]++
        table[len + ':' + c.toString(2).padStart(len, '0')] = sym
      }
      return table
    }
    function decodeSym(table, maxLen) {
      let code = 0
      for (let len = 1; len <= maxLen; len++) {
        code = (code << 1) | readBits(1)
        const hit = table[len + ':' + code.toString(2).padStart(len, '0')]
        if (hit !== undefined) return hit
      }
      throw new Error('inflate: invalid huffman code')
    }
    function fixedLitTable() {
      const lengths = []
      for (let i = 0; i < 144; i++) lengths.push(8)
      for (let i = 144; i < 256; i++) lengths.push(9)
      for (let i = 256; i < 280; i++) lengths.push(7)
      for (let i = 280; i < 288; i++) lengths.push(8)
      return buildHuffman(lengths)
    }
    function fixedDistTable() {
      return buildHuffman(new Array(30).fill(5))
    }
    let litTable = null
    let distTable = null
    let finalBlock = false
    function decodeBlock() {
      for (;;) {
        const sym = decodeSym(litTable, 15)
        if (sym < 256) {
          out.push(sym)
        } else if (sym === 256) {
          return
        } else {
          const lenIdx = sym - 257
          if (lenIdx < 0 || lenIdx >= LEN_BASE.length) throw new Error('inflate: bad length symbol')
          const length = LEN_BASE[lenIdx] + readBits(LEN_EXTRA[lenIdx])
          const distSym = decodeSym(distTable, 15)
          if (distSym < 0 || distSym >= DIST_BASE.length) throw new Error('inflate: bad distance symbol')
          const dist = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym])
          const start = out.length - dist
          if (start < 0) throw new Error('inflate: distance too far back')
          for (let i = 0; i < length; i++) out.push(out[start + i])
        }
      }
    }
    while (!finalBlock) {
      finalBlock = readBits(1) === 1
      const btype = readBits(2)
      if (btype === 0) {
        readBits(bitCnt & 7)
        const len = bytes[pos] | (bytes[pos + 1] << 8)
        const nlen = bytes[pos + 2] | (bytes[pos + 3] << 8)
        pos += 4
        if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored block len mismatch')
        for (let i = 0; i < len; i++) out.push(bytes[pos++])
      } else if (btype === 1) {
        litTable = fixedLitTable()
        distTable = fixedDistTable()
        decodeBlock()
      } else if (btype === 2) {
        const hlit = readBits(5) + 257
        const hdist = readBits(5) + 1
        const hclen = readBits(4) + 4
        const clLengths = new Array(19).fill(0)
        for (let i = 0; i < hclen; i++) clLengths[CLEN_ORDER[i]] = readBits(3)
        const clTable = buildHuffman(clLengths)
        const lengths = []
        while (lengths.length < hlit + hdist) {
          const sym = decodeSym(clTable, 7)
          if (sym < 16) lengths.push(sym)
          else if (sym === 16) {
            const prev = lengths[lengths.length - 1]
            const rep = 3 + readBits(2)
            for (let i = 0; i < rep; i++) lengths.push(prev)
          } else if (sym === 17) {
            const rep = 3 + readBits(3)
            for (let i = 0; i < rep; i++) lengths.push(0)
          } else if (sym === 18) {
            const rep = 11 + readBits(7)
            for (let i = 0; i < rep; i++) lengths.push(0)
          } else throw new Error('inflate: bad code length symbol')
        }
        if (lengths.length > hlit + hdist) lengths.length = hlit + hdist
        litTable = buildHuffman(lengths.slice(0, hlit))
        distTable = buildHuffman(lengths.slice(hlit))
        decodeBlock()
      } else {
        throw new Error('inflate: reserved block type')
      }
    }
    return new Uint8Array(out)
  }

  function inflateZlib(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    if (bytes.length < 2) throw new Error('zlib: too short')
    const cmf = bytes[0]
    const flg = bytes[1]
    if ((cmf & 0x0f) !== 8) throw new Error('zlib: not deflate')
    if (((cmf << 8) | flg) % 31 !== 0) throw new Error('zlib: bad header')
    let offset = 2
    if ((flg & 0x20) !== 0) offset += 4
    return inflateRaw(bytes.slice(offset))
  }

  function decodePdfString(raw) {
    let out = ''
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c === '\\') {
        const n = raw[i + 1]
        if (n === undefined) { out += '\\'; break }
        if (n === 'n') out += '\n'
        else if (n === 'r') out += '\r'
        else if (n === 't') out += '\t'
        else if (n === 'b') out += '\b'
        else if (n === 'f') out += '\f'
        else if (n === '(' || n === ')' || n === '\\') out += n
        else if (n >= '0' && n <= '7') {
          let oct = n
          let j = i + 2
          while (j < raw.length && j < i + 4 && raw[j] >= '0' && raw[j] <= '7') { oct += raw[j]; j++ }
          out += String.fromCharCode(parseInt(oct, 8) & 0xff)
          i = j - 1
        } else { out += n }
        i++
      } else { out += c }
    }
    return out
  }

  function findStreamEnd(body, startIdx) {
    const iEnd = body.indexOf('endstream', startIdx)
    if (iEnd === -1) return { end: -1, data: '' }
    let dataStart = startIdx
    if (body[startIdx] === '\r' && body[startIdx + 1] === '\n') dataStart = startIdx + 2
    else if (body[startIdx] === '\n') dataStart = startIdx + 1
    let dataEnd = iEnd
    if (body[dataEnd - 1] === '\n') dataEnd--
    if (body[dataEnd - 1] === '\r') dataEnd--
    return { end: iEnd + 'endstream'.length, data: body.slice(dataStart, dataEnd) }
  }

  function decodeStreamData(streamData, filters) {
    let data = streamData
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i]
      if (f === 'FlateDecode' || f === 'Fl') {
        data = bytesToLatin1(inflateZlib(latin1ToBytes(data)))
      } else if (f === 'ASCIIHexDecode' || f === 'AHx') {
        let hex = data.replace(/[^0-9a-fA-F]/g, '')
        if (hex.length % 2 === 1) hex += '0'
        let out = ''
        for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16))
        data = out
      } else if (f === 'ASCII85Decode' || f === 'A85') {
        const clean = data.replace(/\s/g, '')
        let out = ''
        let i2 = 0
        const endMark = clean.indexOf('~>')
        const src = endMark >= 0 ? clean.slice(0, endMark) : clean
        while (i2 < src.length) {
          let chunk = src.slice(i2, i2 + 5)
          i2 += 5
          const pad = 5 - chunk.length
          if (pad > 0) chunk += 'uuuu'.slice(0, pad)
          let val = 0
          for (const ch of chunk) {
            if (ch === 'z') { val = 0; break }
            const c2 = ch.charCodeAt(0) - 33
            if (c2 < 0 || c2 > 84) throw new Error('bad a85')
            val = val * 85 + c2
          }
          let b4 = ''
          for (let k = 3; k >= 0; k--) b4 += String.fromCharCode((val >> (k * 8)) & 0xff)
          out += b4.slice(0, 4 - pad)
        }
        data = out
      } else if (f !== '') {
        try { data = bytesToLatin1(inflateZlib(latin1ToBytes(data))) } catch (error) { /* keep as-is */ }
      }
    }
    return data
  }

  function extractTextOperations(content) {
    const runs = []
    let currentFont = null
    let newLine = false
    const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj|<((?:[0-9A-Fa-f\s]+))>\s*Tj|\[((?:[^\[\]\\]|\\.)*)\]\s*TJ|'((?:[^()\\]|\\.)*)'|"((?:[^()\\]|\\.)*)"|\/([A-Za-z0-9_+\-.]+)\s+[\d.]+\s+Tf|(T\*)|(Td)|(TD)/g
    let m
    while ((m = re.exec(content)) !== null) {
      if (m[1] !== undefined) {
        runs.push({ text: decodePdfString(m[1]), font: currentFont, gap: 0, br: newLine })
        newLine = false
      } else if (m[2] !== undefined) {
        const hex = m[2].replace(/\s+/g, '')
        const bytes = []
        for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
        let s = ''
        for (const b of bytes) s += String.fromCharCode(b)
        runs.push({ text: s, font: currentFont, gap: 0, br: newLine })
        newLine = false
      } else if (m[3] !== undefined) {
        const inner = m[3]
        const parts = []
        const partRe = /\(((?:[^()\\]|\\.)*)\)|(<[0-9A-Fa-f\s]+>)|(-?\d+(?:\.\d+)?)/g
        let pm
        while ((pm = partRe.exec(inner)) !== null) {
          if (pm[1] !== undefined) parts.push({ text: decodePdfString(pm[1]) })
          else if (pm[2] !== undefined) {
            const clean = pm[2].replace(/[^0-9a-fA-F]/g, '')
            let s = ''
            for (let i = 0; i + 1 < clean.length; i += 2) s += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16))
            parts.push({ text: s })
          } else parts.push({ gap: parseFloat(pm[3]) })
        }
        let buf = ''
        let gapSum = 0
        for (const p of parts) {
          if (p.text !== undefined) buf += p.text
          else gapSum += p.gap
        }
        if (buf.length > 0) runs.push({ text: buf, font: currentFont, gap: gapSum, br: newLine })
        newLine = false
      } else if (m[4] !== undefined) {
        newLine = true
        runs.push({ text: decodePdfString(m[4]), font: currentFont, gap: 0, br: newLine })
        newLine = false
      } else if (m[5] !== undefined) {
        newLine = true
        runs.push({ text: decodePdfString(m[5]), font: currentFont, gap: 0, br: newLine })
        newLine = false
      } else if (m[6] !== undefined) {
        currentFont = m[6]
      } else if (m[7] !== undefined || m[8] !== undefined || m[9] !== undefined) {
        newLine = true
      }
    }
    return runs
  }

  function hexToStr(hex) {
    let h = hex
    if (h.length % 2 === 1) h += '0'
    const bytes = []
    for (let i = 0; i + 1 < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16))
    let s = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return s
  }

  function parseCmap(cmapText) {
    const map = {}
    let twoByte = false
    const key = (num, width) => num.toString(16).toUpperCase().padStart(width, '0')
    const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g
    let m
    while ((m = bfcharRe.exec(cmapText)) !== null) {
      const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
      let p
      while ((p = pairRe.exec(m[1])) !== null) {
        if (p[1].length > 2) twoByte = true
        map[p[1].toUpperCase()] = hexToStr(p[2])
      }
    }
    const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g
    while ((m = bfrangeRe.exec(cmapText)) !== null) {
      const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g
      let p
      while ((p = rangeRe.exec(m[1])) !== null) {
        const lo = parseInt(p[1], 16)
        const hi = parseInt(p[2], 16)
        const width = p[1].length
        if (width > 2) twoByte = true
        if (p[3] !== undefined) {
          const target = p[3]
          if (target.length === width) {
            let t = parseInt(target, 16)
            for (let c = lo; c <= hi; c++) {
              map[key(c, width)] = hexToStr(t.toString(16).toUpperCase().padStart(width, '0'))
              t++
            }
          } else if (target.length < width) {
            const prefixHex = target.slice(0, Math.max(0, target.length - 2))
            for (let c = lo; c <= hi; c++) {
              const lastByte = (c & 0xff).toString(16).toUpperCase().padStart(2, '0')
              map[key(c, width)] = hexToStr(prefixHex + lastByte)
            }
          }
        } else if (p[4] !== undefined) {
          const entries = p[4].trim().split(/\s+/).filter(Boolean)
          for (let c = lo; c <= hi && c - lo < entries.length; c++) {
            map[key(c, width)] = hexToStr(entries[c - lo].replace(/[<>]/g, ''))
          }
        }
      }
    }
    return { map, twoByte }
  }

  // 解析 PDF 结构（xref/ObjStm/页树），返回页对象编号与后续单页提取所需的对象解析闭包。
  function collectPageNums(latin1) {
    const objects = {}
    const objRe = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g
    let m
    while ((m = objRe.exec(latin1)) !== null) {
      objects[m[1]] = m[3]
    }

    // ---------- 交叉引用解析（经典 xref 表 / XRef 交叉引用流 / ObjStm 对象流） ----------
    function undoPredictor(data, predictor, columns) {
      const bytes = latin1ToBytes(data)
      if (predictor === 2) {
        // TIFF 预测：每字节加上同列上一行，无 filter 字节
        const out = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) {
          out[i] = i >= columns ? (bytes[i] + out[i - columns]) & 0xff : bytes[i]
        }
        return bytesToLatin1(out)
      }
      // PNG 预测（10–15）：每行开头 1 字节 filter 类型，行宽 columns
      const stride = columns + 1
      const rowCount = Math.floor(bytes.length / stride)
      const out = new Uint8Array(rowCount * columns)
      for (let row = 0; row < rowCount; row++) {
        const f = bytes[row * stride]
        for (let j = 0; j < columns; j++) {
          const x = bytes[row * stride + 1 + j]
          const left = j > 0 ? out[row * columns + j - 1] : 0
          const above = row > 0 ? out[(row - 1) * columns + j] : 0
          const ul = row > 0 && j > 0 ? out[(row - 1) * columns + j - 1] : 0
          let v
          if (f === 1) v = x + left
          else if (f === 2) v = x + above
          else if (f === 3) v = x + ((left + above) >> 1)
          else if (f === 4) {
            const p = left + above - ul
            const pa = Math.abs(p - left)
            const pb = Math.abs(p - above)
            const pc = Math.abs(p - ul)
            v = x + (pa <= pb && pa <= pc ? left : pb <= pc ? above : ul)
          } else v = x
          out[row * columns + j] = v & 0xff
        }
      }
      return bytesToLatin1(out)
    }

    function extractFilters(dictPart) {
      const filters = []
      const f1 = dictPart.match(/\/Filter\s*\[([^\]]*)\]/)
      const f2 = dictPart.match(/\/Filter\s*\/([A-Za-z0-9_+.\-]+)/)
      if (f1) {
        for (const f of f1[1].split('/')) {
          const name = f.trim()
          if (name) filters.push(name)
        }
      } else if (f2) filters.push(f2[1])
      return filters
    }

    function parseObjectBody(raw) {
      const sIdx = raw.indexOf('stream')
      if (sIdx >= 0) {
        const dictPart = raw.slice(0, sIdx)
        const after = raw.slice(sIdx + 'stream'.length)
        const { data } = findStreamEnd(after, 0)
        return { dict: dictPart, stream: data, filters: extractFilters(dictPart) }
      }
      return { dict: raw, stream: null, filters: [] }
    }

    function parseXrefStreamEntries(node) {
      const entries = new Map()
      const dict = node.dict
      const wMatch = dict.match(/\/W\s*\[([^\]]*)\]/)
      if (!wMatch || node.stream === null) return entries
      const w = wMatch[1].trim().split(/\s+/).map((x) => parseInt(x, 10))
      const sizeMatch = dict.match(/\/Size\s+(\d+)/)
      const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0
      let indexPairs
      const indexMatch = dict.match(/\/Index\s*\[([^\]]*)\]/)
      if (indexMatch) {
        const nums = indexMatch[1].trim().split(/\s+/).map((x) => parseInt(x, 10))
        indexPairs = []
        for (let i = 0; i + 1 < nums.length; i += 2) indexPairs.push([nums[i], nums[i + 1]])
      } else {
        indexPairs = [[0, size]]
      }
      let decoded = decodeStreamData(node.stream, node.filters)
      const dpMatch = dict.match(/\/DecodeParms\s*<<([\s\S]*?)>>/)
      if (dpMatch) {
        const pm = dpMatch[1].match(/\/Predictor\s+(\d+)/)
        const cm = dpMatch[1].match(/\/Columns\s+(\d+)/)
        if (pm && parseInt(pm[1], 10) >= 2) decoded = undoPredictor(decoded, parseInt(pm[1], 10), cm ? parseInt(cm[1], 10) : 1)
      }
      const rowLen = (w[0] || 0) + (w[1] || 0) + (w[2] || 0)
      if (rowLen === 0) return entries
      const bytes = latin1ToBytes(decoded)
      let p = 0
      for (const pair of indexPairs) {
        const first = pair[0]
        const count = pair[1]
        for (let i = 0; i < count; i++) {
          if (p + rowLen > bytes.length) return entries
          const row = bytes.subarray(p, p + rowLen)
          p += rowLen
          let q = 0
          const read = (len) => { let v = 0; for (let k = 0; k < len; k++) v = v * 256 + row[q + k]; q += len; return v }
          const type = w[0] > 0 ? read(w[0]) : 1
          const f2 = w[1] > 0 ? read(w[1]) : 0
          const f3 = w[2] > 0 ? read(w[2]) : 0
          if (type !== 0) entries.set(first + i, { type, f2, f3 })
        }
      }
      return entries
    }

    function loadRawByOffset(num, offset) {
      const head = latin1.slice(offset, offset + 48).match(/^\s*(\d+)\s+(\d+)\s+obj\b/)
      if (!head || head[1] !== String(num)) return null
      const bodyStart = offset + head[0].length
      const seg = latin1.slice(bodyStart)
      const nextObj = seg.search(/[\r\n]\s*\d+\s+\d+\s+obj\b/)
      let raw = nextObj === -1 ? seg : seg.slice(0, nextObj + 1)
      const eo = raw.lastIndexOf('endobj')
      if (eo >= 0) raw = raw.slice(0, eo)
      return raw
    }

    const xrefEntries = new Map()
    let trailerDict = ''
    const smAll = latin1.match(/startxref\s+(\d+)/g)
    if (smAll !== null && smAll.length > 0) {
      const xrefOffset = parseInt(smAll[smAll.length - 1].match(/(\d+)/)[1], 10)
      const at = latin1.slice(xrefOffset, xrefOffset + 16)
      if (/^\s*xref\b/.test(at)) {
        // 经典 xref 表：解析各 subsection 的 20 字节条目
        const tMatch = latin1.slice(xrefOffset).match(/[\s\S]*?trailer\b/)
        const tableText = tMatch ? tMatch[0].slice(0, -'trailer'.length) : latin1.slice(xrefOffset)
        let pos = 0
        const subHeaderRe = /(\d+)\s+(\d+)\s*[\r\n]+/g
        while (true) {
          subHeaderRe.lastIndex = pos
          const h = subHeaderRe.exec(tableText)
          if (h === null) break
          const first = parseInt(h[1], 10)
          const count = parseInt(h[2], 10)
          pos = h.index + h[0].length
          for (let i = 0; i < count; i++) {
            const line = tableText.slice(pos, pos + 20)
            pos += 20
            const em = line.match(/(\d{10})\s+(\d{5})\s+([nf])/)
            if (em === null) continue
            if (em[3] !== 'f') xrefEntries.set(first + i, { type: 1, f2: parseInt(em[1], 10), f3: parseInt(em[2], 10) })
          }
        }
        const tr = latin1.slice(xrefOffset).match(/trailer\s*(<<[\s\S]*?>>)/)
        if (tr) trailerDict = tr[1]
      } else if (at.match(/^\s*\d+\s+\d+\s+obj\b/)) {
        // XRef 交叉引用流（PDF 1.5+）：trailer 键就在流的字典里
        const headNumMatch = at.match(/^\s*(\d+)\s+\d+\s+obj\b/)
        if (headNumMatch) {
          const xrefNum = headNumMatch[1]
          let xrefNode = objects[xrefNum]
          if (xrefNode === undefined) xrefNode = loadRawByOffset(xrefNum, xrefOffset)
          if (xrefNode !== null && xrefNode !== undefined) {
            const node = parseObjectBody(xrefNode)
            for (const [k, v] of parseXrefStreamEntries(node)) xrefEntries.set(k, v)
            trailerDict = node.dict
          }
        }
      }
    }
    // 混合文件：经典 trailer 携带 /XRefStm 指向补充的交叉引用流
    if (trailerDict !== '') {
      const xsm = trailerDict.match(/\/XRefStm\s+(\d+)/)
      if (xsm) {
        const xoff = parseInt(xsm[1], 10)
        const hm = latin1.slice(xoff, xoff + 48).match(/^\s*(\d+)\s+\d+\s+obj\b/)
        if (hm && objects[hm[1]] !== undefined) {
          const node = parseObjectBody(objects[hm[1]])
          for (const [k, v] of parseXrefStreamEntries(node)) xrefEntries.set(k, v)
        }
      }
    }

    // ---------- ObjStm 对象流展开与对象解析 ----------
    const objstmObjects = {}
    const expandedStms = new Set()

    function expandObjStm(sn) {
      if (expandedStms.has(sn)) return
      expandedStms.add(sn)
      const node = getObject(sn)
      if (node === null || node.stream === null) return
      const nMatch = node.dict.match(/\/N\s+(\d+)/)
      const fMatch = node.dict.match(/\/First\s+(\d+)/)
      if (!nMatch || !fMatch) return
      const n = parseInt(nMatch[1], 10)
      const first = parseInt(fMatch[1], 10)
      let decoded = decodeStreamData(node.stream, node.filters)
      const dpMatch = node.dict.match(/\/DecodeParms\s*<<([\s\S]*?)>>/)
      if (dpMatch) {
        const pm = dpMatch[1].match(/\/Predictor\s+(\d+)/)
        const cm = dpMatch[1].match(/\/Columns\s+(\d+)/)
        if (pm && parseInt(pm[1], 10) >= 2) decoded = undoPredictor(decoded, parseInt(pm[1], 10), cm ? parseInt(cm[1], 10) : 1)
      }
      const head = decoded.slice(0, first)
      const toks = head.trim().split(/\s+/)
      const pairs = []
      for (let i = 0; i < n && i * 2 + 1 < toks.length; i++) {
        const num = parseInt(toks[i * 2], 10)
        const off = parseInt(toks[i * 2 + 1], 10)
        if (!Number.isNaN(num) && !Number.isNaN(off)) pairs.push([num, off])
      }
      for (let i = 0; i < pairs.length; i++) {
        const end = i + 1 < pairs.length ? first + pairs[i + 1][1] : decoded.length
        objstmObjects[pairs[i][0]] = decoded.slice(first + pairs[i][1], end)
      }
    }

    function getObject(num) {
      if (!num) return null
      let raw = objects[num]
      if (raw === undefined) raw = objstmObjects[num]
      if (raw === undefined) {
        const e = xrefEntries.get(Number(num))
        if (e !== undefined) {
          if (e.type === 1) {
            const r = loadRawByOffset(num, e.f2)
            if (r !== null) { objects[num] = r; raw = r }
          } else if (e.type === 2) {
            expandObjStm(e.f2)
            raw = objstmObjects[num]
          }
        }
      }
      if (raw === undefined) return null
      return parseObjectBody(raw)
    }

    // 预先展开所有对象流（Root / Pages / Fonts 等常驻其中）
    for (const e of xrefEntries.values()) {
      if (e.type === 2) expandObjStm(e.f2)
    }

    function resolveRef(dict, key) {
      const re = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R')
      const mm = dict.match(re)
      return mm ? mm[1] : null
    }
    function resolveMultiRef(dict, key) {
      const out = []
      const re = new RegExp('/' + key + '\\s*\\[([^\\]]*)\\]')
      const mm = dict.match(re)
      if (mm) {
        const refRe = /(\d+)\s+\d+\s+R/g
        let r
        while ((r = refRe.exec(mm[1])) !== null) out.push(r[1])
        return out
      }
      const single = resolveRef(dict, key)
      return single ? [single] : []
    }

    let rootNum = null
    if (trailerDict !== '') rootNum = resolveRef(trailerDict, 'Root')
    if (!rootNum) {
      const t = latin1.match(/trailer\s*(<<[\s\S]*?>>)/)
      if (t) rootNum = resolveRef(t[1], 'Root')
    }
    if (!rootNum) throw new Error('PDF 结构无法解析（找不到根对象）')

    const root = getObject(rootNum)
    const pagesNum = resolveRef(root.dict, 'Pages')
    if (!pagesNum) throw new Error('PDF 结构无法解析（找不到页树）')

    const pageNums = []
    const stack = [pagesNum]
    const visited = new Set()
    while (stack.length > 0) {
      const n = stack.pop()
      if (visited.has(n)) continue
      visited.add(n)
      const node = getObject(n)
      if (!node) continue
      const isPages = /\/Type\s*\/Pages\b/.test(node.dict)
      const isPage = /\/Type\s*\/Page\b/.test(node.dict)
      const kids = resolveMultiRef(node.dict, 'Kids')
      if (isPages) {
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
      } else if (isPage) {
        pageNums.push(n)
      }
    }
    if (pageNums.length === 0 && visited.size > 0) {
      for (const n of visited) {
        const node = getObject(n)
        if (node && /\/Type\s*\/Page\b/.test(node.dict)) pageNums.push(n)
      }
    }

    return { pageNums, getObject, resolveRef, resolveMultiRef }
  }

  // 对给定页对象编号逐页提取纯文本（共享：extractPdfText 与 extractPdfStats 复用）。
  function extractPageTexts(pageNums, getObject, resolveRef, resolveMultiRef, onPage) {
    const fontMaps = {}
    function getFontMap(fontRef) {
      if (!fontRef) return null
      if (fontMaps[fontRef] !== undefined) return fontMaps[fontRef]
      const fontObj = getObject(fontRef)
      let result = null
      if (fontObj) {
        const toUniNum = resolveRef(fontObj.dict, 'ToUnicode')
        if (toUniNum) {
          const cmapObj = getObject(toUniNum)
          if (cmapObj && cmapObj.stream !== null) {
            const decoded = decodeStreamData(cmapObj.stream, cmapObj.filters)
            result = parseCmap(decoded)
          }
        }
      }
      fontMaps[fontRef] = result
      return result
    }

    const pageTexts = []
    for (const pn of pageNums) {
      const page = getObject(pn)
      if (!page) continue
      let resDict = page.dict
      const resRef = resolveRef(page.dict, 'Resources')
      if (resRef) {
        const resObj = getObject(resRef)
        if (resObj) resDict = resObj.dict
      }
      const fontTags = {}
      const fontRes = resDict.match(/\/Font\s*<<([\s\S]*?)>>/)
      if (fontRes) {
        const pairRe = /\/([A-Za-z0-9_+\-.]+)\s+(\d+)\s+\d+\s+R/g
        let p
        while ((p = pairRe.exec(fontRes[1])) !== null) {
          fontTags[p[1]] = p[2]
        }
      }
      const contentRefs = resolveMultiRef(page.dict, 'Contents')
      let pageText = ''
      let lastGap = 0
      for (const cref of contentRefs) {
        const cobj = getObject(cref)
        if (!cobj || cobj.stream === null) continue
        const decoded = decodeStreamData(cobj.stream, cobj.filters)
        const runs = extractTextOperations(decoded)
        for (const run of runs) {
          let text = run.text
          const fref = run.font !== null ? fontTags[run.font] : null
          const fm = fref ? getFontMap(fref) : null
          if (fm && fm.map && Object.keys(fm.map).length > 0) {
            let mapped = ''
            const bytes = latin1ToBytes(text)
            let i = 0
            while (i < bytes.length) {
              const one = bytes[i].toString(16).toUpperCase().padStart(2, '0')
              if (fm.twoByte && i + 1 < bytes.length) {
                const two = one + bytes[i + 1].toString(16).toUpperCase().padStart(2, '0')
                if (fm.map[two] !== undefined) { mapped += fm.map[two]; i += 2; continue }
              }
              if (fm.map[one] !== undefined) mapped += fm.map[one]
              else mapped += String.fromCharCode(bytes[i])
              i++
            }
            text = mapped
          } else {
            let latin = ''
            for (let k = 0; k < text.length; k++) {
              const c = text.charCodeAt(k)
              latin += c < 32 || c > 126 ? (c >= 160 ? String.fromCharCode(c) : '') : String.fromCharCode(c)
            }
            text = latin
          }
          if (text !== '') {
            try { text = text.normalize('NFKC') } catch (error) { /* keep */ }
            if (pageText !== '') {
              const prev = pageText[pageText.length - 1] || ''
              const next = text[0] || ''
              const latinish = /[A-Za-z0-9]/
              const needSpace = latinish.test(prev) && latinish.test(next)
              if (run.br) pageText += '\n'
              else if (lastGap >= -100 && needSpace && !pageText.endsWith(' ') && !pageText.endsWith('\n')) pageText += ' '
            }
            pageText += text
          }
          lastGap = run.gap || 0
        }
      }
      pageTexts.push(pageText.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
      if (onPage !== null && typeof onPage === 'function') onPage({ done: pageTexts.length, total: pageNums.length })
    }
    return pageTexts
  }

  function extractPdfText(latin1, onPage) {
    if (latin1.slice(0, 5) !== '%PDF-') throw new Error('不是有效的 PDF 文件')
    const state = collectPageNums(latin1)
    const pageCb = typeof onPage === 'function' ? onPage : null
    if (pageCb !== null) pageCb({ total: state.pageNums.length, done: 0 })
    const pageTexts = extractPageTexts(state.pageNums, state.getObject, state.resolveRef, state.resolveMultiRef, pageCb)
    const pages = pageTexts.filter((t) => t.trim() !== '')
    return pages.map((t, i) => '【第' + (i + 1) + '页】\n' + t).join('\n\n')
  }

  // 采样快速预检：只解析结构与前 2 页文本，避免大 PDF 全量提取。
  function extractPdfStats(latin1) {
    if (latin1.slice(0, 5) !== '%PDF-') throw new Error('不是有效的 PDF 文件')
    const state = collectPageNums(latin1)
    const pages = state.pageNums.length
    const sample = state.pageNums.slice(0, 2)
    const pageTexts = extractPageTexts(sample, state.getObject, state.resolveRef, state.resolveMultiRef)
    const sampleChars = pageTexts.reduce((n, t) => n + t.length, 0)
    const sampleTokens = estimateTokens(pageTexts.join('\n'))
    return { pages, samplePages: 2, sampleChars, sampleTokens }
  }

  // ---------- HTML → 文本 ----------
  function decodeEntities(s) {
    const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', times: '×', divide: '÷', copy: '©', reg: '®', laquo: '«', raquo: '»', bull: '•', deg: '°', emsp: ' ', ensp: ' ' }
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (mm, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : mm
      }
      const v = named[e.toLowerCase()]
      return v !== undefined ? v : mm
    })
  }

  function balancedRegion(html, openEndIndex, tagName) {
    const openRe = new RegExp('<' + tagName + '(\\s|>)', 'g')
    const closeRe = new RegExp('</' + tagName + '\\s*>', 'g')
    let depth = 1
    let pos = openEndIndex
    while (depth > 0) {
      openRe.lastIndex = pos
      closeRe.lastIndex = pos
      const om = openRe.exec(html)
      const cm = closeRe.exec(html)
      if (cm === null) return { start: openEndIndex, end: html.length }
      if (om !== null && om.index < cm.index) {
        depth++
        pos = om.index + om[0].length
      } else {
        depth--
        if (depth === 0) return { start: openEndIndex, end: cm.index }
        pos = cm.index + cm[0].length
      }
    }
    return { start: openEndIndex, end: html.length }
  }

  function htmlToText(html) {
    let title = ''
    const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (tm) title = decodeEntities(tm[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    const candidates = [
      /<div[^>]*id\s*=\s*["'](?:js_content|content_views|article-root|js_content_root|root)["'][^>]*>/i,
      /<div[^>]*class\s*=\s*["'][^"']*(?:rich_media_content|article-content|RichText|Post-RichTextContainer|markdown-body|article-body|entry-content|content)[^"']*["'][^>]*>/i,
      /<article(?:\s[^>]*)?>/i,
      /<main(?:\s[^>]*)?>/i,
    ]
    let content = ''
    for (const re of candidates) {
      const mm = re.exec(html)
      if (mm === null) continue
      const tag = mm[0].match(/^<([a-zA-Z0-9]+)/)[1]
      const region = balancedRegion(html, mm.index + mm[0].length, tag)
      const piece = html.slice(region.start, region.end)
      const plain = piece.replace(/<[^>]+>/g, '')
      if (plain.length > 200) {
        content = piece
        break
      }
    }
    if (content === '') {
      const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
      content = body ? body[1] : html
    }
    content = content
      .replace(/<(script|style|noscript|svg|iframe|form|nav|footer|aside|button|select|textarea)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(script|style|noscript|svg|iframe)[^>]*\/?>/gi, ' ')
      .replace(/<h[1-6][^>]*>/gi, '\n\n')
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|ul|ol|figure|figcaption|header|footer|table|details)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' ')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<(p|div|section|article|blockquote|pre|table)[^>]*>/gi, '\n')
      .replace(/<img[^>]*alt\s*=\s*["']([^"']*)["'][^>]*>/gi, '[图：$1]')
      .replace(/<[^>]+>/g, ' ')
    content = decodeEntities(content)
    content = content
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return { title, text: content }
  }

  // 抓取并提取微信公众号正文：web 服务优先、全局 fetch 兜底、反爬验证页换 UA
  // 重试一次、标题前置。任何失败以异常上抛，由 resolveSource 决定回退缓存还是透传。
  async function fetchArticleText(url) {
    let result = null
    let webError = null
    if (web !== undefined) {
      try {
        result = await web.fetch({ url })
      } catch (err) {
        webError = err
      }
    }
    if (result === null || typeof result !== 'object' || typeof result.statusCode !== 'number') {
      // 回退：web 服务无可用 provider 时用 Node 全局 fetch 兜底
      try {
        const resp = await globalThis.fetch(url, {
          redirect: 'follow',
          headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        })
        const bodyText = await resp.text()
        result = { statusCode: resp.status, body: { kind: 'html', content: bodyText } }
      } catch (err) {
        const reason = webError !== null && typeof webError === 'object' && typeof webError.message === 'string' ? webError.message : String(err)
        throw new Error('网页抓取失败：' + reason)
      }
    }
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error('网页返回状态码 ' + result.statusCode + '，抓取失败')
    const body = result.body
    let contentText = ''
    let pageTitle = ''
    if (body !== null && typeof body === 'object' && body.kind === 'text' && typeof body.content === 'string') {
      contentText = body.content
    } else if (body !== null && typeof body === 'object' && body.kind === 'html' && typeof body.content === 'string') {
      const parsed = htmlToText(body.content)
      pageTitle = parsed.title
      contentText = parsed.text
    }
    if (contentText.trim() === '') throw new Error('网页内容为空或无法解析（可能是临时链接失效、文章已删除，或需要登录）。请换稳定链接，或直接粘贴正文。')
    // 微信反爬验证页（环境异常/去验证）不是正文：换浏览器 UA 走全局 fetch 重试一次
    const looksAntiBot = /环境异常|完成验证|去验证/.test(contentText) && contentText.length < 4000
    if (looksAntiBot) {
      try {
        const resp = await globalThis.fetch(url, {
          redirect: 'follow',
          headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        })
        const retried = htmlToText(await resp.text())
        if (retried.text.trim() !== '' && !/环境异常|完成验证|去验证/.test(retried.text)) {
          contentText = retried.text
          if (retried.title !== '') pageTitle = retried.title
        }
      } catch (err) { /* 保留原内容，交给后续模型处理 */ }
    }
    if (pageTitle !== '' && contentText.indexOf(pageTitle) === -1) contentText = pageTitle + '\n\n' + contentText
    return contentText
  }

  async function resolveSource(args, opts) {
    const opt = opts !== null && typeof opts === 'object' ? opts : {}
    const onProgress = typeof opt.onProgress === 'function' ? opt.onProgress : null
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    const path = typeof args.path === 'string' ? args.path.trim() : ''
    const text = typeof args.text === 'string' ? args.text : ''
    if (url !== '') {
      const hostMatch = url.match(/^https?:\/\/([^\/?#]+)/i)
      const host = hostMatch ? hostMatch[1].toLowerCase() : ''
      if (host !== 'mp.weixin.qq.com' && host !== 'weixin.qq.com' && !host.endsWith('.weixin.qq.com')) {
        throw new Error('链接抓取仅支持微信公众号（mp.weixin.qq.com）。' + (host === '' ? '不是有效的链接。' : '「' + host + '」存在反爬或登录墙，请直接粘贴正文，或将内容保存为 .txt/.md/.pdf 后用 path 传入。'))
      }
      const refresh = args.refresh === true
      if (tune.cacheEnabled && !refresh) {
        const hit = await readCacheEntry(url, false)
        if (hit !== null) return { text: hit.text, source: url, sourceKind: 'url', cache: 'hit', fetchedAt: hit.fetchedAt }
      }
      let contentText = ''
      let fetchError = null
      try {
        contentText = await fetchArticleText(url)
      } catch (err) {
        fetchError = err
      }
      if (fetchError !== null) {
        if (tune.cacheEnabled) {
          const stale = await readCacheEntry(url, true)
          if (stale !== null) {
            const reason = fetchError !== null && typeof fetchError === 'object' && fetchError.message ? fetchError.message : String(fetchError)
            return { text: stale.text, source: url, sourceKind: 'url', cache: 'fallback', fetchedAt: stale.fetchedAt, note: '抓取失败（' + reason + '），已回退缓存全文' }
          }
        }
        throw fetchError
      }
      const looksAntiBot = /环境异常|完成验证|去验证/.test(contentText) && contentText.length < 4000
      if (tune.cacheEnabled && !looksAntiBot) await writeCacheEntry(url, contentText)
      return { text: contentText, source: url, sourceKind: 'url', cache: tune.cacheEnabled ? 'miss' : 'disabled' }
    }
    if (path !== '') {
      const lower = path.toLowerCase()
      if (lower.endsWith('.pdf')) {
        const target = await ctx.fs.resolve(path)
        const bytes = await ctx.fs.readBytes(target, undefined, 30 * 1024 * 1024)
        const latin = bytesToLatin1(bytes)
        const t0 = Date.now()
        if (opt.statsOnly === true) {
          let pdfStats = null
          try {
            pdfStats = extractPdfStats(latin)
          } catch (error) {
            throw new Error('PDF 解析失败：' + (error !== null && typeof error === 'object' && error.message ? error.message : String(error)))
          }
          return { text: '', source: path, sourceKind: 'pdf', pdfStats, extractMs: Date.now() - t0 }
        }
        let extracted = ''
        try {
          let lastPct = -1
          extracted = extractPdfText(latin, onProgress === null ? undefined : (info) => {
            if (info.done === 0) {
              onProgress('解析 PDF 中…（共 ' + info.total + ' 页）')
              return
            }
            const total = Math.max(1, info.total)
            const pct = Math.round((info.done / total) * 100)
            if (info.done >= total || pct >= lastPct + 5) {
              lastPct = pct
              onProgress('解析 PDF 中… ' + pct + '%（' + info.done + '/' + total + ' 页）')
            }
          })
        } catch (error) {
          throw new Error('PDF 解析失败：' + (error !== null && typeof error === 'object' && error.message ? error.message : String(error)))
        }
        if (extracted.trim() === '') throw new Error('PDF 中没有可提取的文本（可能是扫描版/图片型 PDF，建议先 OCR 或转成 txt 再精读）')
        return { text: extracted, source: path, sourceKind: 'pdf', extractMs: Date.now() - t0 }
      }
      if (/\.(txt|md|markdown|text|html|htm|csv|json|log)$/i.test(lower)) {
        const target = await ctx.fs.resolve(path)
        let content = await ctx.fs.readText(target)
        if (/\.(html|htm)$/i.test(lower)) content = htmlToText(content).text
        return { text: content, source: path, sourceKind: 'file' }
      }
      throw new Error('暂不支持的文件类型：' + path + '（支持 .txt / .md / .markdown / .html 与 .pdf）')
    }
    if (text.trim() === '') throw new Error('没有可分析的内容：请提供 url（微信公众号链接）、path（文件路径）或 text（粘贴文本）')
    return { text, source: '粘贴文本', sourceKind: 'text' }
  }

  // estimate 模式的轻量预解析：大 PDF（原始字节 > 2MB）走采样，其余全量；避免重复全量解析。
  async function resolveForEstimate(args) {
    const path = typeof args.path === 'string' ? args.path.trim() : ''
    if (path !== '' && path.toLowerCase().endsWith('.pdf')) {
      const target = await ctx.fs.resolve(path)
      const bytes = await ctx.fs.readBytes(target, undefined, 30 * 1024 * 1024)
      if (bytes.length > 2 * 1024 * 1024) {
        return resolveSource(args, { statsOnly: true })
      }
    }
    return resolveSource(args)
  }

  // ---------- 清洗 / 提示词 ----------
  function sanitizeArguments(raw) {
    return arr(raw).slice(0, 10).map((a) => {
      const ao = a !== null && typeof a === 'object' ? a : { claim: String(a) }
      return { claim: str(ao.claim, ''), evidence: str(ao.evidence, ''), quote: str(ao.quote, ''), source: str(ao.source, '') }
    }).filter((a) => a.claim !== '' || a.evidence !== '')
  }

  function sanitizeQuotes(raw) {
    return arr(raw).slice(0, 8).map((q) => {
      const qo = q !== null && typeof q === 'object' ? q : { text: String(q) }
      return { text: str(qo.text, ''), context: str(qo.context, ''), source: str(qo.source, '') }
    }).filter((q) => q.text !== '')
  }

  function sanitizeCitations(raw) {
    return arr(raw).slice(0, 8).map((c) => {
      const co = c !== null && typeof c === 'object' ? c : { claim: String(c) }
      return { claim: str(co.claim, ''), source: str(co.source, ''), quote: str(co.quote, '') }
    }).filter((c) => c.claim !== '' || c.quote !== '')
  }

  function sanitizeConcepts(raw) {
    return arr(raw).slice(0, 10).map((c) => {
      const co = c !== null && typeof c === 'object' ? c : { term: String(c) }
      return { term: str(co.term, ''), explanation: str(co.explanation, '') }
    }).filter((c) => c.term !== '')
  }

  function sanitizeQuestions(raw) {
    return arr(raw).slice(0, 8).map((q) => String(q).trim()).filter((q) => q !== '')
  }

  function sanitizeSection(raw, fallbackTitle) {
    const obj = raw !== null && typeof raw === 'object' ? raw : {}
    return {
      title: str(obj.title, fallbackTitle),
      summary: str(obj.summary, ''),
      thesis: str(obj.thesis, ''),
      arguments: sanitizeArguments(obj.arguments),
      quotes: sanitizeQuotes(obj.quotes),
      concepts: sanitizeConcepts(obj.concepts),
      questions: sanitizeQuestions(obj.questions),
    }
  }

  const SECTION_SCHEMA = [
    '{',
    '  "title": "本节标题（无法判断时用「第N部分」）",',
    '  "summary": "1-2 句话概括本节内容",',
    '  "thesis": "本节最核心的观点或论点（一句话）",',
    '  "arguments": [{"claim": "分论点", "evidence": "支撑的论据或推理", "quote": "原文关键句（可选）", "source": "原文位置（如 第N页/第N段；原文没有位置标记时留空）"}],',
    '  "quotes": [{"text": "值得摘录的原文原句", "context": "这句话在论证什么（可选）", "source": "原文位置（如 第N页；没有标记时留空）"}],',
    '  "concepts": [{"term": "核心概念/术语", "explanation": "它在文中的含义"}],',
    '  "questions": ["读者应继续追问的批判性问题"]',
    '}',
  ].join('\n')

  function sectionSystem(depth, language, focus) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    let sys = '你是一位专业的精读分析师，擅长从书籍和文章中提取核心观点、论证结构与关键论据。\n'
      + '请严格只输出一个 JSON 对象（不要输出任何解释、前后缀或 Markdown 代码块），字段如下：\n'
      + SECTION_SCHEMA + '\n'
      + '要求：thesis 必须凝练；arguments 的 claim 是分论点、evidence 是支撑它的论据或推理；quote 尽量引用原文原句；questions 要体现批判性阅读。\n'
      + '引用溯源：若原文包含【第N页】等位置标记，arguments 与 quotes 的 source 字段必须注明对应页码或段落位置；没有标记则留空。\n'
      + '输出语言：' + lang + '。\n'
    if (focus.trim() !== '') sys += '读者特别关注：' + focus.trim() + '。\n'
    if (depth === 'quick') sys += '模式：快速抓要点——arguments 不超过 3 条，quotes 不超过 3 条，concepts 不超过 4 个，questions 不超过 3 个。'
    else sys += '模式：深度精读——论据要具体，尽可能多地引用原文。'
    return sys
  }

  function sectionUser(text, index, total) {
    if (total > 1) return '【第 ' + (index + 1) + ' / ' + total + ' 部分】\n\n' + text
    return '以下是待精读的内容：\n\n' + text
  }

  const FINAL_SCHEMA = [
    '{',
    '  "title": "全文标题",',
    '  "summary": "一句话概括全文",',
    '  "thesis": "全文核心论点",',
    '  "arguments": [{"claim": "分论点", "evidence": "论据", "quote": "原文关键句（可选）", "source": "原文位置（可选）"}],',
    '  "structure": ["论证脉络步骤，按顺序，例如：提出背景→定义问题→反驳旧说→提出新框架"],',
    '  "concepts": [{"term": "概念", "explanation": "含义"}],',
    '  "questions": ["批判性思考问题"],',
    '  "citations": [{"claim": "重要论断（简短）", "source": "页码或段落位置（如 第12页；无法定位则留空）", "quote": "支撑该论断的原文关键句"}]',
    '}',
  ].join('\n')

  function finalSystem(language) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是精读分析师。请把各部分已提取的要点综合成全文层面的精读报告。\n'
      + '严格只输出一个 JSON 对象（不要输出任何解释或 Markdown 代码块），字段如下：\n'
      + FINAL_SCHEMA + '\n'
      + 'arguments 应提炼 3-8 条最重要的分论点；structure 用短语按顺序描述全文论证脉络。\n'
      + 'citations 挑选 3-8 条最重要的论断并引用原文关键句；若各部分要点带有 source（页码/段落），必须原样保留到 citations 的 source 字段。\n'
      + '输出语言：' + lang + '。'
  }

  function finalUserFromParts(parts, totalChars) {
    return '全文共 ' + totalChars + ' 字，分为 ' + parts.length + ' 个部分。以下 JSON 数组是各部分已提取的要点：\n\n' + JSON.stringify(parts)
  }

  const MAP_SCHEMA = [
    '{',
    '  "title": "文章标题",',
    '  "summary": "100字以内摘要",',
    '  "coreQuestion": "作者试图回答的核心问题（不是文章主题）",',
    '  "coreConclusions": ["核心结论1", "核心结论2"],',
    '  "items": [',
    '    {"type": "核心结论|分论点|原因或作用机制|事实|数据|案例|隐含前提|反对意见|限制条件|可执行建议（十选一）",',
    '     "claim": "观点/事实陈述",',
    '     "evidence": "原文证据（原文确实没有证据时，必须填「原文未提供证据」）",',
    '     "source": "页码或段落位置（如 第3段 / 第2页）",',
    '     "confidence": "作者原意|原文事实与数据|合理推断|无法确认（四选一）",',
    '     "relations": [{"to": "另一条 claim 的开头文字（用于定位）", "type": "支持|反驳|导致|解释|取决于|举例|对比|限制（八选一）"}]}',
    '  ],',
    '  "dataPoints": [',
    '    {"value": "完整数值与单位", "period": "时间范围", "subject": "样本或研究对象", "baseline": "比较基准", "source": "数据来源", "location": "原文位置"}',
    '  ],',
    '  "caveats": ["反对意见或局限性"],',
    '  "mermaid": "mindmap 语法的思维导图",',
    '  "xmindOutline": "制表符缩进的 Markdown 大纲（可导入 XMind）",',
    '  "recallQuestions": ["主动回忆问题1", "问题2", "问题3", "问题4", "问题5"]',
    '}',
  ].join('\n')

  function mapSystem(language, focus, isFinal) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    let sys = '你是严谨的知识地图分析师。请' + (isFinal ? '把各部分已提取的要点综合' : '把原文整理') + '成「观点—证据—数据—关系」知识地图。\n'
      + '严格只输出一个 JSON 对象（不要输出任何解释、前后缀或 Markdown 代码块），结构如下：\n'
      + MAP_SCHEMA + '\n'
      + '必须遵守的规则：\n'
      + '1. coreQuestion 必须是作者试图回答的核心问题，不是文章主题。\n'
      + '2. coreConclusions 是作者的核心结论（1-3 条），不得只复述主题。\n'
      + '3. items 的 type 只能取十类之一：核心结论、分论点、原因或作用机制、事实、数据、案例、隐含前提、反对意见、限制条件、可执行建议。\n'
      + '4. 每条重要观点都必须有 evidence；原文确实没有提供证据时，evidence 必须填「原文未提供证据」。\n'
      + '5. dataPoints 必须保留完整数值与单位、时间范围、样本或研究对象、比较基准、数据来源、原文位置；原文没有数据时留空数组，严禁编造数据。\n'
      + '6. 案例不得当作普遍证据；相关关系不得写成因果关系。\n'
      + '7. relations 的 type 只能八选一：支持、反驳、导致、解释、取决于、举例、对比、限制；to 写另一条 claim 的开头文字以便定位。\n'
      + '8. confidence 区分四档：作者原意 / 原文事实与数据 / 合理推断 / 无法确认。\n'
      + '9. mermaid 用 mindmap 语法输出完整思维导图；xmindOutline 输出制表符缩进的 Markdown 大纲（可直接导入 XMind）；recallQuestions 是 5 个主动回忆问题。\n'
      + '输出语言：' + lang + '。\n'
    if (focus.trim() !== '') sys += '读者特别关注：' + focus.trim() + '。\n'
    return sys
  }

  function mapUser(text) {
    return '以下是待整理的内容：\n\n' + text + '\n\n注意：若原文中出现【第N页】标记，source 和 location 字段请使用页码。'
  }

  function mapFinalUser(parts, totalChars) {
    return '全文共 ' + totalChars + ' 字，分为 ' + parts.length + ' 个部分。以下 JSON 数组是各部分已提取的要点：\n\n' + JSON.stringify(parts)
  }

  function sanitizeMap(parsed, chapters, meta) {
    const p = parsed !== null && typeof parsed === 'object' ? parsed : {}
    const items = arr(p.items).slice(0, 40).map((it) => {
      const o = it !== null && typeof it === 'object' ? it : { claim: String(it) }
      const claim = str(o.claim, '')
      if (claim === '') return null
      return {
        type: str(o.type, '分论点'),
        claim,
        evidence: str(o.evidence, '原文未提供证据'),
        source: str(o.source, ''),
        confidence: str(o.confidence, ''),
        relations: arr(o.relations).slice(0, 6).map((r) => {
          const ro = r !== null && typeof r === 'object' ? r : { type: String(r) }
          return { to: str(ro.to, ''), type: str(ro.type, '支持') }
        }).filter((r) => r.to !== ''),
      }
    }).filter((x) => x !== null)
    const dataPoints = arr(p.dataPoints).slice(0, 30).map((d) => {
      const o = d !== null && typeof d === 'object' ? d : { value: String(d) }
      return {
        value: str(o.value, ''),
        period: str(o.period, ''),
        subject: str(o.subject, ''),
        baseline: str(o.baseline, ''),
        source: str(o.source, ''),
        location: str(o.location, ''),
      }
    }).filter((d) => d.value !== '')
    const coreConclusions = arr(p.coreConclusions).slice(0, 5).map((c) => String(c).trim()).filter((c) => c !== '')
    const recallQuestions = arr(p.recallQuestions).slice(0, 5).map((q) => String(q).trim()).filter((q) => q !== '')
    const summary = str(p.summary, '').slice(0, 100)
    return {
      kind: 'map',
      title: str(p.title, '未命名知识地图'),
      summary,
      thesis: coreConclusions.length > 0 ? coreConclusions[0] : '',
      coreQuestion: str(p.coreQuestion, ''),
      coreConclusions,
      items,
      dataPoints,
      caveats: arr(p.caveats).slice(0, 15).map((c) => String(c).trim()).filter((c) => c !== ''),
      mermaid: str(p.mermaid, ''),
      xmindOutline: str(p.xmindOutline, ''),
      recallQuestions,
      arguments: [],
      quotes: [],
      concepts: [],
      questions: recallQuestions,
      structure: [],
      chapters,
      meta,
    }
  }

  // ---- 费曼读书法（feynman 模式）----
  const FEYNMAN_STRUCT_SCHEMA = [
    '{',
    '  "toc": ["章节标题与一句话简介（按顺序）"],',
    '  "questions": ["阅读本书想解决的问题（3-6 条）"]',
    '}',
  ].join('\n')

  function feynmanStructSystem(language) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是费曼读书法教练。第一步：浏览目录并提出阅读问题。\n严格只输出一个 JSON 对象（不要任何解释或 Markdown 代码块）：\n' + FEYNMAN_STRUCT_SCHEMA + '\n输出语言：' + lang + '。'
  }

  const FEYNMAN_CHAPTER_SCHEMA = [
    '{',
    '  "title": "本章标题",',
    '  "points": [{"claim": "核心观点", "data": "相关数据（无则留空）", "evidence": "原文证据（无则填「原文未提供证据」）"}],',
    '  "chapterMap": "本章 mermaid mindmap 语法导图",',
    '  "explanation": "合上书，用大白话向零基础的 12 岁孩子讲解本章（多用类比，禁止术语堆砌）",',
    '  "gaps": ["刚才讲解中含糊、跳步、术语化或没讲清的地方"],',
    '  "corrections": ["回到原文核对后，对每个缺口的修正"]',
    '}',
  ].join('\n')

  function feynmanChapterSystem(language, focus) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    let sys = '你是费曼读书法教练。请对本章依次完成五步，并严格只输出一个 JSON 对象（不要任何解释或 Markdown 代码块）：\n'
      + FEYNMAN_CHAPTER_SCHEMA + '\n'
      + '要求：\n'
      + '1. points 严格区分三类信息：claim 是作者的观点主张，data 是原文数据（完整数值与单位），evidence 是原文句子证据；没有证据时 evidence 必须填「原文未提供证据」。\n'
      + '2. chapterMap 用 mermaid mindmap 语法。\n'
      + '3. explanation 必须「合上书」——假装看不到原文，用大白话讲给初学者听，允许类比，禁止术语堆砌；卡壳就如实暴露。\n'
      + '4. gaps 要诚实指出自己刚才讲解中含糊、跳步、说不清的地方（这正是费曼法的核心）。\n'
      + '5. corrections 逐条回到原文核对并修正讲解。\n'
      + '输出语言：' + lang + '。\n'
    if (focus.trim() !== '') sys += '读者特别关注：' + focus.trim() + '。\n'
    return sys
  }

  function feynmanChapterUser(text, index, total) {
    return '【第 ' + index + ' / ' + total + ' 章】\n\n' + text
  }

  const FEYNMAN_FINAL_SCHEMA = [
    '{',
    '  "title": "全书标题",',
    '  "summary": "一句话总结",',
    '  "thesis": "核心论点",',
    '  "bookMap": "mermaid mindmap 全书导图（合并各章）",',
    '  "finalExplanation": "合上书，把全书讲给一个完全没读过的人听",',
    '  "reviewPlan": [{"interval": "第1天/第3天/第7天/第14天/第30天", "focus": "该轮复习重点", "method": "复习方式（如复述要点/回答回忆问题）"}]',
    '}',
  ].join('\n')

  function feynmanFinalSystem(language) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是费曼读书法教练。请完成全书收尾：合并导图、终讲与间隔复习计划。\n严格只输出一个 JSON 对象（不要任何解释或 Markdown 代码块）：\n'
      + FEYNMAN_FINAL_SCHEMA + '\n'
      + 'reviewPlan 必须覆盖 5 个间隔：第1天（当天回顾）、第3天、第7天、第14天、第30天，每轮给出复习重点与具体方式。\n输出语言：' + lang + '。'
  }

  function feynmanFinalUser(compact) {
    return '以下 JSON 数组是各章的要点与讲解摘要：\n\n' + JSON.stringify(compact)
  }

  function sanitizeFeynmanChapter(parsed, index) {
    const p = parsed !== null && typeof parsed === 'object' ? parsed : {}
    return {
      index: index,
      title: str(p.title, '第 ' + index + ' 章'),
      points: arr(p.points).slice(0, 10).map((pt) => {
        const po = pt !== null && typeof pt === 'object' ? pt : { claim: String(pt) }
        return { claim: str(po.claim, ''), data: str(po.data, ''), evidence: str(po.evidence, '原文未提供证据') }
      }).filter((x) => x.claim !== ''),
      chapterMap: str(p.chapterMap, ''),
      explanation: str(p.explanation, ''),
      gaps: arr(p.gaps).slice(0, 6).map((g) => String(g).trim()).filter((g) => g !== ''),
      corrections: arr(p.corrections).slice(0, 6).map((c) => String(c).trim()).filter((c) => c !== ''),
    }
  }

  // ---------- 预算预检：token 与耗时估算 ----------
  // 估算口径（保守）：
  //   中文 1 字 ≈ 0.6 token；拉丁 1 字符 ≈ 0.25 token；其他 ≈ 0.5 token。
  //   每次调用固定 prompt 模板开销 ≈ 600 token；输出按各阶段预算计。
  //   时间 = (输入token + 输出token) / estTokensPerSecond + 调用次数 × estLatencyPerCallMs。
  const EST_PROMPT_OVERHEAD = 600

  function estimateTokens(text) {
    let cjk = 0
    let latin = 0
    let other = 0
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef)) cjk++
      else if (c >= 32 && c < 127) latin++
      else other++
    }
    return Math.ceil(cjk * 0.6 + latin * 0.25 + other * 0.5)
  }

  function estimateCall(calls, inputTokens, outputTokens) {
    const rate = effectiveRate()
    const latency = effectiveLatency()
    const minutes = (inputTokens + outputTokens) / rate / 60 + (calls * latency) / 60000
    return {
      calls,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      minutes: Math.round(minutes * 10) / 10,
      minutesFormula: '（(' + inputTokens + '+' + outputTokens + ') ÷ ' + Math.round(rate * 10) / 10 + ' tok/s + ' + calls + ' 次 × ' + Math.round(latency) + 'ms）',
      estTokensPerSecond: Math.round(rate * 10) / 10,
      estLatencyPerCallMs: Math.round(latency),
      calibrated: calibratedRate() !== null,
    }
  }

  function buildEstimate(text, depth, ext) {
    const extrapolated = ext !== null && typeof ext === 'object' && typeof ext.chars === 'number' ? ext : null
    const chars = extrapolated !== null ? Math.max(1, Math.round(extrapolated.chars)) : text.length
    const tokenRatio = extrapolated !== null && typeof extrapolated.tokensPerChar === 'number' && extrapolated.tokensPerChar > 0 ? extrapolated.tokensPerChar : null
    const tokOf = (len) => {
      if (tokenRatio !== null) return Math.ceil(len * tokenRatio)
      return estimateTokens(text.slice(0, len))
    }
    const effectiveLen = chars > tune.maxInputChars ? tune.maxInputChars : chars
    const parts = Math.min(Math.ceil(effectiveLen / CHUNK_CHARS), MAX_PARTS)
    const perInput = tokOf(effectiveLen > CHUNK_CHARS ? CHUNK_CHARS : effectiveLen) + EST_PROMPT_OVERHEAD
    const summaryInput = parts * 400 + EST_PROMPT_OVERHEAD
    const modes = []
    modes.push({ mode: 'quick', note: '单次调用，输入截断至 30000 字', ...estimateCall(1, tokOf(Math.min(effectiveLen, 30000)) + EST_PROMPT_OVERHEAD, 2500) })
    if (effectiveLen <= 9000) {
      modes.push({ mode: 'deep', note: '短文单次调用', ...estimateCall(1, tokOf(effectiveLen) + EST_PROMPT_OVERHEAD, 4000) })
    } else {
      modes.push({ mode: 'deep', note: '分 ' + parts + ' 段逐段精读 + 1 次综合', ...estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000) })
    }
    const bookParts = Math.max(1, parts)
    modes.push({ mode: 'book', note: '全书分 ' + bookParts + ' 部分精读并汇总', ...estimateCall(bookParts + 1, bookParts * perInput + summaryInput, bookParts * 5000 + 5000) })
    if (effectiveLen <= 9000) {
      modes.push({ mode: 'map', note: '短文单次知识地图', ...estimateCall(1, tokOf(effectiveLen) + EST_PROMPT_OVERHEAD, 5000) })
    } else {
      modes.push({ mode: 'map', note: '分 ' + parts + ' 段提取 + 1 次汇总', ...estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000) })
    }
    const feynmanStruct = effectiveLen > 9000 ? 1 : 0
    const structInput = feynmanStruct > 0 ? tokOf(5000) + EST_PROMPT_OVERHEAD : 0
    modes.push({ mode: 'feynman', note: (feynmanStruct > 0 ? '目录提问 1 次 + ' : '') + '分 ' + Math.max(1, parts) + ' 章 + 合并导图与复习计划 1 次', ...estimateCall(Math.max(1, parts) + feynmanStruct + 1, Math.max(1, parts) * perInput + structInput + summaryInput, Math.max(1, parts) * 5000 + 5000) })
    const result = { chars, modes, estTokensPerSecond: Math.round(effectiveRate() * 10) / 10, estLatencyPerCallMs: Math.round(effectiveLatency()), calibrated: calibratedRate() !== null }
    if (extrapolated !== null) { result.sampled = true; result.note = '按采样外推' }
    return result
  }

  // ---------- 批量精读与跨篇对比 ----------
  const BATCH_SCHEMA = [
    '{',
    '  "title": "对比报告标题（含篇数，如「三篇文章对比：……」）",',
    '  "comparison": [{"theme": "对比主题（一句话）", "positions": [{"doc": "篇目标题", "view": "该篇在该主题上的立场或要点"}]}],',
    '  "conflicts": [{"theme": "冲突点", "positions": [{"doc": "篇目标题", "view": "该篇立场"}]}],',
    '  "complementarity": "各篇如何互补（一句话）",',
    '  "synthesis": "综合结论（2-4 句话）",',
    '  "questions": ["跨篇视角下的追问 1-3 条"]',
    '}',
  ].join('\n')

  function batchFinalSystem(language) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是跨文档对比分析师。请把多篇文章的要点综合成对比报告。\n'
      + '严格只输出一个 JSON 对象（不要输出任何解释、前后缀或 Markdown 代码块），结构如下：\n'
      + BATCH_SCHEMA + '\n'
      + 'comparison 选 3-6 个最有信息量的对比主题；conflicts 只列真实冲突（没有可留空数组）；synthesis 给出综合结论。\n'
      + '输出语言：' + lang + '。'
  }

  function sanitizePositions(raw) {
    return arr(raw).slice(0, 12).map((p) => {
      const po = p !== null && typeof p === 'object' ? p : {}
      return { doc: str(po.doc, ''), view: str(po.view, '') }
    }).filter((p) => p.doc !== '' || p.view !== '')
  }

  function sanitizeComparison(raw, cap) {
    return arr(raw).slice(0, cap).map((c) => {
      const co = c !== null && typeof c === 'object' ? c : {}
      return { theme: str(co.theme, ''), positions: sanitizePositions(co.positions) }
    }).filter((c) => c.theme !== '')
  }

  async function batchEstimateFlow(args, language) {
    await loadCalibration()
    const items = Array.isArray(args.batch) ? args.batch.slice(0, 10) : []
    const rows = []
    let totalChars = 0
    let totalCalls = 0
    let totalTokens = 0
    for (let i = 0; i < items.length; i++) {
      const item = items[i] !== null && typeof items[i] === 'object' ? items[i] : {}
      const src = await resolveSource({ url: item.url, path: item.path, text: item.text, refresh: args.refresh === true })
      let text = String(src.text).replace(/\r\n/g, '\n')
      if (text.length > tune.maxInputChars) text = text.slice(0, tune.maxInputChars)
      totalChars += text.length
      const q = buildEstimate(text, 'quick').modes.find((mm) => mm.mode === 'quick')
      totalCalls += q.calls
      totalTokens += q.totalTokens
      rows.push({ index: i + 1, title: str(item.title, ''), source: str(src.source, ''), chars: text.length, quick: q })
    }
    const finalCall = estimateCall(1, items.length * 400 + EST_PROMPT_OVERHEAD, 5000)
    totalCalls += 1
    totalTokens += finalCall.totalTokens
    const totalMinutes = (totalTokens / effectiveRate() / 60) + (totalCalls * effectiveLatency()) / 60000
    return {
      kind: 'estimate', title: '批量预算预检', summary: items.length + ' 篇文档：逐篇快速提取 + 1 次跨篇对比。', thesis: '',
      arguments: [], quotes: [], concepts: [], questions: [], structure: [], chapters: [],
      estimate: {
        batch: true, items: rows, finalCall,
        totalCalls, totalTokens, totalMinutes: Math.round(totalMinutes * 10) / 10,
        estTokensPerSecond: Math.round(effectiveRate() * 10) / 10, estLatencyPerCallMs: Math.round(effectiveLatency()),
        calibrated: calibratedRate() !== null,
      },
      meta: { source: items.length + ' 篇文档', sourceKind: 'batch', chars: totalChars, depth: 'batch', durationMs: 0 },
    }
  }

  async function batchFlow(args, language, signal, onProgress) {
    const started = Date.now()
    const items = Array.isArray(args.batch) ? args.batch.slice(0, 10) : []
    const docs = []
    let totalChars = 0
    const cfg = await pickConfig()
    const progress = typeof onProgress === 'function' ? onProgress : null
    for (let i = 0; i < items.length; i++) {
      const item = items[i] !== null && typeof items[i] === 'object' ? items[i] : {}
      if (progress !== null) progress('解析第 ' + (i + 1) + '/' + items.length + ' 篇…')
      const src = await resolveSource({ url: item.url, path: item.path, text: item.text, refresh: args.refresh === true }, { onProgress: progress === null ? undefined : (line) => progress('第 ' + (i + 1) + ' 篇 · ' + line) })
      let text = String(src.text).replace(/\r\n/g, '\n')
      if (text.length > 30000) text = text.slice(0, 30000)
      totalChars += text.length
      const title = str(item.title, '')
      if (progress !== null) progress('精读第 ' + (i + 1) + '/' + items.length + ' 篇…')
      const parsed = await callModelJson(cfg, sectionSystem('quick', language, str(item.focus, '')), (title !== '' ? '【文档标题：' + title + '】\n' : '') + sectionUser(text, i, items.length), 2500, signal)
      const s = sanitizeSection(parsed === null ? {} : parsed, title !== '' ? title : ('第 ' + (i + 1) + ' 篇'))
      docs.push({
        index: i + 1, title: s.title, summary: s.summary, thesis: s.thesis,
        arguments: s.arguments, quotes: s.quotes, concepts: s.concepts,
        source: str(src.source, ''), sourceKind: str(src.sourceKind, 'text'), chars: text.length,
      })
      if (progress !== null) progress('完成第 ' + (i + 1) + '/' + items.length + ' 篇')
    }
    const compact = docs.map((d) => ({ title: d.title, summary: d.summary, thesis: d.thesis, arguments: d.arguments.slice(0, 3), quotes: d.quotes.slice(0, 3) }))
    if (progress !== null) progress('跨篇对比汇总中…')
    const finalParsed = await callModelJson(cfg, batchFinalSystem(language), '以下 JSON 数组是 ' + docs.length + ' 篇文章各自的要点：\n\n' + JSON.stringify(compact), 5000, signal)
    const fp = finalParsed !== null && typeof finalParsed === 'object' ? finalParsed : {}
    return {
      kind: 'batch',
      title: str(fp.title, docs.length + ' 篇文章对比'),
      summary: str(fp.synthesis, ''), thesis: str(fp.synthesis, ''),
      arguments: [], quotes: [], concepts: [], questions: arr(fp.questions).slice(0, 5).map((x) => String(x)),
      structure: [], chapters: [], citations: [],
      items: docs,
      comparison: {
        comparison: sanitizeComparison(fp.comparison, 8),
        conflicts: sanitizeComparison(fp.conflicts, 6),
        complementarity: str(fp.complementarity, ''),
        synthesis: str(fp.synthesis, ''),
      },
      meta: { source: docs.length + ' 篇文档', sourceKind: 'batch', chars: totalChars, chunks: docs.length, depth: 'batch', durationMs: Date.now() - started },
    }
  }

  function normalizeDepth(d) {
    return d === 'quick' ? 'quick' : (d === 'book' ? 'book' : (d === 'map' ? 'map' : (d === 'feynman' ? 'feynman' : 'deep')))
  }

  async function computeResult(input, opts) {
    const opt = opts !== null && typeof opts === 'object' ? opts : {}
    const args = input !== null && typeof input === 'object' ? input : {}
    const started = Date.now()
    const depth = normalizeDepth(args.depth)
    const language = args.language === 'en' ? 'en' : (args.language === 'zh' ? 'zh' : 'auto')
    const focus = typeof args.focus === 'string' ? args.focus : ''
    const onProgress = typeof opt.onProgress === 'function' ? opt.onProgress : null
    const signal = opt.signal !== undefined && opt.signal !== null ? opt.signal : null
    const llmStart = { calls: llmCallStats.calls, ms: llmCallStats.ms }

    let src
    let text
    let resolveMs = 0
    if (opt.preResolved !== undefined && opt.preResolved !== null) {
      src = opt.preResolved.src
      text = opt.preResolved.text
      resolveMs = typeof opt.preResolved.resolveMs === 'number' ? opt.preResolved.resolveMs : 0
    } else {
      const t0 = Date.now()
      src = args.estimate === true ? await resolveForEstimate(args) : await resolveSource(args, { onProgress })
      resolveMs = Date.now() - t0
      text = String(src.text).replace(/\r\n/g, '\n')
    }
    // 先解析来源再加载校准：若 storage 后端单文件复用了 URL 缓存域，加载会因域名校验失败而自动降级为仅内存，
    // 避免把校准记录写进 URL 缓存文件造成覆盖。
    await loadCalibration()
    const extractMs = typeof src.extractMs === 'number' ? src.extractMs : 0
    const source = src.source
    const sourceKind = src.sourceKind
    const cacheFields = {
      ...(typeof src.cache === 'string' ? { cache: src.cache } : {}),
      ...(typeof src.fetchedAt === 'string' ? { fetchedAt: src.fetchedAt } : {}),
      ...(typeof src.note === 'string' && src.note !== '' ? { note: src.note } : {}),
    }
    const buildStages = () => ({
      resolveMs: Math.round(resolveMs),
      extractMs: Math.round(extractMs),
      llmMs: Math.round(llmCallStats.ms - llmStart.ms),
      calls: llmCallStats.calls - llmStart.calls,
    })

    if (args.estimate === true) {
      let estimate
      let chars
      const pdfStats = src.pdfStats !== undefined && src.pdfStats !== null ? src.pdfStats : null
      if (pdfStats !== null) {
        const sampleChars = typeof pdfStats.sampleChars === 'number' ? pdfStats.sampleChars : 0
        const samplePages = typeof pdfStats.samplePages === 'number' && pdfStats.samplePages > 0 ? pdfStats.samplePages : 2
        const pages = typeof pdfStats.pages === 'number' ? pdfStats.pages : 1
        const fullChars = Math.max(1, Math.round((sampleChars / samplePages) * pages))
        const sampleTokens = typeof pdfStats.sampleTokens === 'number' ? pdfStats.sampleTokens : 0
        const tokensPerChar = sampleChars > 0 && sampleTokens > 0 ? sampleTokens / sampleChars : 0.6
        estimate = buildEstimate('', depth, { chars: fullChars, tokensPerChar })
        chars = fullChars
      } else {
        estimate = buildEstimate(text, depth)
        chars = text.length
      }
      return {
        kind: 'estimate', title: '预算预检', summary: '不调用模型，仅按字数与模式估算 token 与耗时。', thesis: '',
        arguments: [], quotes: [], concepts: [], questions: [], structure: [], chapters: [],
        estimate,
        meta: { ...cacheFields, source, sourceKind, chars, depth, estimate, durationMs: Date.now() - started, stages: buildStages(), ...(pdfStats !== null ? { pdfStats } : {}) },
      }
    }

    if (text.trim() === '') throw new Error('没有可分析的内容')
    if (text.length > tune.maxInputChars) text = text.slice(0, tune.maxInputChars)
    const estimate = buildEstimate(text, depth)

    const cfg = await pickConfig()

    if (depth === 'quick') {
      const limited = text.length > 30000 ? text.slice(0, 30000) : text
      const parsed = await callModelJson(cfg, sectionSystem('quick', language, focus), sectionUser(limited, 0, 1), 2500, signal)
      if (parsed === null) throw new Error('模型输出无法解析为 JSON，请重试')
      const s = sanitizeSection(parsed, '未命名内容')
      return {
        kind: 'article', title: s.title, summary: s.summary, thesis: s.thesis,
        arguments: s.arguments, quotes: s.quotes, concepts: s.concepts, questions: s.questions,
        structure: [], chapters: [], citations: [],
        meta: { ...cacheFields, source, sourceKind, chars: limited.length, chunks: 1, depth: 'quick', estimate, durationMs: Date.now() - started, stages: buildStages() },
      }
    }

    if (depth === 'map') {
      if (text.length <= 9000) {
        const parsed = await callModelJson(cfg, mapSystem(language, focus, false), mapUser(text), 5000, signal)
        if (parsed === null) throw new Error('模型输出无法解析为 JSON，请重试')
        return sanitizeMap(parsed, [], { ...cacheFields, source, sourceKind, chars: text.length, chunks: 1, depth: 'map', estimate, durationMs: Date.now() - started, stages: buildStages() })
      }
      const chapters = []
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      for (let i = 0; i < parts.length; i++) {
        if (onProgress !== null) onProgress('精读第 ' + (i + 1) + '/' + parts.length + ' 段…')
        const parsed = await callModelJson(cfg, sectionSystem('deep', language, focus), sectionUser(parts[i], i, parts.length), 5000, signal)
        const s = sanitizeSection(parsed === null ? {} : parsed, '第 ' + (i + 1) + ' 部分')
        chapters.push({ title: s.title, summary: s.summary, thesis: s.thesis, arguments: s.arguments, quotes: s.quotes })
        if (onProgress !== null) onProgress('完成第 ' + (i + 1) + '/' + parts.length + ' 段')
      }
      const condensed = chapters.map((c) => ({ title: c.title, summary: c.summary, thesis: c.thesis, arguments: c.arguments.slice(0, 3) }))
      if (onProgress !== null) onProgress('汇总中…')
      const finalParsed = await callModelJson(cfg, mapSystem(language, focus, true), mapFinalUser(condensed, text.length), 5000, signal)
      if (finalParsed === null) throw new Error('模型输出无法解析为 JSON，请重试')
      return sanitizeMap(finalParsed, chapters, { ...cacheFields, source, sourceKind, chars: text.length, chunks: chapters.length, depth: 'map', estimate, durationMs: Date.now() - started, stages: buildStages() })
    }

    if (depth === 'feynman') {
      const isBook = text.length > 9000
      let toc = []
      let questions = []
      if (isBook) {
        const structParsed = await callModelJson(cfg, feynmanStructSystem(language), '请浏览目录并提出阅读问题：\n\n' + text.slice(0, 5000), 2500, signal)
        if (structParsed !== null) {
          toc = arr(structParsed.toc).slice(0, 30).map((x) => String(x).trim()).filter((x) => x !== '')
          questions = arr(structParsed.questions).slice(0, 6).map((x) => String(x).trim()).filter((x) => x !== '')
        }
      }
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      const feynmanChapters = []
      for (let i = 0; i < parts.length; i++) {
        if (onProgress !== null) onProgress('精读第 ' + (i + 1) + '/' + parts.length + ' 段…')
        const parsed = await callModelJson(cfg, feynmanChapterSystem(language, focus), feynmanChapterUser(parts[i], i + 1, parts.length), 5000, signal)
        feynmanChapters.push(sanitizeFeynmanChapter(parsed, i + 1))
        if (onProgress !== null) onProgress('完成第 ' + (i + 1) + '/' + parts.length + ' 段')
      }
      const compact = feynmanChapters.map((c) => ({ title: c.title, points: c.points.slice(0, 3), explanation: c.explanation.slice(0, 300) }))
      if (onProgress !== null) onProgress('汇总中…')
      const finalParsed = await callModelJson(cfg, feynmanFinalSystem(language), feynmanFinalUser(compact), 5000, signal)
      const fp = finalParsed !== null && typeof finalParsed === 'object' ? finalParsed : {}
      const reviewPlan = arr(fp.reviewPlan).slice(0, 5).map((r) => {
        const ro = r !== null && typeof r === 'object' ? r : { interval: String(r) }
        return { interval: str(ro.interval, ''), focus: str(ro.focus, ''), method: str(ro.method, '') }
      }).filter((r) => r.interval !== '')
      const first = feynmanChapters[0] || {}
      const firstClaim = first.points !== undefined && first.points.length > 0 ? first.points[0].claim : ''
      return {
        kind: 'feynman',
        title: str(fp.title, isBook ? '费曼读书报告' : '费曼精读报告'),
        summary: str(fp.summary, typeof first.explanation === 'string' ? first.explanation.slice(0, 100) : ''),
        thesis: str(fp.thesis, firstClaim),
        toc: toc,
        questions: questions,
        feynmanChapters: feynmanChapters,
        bookMap: str(fp.bookMap, ''),
        finalExplanation: str(fp.finalExplanation, ''),
        reviewPlan: reviewPlan,
        arguments: [],
        quotes: [],
        concepts: [],
        structure: [],
        chapters: [],
        meta: { ...cacheFields, source, sourceKind, chars: text.length, chunks: feynmanChapters.length, depth: 'feynman', estimate, durationMs: Date.now() - started, stages: buildStages() },
      }
    }

    const chunked = depth === 'book' || text.length > 9000
    const chapters = []
    if (chunked) {
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      for (let i = 0; i < parts.length; i++) {
        if (onProgress !== null) onProgress('精读第 ' + (i + 1) + '/' + parts.length + ' 段…')
        const parsed = await callModelJson(cfg, sectionSystem('deep', language, focus), sectionUser(parts[i], i, parts.length), 5000, signal)
        const s = sanitizeSection(parsed === null ? {} : parsed, '第 ' + (i + 1) + ' 部分')
        chapters.push({ title: s.title, summary: s.summary, thesis: s.thesis, arguments: s.arguments, quotes: s.quotes })
        if (onProgress !== null) onProgress('完成第 ' + (i + 1) + '/' + parts.length + ' 段')
      }
    }

    let finalParsed = null
    if (chapters.length > 0) {
      if (onProgress !== null) onProgress('汇总中…')
      const parts = chapters.map((c) => ({ title: c.title, summary: c.summary, thesis: c.thesis, arguments: c.arguments.slice(0, 3) }))
      finalParsed = await callModelJson(cfg, finalSystem(language), finalUserFromParts(parts, text.length), 5000, signal)
    } else {
      finalParsed = await callModelJson(cfg, sectionSystem('deep', language, focus), sectionUser(text, 0, 1), 4000, signal)
    }

    if (finalParsed === null) {
      if (chapters.length > 0) {
        const first = chapters[0]
        return {
          kind: depth === 'book' ? 'book' : 'article',
          title: first.title, summary: first.summary, thesis: first.thesis,
          arguments: first.arguments, quotes: first.quotes, concepts: [], questions: [],
          structure: [], chapters, citations: [],
          meta: { ...cacheFields, source, sourceKind, chars: text.length, chunks: chapters.length, depth, estimate, durationMs: Date.now() - started, stages: buildStages(), note: (typeof src.note === 'string' && src.note !== '' ? src.note + '；' : '') + '综合阶段输出解析失败，已回退为各部分要点' },
        }
      }
      throw new Error('模型输出无法解析为 JSON，请重试')
    }

    const fin = sanitizeSection(finalParsed, chapters.length > 0 ? chapters[0].title : '未命名内容')
    const structure = arr(finalParsed.structure).slice(0, 12).map((x) => String(x).trim()).filter((x) => x !== '')
    const citations = sanitizeCitations(finalParsed.citations)
    return {
      kind: depth === 'book' ? 'book' : 'article',
      title: fin.title, summary: fin.summary, thesis: fin.thesis,
      arguments: fin.arguments, quotes: fin.quotes, concepts: fin.concepts, questions: fin.questions,
      structure, chapters, citations,
      meta: { ...cacheFields, source, sourceKind, chars: text.length, chunks: chunked ? chapters.length : 1, depth, estimate, durationMs: Date.now() - started, stages: buildStages() },
    }
  }

  function cacheLabel(meta) {
    const fetched = typeof meta.fetchedAt === 'string' ? meta.fetchedAt.replace('T', ' ').slice(0, 16) : ''
    if (meta.cache === 'hit') return '缓存命中（抓取于 ' + fetched + '，未重新联网）'
    if (meta.cache === 'fallback') return '回退缓存（抓取于 ' + fetched + '）'
    if (meta.cache === 'miss') return '已重新抓取并写入缓存'
    if (meta.cache === 'disabled') return '缓存已禁用'
    return ''
  }

  function metaFooter(meta) {
    const cacheText = cacheLabel(meta)
    let estText = ''
    const est = meta !== null && typeof meta === 'object' && meta.estimate !== null && typeof meta.estimate === 'object' ? meta.estimate : null
    if (est !== null && Array.isArray(est.modes)) {
      const row = est.modes.find((mm) => mm !== null && typeof mm === 'object' && mm.mode === meta.depth) || null
      if (row !== null && typeof row.calls === 'number') estText = ' · 本次预算：约 ' + row.calls + ' 次调用 / ' + row.totalTokens + ' token / ≈' + row.minutes + ' 分钟'
    }
    let execText = ''
    const st = meta !== null && typeof meta === 'object' ? meta.stages : null
    if (st !== null && typeof st === 'object') {
      const bits = []
      if (typeof meta.chunks === 'number' && meta.chunks > 0) bits.push('分段 ' + meta.chunks)
      if (typeof st.resolveMs === 'number') bits.push('抓取 ' + fmtSec(st.resolveMs) + 's')
      if (typeof st.extractMs === 'number' && st.extractMs > 0) bits.push('解析 ' + fmtSec(st.extractMs) + 's')
      if (typeof st.calls === 'number') bits.push('模型 ' + st.calls + ' 次 ' + fmtSec(st.llmMs) + 's')
      const total = (typeof st.resolveMs === 'number' ? st.resolveMs : 0) + (typeof st.extractMs === 'number' ? st.extractMs : 0) + (typeof st.llmMs === 'number' ? st.llmMs : 0)
      if (total > 0) bits.push('总 ' + fmtSec(total) + 's')
      if (bits.length > 0) execText = ' · ' + bits.join(' · ')
    }
    return '（来源：' + str(meta.source, '粘贴文本') + ' · 字数：' + (typeof meta.chars === 'number' ? meta.chars : 0) + ' · 深度：' + str(meta.depth, 'deep') + (cacheText !== '' ? ' · ' + cacheText : '') + estText + execText + '）'
  }

  function fmtSec(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '0'
    const s = Math.round(ms / 100) / 10
    return (Number.isInteger(s) ? String(s) : String(s))
  }

  function renderFeynmanMarkdown(v) {
    const lines = ['# 🧠 费曼读书报告：' + str(v.title, '未命名')]
    if (str(v.summary, '') !== '') lines.push('', '**一句话总结**：' + v.summary)
    if (str(v.thesis, '') !== '') lines.push('', '**核心论点**：' + v.thesis)
    if (arr(v.toc).length > 0) {
      lines.push('', '**目录**：')
      arr(v.toc).forEach((t) => lines.push('- ' + t))
    }
    const qs = arr(v.questions)
    if (qs.length > 0) {
      lines.push('', '**阅读问题清单**：')
      qs.forEach((q, i) => lines.push((i + 1) + '. ' + q))
    }
    arr(v.feynmanChapters).forEach((ch) => {
      const o = ch !== null && typeof ch === 'object' ? ch : {}
      lines.push('', '## 第 ' + o.index + ' 章：' + str(o.title, ''))
      const pts = arr(o.points)
      if (pts.length > 0) {
        lines.push('', '**观点 · 数据 · 证据**：')
        pts.forEach((p, i) => {
          const po = p !== null && typeof p === 'object' ? p : { claim: String(p) }
          lines.push((i + 1) + '. ' + str(po.claim, '') + (str(po.data, '') !== '' ? '（数据：' + po.data + '）' : '') + (str(po.evidence, '') !== '' ? ' —— 证据：' + po.evidence : ''))
        })
      }
      if (str(o.chapterMap, '') !== '') lines.push('', '**章节导图**：', '```mermaid', o.chapterMap, '```')
      if (str(o.explanation, '') !== '') lines.push('', '**费曼讲解（合上书）**：', o.explanation)
      const gaps = arr(o.gaps)
      if (gaps.length > 0) lines.push('', '**知识缺口**：', gaps.map((g) => '- ' + g).join('\n'))
      const fixes = arr(o.corrections)
      if (fixes.length > 0) lines.push('', '**原文修正**：', fixes.map((f) => '- ' + f).join('\n'))
    })
    if (str(v.bookMap, '') !== '') lines.push('', '## 合并全书导图', '```mermaid', v.bookMap, '```')
    if (str(v.finalExplanation, '') !== '') lines.push('', '## 再讲一次（全书终讲）', v.finalExplanation)
    const rp = arr(v.reviewPlan)
    if (rp.length > 0) {
      lines.push('', '## 间隔复习计划')
      rp.forEach((r) => {
        const ro = r !== null && typeof r === 'object' ? r : { interval: String(r) }
        lines.push('- **' + str(ro.interval, '') + '**：' + str(ro.focus, '') + (str(ro.method, '') !== '' ? '（' + ro.method + '）' : ''))
      })
    }
    lines.push('', '---', '', metaFooter(v.meta !== null && typeof v.meta === 'object' ? v.meta : {}))
    return lines.join('\n')
  }

  function renderMapMarkdown(v) {
    const lines = ['# 🗺️ 知识地图：' + str(v.title, '未命名')]
    if (str(v.summary, '') !== '') lines.push('', '**摘要**：' + v.summary)
    if (str(v.coreQuestion, '') !== '') lines.push('', '**核心问题**：' + v.coreQuestion)
    const cons = arr(v.coreConclusions)
    if (cons.length > 0) {
      lines.push('', '**核心结论**：')
      cons.forEach((c, i) => lines.push((i + 1) + '. ' + c))
    }
    const items = arr(v.items)
    if (items.length > 0) {
      lines.push('', '**观点与证据表**：')
      items.forEach((it, i) => {
        const o = it !== null && typeof it === 'object' ? it : {}
        lines.push((i + 1) + '. [' + str(o.type, '分论点') + '] ' + str(o.claim, ''))
        lines.push('   证据：' + str(o.evidence, '原文未提供证据') + (str(o.source, '') !== '' ? '（' + o.source + '）' : '') + (str(o.confidence, '') !== '' ? ' [' + o.confidence + ']' : ''))
        arr(o.relations).forEach((r) => {
          const ro = r !== null && typeof r === 'object' ? r : {}
          if (str(ro.to, '') !== '') lines.push('   ↳ ' + str(ro.type, '支持') + ' → ' + ro.to)
        })
      })
    }
    const dps = arr(v.dataPoints)
    if (dps.length > 0) {
      lines.push('', '**关键数据表**：')
      dps.forEach((d) => {
        const o = d !== null && typeof d === 'object' ? d : {}
        lines.push('- ' + str(o.value, '') + (str(o.period, '') !== '' ? ' · 时间：' + o.period : '') + (str(o.subject, '') !== '' ? ' · 对象：' + o.subject : '') + (str(o.baseline, '') !== '' ? ' · 基准：' + o.baseline : '') + (str(o.source, '') !== '' ? ' · 来源：' + o.source : '') + (str(o.location, '') !== '' ? ' · 位置：' + o.location : ''))
      })
    }
    const cvs = arr(v.caveats)
    if (cvs.length > 0) {
      lines.push('', '**反对意见与局限**：')
      cvs.forEach((c) => lines.push('- ' + c))
    }
    if (str(v.mermaid, '') !== '') lines.push('', '**Mermaid 思维导图**：', '```mermaid', v.mermaid, '```')
    if (str(v.xmindOutline, '') !== '') lines.push('', '**XMind 大纲**：', '```markdown', v.xmindOutline, '```')
    const qs = arr(v.recallQuestions)
    if (qs.length > 0) {
      lines.push('', '**主动回忆问题**：')
      qs.forEach((q, i) => lines.push((i + 1) + '. ' + q))
    }
    lines.push('', '---', '', metaFooter(v.meta !== null && typeof v.meta === 'object' ? v.meta : {}))
    return lines.join('\n')
  }

  function renderEstimateMarkdown(v) {
    const est = v.estimate !== null && typeof v.estimate === 'object' ? v.estimate : {}
    const lines = ['# 🧮 预算预检：' + str(v.meta !== null && typeof v.meta === 'object' ? v.meta.source : '', '内容')]
    const tps = typeof est.estTokensPerSecond === 'number' ? est.estTokensPerSecond : DEFAULT_RATE_TOK_PER_SEC
    const lat = typeof est.estLatencyPerCallMs === 'number' ? est.estLatencyPerCallMs : 800
    if (est.batch === true) {
      lines.push('', '**口径**：中文≈0.6 token/字，拉丁≈0.25 token/字符；时间=(总token÷' + tps + ' tok/s)+(调用次数×' + lat + 'ms)。', '')
      const rows = arr(est.items)
      rows.forEach((r) => {
        const ro = r !== null && typeof r === 'object' ? r : {}
        const q = ro.quick !== null && typeof ro.quick === 'object' ? ro.quick : {}
        lines.push('- **' + (typeof ro.index === 'number' ? '#' + ro.index + ' ' : '') + str(ro.title, '未命名') + '**（' + (typeof ro.chars === 'number' ? ro.chars : 0) + ' 字）· 1 次调用 · 约 ' + (typeof q.totalTokens === 'number' ? q.totalTokens : 0) + ' token · 约 ' + (typeof q.minutes === 'number' ? q.minutes : 0) + ' 分钟')
      })
      lines.push('- **跨篇对比**（1 次）· 约 ' + (est.finalCall !== null && typeof est.finalCall === 'object' && typeof est.finalCall.totalTokens === 'number' ? est.finalCall.totalTokens : 0) + ' token')
      lines.push('', '**合计**：' + (typeof est.totalCalls === 'number' ? est.totalCalls : 0) + ' 次调用 · 约 ' + (typeof est.totalTokens === 'number' ? est.totalTokens : 0) + ' token · 预计 ' + (typeof est.totalMinutes === 'number' ? est.totalMinutes : 0) + ' 分钟')
      if (est.calibrated === true) lines.push('', '> 已使用运行时实测校准速率（' + tps + ' tok/s / ' + lat + 'ms）。')
    } else {
      lines.push('', '**口径**：中文≈0.6 token/字，拉丁≈0.25 token/字符；输出按各阶段预算计；时间=(总token÷' + tps + ' tok/s)+(调用次数×' + lat + 'ms)。', '', '| 模式 | 调用次数 | 输入 token | 输出 token | 总 token | 预计耗时 | 说明 |', '| --- | --- | --- | --- | --- | --- | --- |')
      const modes = arr(est.modes)
      modes.forEach((mm) => {
        const mo = mm !== null && typeof mm === 'object' ? mm : {}
        lines.push('| ' + str(mo.mode, '') + ' | ' + (typeof mo.calls === 'number' ? mo.calls : 0) + ' | ' + (typeof mo.inputTokens === 'number' ? mo.inputTokens : 0) + ' | ' + (typeof mo.outputTokens === 'number' ? mo.outputTokens : 0) + ' | ' + (typeof mo.totalTokens === 'number' ? mo.totalTokens : 0) + ' | ' + (typeof mo.minutes === 'number' ? '≈ ' + mo.minutes + ' 分钟' : '') + ' | ' + str(mo.note, '') + ' |')
      })
      if (typeof est.chars === 'number') lines.push('', '输入字数：' + est.chars + '（超过 ' + tune.maxInputChars + ' 会被截断）')
      if (est.sampled === true) lines.push('', '> 本预检采用 PDF 采样外推（前 2 页字数 ÷ 2 × 总页数），仅作数量级参考。')
      if (est.calibrated === true) lines.push('', '> 已使用运行时实测校准速率（' + tps + ' tok/s / ' + lat + 'ms）。')
      lines.push('', '> 估算基于本地字数启发式与默认速率/延迟，实际取决于模型速度、负载与网络。')
    }
    return lines.join('\n')
  }

  function renderBatchMarkdown(v) {
    const lines = ['# 🔀 跨篇对比：' + str(v.title, '批量精读')]
    if (str(v.summary, '') !== '') lines.push('', '**综合结论**：' + v.summary)
    const items = arr(v.items)
    if (items.length > 0) {
      lines.push('', '## 各篇速览')
      items.forEach((it) => {
        const io = it !== null && typeof it === 'object' ? it : {}
        lines.push('', '### ' + (typeof io.index === 'number' ? io.index + '. ' : '') + str(io.title, '未命名') + (typeof io.chars === 'number' ? '（' + io.chars + ' 字）' : ''))
        if (str(io.thesis, '') !== '') lines.push('- 核心论点：' + io.thesis)
        if (str(io.summary, '') !== '') lines.push('- 摘要：' + io.summary)
      })
    }
    const cmp = v.comparison !== null && typeof v.comparison === 'object' ? v.comparison : {}
    const themes = arr(cmp.comparison)
    if (themes.length > 0) {
      lines.push('', '## 对比矩阵')
      themes.forEach((c, i) => {
        const co = c !== null && typeof c === 'object' ? c : {}
        lines.push('', '### ' + (i + 1) + '. ' + str(co.theme, ''))
        arr(co.positions).forEach((p) => {
          const po = p !== null && typeof p === 'object' ? p : {}
          lines.push('- **' + str(po.doc, '') + '**：' + str(po.view, ''))
        })
      })
    }
    const conflicts = arr(cmp.conflicts)
    if (conflicts.length > 0) {
      lines.push('', '## 冲突点')
      conflicts.forEach((c, i) => {
        const co = c !== null && typeof c === 'object' ? c : {}
        lines.push('', '### ' + (i + 1) + '. ' + str(co.theme, ''))
        arr(co.positions).forEach((p) => {
          const po = p !== null && typeof p === 'object' ? p : {}
          lines.push('- **' + str(po.doc, '') + '**：' + str(po.view, ''))
        })
      })
    }
    if (str(cmp.complementarity, '') !== '') lines.push('', '## 互补关系', cmp.complementarity)
    const qs = sanitizeQuestions(v.questions)
    if (qs.length > 0) {
      lines.push('', '## 跨篇追问')
      qs.forEach((q, i) => lines.push((i + 1) + '. ' + q))
    }
    lines.push('', '---', '', metaFooter(v.meta !== null && typeof v.meta === 'object' ? v.meta : {}))
    return lines.join('\n')
  }

  function renderMarkdown(v) {
    if (v.kind === 'background') return '已启动后台精读任务 ' + str(v.jobId, '') + '（' + str(v.label, '') + '）。\n用 job_output 读取进度与最终报告；job_kill 可取消。'
    if (v.kind === 'map') return renderMapMarkdown(v)
    if (v.kind === 'feynman') return renderFeynmanMarkdown(v)
    if (v.kind === 'estimate') return renderEstimateMarkdown(v)
    if (v.kind === 'batch') return renderBatchMarkdown(v)
    const lines = ['# 📖 精读报告：' + str(v.title, '未命名')]
    if (str(v.summary, '') !== '') lines.push('', '**一句话总结**：' + v.summary)
    if (str(v.thesis, '') !== '') lines.push('', '**核心论点**：' + v.thesis)
    const args2 = sanitizeArguments(v.arguments)
    if (args2.length > 0) {
      lines.push('', '**论证结构**：')
      args2.forEach((a, i) => {
        lines.push((i + 1) + '. ' + a.claim + (a.evidence !== '' ? ' —— 论据：' + a.evidence : ''))
      })
    }
    if (arr(v.structure).length > 0) lines.push('', '**论证脉络**：' + arr(v.structure).join(' → '))
    const cons = sanitizeConcepts(v.concepts)
    if (cons.length > 0) lines.push('', '**核心概念**：' + cons.map((c) => c.term + (c.explanation !== '' ? '（' + c.explanation + '）' : '')).join('；'))
    const qts = sanitizeQuotes(v.quotes)
    if (qts.length > 0) {
      lines.push('', '**金句摘录**：')
      qts.forEach((q) => lines.push('- “' + q.text + '”' + (q.source !== '' ? '（' + q.source + '）' : '')))
    }
    const cits = sanitizeCitations(v.citations)
    if (cits.length > 0) {
      lines.push('', '**引用溯源**：')
      cits.forEach((c, i) => {
        lines.push((i + 1) + '. ' + c.claim + (c.source !== '' ? ' — 位置：' + c.source : '') + (c.quote !== '' ? ' — 原文：“' + c.quote + '”' : ''))
      })
    }
    if (arr(v.chapters).length > 0) {
      lines.push('', '**各部分脉络**：')
      arr(v.chapters).forEach((c, i) => {
        const co = c !== null && typeof c === 'object' ? c : {}
        lines.push((i + 1) + '. ' + str(co.title, '第 ' + (i + 1) + ' 部分') + (str(co.summary, '') !== '' ? '：' + co.summary : ''))
      })
    }
    const qs = sanitizeQuestions(v.questions)
    if (qs.length > 0) {
      lines.push('', '**批判性思考**：')
      qs.forEach((q) => lines.push('- ' + q))
    }
    const meta = v.meta !== null && typeof v.meta === 'object' ? v.meta : {}
    lines.push('', '---', '', metaFooter(meta))
    return lines.join('\n')
  }

  // ---------- 导出（md / mm FreeMind / html 编辑风网页报告） ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  let NODE_SEQ = 0
  function node(title, children) {
    const id = 'n' + (++NODE_SEQ)
    const t = { id, class: 'topic', title: String(title) }
    if (children !== undefined && children.length > 0) t.children = { attached: children }
    return t
  }

  function buildMindTree(v) {
    NODE_SEQ = 0
    const title = typeof v.title === 'string' && v.title !== '' ? v.title : '精读报告'
    const root = node(title)
    if (v.kind === 'map') {
      const kids = []
      if (typeof v.coreQuestion === 'string' && v.coreQuestion !== '') kids.push(node('核心问题', [node(v.coreQuestion)]))
      const cons = Array.isArray(v.coreConclusions) ? v.coreConclusions : []
      if (cons.length > 0) kids.push(node('核心结论', cons.map((c) => node(String(c)))))
      const items = Array.isArray(v.items) ? v.items : []
      const groups = {}
      for (const it of items) {
        const o = it !== null && typeof it === 'object' ? it : { claim: String(it) }
        const t = typeof o.type === 'string' && o.type !== '' ? o.type : '分论点'
        if (groups[t] === undefined) groups[t] = []
        groups[t].push(o)
      }
      for (const t of ['分论点', '原因或作用机制', '事实', '案例', '限制条件', '可执行建议']) {
        const g = groups[t]
        if (g === undefined || g.length === 0) continue
        kids.push(node(t, g.map((o) => {
          const ev = typeof o.evidence === 'string' && o.evidence !== '' && o.evidence !== '原文未提供证据' ? o.evidence.slice(0, 80) : null
          return node((typeof o.claim === 'string' ? o.claim : '').slice(0, 60), ev !== null ? [node('证据：' + ev)] : undefined)
        })))
      }
      const dps = Array.isArray(v.dataPoints) ? v.dataPoints : []
      if (dps.length > 0) kids.push(node('关键数据', dps.map((d) => {
        const o = d !== null && typeof d === 'object' ? d : { value: String(d) }
        return node((typeof o.value === 'string' ? o.value : '').slice(0, 60))
      })))
      const caveats = Array.isArray(v.caveats) ? v.caveats : []
      if (caveats.length > 0) kids.push(node('反对意见与局限', caveats.map((c) => node(String(c).slice(0, 60)))))
      const rqs = Array.isArray(v.recallQuestions) ? v.recallQuestions : []
      if (rqs.length > 0) kids.push(node('主动回忆问题', rqs.map((q) => node(String(q).slice(0, 60)))))
      root.children = { attached: kids }
      return root
    }
    if (v.kind === 'feynman') {
      const kids = []
      if (arr(v.toc).length > 0) kids.push(node('目录', arr(v.toc).map((t) => node(String(t).slice(0, 50)))))
      const qs = arr(v.questions)
      if (qs.length > 0) kids.push(node('阅读问题', qs.map((q) => node(String(q).slice(0, 50)))))
      const chs = arr(v.feynmanChapters)
      if (chs.length > 0) {
        kids.push(node('章节', chs.map((c) => {
          const o = c !== null && typeof c === 'object' ? c : {}
          const pts = arr(o.points).slice(0, 4).map((p) => {
            const po = p !== null && typeof p === 'object' ? p : { claim: String(p) }
            return node(String(str(po.claim, '')).slice(0, 50))
          })
          return node('第 ' + o.index + ' 章 ' + String(str(o.title, '')).slice(0, 30), pts)
        })))
      }
      const rp = arr(v.reviewPlan)
      if (rp.length > 0) kids.push(node('间隔复习', rp.map((r) => {
        const ro = r !== null && typeof r === 'object' ? r : { interval: String(r) }
        return node(String(str(ro.interval, '') + ' ' + str(ro.focus, '')).slice(0, 50))
      })))
      root.children = { attached: kids }
      return root
    }
    const kids = []
    if (typeof v.thesis === 'string' && v.thesis !== '') kids.push(node('核心论点', [node(v.thesis)]))
    const args = Array.isArray(v.arguments) ? v.arguments : []
    if (args.length > 0) {
      kids.push(node('论证结构', args.map((a) => {
        const o = a !== null && typeof a === 'object' ? a : { claim: String(a) }
        const ev = typeof o.evidence === 'string' && o.evidence !== '' ? o.evidence.slice(0, 80) : null
        return node((typeof o.claim === 'string' ? o.claim : '').slice(0, 60), ev !== null ? [node('论据：' + ev)] : undefined)
      })))
    }
    const quotes = Array.isArray(v.quotes) ? v.quotes : []
    if (quotes.length > 0) kids.push(node('金句摘录', quotes.map((q) => {
      const o = q !== null && typeof q === 'object' ? q : { text: String(q) }
      return node((typeof o.text === 'string' ? o.text : '').slice(0, 60))
    })))
    const chapters = Array.isArray(v.chapters) ? v.chapters : []
    if (chapters.length > 0) {
      kids.push(node('章节脉络', chapters.map((c) => {
        const o = c !== null && typeof c === 'object' ? c : {}
        const sum = typeof o.summary === 'string' && o.summary !== '' ? o.summary.slice(0, 60) : null
        return node((typeof o.title === 'string' ? o.title : '').slice(0, 50), sum !== null ? [node(sum)] : undefined)
      })))
    }
    root.children = { attached: kids }
    return root
  }

  function buildFreeMind(v) {
    const root = buildMindTree(v)
    const xml = (n, depth) => {
      const ind = '  '.repeat(depth)
      const kids = n.children !== undefined && n.children.attached !== undefined ? n.children.attached : []
      const t = esc(n.title)
      if (kids.length === 0) return ind + '<node TEXT="' + t + '"/>'
      return ind + '<node TEXT="' + t + '">\n' + kids.map((k) => xml(k, depth + 1)).join('\n') + '\n' + ind + '</node>'
    }
    return '<map version="1.0.1">\n' + xml(root, 1) + '\n</map>'
  }

  function confClass(c) {
    if (c === '作者原意') return 'c-author'
    if (c === '原文事实与数据') return 'c-fact'
    if (c === '合理推断') return 'c-infer'
    if (c === '无法确认') return 'c-unknown'
    return ''
  }

  function htmlTree(n, depth) {
    const cls = depth === 0 ? 't0' : depth === 1 ? 't1' : 't2'
    let h = '<li><div class="node ' + cls + '">' + esc(n.title) + '</div>'
    const kids = n.children !== undefined && n.children.attached !== undefined ? n.children.attached : []
    if (kids.length > 0) h += '<ul>' + kids.map((k) => htmlTree(k, depth + 1)).join('') + '</ul>'
    return h + '</li>'
  }

  function buildHtml(v) {
    const title = typeof v.title === 'string' && v.title !== '' ? v.title : '精读报告'
    const meta = v.meta !== null && typeof v.meta === 'object' ? v.meta : {}
    const isMap = v.kind === 'map'
    const isFeynman = v.kind === 'feynman'
    const depthLabel = { quick: '快速要点', deep: '深度精读', book: '全书精读', map: '知识地图', feynman: '费曼读书法' }[meta.depth] || '精读'
    const sections = []
    const add = (t, h) => sections.push('<section class="sec"><h2><span class="num">' + String(sections.length + 1).padStart(2, '0') + '</span>' + esc(t) + '</h2>' + h + '</section>')
    if (isMap) {
      if (typeof v.summary === 'string' && v.summary !== '') add('摘要', '<p class="lead">' + esc(v.summary) + '</p>')
      if (typeof v.coreQuestion === 'string' && v.coreQuestion !== '') add('核心问题', '<div class="hl"><span class="hl-label">作者试图回答</span>' + esc(v.coreQuestion) + '</div>')
      const cons = Array.isArray(v.coreConclusions) ? v.coreConclusions : []
      if (cons.length > 0) add('核心结论', '<ol class="concl">' + cons.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ol>')
      const items = Array.isArray(v.items) ? v.items : []
      const groups = {}
      for (const it of items) {
        const o = it !== null && typeof it === 'object' ? it : { claim: String(it) }
        const t = typeof o.type === 'string' && o.type !== '' ? o.type : '分论点'
        if (groups[t] === undefined) groups[t] = []
        groups[t].push(o)
      }
      const legend = '<div class="legend"><span class="legend-label">置信度</span>' + ['作者原意', '原文事实与数据', '合理推断', '无法确认'].map((c) => '<span class="chip ' + confClass(c) + '">' + c + '</span>').join('') + '</div>'
      for (const t of ['核心结论', '分论点', '原因或作用机制', '事实', '数据', '案例', '隐含前提', '反对意见', '限制条件', '可执行建议']) {
        const g = groups[t]
        if (g === undefined || g.length === 0) continue
        let h = legend
        h += g.map((o, i) => {
          const ev = typeof o.evidence === 'string' ? o.evidence : ''
          const rels = Array.isArray(o.relations) ? o.relations : []
          const cc = typeof o.confidence === 'string' ? o.confidence : ''
          let item = '<div class="item"><div class="claim"><span class="idx">' + (i + 1) + '</span>' + esc(typeof o.claim === 'string' ? o.claim : '') + '</div>'
          if (ev !== '') item += '<div class="ev' + (ev === '原文未提供证据' ? ' ev-missing' : '') + '">证据 · ' + esc(ev) + '</div>'
          const tags = []
          if (typeof o.source === 'string' && o.source !== '') tags.push('<span class="chip plain">位置 ' + esc(o.source) + '</span>')
          if (cc !== '') tags.push('<span class="chip ' + confClass(cc) + '">' + esc(cc) + '</span>')
          if (tags.length > 0) item += '<div class="tags">' + tags.join('') + '</div>'
          rels.forEach((r) => {
            const ro = r !== null && typeof r === 'object' ? r : {}
            if (typeof ro.to === 'string' && ro.to !== '') item += '<div class="rel">' + esc(typeof ro.type === 'string' ? ro.type : '支持') + ' → ' + esc(ro.to) + '</div>'
          })
          return item + '</div>'
        }).join('')
        add(t, h)
      }
      const dps = Array.isArray(v.dataPoints) ? v.dataPoints : []
      if (dps.length > 0) {
        add('关键数据', '<div class="dgrid">' + dps.map((d) => {
          const o = d !== null && typeof d === 'object' ? d : { value: String(d) }
          const bits = []
          if (typeof o.period === 'string' && o.period !== '') bits.push('<span>时间 ' + esc(o.period) + '</span>')
          if (typeof o.subject === 'string' && o.subject !== '') bits.push('<span>对象 ' + esc(o.subject) + '</span>')
          if (typeof o.baseline === 'string' && o.baseline !== '') bits.push('<span>基准 ' + esc(o.baseline) + '</span>')
          if (typeof o.source === 'string' && o.source !== '') bits.push('<span>来源 ' + esc(o.source) + '</span>')
          if (typeof o.location === 'string' && o.location !== '') bits.push('<span>位置 ' + esc(o.location) + '</span>')
          return '<div class="dcell"><div class="dval">' + esc(typeof o.value === 'string' ? o.value : '') + '</div>' + (bits.length > 0 ? '<div class="dmeta">' + bits.join('') + '</div>' : '') + '</div>'
        }).join('') + '</div>')
      }
      const caveats = Array.isArray(v.caveats) ? v.caveats : []
      if (caveats.length > 0) add('反对意见与局限', '<ul class="list">' + caveats.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>')
      if (typeof v.mermaid === 'string' && v.mermaid !== '') add('Mermaid 思维导图', '<pre class="pre">' + esc(v.mermaid) + '</pre><p class="note">复制到 mermaid.live 或支持 Mermaid 的编辑器渲染</p>')
      if (typeof v.xmindOutline === 'string' && v.xmindOutline !== '') add('XMind 大纲', '<pre class="pre">' + esc(v.xmindOutline) + '</pre>')
      const rqs = Array.isArray(v.recallQuestions) ? v.recallQuestions : []
      if (rqs.length > 0) add('主动回忆问题', '<ol class="list">' + rqs.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ol>')
    } else if (isFeynman) {
      if (typeof v.summary === 'string' && v.summary !== '') add('一句话总结', '<p class="lead">' + esc(v.summary) + '</p>')
      if (typeof v.thesis === 'string' && v.thesis !== '') add('核心论点', '<div class="hl">' + esc(v.thesis) + '</div>')
      const toc = Array.isArray(v.toc) ? v.toc : []
      if (toc.length > 0) add('浏览目录', '<ol class="list">' + toc.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ol>')
      const qs = Array.isArray(v.questions) ? v.questions : []
      if (qs.length > 0) add('阅读问题清单', '<ol class="list">' + qs.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ol>')
      const chs = Array.isArray(v.feynmanChapters) ? v.feynmanChapters : []
      for (const c of chs) {
        const o = c !== null && typeof c === 'object' ? c : {}
        let h = ''
        const pts = Array.isArray(o.points) ? o.points : []
        if (pts.length > 0) h += '<ol class="concl">' + pts.map((p) => {
          const po = p !== null && typeof p === 'object' ? p : { claim: String(p) }
          return '<li><span class="claim">' + esc(typeof po.claim === 'string' ? po.claim : '') + '</span>' + (typeof po.data === 'string' && po.data !== '' ? '<div class="ev">数据 · ' + esc(po.data) + '</div>' : '') + (typeof po.evidence === 'string' && po.evidence !== '' ? '<div class="ev">证据 · ' + esc(po.evidence) + '</div>' : '') + '</li>'
        }).join('') + '</ol>'
        if (typeof o.chapterMap === 'string' && o.chapterMap !== '') h += '<pre class="pre">' + esc(o.chapterMap) + '</pre>'
        if (typeof o.explanation === 'string' && o.explanation !== '') h += '<div class="hl"><span class="hl-label">合上书讲解</span>' + esc(o.explanation) + '</div>'
        const gaps = Array.isArray(o.gaps) ? o.gaps : []
        if (gaps.length > 0) h += '<p class="ev-missing">知识缺口：' + gaps.map((g) => esc(g)).join('；') + '</p>'
        const fixes = Array.isArray(o.corrections) ? o.corrections : []
        if (fixes.length > 0) h += '<p class="ev">原文修正：' + fixes.map((f) => esc(f)).join('；') + '</p>'
        add('第 ' + o.index + ' 章 · ' + (typeof o.title === 'string' ? o.title : ''), h)
      }
      if (typeof v.bookMap === 'string' && v.bookMap !== '') add('合并全书导图', '<pre class="pre">' + esc(v.bookMap) + '</pre>')
      if (typeof v.finalExplanation === 'string' && v.finalExplanation !== '') add('再讲一次（全书终讲）', '<div class="hl">' + esc(v.finalExplanation) + '</div>')
      const rp = Array.isArray(v.reviewPlan) ? v.reviewPlan : []
      if (rp.length > 0) add('间隔复习计划', rp.map((r) => {
        const ro = r !== null && typeof r === 'object' ? r : { interval: String(r) }
        return '<div class="it"><span class="claim">' + esc(typeof ro.interval === 'string' ? ro.interval : '') + '</span><div class="ev">' + esc(typeof ro.focus === 'string' ? ro.focus : '') + (typeof ro.method === 'string' && ro.method !== '' ? '（' + esc(ro.method) + '）' : '') + '</div></div>'
      }).join(''))
    } else {
      if (typeof v.summary === 'string' && v.summary !== '') add('一句话总结', '<p class="lead">' + esc(v.summary) + '</p>')
      if (typeof v.thesis === 'string' && v.thesis !== '') add('核心论点', '<div class="hl">' + esc(v.thesis) + '</div>')
      const args = Array.isArray(v.arguments) ? v.arguments : []
      if (args.length > 0) add('论证结构', '<ol class="concl">' + args.map((a) => {
        const o = a !== null && typeof a === 'object' ? a : { claim: String(a) }
        return '<li><span class="claim">' + esc(typeof o.claim === 'string' ? o.claim : '') + '</span>' + (typeof o.evidence === 'string' && o.evidence !== '' ? '<div class="ev">论据 · ' + esc(o.evidence) + '</div>' : '') + (typeof o.quote === 'string' && o.quote !== '' ? '<div class="quote">“' + esc(o.quote) + '”</div>' : '') + '</li>'
      }).join('') + '</ol>')
      const quotes = Array.isArray(v.quotes) ? v.quotes : []
      if (quotes.length > 0) add('金句摘录', '<ul class="list">' + quotes.map((q) => {
        const o = q !== null && typeof q === 'object' ? q : { text: String(q) }
        return '<li>“' + esc(typeof o.text === 'string' ? o.text : '') + '”' + (typeof o.context === 'string' && o.context !== '' ? '<div class="ev">' + esc(o.context) + '</div>' : '') + '</li>'
      }).join('') + '</ul>')
      const concepts = Array.isArray(v.concepts) ? v.concepts : []
      if (concepts.length > 0) add('核心概念', '<ul class="list">' + concepts.map((c) => {
        const o = c !== null && typeof c === 'object' ? c : { term: String(c) }
        return '<li><b>' + esc(typeof o.term === 'string' ? o.term : '') + '</b>' + (typeof o.explanation === 'string' && o.explanation !== '' ? ' — ' + esc(o.explanation) : '') + '</li>'
      }).join('') + '</ul>')
      const chapters = Array.isArray(v.chapters) ? v.chapters : []
      if (chapters.length > 0) add('章节脉络', '<ol class="list">' + chapters.map((c) => {
        const o = c !== null && typeof c === 'object' ? c : {}
        return '<li>' + esc(typeof o.title === 'string' ? o.title : '') + (typeof o.summary === 'string' && o.summary !== '' ? '<div class="ev">' + esc(o.summary) + '</div>' : '') + '</li>'
      }).join('') + '</ol>')
      const questions = Array.isArray(v.questions) ? v.questions : []
      if (questions.length > 0) add('批判性思考', '<ul class="list">' + questions.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul>')
    }
    const mind = htmlTree(buildMindTree(v), 0)
    const kindLabel = isMap ? '知识地图' : (isFeynman ? '费曼读书报告' : '精读报告')
    const css = [
      ':root{--bg:#F8FAFC;--surface:#FFFFFF;--fg:#0F172A;--fg2:#334155;--muted:#64748B;--border:#E2E8F0;--accent:#2563EB;--accent2:#1D4ED8;--ok:#16A34A;--ok-bg:#F0FDF4;--warn:#B45309;--warn-bg:#FFFBEB;--bad:#DC2626;--bad-bg:#FEF2F2;--info:#2563EB;--info-bg:#EFF6FF;--radius:14px}',
      '@media (prefers-color-scheme:dark){:root{--bg:#0B1220;--surface:#101A2C;--fg:#E2E8F0;--fg2:#CBD5E1;--muted:#94A3B8;--border:#1E293B;--accent:#60A5FA;--accent2:#93C5FD;--ok:#4ADE80;--ok-bg:#052E16;--warn:#FBBF24;--warn-bg:#451A03;--bad:#F87171;--bad-bg:#450A0A;--info:#60A5FA;--info-bg:#172554}}',
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:Roboto,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.75}',
      '.wrap{max-width:820px;margin:0 auto;padding:56px 24px 96px}',
      'header.hero{border-bottom:1px solid var(--border);padding-bottom:32px;margin-bottom:40px}',
      '.kicker{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:14px}',
      '.kicker span{display:inline-block;border:1px solid var(--border);border-radius:999px;padding:2px 12px;margin-right:8px;color:var(--fg2);letter-spacing:.02em;text-transform:none}',
      'h1{font-family:Newsreader,Georgia,"Songti SC","Noto Serif SC",serif;font-size:clamp(28px,5vw,44px);line-height:1.2;font-weight:700;margin:0 0 16px;letter-spacing:-.01em}',
      '.src{font-size:13px;color:var(--muted);word-break:break-all}',
      '.sec{margin-bottom:36px}',
      'h2{display:flex;align-items:baseline;gap:12px;font-family:Newsreader,Georgia,"Songti SC",serif;font-size:22px;font-weight:600;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid var(--border)}',
      '.num{font-family:Roboto,sans-serif;font-size:12px;font-weight:700;color:var(--accent);letter-spacing:.1em}',
      '.lead{font-size:17px;color:var(--fg2);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px 22px;margin:0}',
      '.hl{border-left:4px solid var(--accent);background:var(--surface);border-radius:0 var(--radius) var(--radius) 0;padding:16px 20px;font-size:16px;box-shadow:0 1px 2px rgba(15,23,42,.04)}',
      '.hl-label{display:block;font-size:11px;font-weight:700;letter-spacing:.12em;color:var(--accent);margin-bottom:6px;text-transform:uppercase}',
      '.concl,.list{margin:0;padding-left:22px}.concl li,.list li{margin:10px 0}',
      '.concl li::marker{color:var(--accent);font-weight:700}',
      '.claim{font-weight:600}',
      '.item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;margin:12px 0}',
      '.idx{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:6px;background:var(--accent);color:#fff;font-size:12px;font-weight:700;margin-right:10px}',
      '.ev{font-size:14px;color:var(--muted);margin-top:6px}',
      '.ev-missing{color:var(--warn);font-weight:600}',
      '.quote{border-left:2px solid var(--border);padding-left:12px;margin:8px 0 0;color:var(--fg2);font-size:14px}',
      '.tags{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}',
      '.chip{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:2px 10px;border:1px solid var(--border);color:var(--fg2)}',
      '.chip.plain{background:transparent}',
      '.c-author{color:var(--ok);border-color:var(--ok);background:var(--ok-bg)}',
      '.c-fact{color:var(--info);border-color:var(--info);background:var(--info-bg)}',
      '.c-infer{color:var(--warn);border-color:var(--warn);background:var(--warn-bg)}',
      '.c-unknown{color:var(--bad);border-color:var(--bad);background:var(--bad-bg)}',
      '.legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0 12px;font-size:12px;color:var(--muted)}',
      '.rel{font-size:13px;color:var(--accent);margin-top:6px}',
      '.dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}',
      '.dcell{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px}',
      '.dval{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--accent2)}',
      '.dmeta{margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}',
      '.pre{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;overflow-x:auto;font-size:13px;line-height:1.6;white-space:pre;color:var(--fg2)}',
      '.note{font-size:12px;color:var(--muted);margin-top:8px}',
      'ul.tree,ul.tree ul{list-style:none;margin:0;padding:0}',
      'ul.tree ul{padding-left:28px;position:relative}',
      'ul.tree ul::before{content:"";position:absolute;left:10px;top:0;bottom:0;border-left:2px solid var(--border)}',
      'ul.tree li{position:relative;margin:10px 0}',
      'ul.tree ul li::before{content:"";position:absolute;left:-18px;top:50%;width:18px;border-top:2px solid var(--border)}',
      '.node{display:inline-block;border:1px solid var(--border);background:var(--surface);border-radius:10px;padding:6px 14px;font-size:13px;color:var(--fg2);box-shadow:0 1px 2px rgba(15,23,42,.04)}',
      '.node.t0{background:#1E293B;color:#fff;font-weight:700;font-size:14px;border:none}',
      '.node.t1{border-color:var(--accent);color:var(--accent);font-weight:600}',
      'footer.ft{margin-top:56px;padding-top:20px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}',
      '@media (max-width:640px){.wrap{padding:32px 16px 64px}.dgrid{grid-template-columns:1fr}}',
    ].join('\n')
    return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + ' · ' + esc(kindLabel) + '</title>'
      + '<style>@import url("https://fonts.googleapis.com/css2?family=Newsreader:wght@400;600;700&family=Roboto:wght@400;500;700&display=swap");' + css + '</style></head><body><div class="wrap">'
      + '<header class="hero"><div class="kicker"><span>' + esc(kindLabel) + '</span><span>' + esc(depthLabel) + '</span>' + (typeof meta.chars === 'number' ? '<span>约 ' + meta.chars + ' 字</span>' : '') + '</div>'
      + '<h1>' + esc(title) + '</h1>'
      + (typeof meta.source === 'string' && meta.source !== '' ? '<div class="src">来源 · ' + esc(meta.source) + '</div>' : '')
      + '</header>'
      + sections.join('')
      + '<section class="sec"><h2><span class="num">' + String(sections.length + 1).padStart(2, '0') + '</span>思维导图</h2><ul class="tree">' + mind + '</ul></section>'
      + '<footer class="ft"><span>由 DeepRead 精读助手生成</span><span>文件可离线打开 · 支持深色模式</span></footer>'
      + '</div></body></html>'
  }

  function sanitizeFilename(title) {
    let s = String(title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    if (s === '') s = 'deepread'
    return s
  }

  async function attachExports(value, exportFmt) {
    if (exportFmt === 'none') return
    try {
      const sp = ctx.get('sandboxPolicy')
      const root = sp !== undefined && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot : undefined
      const safe = sanitizeFilename(value.title)
      const folder = 'deepread-output'
      const markdown = renderMarkdown(value)
      const want = {
        md: exportFmt === 'md' || exportFmt === 'all',
        mm: exportFmt === 'mm' || exportFmt === 'all',
        html: exportFmt === 'html' || exportFmt === 'all',
      }
      const writeOne = async (rel, content) => {
        try {
          const target = await ctx.fs.resolve(rel, root ? { cwd: root } : {})
          await ctx.fs.writeText(target, content)
          return rel
        } catch (error) {
          const flat = safe + '-' + rel.split('/').pop()
          const target = await ctx.fs.resolve(flat, root ? { cwd: root } : {})
          await ctx.fs.writeText(target, content)
          return flat
        }
      }
      const files = {}
      if (want.md) files.md = await writeOne(folder + '/' + safe + '.md', markdown)
      if (want.mm) files.mm = await writeOne(folder + '/' + safe + '.mm', buildFreeMind(value))
      if (want.html) files.html = await writeOne(folder + '/' + safe + '.html', buildHtml(value))
      value.meta.files = files
    } catch (error) {
      value.meta.note = (value.meta.note ? value.meta.note + '；' : '') + '导出文件失败：' + (error !== null && typeof error === 'object' && error.message ? error.message : String(error))
    }
  }

  function sourceLabel(source) {
    const s = str(source, '')
    if (s === '' || s === '粘贴文本') return '粘贴内容'
    return s.length > 24 ? s.slice(0, 24) + '…' : s
  }

  async function startBackground(args, input, preResolved, jobs, exec, exportFmt, language, isBatch, probe) {
    await loadCalibration()
    const depth = normalizeDepth(args.depth)
    let sourceLabelText = '粘贴内容'
    let M = 1
    let minutes = null
    let chars = 0
    let sourceKind = 'text'
    let sourceText = '粘贴内容'

    const probeEst = probe !== null && typeof probe === 'object' && typeof probe.estChars === 'number' ? probe : null
    if (isBatch) {
      const items = Array.isArray(args.batch) ? args.batch : []
      M = Math.max(1, items.length)
      sourceLabelText = items.length + ' 篇文档'
      sourceText = items.length + ' 篇文档'
      sourceKind = 'batch'
    } else if (preResolved !== null && preResolved !== undefined) {
      const text = preResolved.text
      const src = preResolved.src
      chars = text.length
      sourceKind = typeof src.sourceKind === 'string' ? src.sourceKind : 'text'
      sourceText = typeof src.source === 'string' ? src.source : '粘贴内容'
      sourceLabelText = sourceLabel(sourceText)
      const est = buildEstimate(text, depth)
      const row = est.modes.find((mm) => mm !== null && typeof mm === 'object' && mm.mode === depth) || est.modes[0]
      minutes = row !== null && typeof row.minutes === 'number' ? row.minutes : null
      M = depth === 'quick' ? 1 : Math.max(1, Math.min(splitChunks(text, CHUNK_CHARS).length, MAX_PARTS))
    } else if (probeEst !== null) {
      // 大 PDF：全量解析在后台任务内进行，label 用采样外推估算字数/段数/预算
      chars = Math.max(1, Math.round(probeEst.estChars))
      sourceKind = typeof probeEst.sourceKind === 'string' ? probeEst.sourceKind : 'pdf'
      sourceText = typeof probeEst.source === 'string' ? probeEst.source : '粘贴内容'
      sourceLabelText = sourceLabel(sourceText)
      const est = buildEstimate('', depth, { chars, tokensPerChar: 0.6 })
      const row = est.modes.find((mm) => mm !== null && typeof mm === 'object' && mm.mode === depth) || est.modes[0]
      minutes = row !== null && typeof row.minutes === 'number' ? row.minutes : null
      M = depth === 'quick' ? 1 : Math.max(1, Math.min(Math.ceil(chars / CHUNK_CHARS), MAX_PARTS))
    }

    const label = 'deepread 精读「' + sourceLabelText + '」· ' + M + ' 段' + (minutes !== null ? ' · 预算≈' + minutes + '分钟' : '')

    const lines = []
    let cancelled = false
    let cancelReason = ''
    const signal = { aborted: false }
    let resolveDone = null
    const donePromise = new Promise((resolve) => { resolveDone = resolve })
    const pushLine = (line) => { if (typeof line === 'string' && line !== '') lines.push(line) }
    const onProgress = pushLine
    const readOutput = () => { const out = lines.join('\n'); lines.length = 0; return out }
    const hooks = {
      cancel(reason) {
        cancelled = true
        cancelReason = typeof reason === 'string' && reason !== '' ? reason : '已取消'
        signal.aborted = true
      },
      done: donePromise,
      readOutput,
    }

    const jobId = await jobs.start({
      kind: 'deepread',
      label,
      // 与官方 tool-terminal 的 DEFAULT_MAX_RESULT_BYTES 对齐：最终报告是主交付物，
      // 低于单次读取上限会触发「保留尾部」截断，丢掉报告开头（进度行+标题/摘要）。
      outputLimitBytes: 256 * 1024,
      owner: exec !== null && typeof exec === 'object' && exec.agent !== undefined ? exec.agent : undefined,
      run: () => {
        void (async () => {
          try {
            let result
            if (isBatch) {
              result = await batchFlow(args, language, signal, onProgress)
            } else if (preResolved !== null && preResolved !== undefined) {
              pushLine('已解析「' + sourceLabelText + '」（' + preResolved.text.length + ' 字' + (typeof preResolved.src.extractMs === 'number' && preResolved.src.extractMs > 0 ? '，PDF 解析 ' + preResolved.src.extractMs + 'ms' : '') + '）')
              result = await computeResult(input, { preResolved, onProgress, signal })
            } else {
              // 大 PDF：解析与逐页进度在任务流内进行
              result = await computeResult(input, { onProgress, signal })
            }
            await attachExports(result, exportFmt)
            pushLine('【最终报告】\n' + renderMarkdown(result))
            resolveDone({ status: 'completed' })
          } catch (err) {
            const msg = err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err)
            if (cancelled) {
              pushLine('已取消：' + cancelReason)
              resolveDone({ status: 'killed', detail: cancelReason })
            } else {
              pushLine('后台精读失败：' + msg)
              resolveDone({ status: 'failed', detail: msg })
            }
          }
        })()
        return hooks
      },
    })

    return {
      kind: 'background',
      title: '后台精读已启动',
      jobId,
      label,
      summary: '后台精读已启动',
      thesis: '',
      meta: { depth: isBatch ? 'batch' : depth, chars, chunks: M, source: sourceText, sourceKind },
    }
  }

  async function analyze(input, exec) {
    const args = input !== null && typeof input === 'object' ? input : {}
    const exportFmt = args.export === 'md' || args.export === 'mm' || args.export === 'html' || args.export === 'all' ? args.export : 'none'
    const language = args.language === 'en' ? 'en' : (args.language === 'zh' ? 'zh' : 'auto')
    const isBatch = Array.isArray(args.batch) && args.batch.length >= 2
    const depth = normalizeDepth(args.depth)

    // 预算预检 → 前台（现状）
    if (args.estimate === true) {
      const result = isBatch
        ? await batchEstimateFlow(args, language)
        : await computeResult(input)
      await attachExports(result, exportFmt)
      return result
    }

    // 批量精读（非 estimate）→ 恒为长任务：有 jobs 转后台，否则前台 batchFlow
    if (isBatch) {
      const jobs = ctx.get('jobs')
      if (jobs !== undefined && typeof jobs.start === 'function') {
        try {
          return await startBackground(args, input, null, jobs, exec, exportFmt, language, true)
        } catch (err) { /* jobs.start 抛错 → 回退前台 */ }
      }
      const result = await batchFlow(args, language, null)
      await attachExports(result, exportFmt)
      return result
    }

    // quick 模式 → 前台（现状）
    if (depth === 'quick') {
      const result = await computeResult(input)
      await attachExports(result, exportFmt)
      return result
    }

    // PDF：采样预检（结构 + 前 2 页）判长，避免前台全量解析大文件；
    // 长 PDF 的全量解析挪进后台任务内逐页报进度（返回 background 前不再静默等待）。
    const pathArg = typeof args.path === 'string' ? args.path.trim() : ''
    if (pathArg !== '' && pathArg.toLowerCase().endsWith('.pdf')) {
      const probeSrc = await resolveSource(args, { statsOnly: true })
      const ps = probeSrc.pdfStats !== undefined && probeSrc.pdfStats !== null ? probeSrc.pdfStats : null
      const estChars = ps !== null && typeof ps.sampleChars === 'number' && typeof ps.samplePages === 'number' && ps.samplePages > 0 && typeof ps.pages === 'number'
        ? Math.max(1, Math.round((ps.sampleChars / ps.samplePages) * ps.pages))
        : 0
      if (estChars > tune.backgroundMinChars) {
        const jobs = ctx.get('jobs')
        if (jobs !== undefined && typeof jobs.start === 'function') {
          try {
            return await startBackground(args, input, null, jobs, exec, exportFmt, language, false, { estChars, source: pathArg, sourceKind: 'pdf' })
          } catch (err) { /* jobs.start 抛错 → 回退前台全量解析 */ }
        }
      }
      const result = await computeResult(input)
      await attachExports(result, exportFmt)
      return result
    }

    // 非 batch 预解析一次（全量）判长，避免 computeResult 重复解析
    const t0 = Date.now()
    const src = await resolveSource(args)
    const resolveMs = Date.now() - t0
    const text = String(src.text).replace(/\r\n/g, '\n')
    const preResolved = { text, src, resolveMs }
    const isLong = text.length > tune.backgroundMinChars

    // 非长输入 → 前台（把预解析结果传入，避免重复 resolveSource）
    if (!isLong) {
      const result = await computeResult(input, { preResolved })
      await attachExports(result, exportFmt)
      return result
    }

    // 长任务：有官方 jobs 服务 → 后台；否则前台降级
    const jobs = ctx.get('jobs')
    if (jobs !== undefined && typeof jobs.start === 'function') {
      try {
        return await startBackground(args, input, preResolved, jobs, exec, exportFmt, language, false)
      } catch (err) {
        // jobs.start 抛错（如无 controller）→ 回退前台
      }
    }

    const result = await computeResult(input, { preResolved })
    await attachExports(result, exportFmt)
    return result
  }

  const tool = defineTool({
    name: 'deepread',
    description: '精读一本书或一篇文章，提取核心观点、论证结构与关键论据。分析结果默认只在会话中展示 Markdown 报告、不写入磁盘；需要落盘时用 export 参数指定格式（md=Markdown、mm=FreeMind 思维导图【XMind 可导入】、html=网页报告、all=全部），文件写入工作区 deepread-output/ 目录。五种模式：quick=快速抓要点；deep=深度精读；map=「观点—证据—数据—关系」知识地图（含四档置信度标注：作者原意/原文事实与数据/合理推断/无法确认）；feynman=费曼读书法（浏览目录→提出问题→分章阅读→提取观点数据证据→章节导图→合上书讲解→自检知识缺口→回原文修正→合并全书导图→再讲一次→间隔复习计划）；book=整本书分部分精读。输入：url（仅微信公众号 mp.weixin.qq.com 稳定链接）、path（.txt/.md/.html/.pdf）、text（粘贴文本）、batch（2-10 篇批量精读+跨篇对比）。报告含引用溯源（页码/段落定位）。estimate=true 可先做预算预检（预计 token 与耗时，不调用模型；大 PDF 采用采样外推）。知乎/掘金等反爬站点请粘贴正文。同一链接抓取过的全文会写入本地缓存（默认 7 天），换模式重读同一篇文章不再重新联网抓取；refresh=true 可强制重新抓取。长文（超过 backgroundMinChars）、大 PDF 或批量精读会自动转为后台任务：返回 kind=background 与 jobId，用 job_output 轮询进度（PDF 逐页解析、「第 i/M 段」、batch 逐篇）与最终报告，job_kill 可取消。',
    timeoutMs: tune.timeoutMs,
    parameters: {
      url: { type: 'string', description: '要精读的网页链接。仅支持微信公众号（mp.weixin.qq.com）的稳定链接；知乎/掘金等有反爬的站点不支持，请粘贴正文。与 path/text 至少提供一个。' },
      text: { type: 'string', description: '要精读的文本内容，直接粘贴。与 url/path 至少提供一个。' },
      path: { type: 'string', description: '工作区内要精读的文件路径，支持 .txt/.md/.markdown/.html 与 .pdf，如 "notes/第一章.md" 或 "book.pdf"。' },
      depth: { type: 'string', enum: ['quick', 'deep', 'map', 'feynman', 'book'], default: 'deep', description: '精读模式。quick=快速抓要点；deep=深度精读（默认，长文自动分段）；map=「观点—证据—数据—关系」知识地图；feynman=费曼读书法（11 步闭环：目录→提问→分章→观点数据证据→章节导图→合上书讲解→找缺口→回原文修正→合并导图→再讲一次→间隔复习）；book=整本书分部分精读并汇总。' },
      export: { type: 'string', enum: ['none', 'md', 'mm', 'html', 'all'], default: 'none', description: '导出格式。none=不落盘，仅在会话中展示（默认）；md=导出 Markdown 报告；mm=导出 FreeMind 思维导图（XMind 可导入）；html=导出网页报告；all=三种全部导出。' },
      refresh: { type: 'boolean', default: false, description: '强制重新抓取并刷新缓存（默认 false：同一链接命中缓存时直接复用已抓取的全文，不再联网）。' },
      focus: { type: 'string', description: '读者特别关注的角度，例如"论证逻辑""研究方法""与既有理论的关系"。' },
      language: { type: 'string', enum: ['zh', 'en', 'auto'], default: 'auto', description: '报告输出语言，默认 auto（跟随原文）。' },
      estimate: { type: 'boolean', default: false, description: '预算预检：true 时不调用模型，只返回各模式的预计调用次数、输入/输出 token 与耗时（按字数估算：中文≈0.6 token/字，拉丁≈0.25 token/字符，输出按各阶段预算计；时间=(总token÷速率)+(调用次数×单次延迟)，速率与延迟可用 Config 调整；大 PDF 采用采样外推）。' },
      batch: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { title: { type: 'string', description: '文档标题（可选，对比报告中用于标识）' }, url: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' }, focus: { type: 'string' } } }, description: '批量精读 2-10 篇并输出跨篇对比报告（对比主题矩阵、冲突点、互补关系与综合结论）。每篇需提供 url/path/text 之一；与 url/path/text 互斥。' },
    },
    // 官方 pending 卡（presentCall）：无 client half 的界面（CLI/Codex 等）在工具运行中
    // 显示这张静态卡（官方 contract 的执行中视图）；Web 端由 client half 注册的 keyed
    // toolview（tool.call.toolview 键 deepread）替换。presentCall 在 replay 时也会被调用，
    // 必须软失败、永不抛错。分段数与解析百分比在执行前未知，官方 contract 也不支持
    // 执行中更新文案——动态进度走后台任务 label 与 job_output 增量（官方 jobs 协议）。
    presentCall(args) {
      try {
        const isBatch = Array.isArray(args.batch) && args.batch.length >= 2
        const url = typeof args.url === 'string' ? args.url.trim() : ''
        const path = typeof args.path === 'string' ? args.path.trim() : ''
        const source = url !== '' ? url : (path !== '' ? path : '粘贴内容')
        const depthLabel = args.depth === 'quick' ? '快速要点' : (args.depth === 'map' ? '知识地图' : (args.depth === 'feynman' ? '费曼读书法' : (args.depth === 'book' ? '整本书' : '深度精读')))
        if (args.estimate === true) {
          return { card: 'generic', kind: 'read', title: 'deepread 预算预检「' + source + '」', content: [{ type: 'text', text: '正在解析来源并估算各模式 token 与耗时（不调用模型）…' }] }
        }
        if (isBatch) {
          return { card: 'generic', kind: 'read', title: 'deepread 批量精读「' + args.batch.length + ' 篇文档」', content: [{ type: 'text', text: '正在逐篇解析与精读，随后生成跨篇对比报告；进度经后台任务逐条推送（job_output 读取）。' }] }
        }
        return { card: 'generic', kind: 'read', title: 'deepread 精读「' + source + '」· ' + depthLabel, content: [{ type: 'text', text: '正在解析来源并分段…长文会自动转为后台任务（任务名标注段数与预算），进度经 job_output 逐条推送。' }] }
      } catch (err) {
        return undefined
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          kind: { type: 'string', required: true },
          title: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          thesis: { type: 'string', required: true },
          jobId: { type: 'string' },
          label: { type: 'string' },
          coreQuestion: { type: 'string' },
          coreConclusions: { type: 'array', items: { type: 'string' } },
          items: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { type: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' }, source: { type: 'string' }, confidence: { type: 'string' }, relations: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { to: { type: 'string' }, type: { type: 'string' } } } } } } },
          dataPoints: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { value: { type: 'string' }, period: { type: 'string' }, subject: { type: 'string' }, baseline: { type: 'string' }, source: { type: 'string' }, location: { type: 'string' } } } },
          caveats: { type: 'array', items: { type: 'string' } },
          mermaid: { type: 'string' },
          xmindOutline: { type: 'string' },
          recallQuestions: { type: 'array', items: { type: 'string' } },
          toc: { type: 'array', items: { type: 'string' } },
          feynmanChapters: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { index: { type: 'number' }, title: { type: 'string' }, points: { type: 'array' }, chapterMap: { type: 'string' }, explanation: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } }, corrections: { type: 'array', items: { type: 'string' } } } } },
          bookMap: { type: 'string' },
          finalExplanation: { type: 'string' },
          reviewPlan: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { interval: { type: 'string' }, focus: { type: 'string' }, method: { type: 'string' } } } },
          arguments: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { claim: { type: 'string' }, evidence: { type: 'string' }, quote: { type: 'string' }, source: { type: 'string' } } } },
          quotes: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { text: { type: 'string' }, context: { type: 'string' }, source: { type: 'string' } } } },
          concepts: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { term: { type: 'string' }, explanation: { type: 'string' } } } },
          questions: { type: 'array', items: { type: 'string' } },
          structure: { type: 'array', items: { type: 'string' } },
          chapters: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { title: { type: 'string' }, summary: { type: 'string' }, thesis: { type: 'string' }, arguments: { type: 'array' }, quotes: { type: 'array' } } } },
          citations: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { claim: { type: 'string' }, source: { type: 'string' }, quote: { type: 'string' } } } },
          estimate: { type: 'object', additionalProperties: true },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          comparison: { type: 'object', additionalProperties: true },
          stages: { type: 'object', additionalProperties: true, properties: { resolveMs: { type: 'number' }, extractMs: { type: 'number' }, llmMs: { type: 'number' }, calls: { type: 'number' } } },
          meta: { type: 'object', additionalProperties: true, properties: { source: { type: 'string' }, sourceKind: { type: 'string' }, chars: { type: 'number' }, chunks: { type: 'number' }, depth: { type: 'string' }, durationMs: { type: 'number' }, note: { type: 'string' }, stages: { type: 'object', additionalProperties: true, properties: { resolveMs: { type: 'number' }, extractMs: { type: 'number' }, llmMs: { type: 'number' }, calls: { type: 'number' } } }, files: { type: 'object', additionalProperties: true, properties: { md: { type: 'string' }, mm: { type: 'string' }, html: { type: 'string' } } } } },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: renderMarkdown(value) }]
      },
      presentationMeta(args, value) {
        return value
      },
    },
    async execute(args, exec) {
      return analyze(args, exec)
    },
  })

  // 测试钩子：暴露纯函数便于单测（生产环境为附加属性，不影响工具注册）。
  tool.__extractPdfText = extractPdfText
  tool.__extractPdfStats = extractPdfStats
  tool.__collectPageNums = collectPageNums

  ctx.effect(() => ctx.tools.register(tool))

  // ---------- 面板直调 API：POST /api/deepread/budget ----------
  // 精读面板「预算预检」按钮经同源 HTTP 调用本路由：Host 直接抓取/读取来源并估算，
  // 面板内显示一行结论，不再把指令发进对话。复用 resolveForEstimate（微信抓取/缓存/
  // 反爬回退/PDF 采样外推）与 buildEstimate（与模型工具同源），返回 lossless JSON。
  // webServer 已声明为 inject 硬依赖，apply 执行时必然就绪；防御式判断兼容测试/降级环境。
  const panelWebServer = ctx.webServer
  if (panelWebServer !== undefined && typeof panelWebServer.register === 'function') {
    ctx.effect(() => panelWebServer.register({
      kind: 'exact',
      path: '/api/deepread/budget',
      handler: async (req, res) => {
        const send = (payload) => {
          if (res.headersSent) return
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        }
        try {
          if (typeof req.method !== 'string' || req.method.toUpperCase() !== 'POST') {
            res.statusCode = 405
            return send({ ok: false, error: '仅支持 POST' })
          }
          const body = await readJsonBody(req)
          const args = body !== null && typeof body === 'object' ? body : {}
          const url = typeof args.url === 'string' ? args.url.trim() : ''
          const path = typeof args.path === 'string' ? args.path.trim() : ''
          const text = typeof args.text === 'string' ? args.text : ''
          if (url === '' && path === '' && text.trim() === '') {
            return send({ ok: false, error: '请提供 url、path 或 text（至少其一）' })
          }
          await loadCalibration()
          const src = await resolveForEstimate({ url, path, text })
          let estimate
          let chars
          const pdfStats = src.pdfStats !== undefined && src.pdfStats !== null ? src.pdfStats : null
          if (pdfStats !== null) {
            const sampleChars = typeof pdfStats.sampleChars === 'number' ? pdfStats.sampleChars : 0
            const samplePages = typeof pdfStats.samplePages === 'number' && pdfStats.samplePages > 0 ? pdfStats.samplePages : 2
            const pages = typeof pdfStats.pages === 'number' ? pdfStats.pages : 1
            const fullChars = Math.max(1, Math.round((sampleChars / samplePages) * pages))
            const sampleTokens = typeof pdfStats.sampleTokens === 'number' ? pdfStats.sampleTokens : 0
            const tokensPerChar = sampleChars > 0 && sampleTokens > 0 ? sampleTokens / sampleChars : 0.6
            estimate = buildEstimate('', 'deep', { chars: fullChars, tokensPerChar })
            chars = fullChars
          } else {
            estimate = buildEstimate(src.text, 'deep')
            chars = src.text.length
          }
          const payload = {
            ok: true,
            chars,
            source: src.source,
            sourceKind: src.sourceKind,
            ...(typeof src.note === 'string' && src.note !== '' ? { note: src.note } : {}),
            ...(typeof src.cache === 'string' ? { cache: src.cache } : {}),
            modes: estimate.modes,
            estTokensPerSecond: estimate.estTokensPerSecond,
            estLatencyPerCallMs: estimate.estLatencyPerCallMs,
            calibrated: estimate.calibrated === true,
          }
          return send(payload)
        } catch (err) {
          res.statusCode = 500
          return send({ ok: false, error: err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err) })
        }
      },
    }))
  }
}

// ---------- HTTP 请求体解析（面板直调 API 用） ----------
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      if (size > 5 * 1024 * 1024) {
        reject(new Error('请求体过大（超过 5MB）'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c, 'utf-8') : c))).toString('utf-8')
      if (raw.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}
