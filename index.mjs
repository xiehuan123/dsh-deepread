// DeepRead 精读助手 — Node half（官方 bundle 插件 Cordis entry）
// 依赖 @deepseek-ai/* 由 profile pnpm 闭包注入，不在 package.json 声明。
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'deepread'
export const inject = ['fs', 'llm', 'tools']

export function apply(ctx) {
  const CHUNK_CHARS = 6000
  const MAX_PARTS = 20
  const web = ctx.get('web')

  function str(v, fallback) {
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
  }

  function arr(v) {
    if (Array.isArray(v)) return v
    if (typeof v === 'string' && v.trim() !== '') return [v.trim()]
    return []
  }

  function parseJson(text) {
    let cleaned = String(text).trim()
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try { return JSON.parse(cleaned) } catch (error) { /* keep going */ }
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) } catch (error) { /* keep going */ }
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

  async function callModel(cfg, system, userText, maxTokens) {
    const options = {
      provider: cfg.provider,
      model: cfg.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      temperature: 0.2,
      maxTokens,
    }
    if (cfg.reasoningEffort !== undefined) options.reasoningEffort = cfg.reasoningEffort
    let text = ''
    let failure = null
    for await (const chunk of ctx.llm.stream(options)) {
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
        const partRe = /\(((?:[^()\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g
        let pm
        while ((pm = partRe.exec(inner)) !== null) {
          if (pm[1] !== undefined) parts.push({ text: decodePdfString(pm[1]) })
          else parts.push({ gap: parseFloat(pm[2]) })
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

  function extractPdfText(latin1) {
    if (latin1.slice(0, 5) !== '%PDF-') throw new Error('不是有效的 PDF 文件')
    const objects = {}
    const objRe = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g
    let m
    while ((m = objRe.exec(latin1)) !== null) {
      objects[m[1]] = m[3]
    }

    function getObject(num) {
      if (!num) return null
      const raw = objects[num]
      if (raw === undefined) return null
      const sIdx = raw.indexOf('stream')
      if (sIdx >= 0) {
        const dictPart = raw.slice(0, sIdx)
        const after = raw.slice(sIdx + 'stream'.length)
        const { data } = findStreamEnd(after, 0)
        const filters = []
        const f1 = dictPart.match(/\/Filter\s*\[([^\]]*)\]/)
        const f2 = dictPart.match(/\/Filter\s*\/([A-Za-z0-9_+.\-]+)/)
        if (f1) {
          for (const f of f1[1].split('/')) {
            const name = f.trim()
            if (name) filters.push(name)
          }
        } else if (f2) filters.push(f2[1])
        return { dict: dictPart, stream: data, filters }
      }
      return { dict: raw, stream: null, filters: [] }
    }

    function resolveRef(dict, key) {
      const re = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R')
      const mm = dict.match(re)
      return mm ? mm[1] : null
    }
    function resolveMultiRef(dict, key) {
      const out = []
      const re = new RegExp('/' + key + '\\s+\\[([^\\]]*)\\]')
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
    const trailerObj = objects.trailer
    if (trailerObj !== undefined) rootNum = resolveRef(trailerObj, 'Root')
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
      const type = node.dict.match(/\/Type\s*\/Pages?/)
      const kids = resolveMultiRef(node.dict, 'Kids')
      if (type && type[0] === '/Type /Pages') {
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
      } else if (type && type[0] === '/Type /Page') {
        pageNums.push(n)
      }
    }
    if (pageNums.length === 0 && visited.size > 0) {
      for (const n of visited) {
        const node = getObject(n)
        if (node && /\/Type\s*\/Page\b/.test(node.dict)) pageNums.push(n)
      }
    }

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
    }
    const pages = pageTexts.filter((t) => t.trim() !== '')
    return pages.map((t, i) => '【第' + (i + 1) + '页】\n' + t).join('\n\n')
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

  async function resolveSource(args) {
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    const path = typeof args.path === 'string' ? args.path.trim() : ''
    const text = typeof args.text === 'string' ? args.text : ''
    if (url !== '') {
      if (web === undefined) throw new Error('当前环境未挂载网页抓取服务，无法读取链接')
      const hostMatch = url.match(/^https?:\/\/([^\/?#]+)/i)
      const host = hostMatch ? hostMatch[1].toLowerCase() : ''
      if (host !== 'mp.weixin.qq.com' && host !== 'weixin.qq.com' && !host.endsWith('.weixin.qq.com')) {
        throw new Error('链接抓取仅支持微信公众号（mp.weixin.qq.com）。' + (host === '' ? '不是有效的链接。' : '「' + host + '」存在反爬或登录墙，请直接粘贴正文，或将内容保存为 .txt/.md/.pdf 后用 path 传入。'))
      }
      const result = await web.fetch({ url })
      if (result === null || typeof result !== 'object' || typeof result.statusCode !== 'number') throw new Error('网页抓取失败')
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
      if (pageTitle !== '' && contentText.indexOf(pageTitle) === -1) contentText = pageTitle + '\n\n' + contentText
      return { text: contentText, source: url, sourceKind: 'url' }
    }
    if (path !== '') {
      const lower = path.toLowerCase()
      if (lower.endsWith('.pdf')) {
        const target = await ctx.fs.resolve(path)
        const bytes = await ctx.fs.readBytes(target, undefined, 30 * 1024 * 1024)
        const latin = bytesToLatin1(bytes)
        let extracted = ''
        try {
          extracted = extractPdfText(latin)
        } catch (error) {
          throw new Error('PDF 解析失败：' + (error !== null && typeof error === 'object' && error.message ? error.message : String(error)))
        }
        if (extracted.trim() === '') throw new Error('PDF 中没有可提取的文本（可能是扫描版/图片型 PDF，建议先 OCR 或转成 txt 再精读）')
        return { text: extracted, source: path, sourceKind: 'pdf' }
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

  // ---------- 清洗 / 提示词 ----------
  function sanitizeArguments(raw) {
    return arr(raw).slice(0, 10).map((a) => {
      const ao = a !== null && typeof a === 'object' ? a : { claim: String(a) }
      return { claim: str(ao.claim, ''), evidence: str(ao.evidence, ''), quote: str(ao.quote, '') }
    }).filter((a) => a.claim !== '' || a.evidence !== '')
  }

  function sanitizeQuotes(raw) {
    return arr(raw).slice(0, 8).map((q) => {
      const qo = q !== null && typeof q === 'object' ? q : { text: String(q) }
      return { text: str(qo.text, ''), context: str(qo.context, '') }
    }).filter((q) => q.text !== '')
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
    '  "arguments": [{"claim": "分论点", "evidence": "支撑的论据或推理", "quote": "原文关键句（可选）"}],',
    '  "quotes": [{"text": "值得摘录的原文原句", "context": "这句话在论证什么（可选）"}],',
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
    '  "arguments": [{"claim": "分论点", "evidence": "论据", "quote": "原文关键句（可选）"}],',
    '  "structure": ["论证脉络步骤，按顺序，例如：提出背景→定义问题→反驳旧说→提出新框架"],',
    '  "concepts": [{"term": "概念", "explanation": "含义"}],',
    '  "questions": ["批判性思考问题"]',
    '}',
  ].join('\n')

  function finalSystem(language) {
    const lang = language === 'en' ? 'English' : (language === 'zh' ? '简体中文' : '与原文语言保持一致')
    return '你是精读分析师。请把各部分已提取的要点综合成全文层面的精读报告。\n'
      + '严格只输出一个 JSON 对象（不要输出任何解释或 Markdown 代码块），字段如下：\n'
      + FINAL_SCHEMA + '\n'
      + 'arguments 应提炼 3-8 条最重要的分论点；structure 用短语按顺序描述全文论证脉络。\n'
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

  async function computeResult(input) {
    const args = input !== null && typeof input === 'object' ? input : {}
    const started = Date.now()
    const depth = args.depth === 'quick' ? 'quick' : (args.depth === 'book' ? 'book' : (args.depth === 'map' ? 'map' : (args.depth === 'feynman' ? 'feynman' : 'deep')))
    const language = args.language === 'en' ? 'en' : (args.language === 'zh' ? 'zh' : 'auto')
    const focus = typeof args.focus === 'string' ? args.focus : ''

    const src = await resolveSource(args)
    let text = String(src.text).replace(/\r\n/g, '\n')
    const source = src.source
    const sourceKind = src.sourceKind
    if (text.trim() === '') throw new Error('没有可分析的内容')
    if (text.length > 400000) text = text.slice(0, 400000)

    const cfg = await pickConfig()

    if (depth === 'quick') {
      const limited = text.length > 30000 ? text.slice(0, 30000) : text
      const parsed = parseJson(await callModel(cfg, sectionSystem('quick', language, focus), sectionUser(limited, 0, 1), 2500))
      if (parsed === null) throw new Error('模型输出无法解析为 JSON，请重试')
      const s = sanitizeSection(parsed, '未命名内容')
      return {
        kind: 'article', title: s.title, summary: s.summary, thesis: s.thesis,
        arguments: s.arguments, quotes: s.quotes, concepts: s.concepts, questions: s.questions,
        structure: [], chapters: [],
        meta: { source, sourceKind, chars: limited.length, chunks: 1, depth: 'quick', durationMs: Date.now() - started },
      }
    }

    if (depth === 'map') {
      if (text.length <= 9000) {
        const parsed = parseJson(await callModel(cfg, mapSystem(language, focus, false), mapUser(text), 5000))
        if (parsed === null) throw new Error('模型输出无法解析为 JSON，请重试')
        return sanitizeMap(parsed, [], { source, sourceKind, chars: text.length, chunks: 1, depth: 'map', durationMs: Date.now() - started })
      }
      const chapters = []
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      for (let i = 0; i < parts.length; i++) {
        const parsed = parseJson(await callModel(cfg, sectionSystem('deep', language, focus), sectionUser(parts[i], i, parts.length), 3000))
        const s = sanitizeSection(parsed === null ? {} : parsed, '第 ' + (i + 1) + ' 部分')
        chapters.push({ title: s.title, summary: s.summary, thesis: s.thesis, arguments: s.arguments, quotes: s.quotes })
      }
      const condensed = chapters.map((c) => ({ title: c.title, summary: c.summary, thesis: c.thesis, arguments: c.arguments.slice(0, 3) }))
      const finalParsed = parseJson(await callModel(cfg, mapSystem(language, focus, true), mapFinalUser(condensed, text.length), 5000))
      if (finalParsed === null) throw new Error('模型输出无法解析为 JSON，请重试')
      return sanitizeMap(finalParsed, chapters, { source, sourceKind, chars: text.length, chunks: chapters.length, depth: 'map', durationMs: Date.now() - started })
    }

    if (depth === 'feynman') {
      const isBook = text.length > 9000
      let toc = []
      let questions = []
      if (isBook) {
        const structParsed = parseJson(await callModel(cfg, feynmanStructSystem(language), '请浏览目录并提出阅读问题：\n\n' + text.slice(0, 5000), 1200))
        if (structParsed !== null) {
          toc = arr(structParsed.toc).slice(0, 30).map((x) => String(x).trim()).filter((x) => x !== '')
          questions = arr(structParsed.questions).slice(0, 6).map((x) => String(x).trim()).filter((x) => x !== '')
        }
      }
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      const feynmanChapters = []
      for (let i = 0; i < parts.length; i++) {
        const parsed = parseJson(await callModel(cfg, feynmanChapterSystem(language, focus), feynmanChapterUser(parts[i], i + 1, parts.length), 3500))
        feynmanChapters.push(sanitizeFeynmanChapter(parsed, i + 1))
      }
      const compact = feynmanChapters.map((c) => ({ title: c.title, points: c.points.slice(0, 3), explanation: c.explanation.slice(0, 300) }))
      const finalParsed = parseJson(await callModel(cfg, feynmanFinalSystem(language), feynmanFinalUser(compact), 3500))
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
        meta: { source, sourceKind, chars: text.length, chunks: feynmanChapters.length, depth: 'feynman', durationMs: Date.now() - started },
      }
    }

    const chunked = depth === 'book' || text.length > 9000
    const chapters = []
    if (chunked) {
      let parts = splitChunks(text, CHUNK_CHARS)
      if (parts.length > MAX_PARTS) parts = parts.slice(0, MAX_PARTS)
      for (let i = 0; i < parts.length; i++) {
        const parsed = parseJson(await callModel(cfg, sectionSystem('deep', language, focus), sectionUser(parts[i], i, parts.length), 3000))
        const s = sanitizeSection(parsed === null ? {} : parsed, '第 ' + (i + 1) + ' 部分')
        chapters.push({ title: s.title, summary: s.summary, thesis: s.thesis, arguments: s.arguments, quotes: s.quotes })
      }
    }

    let finalParsed = null
    if (chapters.length > 0) {
      const parts = chapters.map((c) => ({ title: c.title, summary: c.summary, thesis: c.thesis, arguments: c.arguments.slice(0, 3) }))
      finalParsed = parseJson(await callModel(cfg, finalSystem(language), finalUserFromParts(parts, text.length), 4000))
    } else {
      finalParsed = parseJson(await callModel(cfg, sectionSystem('deep', language, focus), sectionUser(text, 0, 1), 3500))
    }

    if (finalParsed === null) {
      if (chapters.length > 0) {
        const first = chapters[0]
        return {
          kind: depth === 'book' ? 'book' : 'article',
          title: first.title, summary: first.summary, thesis: first.thesis,
          arguments: first.arguments, quotes: first.quotes, concepts: [], questions: [],
          structure: [], chapters,
          meta: { source, sourceKind, chars: text.length, chunks: chapters.length, depth, durationMs: Date.now() - started, note: '综合阶段输出解析失败，已回退为各部分要点' },
        }
      }
      throw new Error('模型输出无法解析为 JSON，请重试')
    }

    const fin = sanitizeSection(finalParsed, chapters.length > 0 ? chapters[0].title : '未命名内容')
    const structure = arr(finalParsed.structure).slice(0, 12).map((x) => String(x).trim()).filter((x) => x !== '')
    return {
      kind: depth === 'book' ? 'book' : 'article',
      title: fin.title, summary: fin.summary, thesis: fin.thesis,
      arguments: fin.arguments, quotes: fin.quotes, concepts: fin.concepts, questions: fin.questions,
      structure, chapters,
      meta: { source, sourceKind, chars: text.length, chunks: chunked ? chapters.length : 1, depth, durationMs: Date.now() - started },
    }
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
    return lines.join('\n')
  }

  function renderMarkdown(v) {
    if (v.kind === 'map') return renderMapMarkdown(v)
    if (v.kind === 'feynman') return renderFeynmanMarkdown(v)
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
      qts.forEach((q) => lines.push('- “' + q.text + '”'))
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
    lines.push('', '---', '', '（来源：' + str(meta.source, '粘贴文本') + ' · 字数：' + (typeof meta.chars === 'number' ? meta.chars : 0) + ' · 深度：' + str(meta.depth, 'deep') + '）')
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

  async function analyze(input) {
    const args = input !== null && typeof input === 'object' ? input : {}
    const exportFmt = args.export === 'md' || args.export === 'mm' || args.export === 'html' || args.export === 'all' ? args.export : 'none'
    const result = await computeResult(input)
    await attachExports(result, exportFmt)
    return result
  }

  const tool = defineTool({
    name: 'deepread',
    description: '精读一本书或一篇文章，提取核心观点、论证结构与关键论据。分析结果默认只在会话中展示 Markdown 报告、不写入磁盘；需要落盘时用 export 参数指定格式（md=Markdown、mm=FreeMind 思维导图【XMind 可导入】、html=网页报告、all=全部），文件写入工作区 deepread-output/ 目录。五种模式：quick=快速抓要点；deep=深度精读；map=「观点—证据—数据—关系」知识地图（含四档置信度标注：作者原意/原文事实与数据/合理推断/无法确认）；feynman=费曼读书法（浏览目录→提出问题→分章阅读→提取观点数据证据→章节导图→合上书讲解→自检知识缺口→回原文修正→合并全书导图→再讲一次→间隔复习计划）；book=整本书分部分精读。输入：url（仅微信公众号 mp.weixin.qq.com 稳定链接）、path（.txt/.md/.html/.pdf）、text（粘贴文本）。知乎/掘金等反爬站点请粘贴正文。',
    timeoutMs: 900000,
    parameters: {
      url: { type: 'string', description: '要精读的网页链接。仅支持微信公众号（mp.weixin.qq.com）的稳定链接；知乎/掘金等有反爬的站点不支持，请粘贴正文。与 path/text 至少提供一个。' },
      text: { type: 'string', description: '要精读的文本内容，直接粘贴。与 url/path 至少提供一个。' },
      path: { type: 'string', description: '工作区内要精读的文件路径，支持 .txt/.md/.markdown/.html 与 .pdf，如 "notes/第一章.md" 或 "book.pdf"。' },
      depth: { type: 'string', enum: ['quick', 'deep', 'map', 'feynman', 'book'], default: 'deep', description: '精读模式。quick=快速抓要点；deep=深度精读（默认，长文自动分段）；map=「观点—证据—数据—关系」知识地图；feynman=费曼读书法（11 步闭环：目录→提问→分章→观点数据证据→章节导图→合上书讲解→找缺口→回原文修正→合并导图→再讲一次→间隔复习）；book=整本书分部分精读并汇总。' },
      export: { type: 'string', enum: ['none', 'md', 'mm', 'html', 'all'], default: 'none', description: '导出格式。none=不落盘，仅在会话中展示（默认）；md=导出 Markdown 报告；mm=导出 FreeMind 思维导图（XMind 可导入）；html=导出网页报告；all=三种全部导出。' },
      focus: { type: 'string', description: '读者特别关注的角度，例如"论证逻辑""研究方法""与既有理论的关系"。' },
      language: { type: 'string', enum: ['zh', 'en', 'auto'], default: 'auto', description: '报告输出语言，默认 auto（跟随原文）。' },
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
          arguments: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { claim: { type: 'string' }, evidence: { type: 'string' }, quote: { type: 'string' } } } },
          quotes: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { text: { type: 'string' }, context: { type: 'string' } } } },
          concepts: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { term: { type: 'string' }, explanation: { type: 'string' } } } },
          questions: { type: 'array', items: { type: 'string' } },
          structure: { type: 'array', items: { type: 'string' } },
          chapters: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { title: { type: 'string' }, summary: { type: 'string' }, thesis: { type: 'string' }, arguments: { type: 'array' }, quotes: { type: 'array' } } } },
          meta: { type: 'object', additionalProperties: true, properties: { source: { type: 'string' }, sourceKind: { type: 'string' }, chars: { type: 'number' }, chunks: { type: 'number' }, depth: { type: 'string' }, durationMs: { type: 'number' }, note: { type: 'string' }, files: { type: 'object', additionalProperties: true, properties: { md: { type: 'string' }, mm: { type: 'string' }, html: { type: 'string' } } } } },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: renderMarkdown(value) }]
      },
      presentationMeta(args, value) {
        return value
      },
    },
    async execute(args) {
      return analyze(args)
    },
  })

  ctx.effect(() => ctx.tools.register(tool))
}
