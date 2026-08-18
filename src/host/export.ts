import type { ExportFormat, HostContext, RuntimeConfig } from './types.js'
import { errorMessage, isFileWriter, isRecord } from './types.js'

type DataRecord = Record<string, unknown>
interface ViewValue extends DataRecord {
  kind?: string
  title?: string
  summary?: string
  thesis?: string
  coreQuestion?: string
  bookMap?: string
  finalExplanation?: string
  mermaid?: string
  xmindOutline?: string
  jobId?: string
  label?: string
  meta?: DataRecord
  estimate?: DataRecord
  comparison?: DataRecord
}

interface MindNode {
  id: string
  class: string
  title: string
  children?: { attached: MindNode[] }
}

const EMPTY_RECORD: DataRecord = {}

interface ValueTools {
  arr(value: unknown): unknown[]
  num(value: unknown, fallback: number): number
  str(value: unknown, fallback: string): string
  sanitizeArguments(value: unknown): Array<{ claim: string; evidence: string; quote: string; source: string }>
  sanitizeCitations(value: unknown): Array<{ claim: string; source: string; quote: string }>
  sanitizeConcepts(value: unknown): Array<{ term: string; explanation: string }>
  sanitizeQuestions(value: unknown): string[]
  sanitizeQuotes(value: unknown): Array<{ text: string; context: string; source: string }>
  defaultRateTokPerSec: number
}

