import { errorMessage, isLlmCatalogService, isLlmStreamService, isRecord } from './types.js';
export function str(v, fallback) {
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}
export function num(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}
export function arr(v) {
    if (Array.isArray(v))
        return v;
    if (typeof v === 'string' && v.trim() !== '')
        return [v.trim()];
    return [];
}
// 修复模型 JSON 的经典毛病：字符串内未转义的换行/回车/Tab
export function repairJson(text) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (const ch of String(text)) {
        if (esc) {
            out += ch;
            esc = false;
            continue;
        }
        if (ch === '\\') {
            out += ch;
            esc = true;
            continue;
        }
        if (ch === '"') {
            inStr = !inStr;
            out += ch;
            continue;
        }
        if (inStr) {
            if (ch === '\n') {
                out += '\\n';
                continue;
            }
            if (ch === '\r') {
                out += '\\r';
                continue;
            }
            if (ch === '\t') {
                out += '\\t';
                continue;
            }
        }
        out += ch;
    }
    return out;
}
export function parseJson(text) {
    let cleaned = String(text).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const attempts = [cleaned];
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start)
        attempts.push(cleaned.slice(start, end + 1));
    for (const raw of attempts) {
        const repaired = repairJson(raw);
        for (const candidate of [raw, repaired, raw.replace(/,\s*([}\]])/g, '$1'), repaired.replace(/,\s*([}\]])/g, '$1')]) {
            try {
                return JSON.parse(candidate);
            }
            catch (error) { /* keep going */ }
        }
    }
    return null;
}
export function splitChunks(text, size) {
    const paras = text.split(/\n{2,}|\r\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    const chunks = [];
    let current = '';
    for (const para of paras) {
        if (para.length > size) {
            if (current.trim() !== '') {
                chunks.push(current.trim());
                current = '';
            }
            let rest = para;
            while (rest.length > size) {
                let cut = rest.slice(0, size);
                let found = -1;
                for (let k = cut.length - 1; k > Math.floor(size * 0.5); k--) {
                    const ch = cut[k];
                    if (ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '.' || ch === '!' || ch === '?' || ch === ';') {
                        found = k + 1;
                        break;
                    }
                }
                if (found > 0)
                    cut = cut.slice(0, found);
                chunks.push(cut.trim());
                rest = rest.slice(cut.length);
            }
            if (rest.trim() !== '')
                current = rest.trim();
        }
        else if ((current === '' ? 0 : current.length + 2) + para.length > size) {
            chunks.push(current.trim());
            current = para;
        }
        else {
            current = current === '' ? para : current + '\n\n' + para;
        }
    }
    if (current.trim() !== '')
        chunks.push(current.trim());
    return chunks;
}
export function createLlmRuntime(deps) {
    const { ctx, estimateTokens, llmCallStats, recordCalibration } = deps;
    function selectedModel() {
        const sel = ctx.get('agentDefaultModel');
        if (sel !== undefined && typeof sel.currentSelection === 'function') {
            const s = sel.currentSelection();
            if (isRecord(s) && typeof s.provider === 'string' && typeof s.model === 'string') {
                return { provider: s.provider, model: s.model, reasoningEffort: s.reasoningEffort };
            }
        }
        return null;
    }
    async function pickConfig() {
        const cfg = selectedModel();
        if (cfg !== null)
            return cfg;
        if (!isLlmCatalogService(ctx.llm)) {
            throw new Error('没有可用的模型 Provider，无法执行精读分析');
        }
        const providers = ctx.llm.listProviders();
        if (!Array.isArray(providers)) {
            throw new Error('没有可用的模型 Provider，无法执行精读分析');
        }
        const first = providers.find((provider) => typeof provider === 'string' || (isRecord(provider) && typeof provider.id === 'string'));
        const providerId = typeof first === 'string' ? first : (isRecord(first) && typeof first.id === 'string' ? first.id : null);
        if (providerId === null) {
            throw new Error('没有可用的模型 Provider，无法执行精读分析');
        }
        const models = await ctx.llm.listModels(providerId);
        if (!Array.isArray(models)) {
            throw new Error('Provider "' + providerId + '" 下没有可用模型');
        }
        const firstModel = models.find((model) => typeof model === 'string' || (isRecord(model) && typeof model.id === 'string'));
        const modelId = typeof firstModel === 'string' ? firstModel : (isRecord(firstModel) && typeof firstModel.id === 'string' ? firstModel.id : null);
        if (modelId === null) {
            throw new Error('Provider "' + providerId + '" 下没有可用模型');
        }
        return { provider: providerId, model: modelId };
    }
    async function callModel(cfg, system, userText, maxTokens, signal) {
        const options = {
            provider: cfg.provider,
            model: cfg.model,
            system,
            messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
            temperature: 0.2,
            maxTokens,
        };
        // 不转发 reasoningEffort：结构化 JSON 输出不需要长思考，推理会吃光小输出预算导致空结果
        let text = '';
        let failure = null;
        if (!isLlmStreamService(ctx.llm))
            throw new Error('模型服务不支持流式调用');
        for await (const chunk of ctx.llm.stream(options)) {
            if (signal !== undefined && signal !== null && signal.aborted)
                throw new Error('任务已取消');
            if (!isRecord(chunk))
                continue;
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
                text += chunk.text;
            }
            else if (chunk.type === 'finish') {
                const reason = chunk.reason;
                if (isRecord(reason) && (reason.kind === 'error' || reason.kind === 'aborted')) {
                    const f = reason.failure;
                    failure = isRecord(f) ? str(f.message, str(f.code, '模型调用失败')) : '模型调用失败';
                }
            }
        }
        if (failure !== null)
            throw new Error('模型调用失败：' + failure);
        if (text.trim() === '')
            throw new Error('模型返回了空结果');
        return text;
    }
    // 判定输出是否被 token 预算截断：JSON 解析失败且文本未正常闭合（对象/数组中途断开）。
    function looksTruncated(text) {
        const t = String(text).trim();
        if (t === '')
            return false;
        const last = t[t.length - 1];
        return last !== '}' && last !== ']';
    }
    // 带重试的 JSON 调用：按失败类型分类重试。底层错误（上游失败、空结果）与
    // 截断输出会逐步加大输出预算（×1.5，硬顶 16000），纯格式问题用校正提示
    // 同预算重试；最终失败时保留每个 attempt 的真实原因，不做无信息的吞没。
    async function callModelJson(cfg, system, userText, maxTokens, signal) {
        const MAX_BUDGET = 16000;
        let prompt = userText;
        let budget = maxTokens;
        const history = [];
        const callStarted = Date.now();
        for (let attempt = 0; attempt < 3; attempt++) {
            let text = '';
            let error = null;
            const t0 = Date.now();
            try {
                text = await callModel(cfg, system, prompt, budget, signal);
                // 运行时自校准：实测吞吐与首字延迟（估计），仅对成功调用采样。
                const elapsedMs = Math.max(1, Date.now() - t0);
                const tokens = estimateTokens(text);
                const seconds = elapsedMs / 1000;
                if (text.trim() !== '' && tokens > 0) {
                    const rateTokPerSec = tokens / seconds;
                    // latency ≈ 耗时 - 生成耗时（产出 token ÷ 速率），夹在 50..5000ms
                    const generationMs = rateTokPerSec > 0 ? (tokens / rateTokPerSec) * 1000 : elapsedMs;
                    recordCalibration(rateTokPerSec, elapsedMs - generationMs);
                }
            }
            catch (err) {
                error = errorMessage(err);
            }
            const parsed = error === null ? parseJson(text) : null;
            history.push({ text, error });
            if (parsed !== null) {
                llmCallStats.calls++;
                llmCallStats.ms += Date.now() - callStarted;
                return parsed;
            }
            const truncated = error === null && looksTruncated(text);
            if (error !== null || truncated) {
                budget = Math.min(Math.ceil(budget * 1.5), MAX_BUDGET);
            }
            if (error !== null) {
                prompt = userText + '\n\n[系统校正] 上一次调用失败（' + error + '），已加大输出预算。请重新只输出一个合法的 JSON 对象：不要任何解释或额外文字。';
            }
            else if (truncated) {
                prompt = userText + '\n\n[系统校正] 你上一次的输出在 JSON 中途被截断（输出预算不足）。请大幅压缩篇幅——arguments 最多 6 条、quotes 最多 4 条、concepts 最多 5 条、questions 最多 4 条，每条只写一句话——并输出完整闭合的 JSON 对象，末尾以 } 结束。';
            }
            else {
                prompt = userText + '\n\n[系统校正] 你上一次的输出无法解析为 JSON（可能混入了解释文字、Markdown 围栏、尾随逗号，或字符串内直接换行）。请重新只输出一个合法的 JSON 对象：不要任何解释或额外文字，字符串内不要直接换行（多行文本用 \\n 转义），引号正确转义，末尾不要有逗号。';
            }
        }
        llmCallStats.calls++;
        llmCallStats.ms += Date.now() - callStarted;
        const kinds = history.map((h) => {
            if (h.error !== null)
                return '底层错误（' + h.error + '）';
            if (looksTruncated(h.text))
                return '输出被截断';
            if (String(h.text).trim() === '')
                return '空输出';
            return 'JSON 解析失败';
        });
        const tail = String(history[history.length - 1]?.text ?? '').trim();
        const shown = tail.length > 160 ? tail.slice(-160) : tail;
        throw new Error('模型输出 3 次均未得到合法 JSON：' + kinds.join('；') + (shown === '' ? '' : '。末次输出尾部：' + shown));
    }
    return { callModelJson, pickConfig, selectedModel };
}
