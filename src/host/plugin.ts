// DeepRead 精读助手 — Node half（官方 bundle 插件 Cordis entry）
// 依赖 @deepseek-ai/* 与 zod 由宿主 profile 树提供（见 package.json peerDependencies）。
import type { IncomingMessage } from 'node:http'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { createBudgetRuntime } from './budget.js'
import { createCalibrationRuntime, DEFAULT_RATE_TOK_PER_SEC } from './calibration.js'
import { ConfigSchema, resolveConfig } from './config.js'
import { createUrlCache } from './cache.js'
import { normalizeDepth, normalizeExportFormat, normalizeLanguage, parseDeepreadInput } from './analysis.js'
import { createExportTools } from './export.js'
import { arr, createLlmRuntime, num, splitChunks, str } from './llm.js'
import { createPdfTools } from './pdf.js'
import { createSourceRuntime } from './source.js'
import type {
  AbortLike,
  AnalysisChapter,
  BatchDocumentResult,
  Config as ConfigOptions,
  DeepreadInput,
  DeepreadDepth,
  DeepreadResult,
  EstimateCall,
  ExportFormat,
  HostContext,
  OutputLanguage,
  ResultMetadata,
  SourceResult,
  SourceKind,
  ToolLike,
  JobsService,
} from './types.js'
import { errorMessage, isHostContext, isRecord } from './types.js'

type DataRecord = Record<string, unknown>
const EMPTY_RECORD: DataRecord = {}
type ProgressCallback = (line: string) => void
interface PreResolved { text: string; src: SourceResult; resolveMs: number }
interface ComputeOptions { preResolved?: PreResolved; signal?: AbortLike | null | undefined; onProgress?: ProgressCallback | undefined }
interface SanitizedSection {
  title: string
  summary: string
  thesis: string
  arguments: Array<{ claim: string; evidence: string; quote: string; source: string }>
  quotes: Array<{ text: string; context: string; source: string }>
  concepts: Array<{ term: string; explanation: string }>
  questions: string[]
}
interface FeynmanChapter {
  index: number
  title: string
  points: Array<{ claim: string; data: string; evidence: string }>
  chapterMap: string
  explanation: string
  gaps: string[]
  corrections: string[]
}
const createTool = defineTool as unknown as (definition: ToolLike) => ToolLike

export const Config = ConfigSchema

export const name = 'deepread'
// webServer 为硬依赖：面板直调 API 依赖它，且必须等它就绪后 apply 才注册路由，
// 否则可选获取会因服务时序静默跳过注册（面板收到 404）。
export const inject = ['fs', 'llm', 'tools', 'web', 'agentDefaultModel', 'sandboxPolicy', 'webServer']

export function apply(ctx: unknown, config?: ConfigOptions): void {
  if (!isHostContext(ctx)) throw new TypeError('deepread requires a valid Harness Host context')
  applyHost(ctx, config)
}