export function createExportTools(ctx: HostContext, tune: RuntimeConfig, tools: ValueTools) {
  const { arr, num, str, sanitizeArguments, sanitizeCitations, sanitizeConcepts, sanitizeQuestions, sanitizeQuotes } = tools
  const DEFAULT_RATE_TOK_PER_SEC = tools.defaultRateTokPerSec
function cacheLabel(meta: DataRecord): string {
  const fetched = typeof meta.fetchedAt === 'string' ? meta.fetchedAt.replace('T', ' ').slice(0, 16) : ''
  if (meta.cache === 'hit') return '缓存命中（抓取于 ' + fetched + '，未重新联网）'
  if (meta.cache === 'fallback') return '回退缓存（抓取于 ' + fetched + '）'
  if (meta.cache === 'miss') return '已重新抓取并写入缓存'
  if (meta.cache === 'disabled') return '缓存已禁用'
  return ''
}

function metaFooter(meta: DataRecord): string {
  const cacheText = cacheLabel(meta)
  let estText = ''
  const est = isRecord(meta.estimate) ? meta.estimate : null
  if (est !== null && Array.isArray(est.modes)) {
    const row = est.modes.find((mm) => isRecord(mm) && mm.mode === meta.depth) || null
    if (row !== null && typeof row.calls === 'number') estText = ' · 本次预算：约 ' + row.calls + ' 次调用 / ' + row.totalTokens + ' token / ≈' + row.minutes + ' 分钟'
  }
  let execText = ''
  const st = isRecord(meta) ? meta.stages : null
  if (isRecord(st)) {
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

function fmtSec(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '0'
  const s = Math.round(ms / 100) / 10
  return (Number.isInteger(s) ? String(s) : String(s))
}

function renderFeynmanMarkdown(v: ViewValue): string {
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
    const o = isRecord(ch) ? ch : EMPTY_RECORD
    lines.push('', '## 第 ' + o.index + ' 章：' + str(o.title, ''))
    const pts = arr(o.points)
    if (pts.length > 0) {
      lines.push('', '**观点 · 数据 · 证据**：')
      pts.forEach((p, i) => {
        const po = isRecord(p) ? p : { claim: String(p) }
        lines.push((i + 1) + '. ' + str(po.claim, '') + (str(po.data, '') !== '' ? '（数据：' + po.data + '）' : '') + (str(po.evidence, '') !== '' ? ' —— 证据：' + po.evidence : ''))
      })
    }
    if (str(o.chapterMap, '') !== '') lines.push('', '**章节导图**：', '```mermaid', str(o.chapterMap, ''), '```')
    if (str(o.explanation, '') !== '') lines.push('', '**费曼讲解（合上书）**：', str(o.explanation, ''))
    const gaps = arr(o.gaps)
    if (gaps.length > 0) lines.push('', '**知识缺口**：', gaps.map((g) => '- ' + g).join('\n'))
    const fixes = arr(o.corrections)
    if (fixes.length > 0) lines.push('', '**原文修正**：', fixes.map((f) => '- ' + f).join('\n'))
  })
  if (str(v.bookMap, '') !== '') lines.push('', '## 合并全书导图', '```mermaid', str(v.bookMap, ''), '```')
  if (str(v.finalExplanation, '') !== '') lines.push('', '## 再讲一次（全书终讲）', str(v.finalExplanation, ''))
  const rp = arr(v.reviewPlan)
  if (rp.length > 0) {
    lines.push('', '## 间隔复习计划')
    rp.forEach((r) => {
      const ro = isRecord(r) ? r : { interval: String(r) }
      lines.push('- **' + str(ro.interval, '') + '**：' + str(ro.focus, '') + (str(ro.method, '') !== '' ? '（' + ro.method + '）' : ''))
    })
  }
  lines.push('', '---', '', metaFooter(v.meta !== null && typeof v.meta === 'object' ? v.meta : EMPTY_RECORD))
  return lines.join('\n')
}

function renderMapMarkdown(v: ViewValue): string {
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
      const o = isRecord(it) ? it : EMPTY_RECORD
      lines.push((i + 1) + '. [' + str(o.type, '分论点') + '] ' + str(o.claim, ''))
      lines.push('   证据：' + str(o.evidence, '原文未提供证据') + (str(o.source, '') !== '' ? '（' + o.source + '）' : '') + (str(o.confidence, '') !== '' ? ' [' + o.confidence + ']' : ''))
      arr(o.relations).forEach((r) => {
        const ro = isRecord(r) ? r : EMPTY_RECORD
        if (str(ro.to, '') !== '') lines.push('   ↳ ' + str(ro.type, '支持') + ' → ' + ro.to)
      })
    })
  }
  const dps = arr(v.dataPoints)
  if (dps.length > 0) {
    lines.push('', '**关键数据表**：')
    dps.forEach((d) => {
      const o = isRecord(d) ? d : EMPTY_RECORD
      lines.push('- ' + str(o.value, '') + (str(o.period, '') !== '' ? ' · 时间：' + o.period : '') + (str(o.subject, '') !== '' ? ' · 对象：' + o.subject : '') + (str(o.baseline, '') !== '' ? ' · 基准：' + o.baseline : '') + (str(o.source, '') !== '' ? ' · 来源：' + o.source : '') + (str(o.location, '') !== '' ? ' · 位置：' + o.location : ''))
    })
  }
  const cvs = arr(v.caveats)
  if (cvs.length > 0) {
    lines.push('', '**反对意见与局限**：')
    cvs.forEach((c) => lines.push('- ' + c))
  }
  if (str(v.mermaid, '') !== '') lines.push('', '**Mermaid 思维导图**：', '```mermaid', str(v.mermaid, ''), '```')
  if (str(v.xmindOutline, '') !== '') lines.push('', '**XMind 大纲**：', '```markdown', str(v.xmindOutline, ''), '```')
  const qs = arr(v.recallQuestions)
  if (qs.length > 0) {
    lines.push('', '**主动回忆问题**：')
    qs.forEach((q, i) => lines.push((i + 1) + '. ' + q))
  }
  lines.push('', '---', '', metaFooter(v.meta !== null && typeof v.meta === 'object' ? v.meta : EMPTY_RECORD))
  return lines.join('\n')
}

