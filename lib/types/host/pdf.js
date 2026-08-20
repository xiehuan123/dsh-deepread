export function createPdfTools(estimateTokens) {
    // ---------- PDF 文本提取（纯 JS：inflate + ToUnicode） ----------
    function bytesToLatin1(bytes) {
        let s = '';
        const CH = 32768;
        for (let i = 0; i < bytes.length; i += CH) {
            s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CH, bytes.length)));
        }
        return s;
    }
    function latin1ToBytes(s) {
        const bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++)
            bytes[i] = s.charCodeAt(i) & 0xff;
        return bytes;
    }
    function inflateRaw(data) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        let pos = 0;
        let bitBuf = 0;
        let bitCnt = 0;
        const out = [];
        function readBits(n) {
            while (bitCnt < n) {
                if (pos >= bytes.length)
                    throw new Error('inflate: unexpected EOF');
                const byte = bytes[pos++];
                if (byte === undefined)
                    throw new Error('inflate: unexpected EOF');
                bitBuf |= byte << bitCnt;
                bitCnt += 8;
            }
            const v = bitBuf & ((1 << n) - 1);
            bitBuf >>>= n;
            bitCnt -= n;
            return v;
        }
        const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
        const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
        const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
        const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
        const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        function buildHuffman(lengths) {
            const maxLen = Math.max.apply(null, lengths);
            const blCount = new Array(maxLen + 1).fill(0);
            for (const l of lengths)
                if (l > 0)
                    blCount[l] = (blCount[l] ?? 0) + 1;
            let code = 0;
            const nextCode = new Array(maxLen + 1).fill(0);
            for (let bits = 1; bits <= maxLen; bits++) {
                code = (code + (blCount[bits - 1] ?? 0)) << 1;
                nextCode[bits] = code;
            }
            const table = {};
            for (let sym = 0; sym < lengths.length; sym++) {
                const len = lengths[sym] ?? 0;
                if (len === 0)
                    continue;
                const c = nextCode[len] ?? 0;
                nextCode[len] = c + 1;
                table[len + ':' + c.toString(2).padStart(len, '0')] = sym;
            }
            return table;
        }
        function decodeSym(table, maxLen) {
            let code = 0;
            for (let len = 1; len <= maxLen; len++) {
                code = (code << 1) | readBits(1);
                const hit = table[len + ':' + code.toString(2).padStart(len, '0')];
                if (hit !== undefined)
                    return hit;
            }
            throw new Error('inflate: invalid huffman code');
        }
        function fixedLitTable() {
            const lengths = [];
            for (let i = 0; i < 144; i++)
                lengths.push(8);
            for (let i = 144; i < 256; i++)
                lengths.push(9);
            for (let i = 256; i < 280; i++)
                lengths.push(7);
            for (let i = 280; i < 288; i++)
                lengths.push(8);
            return buildHuffman(lengths);
        }
        function fixedDistTable() {
            return buildHuffman(new Array(30).fill(5));
        }
        let litTable = null;
        let distTable = null;
        let finalBlock = false;
        function decodeBlock() {
            for (;;) {
                if (litTable === null || distTable === null)
                    throw new Error('inflate: missing huffman table');
                const sym = decodeSym(litTable, 15);
                if (sym < 256) {
                    out.push(sym);
                }
                else if (sym === 256) {
                    return;
                }
                else {
                    const lenIdx = sym - 257;
                    if (lenIdx < 0 || lenIdx >= LEN_BASE.length)
                        throw new Error('inflate: bad length symbol');
                    const length = LEN_BASE[lenIdx] + readBits(LEN_EXTRA[lenIdx]);
                    const distSym = decodeSym(distTable, 15);
                    if (distSym < 0 || distSym >= DIST_BASE.length)
                        throw new Error('inflate: bad distance symbol');
                    const dist = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
                    const start = out.length - dist;
                    if (start < 0)
                        throw new Error('inflate: distance too far back');
                    for (let i = 0; i < length; i++)
                        out.push(out[start + i]);
                }
            }
        }
        while (!finalBlock) {
            finalBlock = readBits(1) === 1;
            const btype = readBits(2);
            if (btype === 0) {
                readBits(bitCnt & 7);
                const len = bytes[pos] | (bytes[pos + 1] << 8);
                const nlen = bytes[pos + 2] | (bytes[pos + 3] << 8);
                pos += 4;
                if ((len ^ 0xffff) !== nlen)
                    throw new Error('inflate: stored block len mismatch');
                for (let i = 0; i < len; i++)
                    out.push(bytes[pos++]);
            }
            else if (btype === 1) {
                litTable = fixedLitTable();
                distTable = fixedDistTable();
                decodeBlock();
            }
            else if (btype === 2) {
                const hlit = readBits(5) + 257;
                const hdist = readBits(5) + 1;
                const hclen = readBits(4) + 4;
                const clLengths = new Array(19).fill(0);
                for (let i = 0; i < hclen; i++)
                    clLengths[CLEN_ORDER[i]] = readBits(3);
                const clTable = buildHuffman(clLengths);
                const lengths = [];
                while (lengths.length < hlit + hdist) {
                    const sym = decodeSym(clTable, 7);
                    if (sym < 16)
                        lengths.push(sym);
                    else if (sym === 16) {
                        const prev = lengths[lengths.length - 1];
                        if (prev === undefined)
                            throw new Error('inflate: missing previous code length');
                        const rep = 3 + readBits(2);
                        for (let i = 0; i < rep; i++)
                            lengths.push(prev);
                    }
                    else if (sym === 17) {
                        const rep = 3 + readBits(3);
                        for (let i = 0; i < rep; i++)
                            lengths.push(0);
                    }
                    else if (sym === 18) {
                        const rep = 11 + readBits(7);
                        for (let i = 0; i < rep; i++)
                            lengths.push(0);
                    }
                    else
                        throw new Error('inflate: bad code length symbol');
                }
                if (lengths.length > hlit + hdist)
                    lengths.length = hlit + hdist;
                litTable = buildHuffman(lengths.slice(0, hlit));
                distTable = buildHuffman(lengths.slice(hlit));
                decodeBlock();
            }
            else {
                throw new Error('inflate: reserved block type');
            }
        }
        return new Uint8Array(out);
    }
    function inflateZlib(data) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (bytes.length < 2)
            throw new Error('zlib: too short');
        const cmf = bytes[0];
        const flg = bytes[1];
        if ((cmf & 0x0f) !== 8)
            throw new Error('zlib: not deflate');
        if (((cmf << 8) | flg) % 31 !== 0)
            throw new Error('zlib: bad header');
        let offset = 2;
        if ((flg & 0x20) !== 0)
            offset += 4;
        return inflateRaw(bytes.slice(offset));
    }
    function decodePdfString(raw) {
        let out = '';
        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            if (c === '\\') {
                const n = raw[i + 1];
                if (n === undefined) {
                    out += '\\';
                    break;
                }
                if (n === 'n')
                    out += '\n';
                else if (n === 'r')
                    out += '\r';
                else if (n === 't')
                    out += '\t';
                else if (n === 'b')
                    out += '\b';
                else if (n === 'f')
                    out += '\f';
                else if (n === '(' || n === ')' || n === '\\')
                    out += n;
                else if (n >= '0' && n <= '7') {
                    let oct = n;
                    let j = i + 2;
                    while (j < raw.length && j < i + 4) {
                        const digit = raw[j];
                        if (digit === undefined || digit < '0' || digit > '7')
                            break;
                        oct += digit;
                        j++;
                    }
                    out += String.fromCharCode(parseInt(oct, 8) & 0xff);
                    i = j - 1;
                }
                else {
                    out += n;
                }
                i++;
            }
            else {
                out += c;
            }
        }
        return out;
    }
    function findStreamEnd(body, startIdx) {
        const iEnd = body.indexOf('endstream', startIdx);
        if (iEnd === -1)
            return { end: -1, data: '' };
        let dataStart = startIdx;
        if (body[startIdx] === '\r' && body[startIdx + 1] === '\n')
            dataStart = startIdx + 2;
        else if (body[startIdx] === '\n')
            dataStart = startIdx + 1;
        let dataEnd = iEnd;
        if (body[dataEnd - 1] === '\n')
            dataEnd--;
        if (body[dataEnd - 1] === '\r')
            dataEnd--;
        return { end: iEnd + 'endstream'.length, data: body.slice(dataStart, dataEnd) };
    }
    function decodeStreamData(streamData, filters) {
        let data = streamData;
        for (let i = 0; i < filters.length; i++) {
            const f = filters[i];
            if (f === 'FlateDecode' || f === 'Fl') {
                data = bytesToLatin1(inflateZlib(latin1ToBytes(data)));
            }
            else if (f === 'ASCIIHexDecode' || f === 'AHx') {
                let hex = data.replace(/[^0-9a-fA-F]/g, '');
                if (hex.length % 2 === 1)
                    hex += '0';
                let out = '';
                for (let k = 0; k < hex.length; k += 2)
                    out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
                data = out;
            }
            else if (f === 'ASCII85Decode' || f === 'A85') {
                const clean = data.replace(/\s/g, '');
                let out = '';
                let i2 = 0;
                const endMark = clean.indexOf('~>');
                const src = endMark >= 0 ? clean.slice(0, endMark) : clean;
                while (i2 < src.length) {
                    let chunk = src.slice(i2, i2 + 5);
                    i2 += 5;
                    const pad = 5 - chunk.length;
                    if (pad > 0)
                        chunk += 'uuuu'.slice(0, pad);
                    let val = 0;
                    for (const ch of chunk) {
                        if (ch === 'z') {
                            val = 0;
                            break;
                        }
                        const c2 = ch.charCodeAt(0) - 33;
                        if (c2 < 0 || c2 > 84)
                            throw new Error('bad a85');
                        val = val * 85 + c2;
                    }
                    let b4 = '';
                    for (let k = 3; k >= 0; k--)
                        b4 += String.fromCharCode((val >> (k * 8)) & 0xff);
                    out += b4.slice(0, 4 - pad);
                }
                data = out;
            }
            else if (f !== '') {
                try {
                    data = bytesToLatin1(inflateZlib(latin1ToBytes(data)));
                }
                catch (error) { /* keep as-is */ }
            }
        }
        return data;
    }
    function extractTextOperations(content) {
        const runs = [];
        let currentFont = null;
        let newLine = false;
        const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj|<((?:[0-9A-Fa-f\s]+))>\s*Tj|\[((?:[^\[\]\\]|\\.)*)\]\s*TJ|'((?:[^()\\]|\\.)*)'|"((?:[^()\\]|\\.)*)"|\/([A-Za-z0-9_+\-.]+)\s+[\d.]+\s+Tf|(T\*)|(Td)|(TD)/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            if (m[1] !== undefined) {
                runs.push({ text: decodePdfString(m[1]), font: currentFont, gap: 0, br: newLine });
                newLine = false;
            }
            else if (m[2] !== undefined) {
                const hex = m[2].replace(/\s+/g, '');
                const bytes = [];
                for (let i = 0; i + 1 < hex.length; i += 2)
                    bytes.push(parseInt(hex.slice(i, i + 2), 16));
                let s = '';
                for (const b of bytes)
                    s += String.fromCharCode(b);
                runs.push({ text: s, font: currentFont, gap: 0, br: newLine });
                newLine = false;
            }
            else if (m[3] !== undefined) {
                const inner = m[3];
                const parts = [];
                const partRe = /\(((?:[^()\\]|\\.)*)\)|(<[0-9A-Fa-f\s]+>)|(-?\d+(?:\.\d+)?)/g;
                let pm;
                while ((pm = partRe.exec(inner)) !== null) {
                    if (pm[1] !== undefined)
                        parts.push({ text: decodePdfString(pm[1]) });
                    else if (pm[2] !== undefined) {
                        const clean = pm[2].replace(/[^0-9a-fA-F]/g, '');
                        let s = '';
                        for (let i = 0; i + 1 < clean.length; i += 2)
                            s += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
                        parts.push({ text: s });
                    }
                    else if (pm[3] !== undefined)
                        parts.push({ gap: parseFloat(pm[3]) });
                }
                let buf = '';
                let gapSum = 0;
                for (const p of parts) {
                    if (p.text !== undefined)
                        buf += p.text;
                    else
                        gapSum += p.gap ?? 0;
                }
                if (buf.length > 0)
                    runs.push({ text: buf, font: currentFont, gap: gapSum, br: newLine });
                newLine = false;
            }
            else if (m[4] !== undefined) {
                newLine = true;
                runs.push({ text: decodePdfString(m[4]), font: currentFont, gap: 0, br: newLine });
                newLine = false;
            }
            else if (m[5] !== undefined) {
                newLine = true;
                runs.push({ text: decodePdfString(m[5]), font: currentFont, gap: 0, br: newLine });
                newLine = false;
            }
            else if (m[6] !== undefined) {
                currentFont = m[6];
            }
            else if (m[7] !== undefined || m[8] !== undefined || m[9] !== undefined) {
                newLine = true;
            }
        }
        return runs;
    }
    function hexToStr(hex) {
        let h = hex;
        if (h.length % 2 === 1)
            h += '0';
        const bytes = [];
        for (let i = 0; i + 1 < h.length; i += 2)
            bytes.push(parseInt(h.slice(i, i + 2), 16));
        let s = '';
        for (let i = 0; i + 1 < bytes.length; i += 2)
            s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return s;
    }
    function parseCmap(cmapText) {
        const map = {};
        let twoByte = false;
        const key = (num, width) => num.toString(16).toUpperCase().padStart(width, '0');
        const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
        let m;
        while ((m = bfcharRe.exec(cmapText)) !== null) {
            const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
            let p;
            const block = m[1];
            if (block === undefined)
                continue;
            while ((p = pairRe.exec(block)) !== null) {
                const source = p[1];
                const target = p[2];
                if (source === undefined || target === undefined)
                    continue;
                if (source.length > 2)
                    twoByte = true;
                map[source.toUpperCase()] = hexToStr(target);
            }
        }
        const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
        while ((m = bfrangeRe.exec(cmapText)) !== null) {
            const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
            let p;
            const block = m[1];
            if (block === undefined)
                continue;
            while ((p = rangeRe.exec(block)) !== null) {
                const sourceStart = p[1];
                const sourceEnd = p[2];
                if (sourceStart === undefined || sourceEnd === undefined)
                    continue;
                const lo = parseInt(sourceStart, 16);
                const hi = parseInt(sourceEnd, 16);
                const width = sourceStart.length;
                if (width > 2)
                    twoByte = true;
                if (p[3] !== undefined) {
                    const target = p[3];
                    if (target.length === width) {
                        let t = parseInt(target, 16);
                        for (let c = lo; c <= hi; c++) {
                            map[key(c, width)] = hexToStr(t.toString(16).toUpperCase().padStart(width, '0'));
                            t++;
                        }
                    }
                    else if (target.length < width) {
                        const prefixHex = target.slice(0, Math.max(0, target.length - 2));
                        for (let c = lo; c <= hi; c++) {
                            const lastByte = (c & 0xff).toString(16).toUpperCase().padStart(2, '0');
                            map[key(c, width)] = hexToStr(prefixHex + lastByte);
                        }
                    }
                }
                else if (p[4] !== undefined) {
                    const entries = p[4].trim().split(/\s+/).filter(Boolean);
                    for (let c = lo; c <= hi && c - lo < entries.length; c++) {
                        map[key(c, width)] = hexToStr(entries[c - lo].replace(/[<>]/g, ''));
                    }
                }
            }
        }
        return { map, twoByte };
    }
    // 解析 PDF 结构（xref/ObjStm/页树），返回页对象编号与后续单页提取所需的对象解析闭包。
    function collectPageNums(latin1) {
        const objects = {};
        const objRe = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
        let m;
        while ((m = objRe.exec(latin1)) !== null) {
            if (m[1] !== undefined && m[3] !== undefined)
                objects[m[1]] = m[3];
        }
        // ---------- 交叉引用解析（经典 xref 表 / XRef 交叉引用流 / ObjStm 对象流） ----------
        function undoPredictor(data, predictor, columns) {
            const bytes = latin1ToBytes(data);
            if (predictor === 2) {
                // TIFF 预测：每字节加上同列上一行，无 filter 字节
                const out = new Uint8Array(bytes.length);
                for (let i = 0; i < bytes.length; i++) {
                    out[i] = i >= columns ? (bytes[i] + out[i - columns]) & 0xff : bytes[i];
                }
                return bytesToLatin1(out);
            }
            // PNG 预测（10–15）：每行开头 1 字节 filter 类型，行宽 columns
            const stride = columns + 1;
            const rowCount = Math.floor(bytes.length / stride);
            const out = new Uint8Array(rowCount * columns);
            for (let row = 0; row < rowCount; row++) {
                const f = bytes[row * stride];
                for (let j = 0; j < columns; j++) {
                    const x = bytes[row * stride + 1 + j];
                    const left = j > 0 ? out[row * columns + j - 1] : 0;
                    const above = row > 0 ? out[(row - 1) * columns + j] : 0;
                    const ul = row > 0 && j > 0 ? out[(row - 1) * columns + j - 1] : 0;
                    let v;
                    if (f === 1)
                        v = x + left;
                    else if (f === 2)
                        v = x + above;
                    else if (f === 3)
                        v = x + ((left + above) >> 1);
                    else if (f === 4) {
                        const p = left + above - ul;
                        const pa = Math.abs(p - left);
                        const pb = Math.abs(p - above);
                        const pc = Math.abs(p - ul);
                        v = x + (pa <= pb && pa <= pc ? left : pb <= pc ? above : ul);
                    }
                    else
                        v = x;
                    out[row * columns + j] = v & 0xff;
                }
            }
            return bytesToLatin1(out);
        }
        function extractFilters(dictPart) {
            const filters = [];
            const f1 = dictPart.match(/\/Filter\s*\[([^\]]*)\]/);
            const f2 = dictPart.match(/\/Filter\s*\/([A-Za-z0-9_+.\-]+)/);
            if (f1) {
                for (const f of f1[1].split('/')) {
                    const name = f.trim();
                    if (name)
                        filters.push(name);
                }
            }
            else if (f2?.[1] !== undefined)
                filters.push(f2[1]);
            return filters;
        }
        function parseObjectBody(raw) {
            const sIdx = raw.indexOf('stream');
            if (sIdx >= 0) {
                const dictPart = raw.slice(0, sIdx);
                const after = raw.slice(sIdx + 'stream'.length);
                const { data } = findStreamEnd(after, 0);
                return { dict: dictPart, stream: data, filters: extractFilters(dictPart) };
            }
            return { dict: raw, stream: null, filters: [] };
        }
        function parseXrefStreamEntries(node) {
            const entries = new Map();
            const dict = node.dict;
            const wMatch = dict.match(/\/W\s*\[([^\]]*)\]/);
            if (!wMatch || node.stream === null)
                return entries;
            const w = wMatch[1].trim().split(/\s+/).map((x) => parseInt(x, 10));
            const sizeMatch = dict.match(/\/Size\s+(\d+)/);
            const size = sizeMatch?.[1] !== undefined ? parseInt(sizeMatch[1], 10) : 0;
            let indexPairs;
            const indexMatch = dict.match(/\/Index\s*\[([^\]]*)\]/);
            if (indexMatch) {
                const nums = indexMatch[1].trim().split(/\s+/).map((x) => parseInt(x, 10));
                indexPairs = [];
                for (let i = 0; i + 1 < nums.length; i += 2)
                    indexPairs.push([nums[i], nums[i + 1]]);
            }
            else {
                indexPairs = [[0, size]];
            }
            let decoded = decodeStreamData(node.stream, node.filters);
            const dpMatch = dict.match(/\/DecodeParms\s*<<([\s\S]*?)>>/);
            if (dpMatch) {
                const params = dpMatch[1];
                const pm = params.match(/\/Predictor\s+(\d+)/);
                const cm = params.match(/\/Columns\s+(\d+)/);
                if (pm?.[1] !== undefined && parseInt(pm[1], 10) >= 2)
                    decoded = undoPredictor(decoded, parseInt(pm[1], 10), cm?.[1] !== undefined ? parseInt(cm[1], 10) : 1);
            }
            const rowLen = (w[0] || 0) + (w[1] || 0) + (w[2] || 0);
            if (rowLen === 0)
                return entries;
            const bytes = latin1ToBytes(decoded);
            let p = 0;
            for (const pair of indexPairs) {
                const first = pair[0];
                const count = pair[1];
                for (let i = 0; i < count; i++) {
                    if (p + rowLen > bytes.length)
                        return entries;
                    const row = bytes.subarray(p, p + rowLen);
                    p += rowLen;
                    let q = 0;
                    const read = (len) => { let v = 0; for (let k = 0; k < len; k++)
                        v = v * 256 + row[q + k]; q += len; return v; };
                    const type = w[0] > 0 ? read(w[0]) : 1;
                    const f2 = w[1] > 0 ? read(w[1]) : 0;
                    const f3 = w[2] > 0 ? read(w[2]) : 0;
                    if (type !== 0)
                        entries.set(first + i, { type, f2, f3 });
                }
            }
            return entries;
        }
        function loadRawByOffset(num, offset) {
            const head = latin1.slice(offset, offset + 48).match(/^\s*(\d+)\s+(\d+)\s+obj\b/);
            if (!head || head[1] !== String(num))
                return null;
            const bodyStart = offset + head[0].length;
            const seg = latin1.slice(bodyStart);
            const nextObj = seg.search(/[\r\n]\s*\d+\s+\d+\s+obj\b/);
            let raw = nextObj === -1 ? seg : seg.slice(0, nextObj + 1);
            const eo = raw.lastIndexOf('endobj');
            if (eo >= 0)
                raw = raw.slice(0, eo);
            return raw;
        }
        const xrefEntries = new Map();
        let trailerDict = '';
        const smAll = latin1.match(/startxref\s+(\d+)/g);
        if (smAll !== null && smAll.length > 0) {
            const xrefOffsetMatch = smAll[smAll.length - 1].match(/(\d+)/);
            if (xrefOffsetMatch?.[1] === undefined)
                throw new Error('PDF 结构无法解析（startxref 无效）');
            const xrefOffset = parseInt(xrefOffsetMatch[1], 10);
            const at = latin1.slice(xrefOffset, xrefOffset + 16);
            if (/^\s*xref\b/.test(at)) {
                // 经典 xref 表：解析各 subsection 的 20 字节条目
                const tMatch = latin1.slice(xrefOffset).match(/[\s\S]*?trailer\b/);
                const tableText = tMatch ? tMatch[0].slice(0, -'trailer'.length) : latin1.slice(xrefOffset);
                let pos = 0;
                const subHeaderRe = /(\d+)\s+(\d+)\s*[\r\n]+/g;
                while (true) {
                    subHeaderRe.lastIndex = pos;
                    const h = subHeaderRe.exec(tableText);
                    if (h === null)
                        break;
                    const first = parseInt(h[1], 10);
                    const count = parseInt(h[2], 10);
                    pos = h.index + h[0].length;
                    for (let i = 0; i < count; i++) {
                        const line = tableText.slice(pos, pos + 20);
                        pos += 20;
                        const em = line.match(/(\d{10})\s+(\d{5})\s+([nf])/);
                        if (em === null)
                            continue;
                        if (em[3] !== 'f')
                            xrefEntries.set(first + i, { type: 1, f2: parseInt(em[1], 10), f3: parseInt(em[2], 10) });
                    }
                }
                const tr = latin1.slice(xrefOffset).match(/trailer\s*(<<[\s\S]*?>>)/);
                if (tr?.[1] !== undefined)
                    trailerDict = tr[1];
            }
            else if (at.match(/^\s*\d+\s+\d+\s+obj\b/)) {
                // XRef 交叉引用流（PDF 1.5+）：trailer 键就在流的字典里
                const headNumMatch = at.match(/^\s*(\d+)\s+\d+\s+obj\b/);
                if (headNumMatch) {
                    const xrefNum = headNumMatch[1];
                    let xrefNode = objects[xrefNum];
                    if (xrefNode === undefined)
                        xrefNode = loadRawByOffset(xrefNum, xrefOffset);
                    if (xrefNode !== null && xrefNode !== undefined) {
                        const node = parseObjectBody(xrefNode);
                        for (const [k, v] of parseXrefStreamEntries(node))
                            xrefEntries.set(k, v);
                        trailerDict = node.dict;
                    }
                }
            }
        }
        // 混合文件：经典 trailer 携带 /XRefStm 指向补充的交叉引用流
        if (trailerDict !== '') {
            const xsm = trailerDict.match(/\/XRefStm\s+(\d+)/);
            if (xsm) {
                const xoff = parseInt(xsm[1], 10);
                const hm = latin1.slice(xoff, xoff + 48).match(/^\s*(\d+)\s+\d+\s+obj\b/);
                if (hm?.[1] !== undefined && objects[hm[1]] !== undefined) {
                    const node = parseObjectBody(objects[hm[1]]);
                    for (const [k, v] of parseXrefStreamEntries(node))
                        xrefEntries.set(k, v);
                }
            }
        }
        // ---------- ObjStm 对象流展开与对象解析 ----------
        const objstmObjects = {};
        const expandedStms = new Set();
        function expandObjStm(sn) {
            if (expandedStms.has(sn))
                return;
            expandedStms.add(sn);
            const node = getObject(sn);
            if (node === null || node.stream === null)
                return;
            const nMatch = node.dict.match(/\/N\s+(\d+)/);
            const fMatch = node.dict.match(/\/First\s+(\d+)/);
            if (!nMatch || !fMatch)
                return;
            const n = parseInt(nMatch[1], 10);
            const first = parseInt(fMatch[1], 10);
            let decoded = decodeStreamData(node.stream, node.filters);
            const dpMatch = node.dict.match(/\/DecodeParms\s*<<([\s\S]*?)>>/);
            if (dpMatch) {
                const params = dpMatch[1];
                const pm = params.match(/\/Predictor\s+(\d+)/);
                const cm = params.match(/\/Columns\s+(\d+)/);
                if (pm?.[1] !== undefined && parseInt(pm[1], 10) >= 2)
                    decoded = undoPredictor(decoded, parseInt(pm[1], 10), cm?.[1] !== undefined ? parseInt(cm[1], 10) : 1);
            }
            const head = decoded.slice(0, first);
            const toks = head.trim().split(/\s+/);
            const pairs = [];
            for (let i = 0; i < n && i * 2 + 1 < toks.length; i++) {
                const num = parseInt(toks[i * 2], 10);
                const off = parseInt(toks[i * 2 + 1], 10);
                if (!Number.isNaN(num) && !Number.isNaN(off))
                    pairs.push([num, off]);
            }
            for (let i = 0; i < pairs.length; i++) {
                const pair = pairs[i];
                const end = i + 1 < pairs.length ? first + pairs[i + 1][1] : decoded.length;
                objstmObjects[pair[0]] = decoded.slice(first + pair[1], end);
            }
        }
        function getObject(num) {
            if (!num)
                return null;
            let raw = objects[num];
            if (raw === undefined)
                raw = objstmObjects[num];
            if (raw === undefined) {
                const e = xrefEntries.get(Number(num));
                if (e !== undefined) {
                    if (e.type === 1) {
                        const r = loadRawByOffset(num, e.f2);
                        if (r !== null) {
                            objects[num] = r;
                            raw = r;
                        }
                    }
                    else if (e.type === 2) {
                        expandObjStm(e.f2);
                        raw = objstmObjects[num];
                    }
                }
            }
            if (raw === undefined)
                return null;
            return parseObjectBody(raw);
        }
        // 预先展开所有对象流（Root / Pages / Fonts 等常驻其中）
        for (const e of xrefEntries.values()) {
            if (e.type === 2)
                expandObjStm(e.f2);
        }
        function resolveRef(dict, key) {
            const re = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R');
            const mm = dict.match(re);
            return mm?.[1] ?? null;
        }
        function resolveMultiRef(dict, key) {
            const out = [];
            const re = new RegExp('/' + key + '\\s*\\[([^\\]]*)\\]');
            const mm = dict.match(re);
            if (mm) {
                const refRe = /(\d+)\s+\d+\s+R/g;
                let r;
                while ((r = refRe.exec(mm[1])) !== null)
                    if (r[1] !== undefined)
                        out.push(r[1]);
                return out;
            }
            const single = resolveRef(dict, key);
            return single ? [single] : [];
        }
        let rootNum = null;
        if (trailerDict !== '')
            rootNum = resolveRef(trailerDict, 'Root');
        if (!rootNum) {
            const t = latin1.match(/trailer\s*(<<[\s\S]*?>>)/);
            if (t?.[1] !== undefined)
                rootNum = resolveRef(t[1], 'Root');
        }
        if (!rootNum)
            throw new Error('PDF 结构无法解析（找不到根对象）');
        const root = getObject(rootNum);
        if (root === null)
            throw new Error('PDF 结构无法解析（根对象缺失）');
        const pagesNum = resolveRef(root.dict, 'Pages');
        if (!pagesNum)
            throw new Error('PDF 结构无法解析（找不到页树）');
        const pageNums = [];
        const stack = [pagesNum];
        const visited = new Set();
        while (stack.length > 0) {
            const n = stack.pop();
            if (n === undefined || visited.has(n))
                continue;
            visited.add(n);
            const node = getObject(n);
            if (!node)
                continue;
            const isPages = /\/Type\s*\/Pages\b/.test(node.dict);
            const isPage = /\/Type\s*\/Page\b/.test(node.dict);
            const kids = resolveMultiRef(node.dict, 'Kids');
            if (isPages) {
                for (let i = kids.length - 1; i >= 0; i--)
                    stack.push(kids[i]);
            }
            else if (isPage) {
                pageNums.push(n);
            }
        }
        if (pageNums.length === 0 && visited.size > 0) {
            for (const n of visited) {
                const node = getObject(n);
                if (node && /\/Type\s*\/Page\b/.test(node.dict))
                    pageNums.push(n);
            }
        }
        return { pageNums, getObject, resolveRef, resolveMultiRef };
    }
    // 对给定页对象编号逐页提取纯文本（共享：extractPdfText 与 extractPdfStats 复用）。
    function extractPageTexts(pageNums, getObject, resolveRef, resolveMultiRef, onPage = null) {
        const fontMaps = {};
        function getFontMap(fontRef) {
            if (!fontRef)
                return null;
            if (fontMaps[fontRef] !== undefined)
                return fontMaps[fontRef];
            const fontObj = getObject(fontRef);
            let result = null;
            if (fontObj) {
                const toUniNum = resolveRef(fontObj.dict, 'ToUnicode');
                if (toUniNum) {
                    const cmapObj = getObject(toUniNum);
                    if (cmapObj && cmapObj.stream !== null) {
                        const decoded = decodeStreamData(cmapObj.stream, cmapObj.filters);
                        result = parseCmap(decoded);
                    }
                }
            }
            fontMaps[fontRef] = result;
            return result;
        }
        const pageTexts = [];
        for (const pn of pageNums) {
            const page = getObject(pn);
            if (!page)
                continue;
            let resDict = page.dict;
            const resRef = resolveRef(page.dict, 'Resources');
            if (resRef) {
                const resObj = getObject(resRef);
                if (resObj)
                    resDict = resObj.dict;
            }
            const fontTags = {};
            const fontRes = resDict.match(/\/Font\s*<<([\s\S]*?)>>/);
            if (fontRes) {
                const pairRe = /\/([A-Za-z0-9_+\-.]+)\s+(\d+)\s+\d+\s+R/g;
                let p;
                while ((p = pairRe.exec(fontRes[1])) !== null) {
                    if (p[1] !== undefined && p[2] !== undefined)
                        fontTags[p[1]] = p[2];
                }
            }
            const contentRefs = resolveMultiRef(page.dict, 'Contents');
            let pageText = '';
            let lastGap = 0;
            for (const cref of contentRefs) {
                const cobj = getObject(cref);
                if (!cobj || cobj.stream === null)
                    continue;
                const decoded = decodeStreamData(cobj.stream, cobj.filters);
                const runs = extractTextOperations(decoded);
                for (const run of runs) {
                    let text = run.text;
                    const fref = run.font !== null ? fontTags[run.font] : null;
                    const fm = fref ? getFontMap(fref) : null;
                    if (fm && fm.map && Object.keys(fm.map).length > 0) {
                        let mapped = '';
                        const bytes = latin1ToBytes(text);
                        let i = 0;
                        while (i < bytes.length) {
                            const one = bytes[i].toString(16).toUpperCase().padStart(2, '0');
                            if (fm.twoByte && i + 1 < bytes.length) {
                                const two = one + bytes[i + 1].toString(16).toUpperCase().padStart(2, '0');
                                if (fm.map[two] !== undefined) {
                                    mapped += fm.map[two];
                                    i += 2;
                                    continue;
                                }
                            }
                            if (fm.map[one] !== undefined)
                                mapped += fm.map[one];
                            else
                                mapped += String.fromCharCode(bytes[i]);
                            i++;
                        }
                        text = mapped;
                    }
                    else {
                        let latin = '';
                        for (let k = 0; k < text.length; k++) {
                            const c = text.charCodeAt(k);
                            latin += c < 32 || c > 126 ? (c >= 160 ? String.fromCharCode(c) : '') : String.fromCharCode(c);
                        }
                        text = latin;
                    }
                    if (text !== '') {
                        try {
                            text = text.normalize('NFKC');
                        }
                        catch (error) { /* keep */ }
                        if (pageText !== '') {
                            const prev = pageText[pageText.length - 1] || '';
                            const next = text[0] || '';
                            const latinish = /[A-Za-z0-9]/;
                            const needSpace = latinish.test(prev) && latinish.test(next);
                            if (run.br)
                                pageText += '\n';
                            else if (lastGap >= -100 && needSpace && !pageText.endsWith(' ') && !pageText.endsWith('\n'))
                                pageText += ' ';
                        }
                        pageText += text;
                    }
                    lastGap = run.gap || 0;
                }
            }
            pageTexts.push(pageText.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
            if (onPage !== null && typeof onPage === 'function')
                onPage({ done: pageTexts.length, total: pageNums.length });
        }
        return pageTexts;
    }
    function extractPdfText(latin1, onPage) {
        if (latin1.slice(0, 5) !== '%PDF-')
            throw new Error('不是有效的 PDF 文件');
        const state = collectPageNums(latin1);
        const pageCb = typeof onPage === 'function' ? onPage : null;
        if (pageCb !== null)
            pageCb({ total: state.pageNums.length, done: 0 });
        const pageTexts = extractPageTexts(state.pageNums, state.getObject, state.resolveRef, state.resolveMultiRef, pageCb);
        const pages = pageTexts.filter((t) => t.trim() !== '');
        return pages.map((t, i) => '【第' + (i + 1) + '页】\n' + t).join('\n\n');
    }
    // 采样快速预检：只解析结构与前 2 页文本，避免大 PDF 全量提取。
    function extractPdfStats(latin1) {
        if (latin1.slice(0, 5) !== '%PDF-')
            throw new Error('不是有效的 PDF 文件');
        const state = collectPageNums(latin1);
        const pages = state.pageNums.length;
        const sample = state.pageNums.slice(0, 2);
        const pageTexts = extractPageTexts(sample, state.getObject, state.resolveRef, state.resolveMultiRef);
        const sampleChars = pageTexts.reduce((n, t) => n + t.length, 0);
        const sampleTokens = estimateTokens(pageTexts.join('\n'));
        return { pages, samplePages: 2, sampleChars, sampleTokens };
    }
    return { bytesToLatin1, collectPageNums, extractPdfStats, extractPdfText };
}
