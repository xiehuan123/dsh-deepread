const EST_PROMPT_OVERHEAD = 600;
export function createBudgetRuntime(tune, rates) {
    function estimateTokens(text) {
        let cjk = 0;
        let latin = 0;
        let other = 0;
        for (let index = 0; index < text.length; index++) {
            const code = text.charCodeAt(index);
            if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef))
                cjk += 1;
            else if (code >= 32 && code < 127)
                latin += 1;
            else
                other += 1;
        }
        return Math.ceil(cjk * 0.6 + latin * 0.25 + other * 0.5);
    }
    function estimateCall(calls, inputTokens, outputTokens) {
        const rate = rates.effectiveRate();
        const latency = rates.effectiveLatency();
        const minutes = (inputTokens + outputTokens) / rate / 60 + (calls * latency) / 60000;
        return {
            calls,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            minutes: Math.round(minutes * 10) / 10,
            minutesFormula: '（(' + inputTokens + '+' + outputTokens + ') ÷ ' + Math.round(rate * 10) / 10 + ' tok/s + ' + calls + ' 次 × ' + Math.round(latency) + 'ms）',
            estTokensPerSecond: Math.round(rate * 10) / 10,
            estLatencyPerCallMs: Math.round(latency),
            calibrated: rates.calibratedRate() !== null,
        };
    }
    function buildEstimate(text, depth, ext = {}) {
        const extrapolated = typeof ext.chars === 'number' ? ext : null;
        const chars = extrapolated === null ? text.length : Math.max(1, Math.round(extrapolated.chars ?? text.length));
        const tokenRatio = extrapolated !== null && typeof extrapolated.tokensPerChar === 'number' && extrapolated.tokensPerChar > 0 ? extrapolated.tokensPerChar : null;
        const tokOf = (length) => tokenRatio === null ? estimateTokens(text.slice(0, length)) : Math.ceil(length * tokenRatio);
        const effectiveLength = Math.min(chars, tune.maxInputChars);
        const parts = Math.min(Math.ceil(effectiveLength / tune.chunkChars), tune.maxParts);
        const perInput = tokOf(Math.min(effectiveLength, tune.chunkChars)) + EST_PROMPT_OVERHEAD;
        const summaryInput = parts * 400 + EST_PROMPT_OVERHEAD;
        const modes = [];
        modes.push({ mode: 'quick', note: '单次调用，输入截断至 30000 字', ...estimateCall(1, tokOf(Math.min(effectiveLength, 30000)) + EST_PROMPT_OVERHEAD, 2500) });
        modes.push(effectiveLength <= 9000
            ? { mode: 'deep', note: '短文单次调用', ...estimateCall(1, tokOf(effectiveLength) + EST_PROMPT_OVERHEAD, 4000) }
            : { mode: 'deep', note: '分 ' + parts + ' 段逐段精读 + 1 次综合', ...estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000) });
        const bookParts = Math.max(1, parts);
        modes.push({ mode: 'book', note: '全书分 ' + bookParts + ' 部分精读并汇总', ...estimateCall(bookParts + 1, bookParts * perInput + summaryInput, bookParts * 5000 + 5000) });
        modes.push(effectiveLength <= 9000
            ? { mode: 'map', note: '短文单次知识地图', ...estimateCall(1, tokOf(effectiveLength) + EST_PROMPT_OVERHEAD, 5000) }
            : { mode: 'map', note: '分 ' + parts + ' 段提取 + 1 次汇总', ...estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000) });
        const structureCalls = effectiveLength > 9000 ? 1 : 0;
        const structureInput = structureCalls > 0 ? tokOf(5000) + EST_PROMPT_OVERHEAD : 0;
        modes.push({ mode: 'feynman', note: (structureCalls > 0 ? '目录提问 1 次 + ' : '') + '分 ' + Math.max(1, parts) + ' 章 + 合并导图与复习计划 1 次', ...estimateCall(Math.max(1, parts) + structureCalls + 1, Math.max(1, parts) * perInput + structureInput + summaryInput, Math.max(1, parts) * 5000 + 5000) });
        const result = {
            chars,
            modes,
            estTokensPerSecond: Math.round(rates.effectiveRate() * 10) / 10,
            estLatencyPerCallMs: Math.round(rates.effectiveLatency()),
            calibrated: rates.calibratedRate() !== null,
        };
        if (extrapolated !== null) {
            result.sampled = true;
            result.note = '按采样外推';
        }
        return result;
    }
    return { buildEstimate, estimateCall, estimateTokens };
}