function renderEstimateMarkdown(v: ViewValue): string {
  const est = isRecord(v.estimate) ? v.estimate : EMPTY_RECORD
  const lines = ['# 🧮 预算预检：' + str(isRecord(v.meta) ? v.meta.source : '', '内容')]
  const tps = typeof est.estTokensPerSecond === 'number' ? est.estTokensPerSecond : DEFAULT_RATE_TOK_PER_SEC
  const lat = typeof est.estLatencyPerCallMs === 'number' ? est.estLatencyPerCallMs : 800
  if (est.batch === true) {
    lines.push('', '**口径**：中文≈0.6 token/字，拉丁≈0.25 token/字符；时间=(总token÷' + tps + ' tok/s)+(调用次数×' + lat + 'ms)。', '')
    const rows = arr(est.items)
    rows.forEach((r) => {
      const ro = isRecord(r) ? r : EMPTY_RECORD
      const q = isRecord(ro.quick) ? ro.quick : EMPTY_RECORD
      lines.push('- **' + (typeof ro.index === 'number' ? '#' + ro.index + ' ' : '') + str(ro.title, '未命名') + '**（' + (typeof ro.chars === 'number' ? ro.chars : 0) + ' 字）· 1 次调用 · 约 ' + (typeof q.totalTokens === 'number' ? q.totalTokens : 0) + ' token · 约 ' + (typeof q.minutes === 'number' ? q.minutes : 0) + ' 分钟')
    })
    const finalCall = isRecord(est.finalCall) ? est.finalCall : EMPTY_RECORD
    lines.push('- **跨篇对比**（1 次）· 约 ' + (typeof finalCall.totalTokens === 'number' ? finalCall.totalTokens : 0) + ' token')
    lines.push('', '**合计**：' + (typeof est.totalCalls === 'number' ? est.totalCalls : 0) + ' 次调用 · 约 ' + (typeof est.totalTokens === 'number' ? est.totalTokens : 0) + ' token · 预计 ' + (typeof est.totalMinutes === 'number' ? est.totalMinutes : 0) + ' 分钟')
    if (est.calibrated === true) lines.push('', '> 已使用运行时实测校准速率（' + tps + ' tok/s / ' + lat + 'ms）。')
  } else {
    lines.push('', '**口径**：中文≈0.6 token/字，拉丁≈0.25 token/字符；输出按各阶段预算计；时间=(总token÷' + tps + ' tok/s)+(调用次数×' + lat + 'ms)。', '', '| 模式 | 调用次数 | 输入 token | 输出 token | 总 token | 预计耗时 | 说明 |', '| --- | --- | --- | --- | --- | --- | --- |')
    const modes = arr(est.modes)
    modes.forEach((mm) => {
      const mo = isRecord(mm) ? mm : EMPTY_RECORD
      lines.push('| ' + str(mo.mode, '') + ' | ' + (typeof mo.calls === 'number' ? mo.calls : 0) + ' | ' + (typeof mo.inputTokens === 'number' ? mo.inputTokens : 0) + ' | ' + (typeof mo.outputTokens === 'number' ? mo.outputTokens : 0) + ' | ' + (typeof mo.totalTokens === 'number' ? mo.totalTokens : 0) + ' | ' + (typeof mo.minutes === 'number' ? '≈ ' + mo.minutes + ' 分钟' : '') + ' | ' + str(mo.note, '') + ' |')
    })
    if (typeof est.chars === 'number') lines.push('', '输入字数：' + est.chars + '（超过 ' + tune.maxInputChars + ' 会被截断）')
    if (est.sampled === true) lines.push('', '> 本预检采用 PDF 采样外推（前 2 页字数 ÷ 2 × 总页数），仅作数量级参考。')
    if (est.calibrated === true) lines.push('', '> 已使用运行时实测校准速率（' + tps + ' tok/s / ' + lat + 'ms）。')
    lines.push('', '> 估算基于本地字数启发式与默认速率/延迟，实际取决于模型速度、负载与网络。')
  }
  return lines.join('\n')
}

