// 后台任务进度透明测试：mock jobs 服务验证长文/批量转后台、进度、取消、前台降级。
import { mkdtemp, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-jobs-'))
const scope = join(tmp, 'node_modules', '@deepseek-ai')

const dshToolsDir = join(scope, 'dsh-tools')
await mkdir(dshToolsDir, { recursive: true })
await writeFile(join(dshToolsDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', type: 'module', main: 'index.js' }))
await writeFile(join(dshToolsDir, 'index.js'), 'export function defineTool(tool){ return tool }\n')

const schemasteryDir = join(scope, 'schemastery')
await mkdir(schemasteryDir, { recursive: true })
await writeFile(join(schemasteryDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', type: 'module', main: 'index.js' }))
await writeFile(join(schemasteryDir, 'index.js'), [
  'const primitive = () => ({ default: (d) => d })',
  'export default { object: (props) => props, number: primitive, string: primitive, boolean: primitive, union: () => ({ default: (d) => d }) }',
  '',
].join('\n'))

const storageDomainDir = join(scope, 'dsh-storage-domain')
await mkdir(storageDomainDir, { recursive: true })
await writeFile(join(storageDomainDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-storage-domain', type: 'module', main: 'index.js' }))
await writeFile(join(storageDomainDir, 'index.js'), [
  'export function defineDomain(spec){ if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) throw new Error(\'domain name must match [a-z][a-z0-9_]*\'); return spec }',
  'export function domainTable(keySchema, recordSchema){ return { keySchema, recordSchema } }',
  '',
].join('\n'))

const zodDir = join(tmp, 'node_modules', 'zod')
await mkdir(zodDir, { recursive: true })
await writeFile(join(zodDir, 'package.json'), JSON.stringify({ name: 'zod', type: 'module', main: 'index.js' }))
await writeFile(join(zodDir, 'index.js'), [
  'export const z = { object: (shape) => ({ shape }), string: () => ({ type: \'string\' }) }',
  '',
].join('\n'))

await copyFile(join(root, 'index.mjs'), join(tmp, 'index.mjs'))
const mod = await import(pathToFileURL(join(tmp, 'index.mjs')).href)

const sectionJson = JSON.stringify({ title: '后台精读标题', summary: '摘要', thesis: '论点', arguments: [], quotes: [], concepts: [], questions: [] })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// 生成经典 xref 的多页纯文本 PDF（ASCII、无压缩流），用于后台解析进度测试。
function buildPdf(pages, charsPerPage) {
  const objs = []
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const kids = []
  for (let i = 0; i < pages; i++) kids.push((2 * i + 3) + ' 0 R')
  objs.push('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>\nendobj\n')
  const fontNum = 2 * pages + 3
  for (let i = 0; i < pages; i++) {
    const pageNum = 2 * i + 3
    const contentNum = pageNum + 1
    const stream = 'BT /F1 12 Tf 72 720 Td (' + 'a'.repeat(charsPerPage) + ') Tj ET'
    objs.push(pageNum + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + fontNum + ' 0 R >> >> /Contents ' + contentNum + ' 0 R >>\nendobj\n')
    objs.push(contentNum + ' 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream\nendobj\n')
  }
  objs.push(fontNum + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n')
  let out = '%PDF-1.4\n'
  const offsets = []
  for (const o of objs) { offsets.push(out.length); out += o }
  const xrefPos = out.length
  const total = objs.length + 1
  out += 'xref\n0 ' + total + '\n'
  out += '0000000000 65535 f\r\n'
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n\r\n'
  out += 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n'
  return out
}

function makeCtx(opts = {}) {
  const holder = { calls: 0, slowMs: opts.slowMs || 0 }
  const jobsState = { started: 0, spec: null, hooks: null }
  let jobs
  if (opts.withJobs !== false) {
    jobs = {
      async start(spec) {
        jobsState.started++
        jobsState.spec = spec
        jobsState.hooks = spec.run() // 同步拿到 hooks，并触发后台计算
        return 'deepread-1'
      },
    }
  }
  holder.ctx = {
    get: (name) => {
      if (name === 'jobs') return jobs
      return undefined
    },
    effect: (fn) => { fn(); return () => {} },
    fs: {
      async resolve(p) { return p },
      async readBytes(p) { return await readFile(p) },
      async readText(p) { return await readFile(p, 'utf-8') },
    },
    llm: {
      listProviders: () => [{ id: 'fake' }],
      listModels: async () => ['fake-model'],
      stream: async function* () {
        holder.calls++
        yield { type: 'text-delta', text: sectionJson }
        if (holder.slowMs > 0) await delay(holder.slowMs)
        yield { type: 'finish', reason: null }
      },
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  holder.jobsState = jobsState
  return holder
}

const LONG_TEXT = '字'.repeat(10000)

// 场景 1：长文本 deep → 后台；done completed；进度行 + 最终报告
{
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: LONG_TEXT, depth: 'deep', export: 'none' }, { agent: 'agent-1' })
  assert.equal(r.kind, 'background')
  assert.equal(r.title, '后台精读已启动', 'background 结果含 title（输出 schema 必填）')
  assert.equal(r.jobId, 'deepread-1')
  assert.equal(h.jobsState.started, 1)
  assert.equal(h.jobsState.spec.kind, 'deepread')
  assert.equal(h.jobsState.spec.owner, 'agent-1')
  assert.equal(h.jobsState.spec.outputLimitBytes, 256 * 1024)
  assert.ok(h.jobsState.spec.label.includes('deepread 精读'), 'label 形如 deepread 精读「…」· N 段')
  assert.ok(h.jobsState.spec.label.includes('段'), 'label 含段数')
  const hooks = h.jobsState.hooks
  assert.ok(hooks, 'start 返回 hooks')
  const doneResult = await hooks.done
  assert.equal(doneResult.status, 'completed')
  const out1 = hooks.readOutput()
  assert.ok(out1.includes('已解析「粘贴内容」（10000 字）'), '进度行含解析完成行')
  assert.ok(out1.includes('精读第 1/2 段'), '进度行含分段开始')
  assert.ok(out1.includes('汇总中'), '进度行含汇总')
  assert.ok(out1.includes('【最终报告】'), '含最终报告')
  assert.ok(out1.includes('后台精读标题'), '含报告标题')
  const out2 = hooks.readOutput()
  assert.equal(out2, '', 'readOutput 读完清空')
  console.log('JOBS 1/7: 长文 deep 后台 → jobId=deepread-1，进度/汇总/最终报告齐全')
}

// 场景 2：短文本 quick → 前台（不产生 job）
{
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: '短文本', depth: 'quick', export: 'none' })
  assert.equal(r.kind, 'article')
  assert.equal(h.jobsState.started, 0, 'quick 不产生后台任务')
  assert.equal(h.jobsState.hooks, null)
  console.log('JOBS 2/7: 短文本 quick 前台 kind=article，无 job')
}

// 场景 3：无 jobs 服务 + 长文本 → 前台正常出报告
{
  const h = makeCtx({ withJobs: false })
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: LONG_TEXT, depth: 'deep', export: 'none' })
  assert.equal(r.kind, 'article')
  assert.equal(r.title, '后台精读标题')
  assert.equal(h.jobsState.started, 0)
  console.log('JOBS 3/7: 无 jobs 长文本前台出报告')
}

// 场景 4：cancel() 后 done 以 killed 结算
{
  const h = makeCtx({ slowMs: 80 })
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ text: LONG_TEXT, depth: 'deep', export: 'none' })
  assert.equal(r.kind, 'background')
  const hooks = h.jobsState.hooks
  await delay(20) // 让后台进入 llm 流（正在 slowMs 延迟中）
  hooks.cancel('用户取消')
  const doneResult = await hooks.done
  assert.equal(doneResult.status, 'killed')
  assert.equal(doneResult.detail, '用户取消')
  console.log('JOBS 4/7: cancel 后 done.status=killed')
}

// 场景 5：batch 恒后台
{
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ batch: [{ text: 'aa'.repeat(200) }, { text: 'bb'.repeat(200) }], export: 'none' })
  assert.equal(r.kind, 'background')
  assert.equal(r.jobId, 'deepread-1')
  assert.ok(h.jobsState.spec.label.includes('2 篇文档'), 'batch 标签含篇数')
  const doneResult = await h.jobsState.hooks.done
  assert.equal(doneResult.status, 'completed')
  const batchOut = h.jobsState.hooks.readOutput()
  assert.ok(batchOut.includes('解析第 1/2 篇…'), 'batch 含逐篇解析进度')
  assert.ok(batchOut.includes('精读第 1/2 篇…'), 'batch 含逐篇精读进度')
  assert.ok(batchOut.includes('完成第 2/2 篇'), 'batch 含逐篇完成进度')
  assert.ok(batchOut.includes('跨篇对比汇总中…'), 'batch 含汇总进度')
  assert.ok(batchOut.includes('【最终报告】'), 'batch 含最终报告')
  console.log('JOBS 5/7: batch 恒后台，label=' + h.jobsState.spec.label + '，逐篇进度齐全')
}