function applyHost(ctx: HostContext, config?: ConfigOptions): void {
  const tune = resolveConfig(config)
  const CHUNK_CHARS = tune.chunkChars
  const MAX_PARTS = tune.maxParts
  const web = ctx.get('web')

  const llmCallStats = { calls: 0, ms: 0 }
  const calibration = createCalibrationRuntime(ctx, tune)
  const { calibratedRate, effectiveLatency, effectiveRate, loadCalibration, recordCalibration } = calibration
  const { buildEstimate, estimateCall, estimateTokens } = createBudgetRuntime(tune, calibration)

  const { readCacheEntry, writeCacheEntry } = createUrlCache(ctx, tune)

  const { callModelJson, pickConfig } = createLlmRuntime({
    ctx, estimateTokens, llmCallStats, recordCalibration,
  })
  const { bytesToLatin1, collectPageNums, extractPdfStats, extractPdfText } = createPdfTools(estimateTokens)
  const { attachExports, renderMarkdown } = createExportTools(ctx, tune, {
    arr,
    num,
    str,
    sanitizeArguments,
    sanitizeCitations,
    sanitizeConcepts,
    sanitizeQuestions,
    sanitizeQuotes,
    defaultRateTokPerSec: DEFAULT_RATE_TOK_PER_SEC,
  })

  const { resolveForEstimate, resolveSource } = createSourceRuntime({
    bytesToLatin1, ctx, extractPdfStats, extractPdfText,
    readCacheEntry, tune, web, writeCacheEntry,
  })

  // ---------- 清洗 / 提示词 ----------
  function sanitizeArguments(raw: unknown) {
    return arr(raw).slice(0, 10).map((a) => {
      const ao = isRecord(a) ? a : { claim: String(a) }
      return { claim: str(ao.claim, ''), evidence: str(ao.evidence, ''), quote: str(ao.quote, ''), source: str(ao.source, '') }
    }).filter((a) => a.claim !== '' || a.evidence !== '')
  }

  function sanitizeQuotes(raw: unknown) {
    return arr(raw).slice(0, 8).map((q) => {
      const qo = isRecord(q) ? q : { text: String(q) }
      return { text: str(qo.text, ''), context: str(qo.context, ''), source: str(qo.source, '') }
    }).filter((q) => q.text !== '')
  }

  function sanitizeCitations(raw: unknown) {
    return arr(raw).slice(0, 8).map((c) => {
      const co = isRecord(c) ? c : { claim: String(c) }
      return { claim: str(co.claim, ''), source: str(co.source, ''), quote: str(co.quote, '') }
    }).filter((c) => c.claim !== '' || c.quote !== '')
  }

  function sanitizeConcepts(raw: unknown) {
    return arr(raw).slice(0, 10).map((c) => {
      const co = isRecord(c) ? c : { term: String(c) }
      return { term: str(co.term, ''), explanation: str(co.explanation, '') }
    }).filter((c) => c.term !== '')
  }

  function sanitizeQuestions(raw: unknown) {
    return arr(raw).slice(0, 8).map((q) => String(q).trim()).filter((q) => q !== '')
  }

  function sanitizeSection(raw: unknown, fallbackTitle: string): SanitizedSection {
    const obj = isRecord(raw) ? raw : EMPTY_RECORD
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

  function sectionSystem(depth: DeepreadDepth, language: OutputLanguage, focus: string) {
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

  function sectionUser(text: string, index: number, total: number) {
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

  function finalSystem(language: OutputLanguage) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是精读分析师。请把各部分已提取的要点综合成全文层面的精读报告。\n'
      + '严格只输出一个 JSON 对象（不要输出任何解释或 Markdown 代码块），字段如下：\n'
      + FINAL_SCHEMA + '\n'
      + 'arguments 应提炼 3-8 条最重要的分论点；structure 用短语按顺序描述全文论证脉络。\n'
      + 'citations 挑选 3-8 条最重要的论断并引用原文关键句；若各部分要点带有 source（页码/段落），必须原样保留到 citations 的 source 字段。\n'
      + '输出语言：' + lang + '。'
  }

  function finalUserFromParts(parts: unknown[], totalChars: number) {
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

  function mapSystem(language: OutputLanguage, focus: string, isFinal: boolean) {
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

  function mapUser(text: string) {
    return '以下是待整理的内容：\n\n' + text + '\n\n注意：若原文中出现【第N页】标记，source 和 location 字段请使用页码。'
  }

  function mapFinalUser(parts: unknown[], totalChars: number) {
    return '全文共 ' + totalChars + ' 字，分为 ' + parts.length + ' 个部分。以下 JSON 数组是各部分已提取的要点：\n\n' + JSON.stringify(parts)
  }

  function sanitizeMap(parsed: unknown, chapters: AnalysisChapter[], meta: ResultMetadata): DeepreadResult {
    const p = isRecord(parsed) ? parsed : EMPTY_RECORD
    const items = arr(p.items).slice(0, 40).map((it) => {
      const o = isRecord(it) ? it : { claim: String(it) }
      const claim = str(o.claim, '')
      if (claim === '') return null
      return {
        type: str(o.type, '分论点'),
        claim,
        evidence: str(o.evidence, '原文未提供证据'),
        source: str(o.source, ''),
        confidence: str(o.confidence, ''),
        relations: arr(o.relations).slice(0, 6).map((r) => {
          const ro = isRecord(r) ? r : { type: String(r) }
          return { to: str(ro.to, ''), type: str(ro.type, '支持') }
        }).filter((r) => r.to !== ''),
      }
    }).filter((x) => x !== null)
    const dataPoints = arr(p.dataPoints).slice(0, 30).map((d) => {
      const o = isRecord(d) ? d : { value: String(d) }
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
      thesis: coreConclusions[0] ?? '',
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

  function feynmanStructSystem(language: OutputLanguage) {
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

  function feynmanChapterSystem(language: OutputLanguage, focus: string) {
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

  function feynmanChapterUser(text: string, index: number, total: number) {
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

  function feynmanFinalSystem(language: OutputLanguage) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是费曼读书法教练。请完成全书收尾：合并导图、终讲与间隔复习计划。\n严格只输出一个 JSON 对象（不要任何解释或 Markdown 代码块）：\n'
      + FEYNMAN_FINAL_SCHEMA + '\n'
      + 'reviewPlan 必须覆盖 5 个间隔：第1天（当天回顾）、第3天、第7天、第14天、第30天，每轮给出复习重点与具体方式。\n输出语言：' + lang + '。'
  }

  function feynmanFinalUser(compact: unknown) {
    return '以下 JSON 数组是各章的要点与讲解摘要：\n\n' + JSON.stringify(compact)
  }

  function sanitizeFeynmanChapter(parsed: unknown, index: number): FeynmanChapter {
    const p = isRecord(parsed) ? parsed : EMPTY_RECORD
    return {
      index: index,
      title: str(p.title, '第 ' + index + ' 章'),
      points: arr(p.points).slice(0, 10).map((pt) => {
        const po = isRecord(pt) ? pt : { claim: String(pt) }
        return { claim: str(po.claim, ''), data: str(po.data, ''), evidence: str(po.evidence, '原文未提供证据') }
      }).filter((x) => x.claim !== ''),
      chapterMap: str(p.chapterMap, ''),
      explanation: str(p.explanation, ''),
      gaps: arr(p.gaps).slice(0, 6).map((g) => String(g).trim()).filter((g) => g !== ''),
      corrections: arr(p.corrections).slice(0, 6).map((c) => String(c).trim()).filter((c) => c !== ''),
    }
  }

  // 批量最终综合调用沿用预算模块的固定 prompt 开销。
  const EST_PROMPT_OVERHEAD = 600

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

  function batchFinalSystem(language: OutputLanguage) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是跨文档对比分析师。请把多篇文章的要点综合成对比报告。\n'
      + '严格只输出一个 JSON 对象（不要输出任何解释、前后缀或 Markdown 代码块），结构如下：\n'
      + BATCH_SCHEMA + '\n'
      + 'comparison 选 3-6 个最有信息量的对比主题；conflicts 只列真实冲突（没有可留空数组）；synthesis 给出综合结论。\n'
      + '输出语言：' + lang + '。'
  }

  function sanitizePositions(raw: unknown) {
    return arr(raw).slice(0, 12).map((p) => {
      const po = isRecord(p) ? p : EMPTY_RECORD
      return { doc: str(po.doc, ''), view: str(po.view, '') }
    }).filter((p) => p.doc !== '' || p.view !== '')
  }

  function sanitizeComparison(raw: unknown, cap: number) {
    return arr(raw).slice(0, cap).map((c) => {
      const co = isRecord(c) ? c : EMPTY_RECORD
      return { theme: str(co.theme, ''), positions: sanitizePositions(co.positions) }
    }).filter((c) => c.theme !== '')
  }

  async function batchEstimateFlow(args: DeepreadInput, language: OutputLanguage): Promise<DeepreadResult> {
    await loadCalibration()
    const items = Array.isArray(args.batch) ? args.batch.slice(0, 10) : []
    const rows: Array<{ index: number; title: string; source: string; chars: number; quick: EstimateCall }> = []
    let totalChars = 0
    let totalCalls = 0
    let totalTokens = 0
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      const src = await resolveSource({ ...item, refresh: args.refresh === true })
      let text = String(src.text).replace(/\r\n/g, '\n')
      if (text.length > tune.maxInputChars) text = text.slice(0, tune.maxInputChars)
      totalChars += text.length
      const q = buildEstimate(text, 'quick').modes.find((mm) => mm.mode === 'quick')
      if (q === undefined) throw new Error('预算估算缺少 quick 模式')
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
      meta: { source: items.length + ' 篇文档', sourceKind: 'batch', chars: totalChars, chunks: items.length, depth: 'batch', durationMs: 0 },
    }
  }

  async function batchFlow(args: DeepreadInput, language: OutputLanguage, signal?: AbortLike | null, onProgress?: ProgressCallback): Promise<DeepreadResult> {
    const started = Date.now()
    const items = Array.isArray(args.batch) ? args.batch.slice(0, 10) : []
    const docs: BatchDocumentResult[] = []
    let totalChars = 0
    const cfg = await pickConfig()
    const progress = typeof onProgress === 'function' ? onProgress : null
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      if (progress !== null) progress('解析第 ' + (i + 1) + '/' + items.length + ' 篇…')
      const src = await resolveSource({ ...item, refresh: args.refresh === true }, { onProgress: progress === null ? undefined : (line) => progress('第 ' + (i + 1) + ' 篇 · ' + line) })
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
    const compact = docs.map((d) => ({ title: d.title, summary: d.summary, thesis: d.thesis, arguments: arr(d.arguments).slice(0, 3), quotes: arr(d.quotes).slice(0, 3) }))
    if (progress !== null) progress('跨篇对比汇总中…')
    const finalParsed = await callModelJson(cfg, batchFinalSystem(language), '以下 JSON 数组是 ' + docs.length + ' 篇文章各自的要点：\n\n' + JSON.stringify(compact), 5000, signal)
    const fp = isRecord(finalParsed) ? finalParsed : EMPTY_RECORD
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

  async function computeResult(input: unknown, opts: ComputeOptions = {}): Promise<DeepreadResult> {
    const opt = opts
    const args = parseDeepreadInput(input)
    const started = Date.now()
    const depth = normalizeDepth(args.depth)
    const language = normalizeLanguage(args.language)
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
      ...(typeof src.cache === 'string' ? { cache: src.cache } : EMPTY_RECORD),
      ...(typeof src.fetchedAt === 'string' ? { fetchedAt: src.fetchedAt } : EMPTY_RECORD),
      ...(typeof src.note === 'string' && src.note !== '' ? { note: src.note } : EMPTY_RECORD),
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
        meta: { ...cacheFields, source, sourceKind, chars, chunks: 0, depth, estimate, durationMs: Date.now() - started, stages: buildStages(), ...(pdfStats !== null ? { pdfStats } : EMPTY_RECORD) },
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
      const chapters: AnalysisChapter[] = []
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      for (let i = 0; i < parts.length; i++) {
        if (onProgress !== null) onProgress('精读第 ' + (i + 1) + '/' + parts.length + ' 段…')
        const parsed = await callModelJson(cfg, sectionSystem('deep', language, focus), sectionUser(parts[i]!, i, parts.length), 5000, signal)
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
      let toc: string[] = []
      let questions: string[] = []
      if (isBook) {
        const structParsed = await callModelJson(cfg, feynmanStructSystem(language), '请浏览目录并提出阅读问题：\n\n' + text.slice(0, 5000), 2500, signal)
        if (isRecord(structParsed)) {
          toc = arr(structParsed.toc).slice(0, 30).map((x) => String(x).trim()).filter((x) => x !== '')
          questions = arr(structParsed.questions).slice(0, 6).map((x) => String(x).trim()).filter((x) => x !== '')
        }
      }
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      const feynmanChapters: FeynmanChapter[] = []
      for (let i = 0; i < parts.length; i++) {
        if (onProgress !== null) onProgress('精读第 ' + (i + 1) + '/' + parts.length + ' 段…')
        const parsed = await callModelJson(cfg, feynmanChapterSystem(language, focus), feynmanChapterUser(parts[i]!, i + 1, parts.length), 5000, signal)
        feynmanChapters.push(sanitizeFeynmanChapter(parsed, i + 1))
        if (onProgress !== null) onProgress('完成第 ' + (i + 1) + '/' + parts.length + ' 段')
      }
      const compact = feynmanChapters.map((c) => ({ title: c.title, points: c.points.slice(0, 3), explanation: c.explanation.slice(0, 300) }))
      if (onProgress !== null) onProgress('汇总中…')
      const finalParsed = await callModelJson(cfg, feynmanFinalSystem(language), feynmanFinalUser(compact), 5000, signal)
      const fp = isRecord(finalParsed) ? finalParsed : EMPTY_RECORD
      const reviewPlan = arr(fp.reviewPlan).slice(0, 5).map((r) => {
        const ro = isRecord(r) ? r : { interval: String(r) }
        return { interval: str(ro.interval, ''), focus: str(ro.focus, ''), method: str(ro.method, '') }
      }).filter((r) => r.interval !== '')
      const first = feynmanChapters[0]
      const firstClaim = first?.points[0]?.claim ?? ''
      return {
        kind: 'feynman',
        title: str(fp.title, isBook ? '费曼读书报告' : '费曼精读报告'),
        summary: str(fp.summary, first?.explanation.slice(0, 100) ?? ''),
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
    const chapters: AnalysisChapter[] = []
    if (chunked) {
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      for (let i = 0; i < parts.length; i++) {
        if (onProgress !== null) onProgress('精读第 ' + (i + 1) + '/' + parts.length + ' 段…')
        const parsed = await callModelJson(cfg, sectionSystem('deep', language, focus), sectionUser(parts[i]!, i, parts.length), 5000, signal)
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
        const first = chapters[0]!
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

    const finalRecord = isRecord(finalParsed) ? finalParsed : EMPTY_RECORD
    const fin = sanitizeSection(finalRecord, chapters.length > 0 ? chapters[0]!.title : '未命名内容')
    const structure = arr(finalRecord.structure).slice(0, 12).map((x) => String(x).trim()).filter((x) => x !== '')
    const citations = sanitizeCitations(finalRecord.citations)
    return {
      kind: depth === 'book' ? 'book' : 'article',
      title: fin.title, summary: fin.summary, thesis: fin.thesis,
      arguments: fin.arguments, quotes: fin.quotes, concepts: fin.concepts, questions: fin.questions,
      structure, chapters, citations,
      meta: { ...cacheFields, source, sourceKind, chars: text.length, chunks: chunked ? chapters.length : 1, depth, estimate, durationMs: Date.now() - started, stages: buildStages() },
    }
  }

  function sourceLabel(source: unknown) {
    const s = str(source, '')
    if (s === '' || s === '粘贴文本') return '粘贴内容'
    return s.length > 24 ? s.slice(0, 24) + '…' : s
  }

  async function startBackground(
    args: DeepreadInput,
    input: unknown,
    preResolved: PreResolved | null,
    jobs: JobsService,
    exec: unknown,
    exportFmt: ExportFormat,
    language: OutputLanguage,
    isBatch: boolean,
    probe?: { estChars: number; source?: string; sourceKind?: string },
  ): Promise<DeepreadResult> {
    await loadCalibration()
    const depth = normalizeDepth(args.depth)
    let sourceLabelText = '粘贴内容'
    let M = 1
    let minutes: number | null = null
    let chars = 0
    let sourceKind: SourceKind | 'batch' = 'text'
    let sourceText = '粘贴内容'

    const probeEst = probe ?? null
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
      const row = est.modes.find((mm) => mm.mode === depth) ?? est.modes[0]
      minutes = row?.minutes ?? null
      M = depth === 'quick' ? 1 : Math.max(1, Math.min(splitChunks(text, CHUNK_CHARS).length, MAX_PARTS))
    } else if (probeEst !== null) {
      // 大 PDF：全量解析在后台任务内进行，label 用采样外推估算字数/段数/预算
      chars = Math.max(1, Math.round(probeEst.estChars))
      sourceKind = probeEst.sourceKind === 'url' || probeEst.sourceKind === 'file' || probeEst.sourceKind === 'pdf' || probeEst.sourceKind === 'text'
        ? probeEst.sourceKind
        : 'pdf'
      sourceText = typeof probeEst.source === 'string' ? probeEst.source : '粘贴内容'
      sourceLabelText = sourceLabel(sourceText)
      const est = buildEstimate('', depth, { chars, tokensPerChar: 0.6 })
      const row = est.modes.find((mm) => mm.mode === depth) ?? est.modes[0]
      minutes = row?.minutes ?? null
      M = depth === 'quick' ? 1 : Math.max(1, Math.min(Math.ceil(chars / CHUNK_CHARS), MAX_PARTS))
    }

    const label = 'deepread 精读「' + sourceLabelText + '」· ' + M + ' 段' + (minutes !== null ? ' · 预算≈' + minutes + '分钟' : '')

    const lines: string[] = []
    let cancelled = false
    let cancelReason = ''
    const signal = { aborted: false }
    type JobDone = { status: string; detail?: string }
    let resolveDone!: (value: JobDone) => void
    const donePromise = new Promise<JobDone>((resolve) => { resolveDone = resolve })
    const pushLine = (line: string): void => { if (line !== '') lines.push(line) }
    const onProgress = pushLine
    const readOutput = () => { const out = lines.join('\n'); lines.length = 0; return out }
    const hooks = {
      cancel(reason: unknown) {
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
      owner: isRecord(exec) && exec.agent !== undefined ? exec.agent : undefined,
      run: () => {
        void (async () => {
          try {
            let result: DeepreadResult
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
            const msg = errorMessage(err)
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

  async function analyze(input: unknown, exec: unknown): Promise<unknown> {
    const args = parseDeepreadInput(input)
    const exportFmt = normalizeExportFormat(args.export)
    const language = normalizeLanguage(args.language)
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

  const tool = createTool({
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
    presentCall(rawArgs: unknown) {
      try {
        if (!isRecord(rawArgs)) return undefined
        const args = parseDeepreadInput(rawArgs)
        const isBatch = Array.isArray(args.batch) && args.batch.length >= 2
        const url = typeof args.url === 'string' ? args.url.trim() : ''
        const path = typeof args.path === 'string' ? args.path.trim() : ''
        const source = url !== '' ? url : (path !== '' ? path : '粘贴内容')
        const depthLabel = args.depth === 'quick' ? '快速要点' : (args.depth === 'map' ? '知识地图' : (args.depth === 'feynman' ? '费曼读书法' : (args.depth === 'book' ? '整本书' : '深度精读')))
        if (args.estimate === true) {
          return { card: 'generic', kind: 'read', title: 'deepread 预算预检「' + source + '」', content: [{ type: 'text', text: '正在解析来源并估算各模式 token 与耗时（不调用模型）…' }] }
        }
        if (isBatch) {
          return { card: 'generic', kind: 'read', title: 'deepread 批量精读「' + (args.batch?.length ?? 0) + ' 篇文档」', content: [{ type: 'text', text: '正在逐篇解析与精读，随后生成跨篇对比报告；进度经后台任务逐条推送（job_output 读取）。' }] }
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
      render(_args: unknown, value: unknown) {
        return [{ type: 'text', text: renderMarkdown(value) }]
      },
      presentationMeta(_args: unknown, value: unknown) {
        return value
      },
    },
    async execute(args: unknown, exec: unknown) {
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
        const send = (payload: unknown): void => {
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
          const args = isRecord(body) ? body : EMPTY_RECORD
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
            ...(typeof src.note === 'string' && src.note !== '' ? { note: src.note } : EMPTY_RECORD),
            ...(typeof src.cache === 'string' ? { cache: src.cache } : EMPTY_RECORD),
            modes: estimate.modes,
            estTokensPerSecond: estimate.estTokensPerSecond,
            estLatencyPerCallMs: estimate.estLatencyPerCallMs,
            calibrated: estimate.calibrated === true,
          }
          return send(payload)
        } catch (err) {
          res.statusCode = 500
          return send({ ok: false, error: errorMessage(err) })
        }
      },
    }))
  }
}

// ---------- HTTP 请求体解析（面板直调 API 用） ----------
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Array<string | Buffer> = []
    let size = 0
    req.on('data', (chunk: string | Buffer) => {
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