function renderBatchMarkdown(v: ViewValue): string {
  const lines = ['# 🔀 跨篇对比：' + str(v.title, '批量精读')]
  if (str(v.summary, '') !== '') lines.push('', '**综合结论**：' + v.summary)
  const items = arr(v.items)
  if (items.length > 0) {
    lines.push('', '## 各篇速览')
    items.forEach((it) => {
      const io = isRecord(it) ? it : EMPTY_RECORD
      lines.push('', '### ' + (typeof io.index === 'number' ? io.index + '. ' : '') + str(io.title, '未命名') + (typeof io.chars === 'number' ? '（' + io.chars + ' 字）' : ''))
      if (str(io.thesis, '') !== '') lines.push('- 核心论点：' + io.thesis)
      if (str(io.summary, '') !== '') lines.push('- 摘要：' + io.summary)
    })
  }
  const cmp = v.comparison !== null && typeof v.comparison === 'object' ? v.comparison : EMPTY_RECORD
  const themes = arr(cmp.comparison)
  if (themes.length > 0) {
    lines.push('', '## 对比矩阵')
    themes.forEach((c, i) => {
      const co = isRecord(c) ? c : EMPTY_RECORD
      lines.push('', '### ' + (i + 1) + '. ' + str(co.theme, ''))
      arr(co.positions).forEach((p) => {
        const po = isRecord(p) ? p : EMPTY_RECORD
        lines.push('- **' + str(po.doc, '') + '**：' + str(po.view, ''))
      })
    })
  }
  const conflicts = arr(cmp.conflicts)
  if (conflicts.length > 0) {
    lines.push('', '## 冲突点')
    conflicts.forEach((c, i) => {
      const co = isRecord(c) ? c : EMPTY_RECORD
      lines.push('', '### ' + (i + 1) + '. ' + str(co.theme, ''))
      arr(co.positions).forEach((p) => {
        const po = isRecord(p) ? p : EMPTY_RECORD
        lines.push('- **' + str(po.doc, '') + '**：' + str(po.view, ''))
      })
    })
  }
  if (str(cmp.complementarity, '') !== '') lines.push('', '## 互补关系', str(cmp.complementarity, ''))
  const qs = sanitizeQuestions(v.questions)
  if (qs.length > 0) {
    lines.push('', '## 跨篇追问')
    qs.forEach((q, i) => lines.push((i + 1) + '. ' + q))
  }
  lines.push('', '---', '', metaFooter(v.meta !== null && typeof v.meta === 'object' ? v.meta : EMPTY_RECORD))
  return lines.join('\n')
}

function renderMarkdown(value: unknown): string {
  const v: ViewValue = isRecord(value) ? value : EMPTY_RECORD
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
      const co = isRecord(c) ? c : EMPTY_RECORD
      lines.push((i + 1) + '. ' + str(co.title, '第 ' + (i + 1) + ' 部分') + (str(co.summary, '') !== '' ? '：' + co.summary : ''))
    })
  }
  const qs = sanitizeQuestions(v.questions)
  if (qs.length > 0) {
    lines.push('', '**批判性思考**：')
    qs.forEach((q) => lines.push('- ' + q))
  }
  const meta = v.meta !== null && typeof v.meta === 'object' ? v.meta : EMPTY_RECORD
  lines.push('', '---', '', metaFooter(meta))
  return lines.join('\n')
}

// ---------- 导出（md / mm FreeMind / html 编辑风网页报告） ----------
function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

let NODE_SEQ = 0
function node(title: unknown, children: MindNode[] = []): MindNode {
  const id = 'n' + (++NODE_SEQ)
  const t: MindNode = { id, class: 'topic', title: String(title) }
  if (children !== undefined && children.length > 0) t.children = { attached: children }
  return t
}

