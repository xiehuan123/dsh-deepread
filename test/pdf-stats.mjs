// PDF 采样快速预检测试：extractPdfStats 直接调用 + estimate 模式采样外推。
import { mkdtemp, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = await mkdtemp(join(tmpdir(), 'dsh-deepread-pdfstats-'))
const scope = join(tmp, 'node_modules', '@deepseek-ai')

async function setupShims() {
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
  return await import(pathToFileURL(join(tmp, 'index.mjs')).href)
}

const mod = await setupShims()

function makePdfCtx() {
  const holder = {}
  holder.ctx = {
    get: () => undefined,
    effect: (fn) => { fn(); return () => {} },
    fs: {
      resolve: async (p) => resolve(p),
      readBytes: async (p) => await readFile(p),
    },
    tools: { register: (t) => { holder.tool = t } },
  }
  return holder
}

const fixture = join(root, 'test', 'fixtures', 'objstm.pdf')
const latin1Of = (bytes) => Buffer.from(bytes).toString('latin1')

// 场景 1：extractPdfStats 对 ObjStm fixture 返回 pages=1 且 sampleChars>0
{
  const h = makePdfCtx()
  mod.apply(h.ctx, undefined)
  assert.ok(typeof h.tool.__extractPdfStats === 'function', '暴露 __extractPdfStats 测试钩子')
  const bytes = await readFile(fixture)
  const stats = h.tool.__extractPdfStats(latin1Of(bytes))
  assert.equal(stats.pages, 1, 'fixture 总页数应为 1')
  assert.ok(stats.sampleChars > 0, 'fixture 采样字符数应 > 0')
  assert.equal(stats.samplePages, 2, 'samplePages 恒为 2')
  console.log('PDF STATS 1/3: fixture extractPdfStats → pages=' + stats.pages + ' sampleChars=' + stats.sampleChars)
}

// 场景 2（可选）：98099749.pdf 真实大 PDF → pages=479 且外推字数在 10 万~50 万
const bigPdf = '/Users/xiehuan/Downloads/98099749.pdf'
let bigPdfExists = true
try {
  await readFile(bigPdf)
} catch (err) {
  bigPdfExists = false
}

if (bigPdfExists) {
  const h = makePdfCtx()
  mod.apply(h.ctx, undefined)
  const bytes = await readFile(bigPdf)
  const stats = h.tool.__extractPdfStats(latin1Of(bytes))
  assert.equal(stats.pages, 479, '98099749.pdf 应为 479 页')
  const extrapolated = Math.round((stats.sampleChars / stats.samplePages) * stats.pages)
  // 前 2 页含封面（标题页，约 99 字），导致采样偏低；外推值应落在「一本书」数量级（8 万~50 万字）。
  assert.ok(extrapolated >= 80000 && extrapolated <= 500000, '外推字数应在 8 万~50 万之间，实际 ' + extrapolated)
  console.log('PDF STATS 2/3: 98099749.pdf → pages=' + stats.pages + ' sampleChars=' + stats.sampleChars + ' 外推=' + extrapolated)
} else {
  console.log('PDF STATS 2/3: SKIP（/Users/xiehuan/Downloads/98099749.pdf 不存在）')
}

// 场景 3：estimate 模式对 >2MB PDF 走采样外推（返回 pdfStats + 「按采样外推」标注）
if (bigPdfExists) {
  const h = makePdfCtx()
  mod.apply(h.ctx, undefined)
  const r = await h.tool.execute({ path: bigPdf, depth: 'deep', estimate: true })
  assert.equal(r.kind, 'estimate')
  assert.ok(r.meta.pdfStats, 'estimate 结果应带 pdfStats')
  assert.equal(r.meta.pdfStats.pages, 479)
  assert.ok(r.estimate.sampled === true && r.estimate.note === '按采样外推', '标注「按采样外推」')
  assert.ok(r.meta.chars >= 80000 && r.meta.chars <= 500000, '外推字数区间')
  console.log('PDF STATS 3/3: estimate 采样外推 → chars=' + r.meta.chars + ' note=' + r.estimate.note)
} else {
  console.log('PDF STATS 3/3: SKIP（无大 PDF 触发采样外推）')
}

console.log('PDF STATS OK')