// 场景 6：长 PDF（24 页 × 1200 字）→ 后台；解析阶段逐页进度 + 分段精读进度
{
  const pdfPath = join(tmp, 'many-pages.pdf')
  await writeFile(pdfPath, buildPdf(24, 1200))
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ path: pdfPath, depth: 'deep', export: 'none' }, { agent: 'agent-1' })
  assert.equal(r.kind, 'background')
  assert.equal(h.jobsState.started, 1)
  const stats = h.tool.__extractPdfStats(Buffer.from(await readFile(pdfPath)).toString('latin1'))
  const estChars = Math.max(1, Math.round((stats.sampleChars / stats.samplePages) * stats.pages))
  const expectedM = Math.min(Math.ceil(estChars / 6000), 20)
  assert.ok(h.jobsState.spec.label.includes(expectedM + ' 段'), 'label 含采样外推段数 ' + expectedM + '，实际=' + h.jobsState.spec.label)
  const doneResult = await h.jobsState.hooks.done
  assert.equal(doneResult.status, 'completed')
  const out = h.jobsState.hooks.readOutput()
  assert.ok(out.includes('解析 PDF 中…（共 24 页）'), '解析开始行含总页数')
  assert.ok(out.includes('解析 PDF 中… 100%（24/24 页）'), '解析完成行 100%')
  assert.ok(/精读第 1\/\d+ 段…/.test(out), '解析后进入分段精读')
  const doneLines = out.match(/完成第 \d+\/\d+ 段/g)
  assert.ok(doneLines !== null && doneLines.length > 1, '逐段完成行存在，实际 ' + (doneLines === null ? 0 : doneLines.length) + ' 行')
  assert.ok(out.includes('汇总中…') && out.includes('【最终报告】'), '汇总与最终报告齐全')
  console.log('JOBS 6/7: 长 PDF 后台 → 逐页解析进度 + 分段精读进度，label=' + h.jobsState.spec.label)
}