function buildMindTree(value: unknown): MindNode {
  const v: ViewValue = isRecord(value) ? value : EMPTY_RECORD
  NODE_SEQ = 0
  const title = typeof v.title === 'string' && v.title !== '' ? v.title : '精读报告'
  const root = node(title)
  if (v.kind === 'map') {
    const kids = []
    if (typeof v.coreQuestion === 'string' && v.coreQuestion !== '') kids.push(node('核心问题', [node(v.coreQuestion)]))
    const cons = Array.isArray(v.coreConclusions) ? v.coreConclusions : []
    if (cons.length > 0) kids.push(node('核心结论', cons.map((c) => node(String(c)))))
    const items = Array.isArray(v.items) ? v.items : []
    const groups: Record<string, DataRecord[]> = {}
    for (const it of items) {
      const o: DataRecord = isRecord(it) ? it : { claim: String(it) }
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
      const o = isRecord(d) ? d : { value: String(d) }
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
        const o = isRecord(c) ? c : EMPTY_RECORD
        const pts = arr(o.points).slice(0, 4).map((p) => {
          const po = isRecord(p) ? p : { claim: String(p) }
          return node(String(str(po.claim, '')).slice(0, 50))
        })
        return node('第 ' + o.index + ' 章 ' + String(str(o.title, '')).slice(0, 30), pts)
      })))
    }
    const rp = arr(v.reviewPlan)
    if (rp.length > 0) kids.push(node('间隔复习', rp.map((r) => {
      const ro = isRecord(r) ? r : { interval: String(r) }
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
      const o = isRecord(a) ? a : { claim: String(a) }
      const ev = typeof o.evidence === 'string' && o.evidence !== '' ? o.evidence.slice(0, 80) : null
      return node((typeof o.claim === 'string' ? o.claim : '').slice(0, 60), ev !== null ? [node('论据：' + ev)] : undefined)
    })))
  }
  const quotes = Array.isArray(v.quotes) ? v.quotes : []
  if (quotes.length > 0) kids.push(node('金句摘录', quotes.map((q) => {
    const o = isRecord(q) ? q : { text: String(q) }
    return node((typeof o.text === 'string' ? o.text : '').slice(0, 60))
  })))
  const chapters = Array.isArray(v.chapters) ? v.chapters : []
  if (chapters.length > 0) {
    kids.push(node('章节脉络', chapters.map((c) => {
      const o = isRecord(c) ? c : EMPTY_RECORD
      const sum = typeof o.summary === 'string' && o.summary !== '' ? o.summary.slice(0, 60) : null
      return node((typeof o.title === 'string' ? o.title : '').slice(0, 50), sum !== null ? [node(sum)] : undefined)
    })))
  }
  root.children = { attached: kids }
  return root
}

function buildFreeMind(v: unknown): string {
  const root = buildMindTree(v)
  const xml = (n: MindNode, depth: number): string => {
    const ind = '  '.repeat(depth)
    const kids = n.children !== undefined && n.children.attached !== undefined ? n.children.attached : []
    const t = esc(n.title)
    if (kids.length === 0) return ind + '<node TEXT="' + t + '"/>'
    return ind + '<node TEXT="' + t + '">\n' + kids.map((k) => xml(k, depth + 1)).join('\n') + '\n' + ind + '</node>'
  }
  return '<map version="1.0.1">\n' + xml(root, 1) + '\n</map>'
}

function confClass(c: unknown): string {
  if (c === '作者原意') return 'c-author'
  if (c === '原文事实与数据') return 'c-fact'
  if (c === '合理推断') return 'c-infer'
  if (c === '无法确认') return 'c-unknown'
  return ''
}

