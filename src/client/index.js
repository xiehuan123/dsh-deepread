// DeepRead 精读助手 — client source。由 scripts/build-client.mjs 打包成 C6 工厂包
// （window.__ModuleLoader__.load({ id, factory }) 形态），产物 lib/client.js 勿手改。
// 注册：deepread 工具结果卡片（tool.call.toolview）
// + 输入区左侧 📖 按钮（conversation.input.left）+ 卡片式精读面板（shell.overlay）。
const React = require("react")

    const CSS = [
      '.dr-card { font-size: 13px; line-height: 1.6; }',
      '.dr-head { margin-bottom: 4px; }',
      '.dr-title { font-weight: 600; font-size: 14px; color: var(--dsw-alias-label-primary); }',
      '.dr-badges { margin-top: 4px; }',
      '.dr-badge { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; }',
      '.dr-source { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 4px; word-break: break-all; }',
      '.dr-files { color: var(--dsw-alias-state-success-primary); font-size: 12px; margin-top: 4px; word-break: break-all; }',
      '.dr-summary { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; margin: 8px 0; }',
      '.dr-thesis { border-left: 3px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 0 8px 8px 0; padding: 8px 10px; margin: 8px 0; color: var(--dsw-alias-label-primary); }',
      '.dr-thesis-label { font-size: 11px; color: var(--dsw-alias-brand-primary); font-weight: 600; margin-bottom: 2px; }',
      '.dr-question { border-left: 3px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 0 8px 8px 0; padding: 8px 10px; margin: 8px 0; color: var(--dsw-alias-label-primary); }',
      '.dr-section { border-top: 1px solid var(--dsw-alias-border-l1); margin-top: 6px; }',
      '.dr-section-head { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: none; padding: 6px 0; cursor: pointer; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; text-align: left; }',
      '.dr-section-icon { color: var(--dsw-alias-label-secondary); width: 12px; }',
      '.dr-section-count { color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 400; }',
      '.dr-section-body { padding-bottom: 8px; }',
      '.dr-args, .dr-chapters, .dr-flow, .dr-quotes, .dr-concepts, .dr-questions, .dr-conclusions { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-primary); }',
      '.dr-args li, .dr-quotes li, .dr-concepts li, .dr-questions li, .dr-chapters li, .dr-flow li, .dr-conclusions li { margin: 4px 0; }',
      '.dr-arg-claim { font-weight: 600; }',
      '.dr-arg-quote { color: var(--dsw-alias-label-secondary); border-left: 2px solid var(--dsw-alias-border-l2); padding-left: 8px; margin: 2px 0 6px; }',
      '.dr-chapter-title { font-weight: 600; }',
      '.dr-chapter-summary, .dr-chapter-thesis { color: var(--dsw-alias-label-secondary); }',
      '.dr-quote-text { color: var(--dsw-alias-label-primary); }',
      '.dr-quote-context { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.dr-concept-term { font-weight: 600; color: var(--dsw-alias-brand-primary); }',
      '.dr-concept-expl { color: var(--dsw-alias-label-secondary); }',
      '.dr-note { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 6px; }',
      '.dr-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin-top: 6px; }',
      '.dr-budget { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }',
      '.dr-budget-result { color: var(--dsw-alias-label-primary); font-weight: 600; }',
      '.dr-budget-error { color: var(--dsw-alias-state-error-primary); }',
      '.dr-job-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 4px 8px; margin: 4px 0; word-break: break-all; overflow-wrap: anywhere; }',
      '.dr-map-item { border-left: 2px solid var(--dsw-alias-border-l2); padding-left: 8px; margin: 8px 0; }',
      '.dr-map-claim { font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dr-evidence { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.dr-evidence-missing { color: var(--dsw-alias-state-warn-primary); font-size: 12px; }',
      '.dr-tag { display: inline-block; margin-right: 6px; margin-top: 2px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; }',
      '.dr-conf-author { color: #16a34a; border-color: #16a34a66; background: #16a34a14; }',
      '.dr-conf-fact { color: #2563eb; border-color: #2563eb66; background: #2563eb14; }',
      '.dr-conf-infer { color: #b45309; border-color: #b4530966; background: #b4530914; }',
      '.dr-conf-unknown { color: #dc2626; border-color: #dc262666; background: #dc262614; }',
      '.dr-legend { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }',
      '.dr-legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.dr-relation { color: var(--dsw-alias-brand-primary); font-size: 11px; display: block; }',
      '.dr-data-row { border-left: 2px solid var(--dsw-alias-border-l2); padding-left: 8px; margin: 6px 0; }',
      '.dr-data-value { font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dr-data-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.dr-pre { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; overflow-x: auto; font-size: 12px; white-space: pre; color: var(--dsw-alias-label-primary); }',
      '.dr-toc { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-primary); }',
      '.dr-toc li { margin: 4px 0; }',
      '.dr-feynman-talk { border-left: 3px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 0 8px 8px 0; padding: 8px 10px; margin: 8px 0; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }',
      '.dr-gap { color: var(--dsw-alias-state-warn-primary); }',
      '.dr-fix { color: var(--dsw-alias-state-success-primary); }',
      '.dr-review-row { display: flex; gap: 8px; align-items: baseline; margin: 4px 0; }',
      '.dr-review-day { flex-shrink: 0; font-weight: 600; color: var(--dsw-alias-brand-primary); min-width: 56px; }',
      '.dr-composer-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; min-height: 30px; flex-shrink: 0; background: none; border: 1px solid transparent; border-radius: 8px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 14px; }',
      '.dr-composer-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }',
      '.dr-panel { pointer-events: auto; position: fixed; top: 56px; right: 16px; width: 420px; max-width: calc(100vw - 32px); max-height: 86vh; overflow-y: auto; z-index: 200; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18); padding: 12px; font-size: 13px; color: var(--dsw-alias-label-primary); }',
      '.dr-panel-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }',
      '.dr-close { background: none; border: none; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 14px; padding: 2px 6px; border-radius: 6px; }',
      '.dr-close:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }',
      '.dr-input { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; padding: 7px 9px; }',
      '.dr-input:focus { outline: 1px solid var(--dsw-alias-brand-primary); }',
      '.dr-textarea { resize: vertical; font-family: inherit; line-height: 1.5; }',
      '.dr-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
      '.dr-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.dr-depth, .dr-export { background: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 3px 10px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.dr-depth-on, .dr-export-on { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }',
      '.dr-submit { background: var(--dsw-alias-brand-primary); color: #fff; border: none; border-radius: 8px; padding: 7px 12px; cursor: pointer; font-size: 13px; font-weight: 600; }',
      '.dr-submit:disabled { opacity: 0.6; cursor: default; }',
      '.dr-preflight { background: none; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 7px 12px; cursor: pointer; font-size: 13px; }',
      '.dr-preflight:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }',
      '.dr-preflight:disabled { opacity: 0.6; cursor: default; }',
      '.dr-history { display: flex; flex-direction: column; gap: 4px; }',
      '.dr-history-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 4px 0; }',
      '.dr-history-item { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }',
      '.dr-history-head { display: flex; align-items: flex-start; gap: 6px; width: 100%; background: none; border: none; padding: 6px 8px; cursor: pointer; text-align: left; box-sizing: border-box; }',
      '.dr-history-arrow { color: var(--dsw-alias-label-secondary); width: 12px; flex-shrink: 0; margin-top: 1px; }',
      '.dr-history-main { flex: 1; min-width: 0; }',
      '.dr-history-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); line-height: 1.4; word-break: break-all; }',
      '.dr-history-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }',
      '.dr-history-time { color: var(--dsw-alias-label-secondary); font-size: 11px; }',
      '.dr-history-detail { padding: 2px 8px 8px; }',
      '.dr-history-reread { background: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 2px 10px; cursor: pointer; color: var(--dsw-alias-brand-primary); font-size: 12px; margin-top: 6px; }',
      '.dr-history-reread:hover { border-color: var(--dsw-alias-brand-primary); }',
    ].join('\n')
    function injectCss(css) {
      if (typeof document === 'undefined') return () => {}
      const el = document.createElement('style')
      el.setAttribute('data-plugin', 'dsh-deepread')
      el.textContent = css
      document.head.appendChild(el)
      return () => { if (el.parentNode !== null) el.parentNode.removeChild(el) }
    }

    const DEPTH_LABELS = { quick: '快速要点', deep: '深度精读', book: '全书精读', map: '知识地图', feynman: '费曼读书法' }
    const KIND_LABELS = { url: '网页', pdf: 'PDF', file: '文件', text: '粘贴文本' }
    const TYPE_ORDER = ['核心结论', '分论点', '原因或作用机制', '事实', '数据', '案例', '隐含前提', '反对意见', '限制条件', '可执行建议']
    const CONF_CLASS = { '作者原意': 'dr-conf-author', '原文事实与数据': 'dr-conf-fact', '合理推断': 'dr-conf-infer', '无法确认': 'dr-conf-unknown' }
    const CONF_ORDER = ['作者原意', '原文事实与数据', '合理推断', '无法确认']

    // ---------- 预算估算（镜像 host buildEstimate，纯客户端即时预览） ----------
    const EST_PROMPT_OVERHEAD = 600
    const EST_CHUNK_CHARS = 6000
    const EST_MAX_PARTS = 20
    const EST_MAX_INPUT_CHARS = 400000
    const CALIB_KEY = 'dsh-deepread-calib'

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

    function estimateCall(calls, inputTokens, outputTokens, rate, latency) {
      const totalTokens = inputTokens + outputTokens
      const minutes = Math.round(((totalTokens / rate / 60) + (calls * latency / 60000)) * 10) / 10
      return { calls: calls, inputTokens: inputTokens, outputTokens: outputTokens, totalTokens: totalTokens, minutes: minutes }
    }

    function estimateModes(text, rate, latency) {
      const chars = text.length
      const tokOf = (len) => estimateTokens(text.slice(0, len))
      const effectiveLen = chars > EST_MAX_INPUT_CHARS ? EST_MAX_INPUT_CHARS : chars
      const parts = Math.min(Math.ceil(effectiveLen / EST_CHUNK_CHARS), EST_MAX_PARTS)
      const perInput = tokOf(effectiveLen > EST_CHUNK_CHARS ? EST_CHUNK_CHARS : effectiveLen) + EST_PROMPT_OVERHEAD
      const summaryInput = parts * 400 + EST_PROMPT_OVERHEAD
      const quick = estimateCall(1, tokOf(Math.min(effectiveLen, 30000)) + EST_PROMPT_OVERHEAD, 2500, rate, latency)
      const deep = effectiveLen <= 9000
        ? estimateCall(1, tokOf(effectiveLen) + EST_PROMPT_OVERHEAD, 4000, rate, latency)
        : estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000, rate, latency)
      const bookParts = Math.max(1, parts)
      const book = estimateCall(bookParts + 1, bookParts * perInput + summaryInput, bookParts * 5000 + 5000, rate, latency)
      const map = effectiveLen <= 9000
        ? estimateCall(1, tokOf(effectiveLen) + EST_PROMPT_OVERHEAD, 5000, rate, latency)
        : estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5000 + 5000, rate, latency)
      const feynmanStruct = effectiveLen > 9000 ? 1 : 0
      const structInput = feynmanStruct > 0 ? tokOf(5000) + EST_PROMPT_OVERHEAD : 0
      const feynman = estimateCall(Math.max(1, parts) + feynmanStruct + 1, Math.max(1, parts) * perInput + structInput + summaryInput, Math.max(1, parts) * 5000 + 5000, rate, latency)
      return { quick: quick, deep: deep, book: book, map: map, feynman: feynman }
    }

    function formatTokens(n) {
      if (typeof n !== 'number' || !isFinite(n)) return '≈? token'
      if (n >= 1000) {
        const k = Math.round(n / 100) / 10
        return '≈' + k + 'k token'
      }
      return '≈' + n + ' token'
    }

    function formatMinutes(m) {
      if (typeof m !== 'number' || !isFinite(m)) return '≈?分钟'
      if (m < 1) return '≈<1分钟'
      if (m >= 60) {
        const h = Math.round(m / 6) / 10
        return '≈' + h + '小时'
      }
      return '≈' + m + '分钟'
    }

    function readCalibration() {
      if (typeof localStorage === 'undefined') return { rate: 30, latency: 800 }
      try {
        const raw = localStorage.getItem(CALIB_KEY)
        if (raw === null || raw === '') return { rate: 30, latency: 800 }
        const parsed = JSON.parse(raw)
        const rate = parsed !== null && typeof parsed === 'object' && typeof parsed.rate === 'number' && isFinite(parsed.rate) && parsed.rate > 0 ? parsed.rate : 30
        const latency = parsed !== null && typeof parsed === 'object' && typeof parsed.latency === 'number' && isFinite(parsed.latency) && parsed.latency > 0 ? parsed.latency : 800
        return { rate: rate, latency: latency }
      } catch (err) {
        return { rate: 30, latency: 800 }
      }
    }

    function writeCalibration(rate, latency) {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(CALIB_KEY, JSON.stringify({ rate: rate, latency: latency }))
      } catch (err) {
        // localStorage 不可用或写入失败：静默忽略
      }
    }

    function badge(text) {
      return React.createElement('span', { className: 'dr-badge' }, text)
    }
    function tag(text, cls) {
      return React.createElement('span', { className: 'dr-tag' + (cls !== undefined ? ' ' + cls : '') }, text)
    }

    function Section(props) {
      const [open, setOpen] = React.useState(props.defaultOpen !== false)
      return React.createElement('div', { className: 'dr-section' },
        React.createElement('button', { type: 'button', className: 'dr-section-head', onClick: () => setOpen(!open) },
          React.createElement('span', { className: 'dr-section-icon' }, open ? '▾' : '▸'),
          React.createElement('span', null, props.title),
          props.count !== undefined ? React.createElement('span', { className: 'dr-section-count' }, String(props.count)) : null,
        ),
        open ? React.createElement('div', { className: 'dr-section-body' }, props.children) : null,
      )
    }

    function Header(props) {
      const v = props.value
      const meta = v.meta !== null && typeof v.meta === 'object' ? v.meta : {}
      const isMap = v.kind === 'map'
      const depthLabel = DEPTH_LABELS[meta.depth] !== undefined ? DEPTH_LABELS[meta.depth] : '精读'
      const kindLabel = KIND_LABELS[meta.sourceKind] !== undefined ? KIND_LABELS[meta.sourceKind] : null
      const files = meta.files !== null && typeof meta.files === 'object' ? meta.files : null
      let estBadge = null
      const est = meta.estimate !== null && typeof meta.estimate === 'object' && Array.isArray(meta.estimate.modes) ? meta.estimate : null
      if (est !== null) {
        const row = est.modes.find((mm) => mm !== null && typeof mm === 'object' && mm.mode === meta.depth) || null
        if (row !== null && typeof row.calls === 'number') estBadge = '预算 ≈ ' + row.totalTokens + ' token · ' + row.minutes + ' 分钟'
      }
      return React.createElement('div', { className: 'dr-head' },
        React.createElement('div', { className: 'dr-title' }, (isMap ? '🗺️' : '📖') + ' ' + (typeof v.title === 'string' && v.title !== '' ? v.title : (isMap ? '知识地图' : '精读报告'))),
        React.createElement('div', { className: 'dr-badges' },
          badge(isMap ? '知识地图' : '文章'),
          kindLabel !== null ? badge(kindLabel) : null,
          badge(depthLabel),
          typeof meta.chars === 'number' ? badge('约 ' + meta.chars + ' 字') : null,
          estBadge !== null ? badge(estBadge) : null,
        ),
        typeof meta.source === 'string' && meta.source !== '' ? React.createElement('div', { className: 'dr-source' }, '来源：' + meta.source) : null,
        files !== null ? React.createElement('div', { className: 'dr-files' }, '已导出：' + ['md', 'mm', 'html'].map((k) => (typeof files[k] === 'string' ? files[k] : null)).filter(Boolean).join(' · ')) : null,
      )
    }

    function MapItemRow(o, i) {
      const evidence = typeof o.evidence === 'string' ? o.evidence : ''
      const relations = Array.isArray(o.relations) ? o.relations : []
      const conf = typeof o.confidence === 'string' ? o.confidence : ''
      return React.createElement('div', { className: 'dr-map-item', key: 'mi-' + i },
        React.createElement('div', { className: 'dr-map-claim' }, (i + 1) + '. ' + (typeof o.claim === 'string' ? o.claim : '')),
        evidence !== '' ? React.createElement('div', { className: evidence === '原文未提供证据' ? 'dr-evidence-missing' : 'dr-evidence' }, '证据：' + evidence) : null,
        (typeof o.source === 'string' && o.source !== '') || conf !== '' ? React.createElement('div', null,
          typeof o.source === 'string' && o.source !== '' ? tag('位置：' + o.source) : null,
          conf !== '' ? tag(conf, CONF_CLASS[conf]) : null,
        ) : null,
        relations.map((r, ri) => {
          const ro = r !== null && typeof r === 'object' ? r : { type: String(r) }
          if (typeof ro.to !== 'string' || ro.to === '') return null
          return React.createElement('span', { className: 'dr-relation', key: 'rel-' + ri }, '↳ ' + (typeof ro.type === 'string' ? ro.type : '支持') + ' → ' + ro.to)
        }),
      )
    }

    function FeynmanSections(props) {
      const v = props.value
      const toc = Array.isArray(v.toc) ? v.toc : []
      const questions = Array.isArray(v.questions) ? v.questions : []
      const chapters = Array.isArray(v.feynmanChapters) ? v.feynmanChapters : []
      const reviewPlan = Array.isArray(v.reviewPlan) ? v.reviewPlan : []
      return React.createElement('div', { className: 'dr-sections' },
        React.createElement(Header, { value: v }),
        typeof v.summary === 'string' && v.summary !== '' ? React.createElement('div', { className: 'dr-summary' }, v.summary) : null,
        typeof v.thesis === 'string' && v.thesis !== '' ? React.createElement('div', { className: 'dr-thesis' },
          React.createElement('div', { className: 'dr-thesis-label' }, '核心论点'),
          v.thesis,
        ) : null,
        toc.length > 0 ? React.createElement(Section, { title: '浏览目录', count: toc.length, defaultOpen: true },
          React.createElement('ol', { className: 'dr-toc' }, toc.map((t, i) => React.createElement('li', { key: 'toc-' + i }, String(t)))),
        ) : null,
        questions.length > 0 ? React.createElement(Section, { title: '阅读问题清单', count: questions.length, defaultOpen: true },
          React.createElement('ol', { className: 'dr-questions' }, questions.map((q, i) => React.createElement('li', { key: 'q-' + i }, String(q)))),
        ) : null,
        chapters.map((ch, i) => {
          const o = ch !== null && typeof ch === 'object' ? ch : {}
          const points = Array.isArray(o.points) ? o.points : []
          const gaps = Array.isArray(o.gaps) ? o.gaps : []
          const fixes = Array.isArray(o.corrections) ? o.corrections : []
          return React.createElement(Section, { title: '第 ' + o.index + ' 章 · ' + (typeof o.title === 'string' ? o.title : ''), count: points.length, defaultOpen: o.index <= 2, key: 'fc-' + i },
            points.length > 0 ? React.createElement('div', null, points.map((p, pi) => {
              const po = p !== null && typeof p === 'object' ? p : { claim: String(p) }
              return React.createElement('div', { className: 'dr-map-item', key: 'fp-' + pi },
                React.createElement('div', { className: 'dr-map-claim' }, (pi + 1) + '. ' + (typeof po.claim === 'string' ? po.claim : '')),
                typeof po.data === 'string' && po.data !== '' ? React.createElement('div', { className: 'dr-evidence' }, '数据：' + po.data) : null,
                typeof po.evidence === 'string' && po.evidence !== '' ? React.createElement('div', { className: po.evidence === '原文未提供证据' ? 'dr-evidence-missing' : 'dr-evidence' }, '证据：' + po.evidence) : null,
              )
            })) : null,
            typeof o.chapterMap === 'string' && o.chapterMap !== '' ? React.createElement('pre', { className: 'dr-pre' }, 'mindmap\n' + String(o.chapterMap)) : null,
            typeof o.explanation === 'string' && o.explanation !== '' ? React.createElement('div', { className: 'dr-feynman-talk' }, '💬 合上书讲解\n' + o.explanation) : null,
            gaps.length > 0 ? React.createElement('div', { className: 'dr-gap' }, '⚠️ 知识缺口：' + gaps.map(String).join('；')) : null,
            fixes.length > 0 ? React.createElement('div', { className: 'dr-fix' }, '✅ 原文修正：' + fixes.map(String).join('；')) : null,
          )
        }),
        typeof v.bookMap === 'string' && v.bookMap !== '' ? React.createElement(Section, { title: '合并全书导图' },
          React.createElement('pre', { className: 'dr-pre' }, 'mindmap\n' + String(v.bookMap)),
        ) : null,
        typeof v.finalExplanation === 'string' && v.finalExplanation !== '' ? React.createElement(Section, { title: '再讲一次（全书终讲）', defaultOpen: true },
          React.createElement('div', { className: 'dr-feynman-talk' }, v.finalExplanation),
        ) : null,
        reviewPlan.length > 0 ? React.createElement(Section, { title: '间隔复习计划', count: reviewPlan.length, defaultOpen: true },
          React.createElement('div', null, reviewPlan.map((r, i) => {
            const ro = r !== null && typeof r === 'object' ? r : { interval: String(r) }
            return React.createElement('div', { className: 'dr-review-row', key: 'rp-' + i },
              React.createElement('span', { className: 'dr-review-day' }, typeof ro.interval === 'string' ? ro.interval : ''),
              React.createElement('span', null, (typeof ro.focus === 'string' ? ro.focus : '') + (typeof ro.method === 'string' && ro.method !== '' ? ' —— ' + ro.method : '')),
            )
          })),
        ) : null,
      )
    }

    function Sections(props) {
      const v = props.value !== null && typeof props.value === 'object' ? props.value : {}
      if (v.kind === 'feynman') return React.createElement(FeynmanSections, { value: v })
      if (v.kind === 'map') {
        const items = Array.isArray(v.items) ? v.items : []
        const dataPoints = Array.isArray(v.dataPoints) ? v.dataPoints : []
        const caveats = Array.isArray(v.caveats) ? v.caveats : []
        const coreConclusions = Array.isArray(v.coreConclusions) ? v.coreConclusions : []
        const recallQuestions = Array.isArray(v.recallQuestions) ? v.recallQuestions : []
        const groups = {}
        for (const it of items) {
          const o = it !== null && typeof it === 'object' ? it : { claim: String(it) }
          const t = typeof o.type === 'string' && o.type !== '' ? o.type : '分论点'
          if (groups[t] === undefined) groups[t] = []
          groups[t].push(o)
        }
        return React.createElement('div', { className: 'dr-sections' },
          React.createElement(Header, { value: v }),
          typeof v.summary === 'string' && v.summary !== '' ? React.createElement('div', { className: 'dr-summary' }, v.summary) : null,
          typeof v.coreQuestion === 'string' && v.coreQuestion !== '' ? React.createElement('div', { className: 'dr-question' },
            React.createElement('div', { className: 'dr-thesis-label' }, '核心问题（作者试图回答）'),
            v.coreQuestion,
          ) : null,
          coreConclusions.length > 0 ? React.createElement(Section, { title: '核心结论', count: coreConclusions.length, defaultOpen: true },
            React.createElement('ol', { className: 'dr-conclusions' }, coreConclusions.map((c, i) => React.createElement('li', { key: 'cc-' + i }, String(c)))),
          ) : null,
          React.createElement('div', { className: 'dr-legend' },
            React.createElement('span', { className: 'dr-legend-item' }, '置信度：'),
            CONF_ORDER.map((c) => React.createElement('span', { className: 'dr-legend-item', key: 'lg-' + c }, tag(c, CONF_CLASS[c]))),
          ),
          TYPE_ORDER.map((t) => {
            const group = groups[t]
            if (group === undefined || group.length === 0) return null
            return React.createElement(Section, { title: t, count: group.length, defaultOpen: t === '核心结论' || t === '分论点', key: 'g-' + t },
              React.createElement('div', null, group.map(MapItemRow)),
            )
          }),
          dataPoints.length > 0 ? React.createElement(Section, { title: '关键数据表', count: dataPoints.length, defaultOpen: true },
            React.createElement('div', null, dataPoints.map((d, i) => {
              const o = d !== null && typeof d === 'object' ? d : { value: String(d) }
              return React.createElement('div', { className: 'dr-data-row', key: 'dp-' + i },
                React.createElement('div', { className: 'dr-data-value' }, typeof o.value === 'string' ? o.value : ''),
                typeof o.period === 'string' && o.period !== '' ? React.createElement('div', { className: 'dr-data-meta' }, '时间：' + o.period) : null,
                typeof o.subject === 'string' && o.subject !== '' ? React.createElement('div', { className: 'dr-data-meta' }, '对象：' + o.subject) : null,
                typeof o.baseline === 'string' && o.baseline !== '' ? React.createElement('div', { className: 'dr-data-meta' }, '基准：' + o.baseline) : null,
                typeof o.source === 'string' && o.source !== '' ? React.createElement('div', { className: 'dr-data-meta' }, '来源：' + o.source) : null,
                typeof o.location === 'string' && o.location !== '' ? React.createElement('div', { className: 'dr-data-meta' }, '位置：' + o.location) : null,
              )
            })),
          ) : null,
          caveats.length > 0 ? React.createElement(Section, { title: '反对意见与局限', count: caveats.length },
            React.createElement('ul', { className: 'dr-questions' }, caveats.map((c, i) => React.createElement('li', { key: 'cv-' + i }, String(c)))),
          ) : null,
          typeof v.mermaid === 'string' && v.mermaid !== '' ? React.createElement(Section, { title: 'Mermaid 思维导图' },
            React.createElement('pre', { className: 'dr-pre' }, 'mindmap\n' + String(v.mermaid)),
          ) : null,
          recallQuestions.length > 0 ? React.createElement(Section, { title: '主动回忆问题', count: recallQuestions.length, defaultOpen: true },
            React.createElement('ol', { className: 'dr-questions' }, recallQuestions.map((q, i) => React.createElement('li', { key: 'rq-' + i }, String(q)))),
          ) : null,
          typeof v.meta === 'object' && v.meta !== null && v.meta.note ? React.createElement('div', { className: 'dr-note' }, String(v.meta.note)) : null,
        )
      }
      const args = Array.isArray(v.arguments) ? v.arguments : []
      const quotes = Array.isArray(v.quotes) ? v.quotes : []
      const concepts = Array.isArray(v.concepts) ? v.concepts : []
      const questions = Array.isArray(v.questions) ? v.questions : []
      const structure = Array.isArray(v.structure) ? v.structure : []
      const chapters = Array.isArray(v.chapters) ? v.chapters : []
      const meta = v.meta !== null && typeof v.meta === 'object' ? v.meta : {}
      const isBook = v.kind === 'book'
      return React.createElement('div', { className: 'dr-sections' },
        React.createElement(Header, { value: v }),
        typeof v.summary === 'string' && v.summary !== '' ? React.createElement('div', { className: 'dr-summary' }, v.summary) : null,
        typeof v.thesis === 'string' && v.thesis !== '' ? React.createElement('div', { className: 'dr-thesis' },
          React.createElement('div', { className: 'dr-thesis-label' }, '核心论点'),
          v.thesis,
        ) : null,
        args.length > 0 ? React.createElement(Section, { title: '论证结构', count: args.length, defaultOpen: true },
          React.createElement('ol', { className: 'dr-args' }, args.map((a, i) => {
            const o = a !== null && typeof a === 'object' ? a : { claim: String(a) }
            return React.createElement('li', { key: 'arg-' + i },
              React.createElement('div', { className: 'dr-arg-claim' }, typeof o.claim === 'string' ? o.claim : ''),
              typeof o.evidence === 'string' && o.evidence !== '' ? React.createElement('div', null, '论据：' + o.evidence) : null,
              typeof o.quote === 'string' && o.quote !== '' ? React.createElement('div', { className: 'dr-arg-quote' }, '“' + o.quote + '”') : null,
            )
          })),
        ) : null,
        structure.length > 0 ? React.createElement(Section, { title: '论证脉络', count: structure.length },
          React.createElement('ol', { className: 'dr-flow' }, structure.map((s, i) => React.createElement('li', { key: 'st-' + i }, String(s)))),
        ) : null,
        chapters.length > 0 ? React.createElement(Section, { title: isBook ? '章节脉络' : '各部分要点', count: chapters.length },
          React.createElement('ol', { className: 'dr-chapters' }, chapters.map((c, i) => {
            const o = c !== null && typeof c === 'object' ? c : {}
            return React.createElement('li', { key: 'ch-' + i },
              React.createElement('div', { className: 'dr-chapter-title' }, typeof o.title === 'string' ? o.title : '第 ' + (i + 1) + ' 部分'),
              typeof o.summary === 'string' && o.summary !== '' ? React.createElement('div', { className: 'dr-chapter-summary' }, o.summary) : null,
            )
          })),
        ) : null,
        quotes.length > 0 ? React.createElement(Section, { title: '金句摘录', count: quotes.length },
          React.createElement('ul', { className: 'dr-quotes' }, quotes.map((q, i) => {
            const o = q !== null && typeof q === 'object' ? q : { text: String(q) }
            return React.createElement('li', { key: 'q-' + i }, '“' + (typeof o.text === 'string' ? o.text : '') + '”')
          })),
        ) : null,
        concepts.length > 0 ? React.createElement(Section, { title: '核心概念', count: concepts.length },
          React.createElement('ul', { className: 'dr-concepts' }, concepts.map((c, i) => {
            const o = c !== null && typeof c === 'object' ? c : { term: String(c) }
            return React.createElement('li', { key: 'c-' + i },
              React.createElement('span', { className: 'dr-concept-term' }, typeof o.term === 'string' ? o.term : ''),
              typeof o.explanation === 'string' && o.explanation !== '' ? React.createElement('span', { className: 'dr-concept-expl' }, ' — ' + o.explanation) : null,
            )
          })),
        ) : null,
        questions.length > 0 ? React.createElement(Section, { title: '批判性思考', count: questions.length },
          React.createElement('ul', { className: 'dr-questions' }, questions.map((q, i) => React.createElement('li', { key: 'qn-' + i }, String(q)))),
        ) : null,
        meta.note ? React.createElement('div', { className: 'dr-note' }, String(meta.note)) : null,
      )
    }

    // ——— 「📚 最近读过」历史（纯客户端 localStorage，无 host RPC） ———
    const HISTORY_KEY = 'dsh-deepread-history-v1'
    const HISTORY_MAX = 20
    const HISTORY_KINDS = ['article', 'book', 'map', 'feynman', 'batch']

    function historyKindAllowed(kind) {
      return HISTORY_KINDS.indexOf(kind) !== -1
    }
    function readHistory() {
      if (typeof localStorage === 'undefined') return []
      try {
        const raw = localStorage.getItem(HISTORY_KEY)
        if (raw === null || raw === '') return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch (err) {
        return []
      }
    }
    function writeHistory(record) {
      if (typeof localStorage === 'undefined') return
      try {
        const list = readHistory()
        const idx = list.findIndex((it) => it !== null && typeof it === 'object' && it.id === record.id)
        if (idx !== -1) list.splice(idx, 1)
        list.unshift(record)
        if (list.length > HISTORY_MAX) list.length = HISTORY_MAX
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
      } catch (err) {
        // localStorage 不可用或写入失败：静默忽略
      }
    }
    function relativeTime(time) {
      if (typeof time !== 'number' || !isFinite(time)) return ''
      const diff = Date.now() - time
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour
      if (diff < minute) return '刚刚'
      if (diff < hour) return Math.floor(diff / minute) + ' 分钟前'
      if (diff < day) return Math.floor(diff / hour) + ' 小时前'
      if (diff < 2 * day) return '昨天'
      if (diff < 7 * day) return Math.floor(diff / day) + ' 天前'
      const d = new Date(time)
      const mm = String(d.getMonth() + 1)
      const dd = String(d.getDate())
      return d.getFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd)
    }
    function HistoryItem(props) {
      const item = props.item !== null && typeof props.item === 'object' ? props.item : {}
      const [open, setOpen] = React.useState(false)
      const title = typeof item.title === 'string' ? item.title : ''
      const displayTitle = title.length > 40 ? title.slice(0, 40) + '…' : title
      const depthLabel = DEPTH_LABELS[item.depth] !== undefined ? DEPTH_LABELS[item.depth] : '精读'
      const timeText = relativeTime(item.time)
      const summary = typeof item.summary === 'string' ? item.summary : ''
      const thesis = typeof item.thesis === 'string' ? item.thesis : ''
      const onReread = props.onReread
      return React.createElement('div', { className: 'dr-history-item' },
        React.createElement('button', { type: 'button', className: 'dr-history-head', title: title, onClick: () => setOpen(!open) },
          React.createElement('span', { className: 'dr-history-arrow' }, open ? '▾' : '▸'),
          React.createElement('div', { className: 'dr-history-main' },
            React.createElement('div', { className: 'dr-history-title' }, displayTitle),
            React.createElement('div', { className: 'dr-history-meta' },
              badge(depthLabel),
              timeText !== '' ? React.createElement('span', { className: 'dr-history-time' }, timeText) : null,
            ),
          ),
        ),
        open ? React.createElement('div', { className: 'dr-history-detail' },
          summary !== '' ? React.createElement('div', { className: 'dr-summary' }, summary) : null,
          thesis !== '' ? React.createElement('div', { className: 'dr-thesis' },
            React.createElement('div', { className: 'dr-thesis-label' }, '核心论点'),
            thesis,
          ) : null,
          typeof onReread === 'function' ? React.createElement('button', { type: 'button', className: 'dr-history-reread', onClick: () => onReread(item) }, '↺ 重新精读') : null,
        ) : null,
      )
    }

    function BackgroundCard(props) {
      const v = props.value !== null && typeof props.value === 'object' ? props.value : {}
      const meta = v.meta !== null && typeof v.meta === 'object' ? v.meta : {}
      const depthLabel = meta.depth === 'batch' ? '批量精读' : (DEPTH_LABELS[meta.depth] !== undefined ? DEPTH_LABELS[meta.depth] : null)
      const kindLabel = KIND_LABELS[meta.sourceKind] !== undefined ? KIND_LABELS[meta.sourceKind] : null
      return React.createElement('div', { className: 'dr-card' },
        React.createElement('div', { className: 'dr-title' }, '⏳ 后台精读已启动'),
        React.createElement('div', { className: 'dr-badges' },
          kindLabel !== null ? badge(kindLabel) : null,
          depthLabel !== null ? badge(depthLabel) : null,
        ),
        typeof v.jobId === 'string' && v.jobId !== '' ? React.createElement('div', { className: 'dr-job-id' }, v.jobId) : null,
        typeof v.label === 'string' && v.label !== '' ? React.createElement('div', { className: 'dr-source' }, v.label) : null,
        React.createElement('div', { className: 'dr-note' }, '用 job_output 读取进度与最终报告；job_kill 可取消'),
      )
    }

    function DeepReadCard(props) {
      const block = props.block
      const value = block !== null && typeof block === 'object' && block.meta !== null && typeof block.meta === 'object' ? block.meta : null
      React.useEffect(() => {
        if (value === null) return
        if (value.kind === 'estimate') return
        if (value.kind === 'background') return
        const meta = value.meta !== null && typeof value.meta === 'object' ? value.meta : {}
        const est = meta.estimate !== null && typeof meta.estimate === 'object' ? meta.estimate : null
        if (est !== null) {
          const rate = typeof est.estTokensPerSecond === 'number' ? est.estTokensPerSecond : null
          const latency = typeof est.estLatencyPerCallMs === 'number' ? est.estLatencyPerCallMs : null
          if ((rate !== null && latency !== null) || est.calibrated === true) {
            writeCalibration(rate !== null ? rate : 100, latency !== null ? latency : 800)
          }
        }
        if (!historyKindAllowed(value.kind)) return
        const title = typeof value.title === 'string' ? value.title : ''
        if (title === '') return
        const source = typeof meta.source === 'string' ? meta.source : ''
        writeHistory({
          id: String(source) + '|' + value.kind + '|' + title,
          title: title,
          kind: value.kind,
          depth: typeof meta.depth === 'string' ? meta.depth : '',
          source: source,
          chars: typeof meta.chars === 'number' ? meta.chars : 0,
          time: Date.now(),
          summary: typeof value.summary === 'string' ? value.summary : '',
          thesis: typeof value.thesis === 'string' ? value.thesis : '',
        })
      }, [value])
      const settled = block !== null && typeof block === 'object' && (Array.isArray(block.content) || block.meta !== undefined)
      if (!settled) {
        return React.createElement('div', { className: 'dr-card' },
          React.createElement('div', { className: 'dr-note' }, '📖 正在精读分析…（长文会自动分部分处理，请稍候）'),
        )
      }
      if (block.isError === true) {
        const message = block.error !== null && typeof block.error === 'object' ? (block.error.name || '精读失败') : '精读失败'
        return React.createElement('div', { className: 'dr-card' }, React.createElement('div', { className: 'dr-error' }, message))
      }
      const meta = block.meta !== null && typeof block.meta === 'object' ? block.meta : null
      if (meta === null) {
        return React.createElement('div', { className: 'dr-card' }, React.createElement('div', { className: 'dr-note' }, '精读已完成，请查看上方对话中的分析。'))
      }
      if (meta.kind === 'background') {
        return React.createElement(BackgroundCard, { value: meta })
      }
      return React.createElement('div', { className: 'dr-card' }, React.createElement(Sections, { value: meta }))
    }

    const store = {
      open: false,
      listeners: [],
      get() { return this.open },
      setOpen(value) {
        this.open = value === true
        for (const listener of this.listeners.slice()) listener()
      },
      subscribe(listener) {
        this.listeners.push(listener)
        return () => { this.listeners = this.listeners.filter((l) => l !== listener) }
      },
    }

    function usePanelOpen() {
      const [open, setOpen] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setOpen(store.get())), [])
      return [open, (value) => store.setOpen(value)]
    }

    function ComposerButton() {
      return React.createElement('button', { type: 'button', className: 'dr-composer-btn', title: '精读助手：提取核心观点', onClick: () => store.setOpen(true) }, '📖')
    }

    function Panel(props) {
      const [open, setOpen] = usePanelOpen()
      const [url, setUrl] = React.useState('')
      const [text, setText] = React.useState('')
      const [path, setPath] = React.useState('')
      const [focus, setFocus] = React.useState('')
      const [depth, setDepth] = React.useState('deep')
      const [exportFmt, setExportFmt] = React.useState('none')
      const [error, setError] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [history, setHistory] = React.useState([])
      // 预算预检结果：{ status: 'idle'|'loading'|'done'|'error', line, data }；面板内直接展示，不跳对话。
      const [budget, setBudget] = React.useState(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        if (open) setHistory(readHistory().slice(0, 8))
      }, [open])

      if (!open) return null

      // 官方 inject 通道：纯回调进组件，组件不碰 ctx（AGENTS.md ctx discipline）
      const submitDeepread = props.submitDeepread

      // 把三种输入归一为指令里的目标描述；返回 { target } 或 { error }。
      const buildTarget = () => {
        const link = url.trim()
        const pasted = text.trim()
        const filePath = path.trim()
        if (link === '' && pasted === '' && filePath === '') {
          return { error: '请填写链接、粘贴文本，或提供文件路径（三者其一）' }
        }
        if (typeof submitDeepread !== 'function') {
          return { error: '精读提交通道不可用，请直接对对话说：请用 deepread 精读 <内容>' }
        }
        if (pasted !== '') return { target: '正文如下：\n' + pasted }
        if (/^https?:\/\//i.test(link) || link.startsWith('mp.weixin.qq.com') || link.includes('weixin.qq.com')) return { target: '链接：' + link }
        if (filePath !== '') return { target: '文件路径：' + filePath }
        if (link !== '') return { target: '文件路径：' + link }
        return { error: '无法识别输入内容' }
      }

      const submit = () => {
        const built = buildTarget()
        if (built.error !== undefined) { setError(built.error); return }
        const target = built.target
        const depthLabel = DEPTH_LABELS[depth] || depth
        const exportLabel = { none: '不导出，仅会话展示', md: 'MD', mm: '思维导图', html: '网页', all: '全部' }[exportFmt] || exportFmt
        let instruction = '请使用 deepread 工具精读以下内容（模式：' + depthLabel + '；导出：' + exportLabel
        if (focus.trim() !== '') instruction += '；关注重点：' + focus.trim()
        instruction += '）。\n' + target
        const failure = submitDeepread(instruction)
        if (failure !== null) { setError(failure); return }
        setOpen(false)
      }

      // 预算预检：POST 同源 API（/api/deepread/budget）由 Host 直接抓取/读取来源并估算，
      // 面板内显示一行结论（不跳对话、不渲染表格）。粘贴文本仍走本地实时估算。
      const preflightBudget = async () => {
        const built = buildTarget()
        if (built.error !== undefined) { setError(built.error); return }
        setBudget({ status: 'loading', line: '预算计算中…', data: null })
        setError(null)
        setNote(null)
        try {
          const res = await fetch('/api/deepread/budget', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: url.trim(), path: path.trim(), text: text.trim() }),
          })
          let data = null
          try {
            data = await res.json()
          } catch (err) {
            data = null
          }
          if (!res.ok || data === null || typeof data !== 'object') {
            setBudget({ status: 'error', line: '预算预检失败：HTTP ' + res.status, data: null })
            return
          }
          if (data.ok !== true) {
            setBudget({ status: 'error', line: typeof data.error === 'string' && data.error !== '' ? data.error : '预算预检失败', data: null })
            return
          }
          setBudget({ status: 'done', line: '', data })
        } catch (err) {
          setBudget({ status: 'error', line: '预算预检失败：' + (err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err)), data: null })
        }
      }

      const depthOption = (value) => {
        const full = DEPTH_LABELS[value] !== undefined ? DEPTH_LABELS[value] : value
        const est = budgetModes !== null && budgetModes[value] !== undefined ? budgetModes[value] : null
        const label = est !== null ? full + ' (' + formatTokens(est.totalTokens) + ' · ' + formatMinutes(est.minutes) + ')' : full
        return React.createElement('button', {
          type: 'button',
          className: 'dr-depth' + (depth === value ? ' dr-depth-on' : ''),
          key: value,
          onClick: () => setDepth(value),
        }, label)
      }

      const exportOption = (value, label) => React.createElement('button', {
        type: 'button',
        className: 'dr-export' + (exportFmt === value ? ' dr-export-on' : ''),
        key: value,
        onClick: () => setExportFmt(value),
      }, label)

      const reread = (item) => {
        if (item !== null && typeof item === 'object' && typeof item.source === 'string' && item.source !== '') {
          setText(item.source)
        }
        if (panelRef.current !== null && panelRef.current !== undefined) panelRef.current.scrollTop = 0
      }

      // 预算汇总：文本输入非空时实时计算；仅链接/路径时提示开始后计算；全空时提示输入内容。
      // 点击「预算预检」后（budget done）按当前深度动态取 Host 返回的对应模式行。
      const calib = readCalibration()
      const hasText = text.trim() !== ''
      const hasTarget = url.trim() !== '' || path.trim() !== ''
      const budgetModes = hasText ? estimateModes(text, calib.rate, calib.latency) : null
      let budgetLine = '预算：输入内容后自动计算'
      if (budgetModes !== null && budgetModes[depth] !== undefined) {
        budgetLine = '预算：' + formatTokens(budgetModes[depth].totalTokens) + ' · ' + formatMinutes(budgetModes[depth].minutes)
      } else if (hasTarget) {
        budgetLine = '预算：链接/文件点「预算预检」立即查看'
      }
      const budgetState = budget !== null ? budget.status : 'idle'
      let displayLine = budgetLine
      let budgetCls = 'dr-budget'
      if (budgetState === 'loading') {
        displayLine = budget.line
      } else if (budgetState === 'error') {
        displayLine = budget.line
        budgetCls += ' dr-budget-error'
      } else if (budgetState === 'done' && budget !== null && budget.data !== null && typeof budget.data === 'object') {
        const d = budget.data
        const modes = Array.isArray(d.modes) ? d.modes : []
        const row = modes.find((m) => m !== null && typeof m === 'object' && m.mode === depth) || null
        const chars = typeof d.chars === 'number' ? d.chars : 0
        if (row !== null && typeof row.totalTokens === 'number') {
          displayLine = '预算：约 ' + chars + ' 字 · ' + formatTokens(row.totalTokens) + ' · ' + formatMinutes(row.minutes)
        } else {
          displayLine = '预算：约 ' + chars + ' 字（结果解析失败）'
        }
        budgetCls += ' dr-budget-result'
      }

      return React.createElement('div', { className: 'dr-panel', ref: panelRef },
        React.createElement('div', { className: 'dr-panel-head' },
          React.createElement('span', null, '📖 精读助手'),
          React.createElement('button', { type: 'button', className: 'dr-close', title: '关闭', onClick: () => setOpen(false) }, '✕'),
        ),
        React.createElement('input', {
          className: 'dr-input',
          placeholder: '微信公众号文章链接（mp.weixin.qq.com，需稳定链接）',
          value: url,
          onChange: (event) => setUrl(event.target.value),
        }),
        React.createElement('textarea', {
          className: 'dr-input dr-textarea',
          placeholder: '或粘贴要精读的文章 / 章节内容…',
          rows: 6,
          value: text,
          onChange: (event) => setText(event.target.value),
        }),
        React.createElement('input', {
          className: 'dr-input',
          placeholder: '或填写文件路径（.txt / .md / .pdf），如 notes/第一章.md',
          value: path,
          onChange: (event) => setPath(event.target.value),
        }),
        React.createElement(Section, { title: '📚 最近读过', count: history.length, defaultOpen: true },
          history.length === 0 ? React.createElement('div', { className: 'dr-history-empty' }, '还没有精读记录，完成一次精读后会自动出现在这里。') : null,
          React.createElement('div', { className: 'dr-history' },
            history.map((item, i) => React.createElement(HistoryItem, { item: item, onReread: reread, key: 'h-' + i })),
          ),
        ),
        React.createElement('div', { className: budgetCls }, displayLine),
        React.createElement('div', { className: 'dr-row' },
          React.createElement('span', { className: 'dr-label' }, '深度'),
          depthOption('quick'),
          depthOption('deep'),
          depthOption('map'),
          depthOption('feynman'),
          depthOption('book'),
        ),
        React.createElement('div', { className: 'dr-row' },
          React.createElement('span', { className: 'dr-label' }, '导出'),
          exportOption('none', '仅会话'),
          exportOption('md', 'MD'),
          exportOption('mm', '导图'),
          exportOption('html', '网页'),
          exportOption('all', '全部'),
        ),
        React.createElement('input', {
          className: 'dr-input',
          placeholder: '关注重点（可选），如：论证逻辑 / 研究方法',
          value: focus,
          onChange: (event) => setFocus(event.target.value),
        }),
        React.createElement('div', { className: 'dr-row' },
          React.createElement('button', { type: 'button', className: 'dr-submit', onClick: submit }, '开始精读'),
          React.createElement('button', { type: 'button', className: 'dr-preflight', onClick: preflightBudget, disabled: budgetState === 'loading' }, '🔍 预算预检'),
        ),
        error !== null ? React.createElement('div', { className: 'dr-error' }, String(error)) : null,
        note !== null ? React.createElement('div', { className: 'dr-note' }, String(note)) : null,
      )
    }

    exports.apply = function (ctx) {
      const disposeCss = injectCss(CSS)
      const slots = ctx.get('slots')
      if (slots === undefined) return disposeCss

      // 官方 inject 通道：ctx 全部留在 apply 闭包里，组件只收普通回调（AGENTS.md ctx discipline）。
      // 事件处理器允许读实时快照（AGENTS.md reactive-read 规则）。
      const submitDeepread = (instruction) => {
        try {
          const sessions = ctx.get('sessions')
          const list = sessions !== null && sessions !== undefined ? sessions.list : undefined
          if (list === null || list === undefined || typeof list.getSnapshot !== 'function') {
            return '精读提交通道不可用，请直接对对话说：请用 deepread 精读 <内容>'
          }
          const snapshot = list.getSnapshot()
          const currentId = snapshot !== null && snapshot !== undefined ? snapshot.current : undefined
          if (currentId === undefined) return '当前没有打开的会话，请先在对话中打开一个会话'
          const conversation = ctx.get('conversation')
          const input = conversation !== null && conversation !== undefined ? conversation.input : undefined
          if (input === undefined || typeof input.shell !== 'function') {
            return '精读提交通道不可用，请直接对对话说：请用 deepread 精读 <内容>'
          }
          const shell = input.shell(currentId)
          shell.setDraft(instruction)
          shell.submit('queue')
          return null
        } catch (err) {
          return err !== null && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err)
        }
      }

      slots.inject('tool.call.toolview', () => slots.register(
        { name: 'tool.call.toolview', key: 'deepread' },
        (props) => React.createElement(DeepReadCard, props),
      ))
      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'deepread-composer', order: 30, label: '精读' },
        () => React.createElement(ComposerButton),
      ))
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'deepread-panel', order: 10, label: '精读助手面板', inject: () => ({ submitDeepread }) },
        (props) => React.createElement(Panel, props),
      ))
      return disposeCss
    }

    exports.inject = ['slots', 'sessions', 'conversation']
