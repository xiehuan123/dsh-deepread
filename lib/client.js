/* DeepRead 精读助手 — client bundle（官方 dsh.client 通道）
 * 注册：deepread 工具结果卡片（tool.call.toolview）+ 输入区精读条（conversation.input.dock）。
 */
window.__ModuleLoader__.load({
  id: "dsh-deepread",
  factory: (require) => {
    var exports = { exports: {} }.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

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
      '.dr-dock { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 8px 10px; font-size: 13px; color: var(--dsw-alias-label-primary); }',
      '.dr-dock-title { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; white-space: nowrap; }',
      '.dr-dock-input { flex: 1; min-width: 180px; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; padding: 5px 8px; }',
      '.dr-dock-input:focus { outline: 1px solid var(--dsw-alias-brand-primary); }',
      '.dr-dock-textarea { width: 100%; min-height: 72px; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; padding: 6px 8px; font-family: inherit; resize: vertical; }',
      '.dr-select { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; padding: 5px 6px; }',
      '.dr-dock-btn { display: inline-flex; align-items: center; gap: 4px; background: var(--dsw-alias-brand-primary); color: #fff; border: none; border-radius: 8px; padding: 5px 12px; cursor: pointer; font-size: 13px; font-weight: 600; white-space: nowrap; }',
      '.dr-dock-btn:hover { opacity: 0.92; }',
      '.dr-dock-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
    ].join('\n')

    function injectCss(ctx, css) {
      const styles = ctx.get('styles')
      if (styles !== undefined && typeof styles.insert === 'function') return styles.insert(css)
      if (typeof document !== 'undefined') {
        const el = document.createElement('style')
        el.textContent = css
        document.head.appendChild(el)
        return () => { if (el.parentNode !== null) el.parentNode.removeChild(el) }
      }
      return () => {}
    }

    const DEPTH_LABELS = { quick: '快速要点', deep: '深度精读', book: '全书精读', map: '知识地图', feynman: '费曼读书法' }
    const KIND_LABELS = { url: '网页', pdf: 'PDF', file: '文件', text: '粘贴文本' }
    const TYPE_ORDER = ['核心结论', '分论点', '原因或作用机制', '事实', '数据', '案例', '隐含前提', '反对意见', '限制条件', '可执行建议']
    const CONF_CLASS = { '作者原意': 'dr-conf-author', '原文事实与数据': 'dr-conf-fact', '合理推断': 'dr-conf-infer', '无法确认': 'dr-conf-unknown' }
    const CONF_ORDER = ['作者原意', '原文事实与数据', '合理推断', '无法确认']

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
      return React.createElement('div', { className: 'dr-head' },
        React.createElement('div', { className: 'dr-title' }, (isMap ? '🗺️' : '📖') + ' ' + (typeof v.title === 'string' && v.title !== '' ? v.title : (isMap ? '知识地图' : '精读报告'))),
        React.createElement('div', { className: 'dr-badges' },
          badge(isMap ? '知识地图' : '文章'),
          kindLabel !== null ? badge(kindLabel) : null,
          badge(depthLabel),
          typeof meta.chars === 'number' ? badge('约 ' + meta.chars + ' 字') : null,
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

    function DeepReadCard(props) {
      const block = props.block
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
      return React.createElement('div', { className: 'dr-card' }, React.createElement(Sections, { value: meta }))
    }

    function DockBar(props) {
      const [src, setSrc] = React.useState('')
      const [body, setBody] = React.useState('')
      const [showBody, setShowBody] = React.useState(false)
      const [depth, setDepth] = React.useState('map')
      const [exportFmt, setExportFmt] = React.useState('none')
      const inputActions = props.inputActions

      const submit = () => {
        const link = src.trim()
        const pasted = body.trim()
        const hasLink = /^https?:\/\//i.test(link) || link.startsWith('mp.weixin.qq.com') || link.includes('weixin.qq.com')
        let target = null
        if (pasted !== '') target = '正文如下：\n' + pasted
        else if (hasLink) target = '链接：' + link
        else if (link !== '') target = '文件路径：' + link
        if (target === null) return
        const depthLabel = DEPTH_LABELS[depth] || depth
        const exportLabel = { none: '不导出，仅会话展示', md: 'MD', mm: '思维导图', html: '网页', all: '全部' }[exportFmt] || exportFmt
        const instruction = '请使用 deepread 工具精读以下内容（模式：' + depthLabel + '；导出：' + exportLabel + '）。\n' + target
        if (inputActions !== undefined && typeof inputActions.setDraft === 'function' && typeof inputActions.submit === 'function') {
          inputActions.setDraft(instruction)
          inputActions.submit()
        }
      }

      return React.createElement('div', { className: 'dr-dock' },
        React.createElement('span', { className: 'dr-dock-title' }, '📖 精读'),
        React.createElement('input', {
          className: 'dr-dock-input',
          placeholder: '微信公众号链接 / 文件路径（.txt/.md/.pdf）',
          value: src,
          onChange: (event) => setSrc(event.target.value),
        }),
        React.createElement('select', { className: 'dr-select', value: depth, onChange: (event) => setDepth(event.target.value) },
          React.createElement('option', { value: 'quick' }, '快速'),
          React.createElement('option', { value: 'deep' }, '深度'),
          React.createElement('option', { value: 'map' }, '知识地图'),
          React.createElement('option', { value: 'book' }, '全书'),
          React.createElement('option', { value: 'feynman' }, '费曼'),
        ),
        React.createElement('select', { className: 'dr-select', value: exportFmt, onChange: (event) => setExportFmt(event.target.value) },
          React.createElement('option', { value: 'none' }, '仅会话'),
          React.createElement('option', { value: 'md' }, '导出 MD'),
          React.createElement('option', { value: 'mm' }, '导出导图'),
          React.createElement('option', { value: 'html' }, '导出网页'),
          React.createElement('option', { value: 'all' }, '导出全部'),
        ),
        React.createElement('button', { type: 'button', className: 'dr-dock-btn', onClick: submit }, '开始精读'),
        React.createElement('button', { type: 'button', className: 'dr-dock-hint', style: { background: 'none', border: 'none', cursor: 'pointer' }, onClick: () => setShowBody(!showBody) }, showBody ? '收起正文' : '贴正文'),
        showBody ? React.createElement('textarea', {
          className: 'dr-dock-textarea',
          placeholder: '或粘贴要精读的文章 / 章节内容…',
          value: body,
          onChange: (event) => setBody(event.target.value),
        }) : null,
      )
    }

    exports.apply = function (ctx) {
      const disposeCss = injectCss(ctx, CSS)
      const slots = ctx.get('slots')
      if (slots === undefined) return disposeCss
      slots.inject('tool.call.toolview', () => slots.register(
        { name: 'tool.call.toolview', key: 'deepread' },
        (props) => React.createElement(DeepReadCard, props),
      ))
      slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'deepread-dock', order: 30, label: '精读助手' },
        (props) => React.createElement(DockBar, props),
      ))
      return disposeCss
    }

    return exports;
  }
});