function htmlTree(n: MindNode, depth: number): string {
  const cls = depth === 0 ? 't0' : depth === 1 ? 't1' : 't2'
  let h = '<li><div class="node ' + cls + '">' + esc(n.title) + '</div>'
  const kids = n.children !== undefined && n.children.attached !== undefined ? n.children.attached : []
  if (kids.length > 0) h += '<ul>' + kids.map((k) => htmlTree(k, depth + 1)).join('') + '</ul>'
  return h + '</li>'
}

function buildHtml(value: unknown): string {
  const v: ViewValue = isRecord(value) ? value : EMPTY_RECORD
  const title = typeof v.title === 'string' && v.title !== '' ? v.title : '精读报告'
  const meta = isRecord(v.meta) ? v.meta : EMPTY_RECORD
  const isMap = v.kind === 'map'
  const isFeynman = v.kind === 'feynman'
  const depthLabels: Record<string, string> = { quick: '快速要点', deep: '深度精读', book: '全书精读', map: '知识地图', feynman: '费曼读书法' }
  const depthLabel = typeof meta.depth === 'string' ? depthLabels[meta.depth] ?? '精读' : '精读'
  const sections: string[] = []
  const add = (t: string, h: string): void => { sections.push('<section class="sec"><h2><span class="num">' + String(sections.length + 1).padStart(2, '0') + '</span>' + esc(t) + '</h2>' + h + '</section>') }
  if (isMap) {
    if (typeof v.summary === 'string' && v.summary !== '') add('摘要', '<p class="lead">' + esc(v.summary) + '</p>')
    if (typeof v.coreQuestion === 'string' && v.coreQuestion !== '') add('核心问题', '<div class="hl"><span class="hl-label">作者试图回答</span>' + esc(v.coreQuestion) + '</div>')
    const cons = Array.isArray(v.coreConclusions) ? v.coreConclusions : []
    if (cons.length > 0) add('核心结论', '<ol class="concl">' + cons.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ol>')
    const items = Array.isArray(v.items) ? v.items : []
    const groups: Record<string, DataRecord[]> = {}
    for (const it of items) {
      const o: DataRecord = isRecord(it) ? it : { claim: String(it) }
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
          const ro = isRecord(r) ? r : EMPTY_RECORD
          if (typeof ro.to === 'string' && ro.to !== '') item += '<div class="rel">' + esc(typeof ro.type === 'string' ? ro.type : '支持') + ' → ' + esc(ro.to) + '</div>'
        })
        return item + '</div>'
      }).join('')
      add(t, h)
    }
    const dps = Array.isArray(v.dataPoints) ? v.dataPoints : []
    if (dps.length > 0) {
      add('关键数据', '<div class="dgrid">' + dps.map((d) => {
        const o = isRecord(d) ? d : { value: String(d) }
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
      const o = isRecord(c) ? c : EMPTY_RECORD
      let h = ''
      const pts = Array.isArray(o.points) ? o.points : []
      if (pts.length > 0) h += '<ol class="concl">' + pts.map((p) => {
        const po = isRecord(p) ? p : { claim: String(p) }
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
      const ro = isRecord(r) ? r : { interval: String(r) }
      return '<div class="it"><span class="claim">' + esc(typeof ro.interval === 'string' ? ro.interval : '') + '</span><div class="ev">' + esc(typeof ro.focus === 'string' ? ro.focus : '') + (typeof ro.method === 'string' && ro.method !== '' ? '（' + esc(ro.method) + '）' : '') + '</div></div>'
    }).join(''))
  } else {
    if (typeof v.summary === 'string' && v.summary !== '') add('一句话总结', '<p class="lead">' + esc(v.summary) + '</p>')
    if (typeof v.thesis === 'string' && v.thesis !== '') add('核心论点', '<div class="hl">' + esc(v.thesis) + '</div>')
    const args = Array.isArray(v.arguments) ? v.arguments : []
    if (args.length > 0) add('论证结构', '<ol class="concl">' + args.map((a) => {
      const o = isRecord(a) ? a : { claim: String(a) }
      return '<li><span class="claim">' + esc(typeof o.claim === 'string' ? o.claim : '') + '</span>' + (typeof o.evidence === 'string' && o.evidence !== '' ? '<div class="ev">论据 · ' + esc(o.evidence) + '</div>' : '') + (typeof o.quote === 'string' && o.quote !== '' ? '<div class="quote">“' + esc(o.quote) + '”</div>' : '') + '</li>'
    }).join('') + '</ol>')
    const quotes = Array.isArray(v.quotes) ? v.quotes : []
    if (quotes.length > 0) add('金句摘录', '<ul class="list">' + quotes.map((q) => {
      const o = isRecord(q) ? q : { text: String(q) }
      return '<li>“' + esc(typeof o.text === 'string' ? o.text : '') + '”' + (typeof o.context === 'string' && o.context !== '' ? '<div class="ev">' + esc(o.context) + '</div>' : '') + '</li>'
    }).join('') + '</ul>')
    const concepts = Array.isArray(v.concepts) ? v.concepts : []
    if (concepts.length > 0) add('核心概念', '<ul class="list">' + concepts.map((c) => {
      const o = isRecord(c) ? c : { term: String(c) }
      return '<li><b>' + esc(typeof o.term === 'string' ? o.term : '') + '</b>' + (typeof o.explanation === 'string' && o.explanation !== '' ? ' — ' + esc(o.explanation) : '') + '</li>'
    }).join('') + '</ul>')
    const chapters = Array.isArray(v.chapters) ? v.chapters : []
    if (chapters.length > 0) add('章节脉络', '<ol class="list">' + chapters.map((c) => {
      const o = isRecord(c) ? c : EMPTY_RECORD
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

function sanitizeFilename(title: unknown): string {
  let s = String(title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  if (s === '') s = 'deepread'
  return s
}

async function attachExports(value: unknown, exportFmt: ExportFormat): Promise<void> {
  if (exportFmt === 'none') return
  if (!isRecord(value)) return
  if (!isFileWriter(ctx.fs)) throw new Error('文件服务不可用')
  const fileWriter = ctx.fs
  try {
    const sp = ctx.get('sandboxPolicy')
    const root = isRecord(sp) && typeof sp.workspaceRoot === 'string' ? sp.workspaceRoot : undefined
    const safe = sanitizeFilename(value.title)
    const folder = 'deepread-output'
    const markdown = renderMarkdown(value)
    const want = {
      md: exportFmt === 'md' || exportFmt === 'all',
      mm: exportFmt === 'mm' || exportFmt === 'all',
      html: exportFmt === 'html' || exportFmt === 'all',
    }
    const writeOne = async (rel: string, content: string): Promise<string> => {
      try {
        const target = await fileWriter.resolve(rel, root ? { cwd: root } : undefined)
        await fileWriter.writeText(target, content)
        return rel
      } catch (error) {
        const flat = safe + '-' + rel.split('/').pop()
        const target = await fileWriter.resolve(flat, root ? { cwd: root } : undefined)
        await fileWriter.writeText(target, content)
        return flat
      }
    }
    const files: Partial<Record<'md' | 'mm' | 'html', string>> = {}
    if (want.md) files.md = await writeOne(folder + '/' + safe + '.md', markdown)
    if (want.mm) files.mm = await writeOne(folder + '/' + safe + '.mm', buildFreeMind(value))
    if (want.html) files.html = await writeOne(folder + '/' + safe + '.html', buildHtml(value))
    const meta = isRecord(value.meta) ? value.meta : {}
    meta.files = files
    value.meta = meta
  } catch (error) {
    const meta = isRecord(value.meta) ? value.meta : {}
    const priorNote = typeof meta.note === 'string' && meta.note !== '' ? meta.note + '；' : ''
    meta.note = priorNote + '导出文件失败：' + errorMessage(error)
    value.meta = meta
  }
}


  return { attachExports, renderMarkdown }
}