// 场景 7：短 PDF（2 页 × 200 字）→ 前台（采样外推判长后直接前台出报告）
{
  const smallPath = join(tmp, 'small.pdf')
  await writeFile(smallPath, buildPdf(2, 200))
  const h = makeCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ path: smallPath, depth: 'deep', export: 'none' }, { agent: 'agent-1' })
  assert.equal(r.kind, 'article', '短 PDF 前台出报告')
  assert.equal(h.jobsState.started, 0, '短 PDF 不产生后台任务')
  assert.equal(r.meta.sourceKind, 'pdf')
  console.log('JOBS 7/7: 短 PDF 前台 kind=article（采样预检判长正常）')
}

// 场景 8：presentCall 官方 pending 卡（call 时一次性渲染；replay 软失败不抛错）
{
  const h = makeCtx({ withJobs: false })
  mod.apply(h.ctx, undefined)
  assert.equal(typeof h.tool.presentCall, 'function', '注册了 presentCall')
  const view = h.tool.presentCall({ path: 'book.pdf', depth: 'deep' })
  assert.equal(view.card, 'generic')
  assert.equal(view.kind, 'read')
  assert.ok(view.title.includes('deepread 精读「book.pdf」'), 'title 含来源，实际=' + view.title)
  assert.ok(view.content.length >= 1 && view.content[0].type === 'text', '含说明文本 content')
  const batchView = h.tool.presentCall({ batch: [{ text: 'a' }, { text: 'b' }] })
  assert.ok(batchView.title.includes('批量精读'), 'batch 卡标题')
  assert.equal(h.tool.presentCall(null), undefined, '异常输入软失败为 undefined')
  console.log('JOBS 8/8: presentCall 官方 pending 卡（generic/read，含标题与说明，软失败）')
}

console.log('JOBS PROGRESS OK')
