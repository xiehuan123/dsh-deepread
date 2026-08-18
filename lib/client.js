window.__ModuleLoader__.load({
	id: "dsh-deepread",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/models.ts
		function isBudgetSuccess(value) {
			return isRecord(value) && value.ok === true && typeof value.chars === "number" && Array.isArray(value.modes) && value.modes.every((row) => isRecord(row) && typeof row.mode === "string" && typeof row.calls === "number" && typeof row.inputTokens === "number" && typeof row.outputTokens === "number" && typeof row.totalTokens === "number" && typeof row.minutes === "number");
		}
		function isRecord(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function errorMessage(value) {
			return isRecord(value) && typeof value.message === "string" ? value.message : String(value);
		}
		//#endregion
		//#region src/client/store.ts
		function createPanelState() {
			const source = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
				open: false,
				position: null
			});
			return {
				source,
				actions: {
					togglePanel() {
						source.update((draft) => {
							draft.open = !draft.open;
						});
					},
					closePanel() {
						source.update((draft) => {
							draft.open = false;
						});
					},
					setPanelPosition(position) {
						source.update((draft) => {
							draft.position = position;
						});
					}
				}
			};
		}
		//#endregion
		//#region src/client/storage.ts
		const HISTORY_KEY = "dsh-deepread-history-v1";
		const CALIB_KEY = "dsh-deepread-calib";
		const HISTORY_MAX = 20;
		const HISTORY_KINDS = [
			"article",
			"book",
			"map",
			"feynman",
			"batch"
		];
		const DEFAULT_CALIBRATION = {
			rate: 30,
			latency: 800
		};
		function currentStorage() {
			return globalThis.localStorage;
		}
		function isBrowserStorage(value) {
			return isRecord(value) && typeof value.getItem === "function" && typeof value.setItem === "function";
		}
		function historyKindAllowed(kind) {
			return typeof kind === "string" && HISTORY_KINDS.includes(kind);
		}
		function parseHistoryRecord(value) {
			if (!isRecord(value)) return null;
			if (typeof value.id !== "string" || typeof value.title !== "string" || !historyKindAllowed(value.kind)) return null;
			return {
				id: value.id,
				title: value.title,
				kind: value.kind,
				depth: typeof value.depth === "string" ? value.depth : "",
				source: typeof value.source === "string" ? value.source : "",
				chars: typeof value.chars === "number" && Number.isFinite(value.chars) ? value.chars : 0,
				time: typeof value.time === "number" && Number.isFinite(value.time) ? value.time : 0,
				summary: typeof value.summary === "string" ? value.summary : "",
				thesis: typeof value.thesis === "string" ? value.thesis : ""
			};
		}
		function readHistory(storageValue = currentStorage()) {
			const storage = isBrowserStorage(storageValue) ? storageValue : void 0;
			if (storage === void 0) return [];
			try {
				const raw = storage.getItem(HISTORY_KEY);
				if (raw === null || raw === "") return [];
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.map(parseHistoryRecord).filter((item) => item !== null) : [];
			} catch {
				return [];
			}
		}
		function writeHistory(record, storageValue = currentStorage()) {
			const storage = isBrowserStorage(storageValue) ? storageValue : void 0;
			if (storage === void 0) return;
			try {
				const list = readHistory(storage);
				const index = list.findIndex((item) => item.id === record.id);
				if (index !== -1) list.splice(index, 1);
				list.unshift(record);
				if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
				storage.setItem(HISTORY_KEY, JSON.stringify(list));
			} catch {}
		}
		function readCalibration(storageValue = currentStorage()) {
			const storage = isBrowserStorage(storageValue) ? storageValue : void 0;
			if (storage === void 0) return DEFAULT_CALIBRATION;
			try {
				const raw = storage.getItem(CALIB_KEY);
				if (raw === null || raw === "") return DEFAULT_CALIBRATION;
				const parsed = JSON.parse(raw);
				if (!isRecord(parsed)) return DEFAULT_CALIBRATION;
				return {
					rate: typeof parsed.rate === "number" && Number.isFinite(parsed.rate) && parsed.rate > 0 ? parsed.rate : DEFAULT_CALIBRATION.rate,
					latency: typeof parsed.latency === "number" && Number.isFinite(parsed.latency) && parsed.latency > 0 ? parsed.latency : DEFAULT_CALIBRATION.latency
				};
			} catch {
				return DEFAULT_CALIBRATION;
			}
		}
		function writeCalibration(rate, latency, storageValue = currentStorage()) {
			const storage = isBrowserStorage(storageValue) ? storageValue : void 0;
			if (storage === void 0) return;
			try {
				storage.setItem(CALIB_KEY, JSON.stringify({
					rate,
					latency
				}));
			} catch {}
		}
		//#endregion
		//#region src/client/view.ts
		const CSS = [
			".dr-card { font-size: 13px; line-height: 1.6; }",
			".dr-head { margin-bottom: 4px; }",
			".dr-title { font-weight: 600; font-size: 14px; color: var(--dsw-alias-label-primary); }",
			".dr-badges { margin-top: 4px; }",
			".dr-badge { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; }",
			".dr-source { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 4px; word-break: break-all; }",
			".dr-files { color: var(--dsw-alias-state-success-primary); font-size: 12px; margin-top: 4px; word-break: break-all; }",
			".dr-summary { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; margin: 8px 0; }",
			".dr-thesis { border-left: 3px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 0 8px 8px 0; padding: 8px 10px; margin: 8px 0; color: var(--dsw-alias-label-primary); }",
			".dr-thesis-label { font-size: 11px; color: var(--dsw-alias-brand-primary); font-weight: 600; margin-bottom: 2px; }",
			".dr-question { border-left: 3px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 0 8px 8px 0; padding: 8px 10px; margin: 8px 0; color: var(--dsw-alias-label-primary); }",
			".dr-section { border-top: 1px solid var(--dsw-alias-border-l1); margin-top: 6px; }",
			".dr-section-head { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: none; padding: 6px 0; cursor: pointer; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; text-align: left; }",
			".dr-section-icon { color: var(--dsw-alias-label-secondary); width: 12px; }",
			".dr-section-count { color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 400; }",
			".dr-section-body { padding-bottom: 8px; }",
			".dr-args, .dr-chapters, .dr-flow, .dr-quotes, .dr-concepts, .dr-questions, .dr-conclusions { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-primary); }",
			".dr-args li, .dr-quotes li, .dr-concepts li, .dr-questions li, .dr-chapters li, .dr-flow li, .dr-conclusions li { margin: 4px 0; }",
			".dr-arg-claim { font-weight: 600; }",
			".dr-arg-quote { color: var(--dsw-alias-label-secondary); border-left: 2px solid var(--dsw-alias-border-l2); padding-left: 8px; margin: 2px 0 6px; }",
			".dr-chapter-title { font-weight: 600; }",
			".dr-chapter-summary, .dr-chapter-thesis { color: var(--dsw-alias-label-secondary); }",
			".dr-quote-text { color: var(--dsw-alias-label-primary); }",
			".dr-quote-context { color: var(--dsw-alias-label-secondary); font-size: 12px; }",
			".dr-concept-term { font-weight: 600; color: var(--dsw-alias-brand-primary); }",
			".dr-concept-expl { color: var(--dsw-alias-label-secondary); }",
			".dr-note { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 6px; }",
			".dr-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin-top: 6px; }",
			".dr-budget { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }",
			".dr-budget-result { color: var(--dsw-alias-label-primary); font-weight: 600; }",
			".dr-budget-error { color: var(--dsw-alias-state-error-primary); }",
			".dr-job-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 4px 8px; margin: 4px 0; word-break: break-all; overflow-wrap: anywhere; }",
			".dr-map-item { border-left: 2px solid var(--dsw-alias-border-l2); padding-left: 8px; margin: 8px 0; }",
			".dr-map-claim { font-weight: 600; color: var(--dsw-alias-label-primary); }",
			".dr-evidence { color: var(--dsw-alias-label-secondary); font-size: 12px; }",
			".dr-evidence-missing { color: var(--dsw-alias-state-warn-primary); font-size: 12px; }",
			".dr-tag { display: inline-block; margin-right: 6px; margin-top: 2px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; }",
			".dr-conf-author { color: #16a34a; border-color: #16a34a66; background: #16a34a14; }",
			".dr-conf-fact { color: #2563eb; border-color: #2563eb66; background: #2563eb14; }",
			".dr-conf-infer { color: #b45309; border-color: #b4530966; background: #b4530914; }",
			".dr-conf-unknown { color: #dc2626; border-color: #dc262666; background: #dc262614; }",
			".dr-legend { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 2px; }",
			".dr-legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); }",
			".dr-relation { color: var(--dsw-alias-brand-primary); font-size: 11px; display: block; }",
			".dr-data-row { border-left: 2px solid var(--dsw-alias-border-l2); padding-left: 8px; margin: 6px 0; }",
			".dr-data-value { font-weight: 600; color: var(--dsw-alias-label-primary); }",
			".dr-data-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }",
			".dr-pre { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; overflow-x: auto; font-size: 12px; white-space: pre; color: var(--dsw-alias-label-primary); }",
			".dr-toc { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-primary); }",
			".dr-toc li { margin: 4px 0; }",
			".dr-feynman-talk { border-left: 3px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); border-radius: 0 8px 8px 0; padding: 8px 10px; margin: 8px 0; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }",
			".dr-gap { color: var(--dsw-alias-state-warn-primary); }",
			".dr-fix { color: var(--dsw-alias-state-success-primary); }",
			".dr-review-row { display: flex; gap: 8px; align-items: baseline; margin: 4px 0; }",
			".dr-review-day { flex-shrink: 0; font-weight: 600; color: var(--dsw-alias-brand-primary); min-width: 56px; }",
			".dr-composer-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; min-height: 30px; flex-shrink: 0; background: none; border: 1px solid transparent; border-radius: 8px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 14px; }",
			".dr-composer-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }",
			".dr-panel { pointer-events: auto; position: fixed; top: 56px; right: 16px; width: 420px; max-width: calc(100vw - 32px); max-height: 86vh; overflow-y: auto; z-index: 200; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18); padding: 12px; font-size: 13px; color: var(--dsw-alias-label-primary); }",
			".dr-panel-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; cursor: grab; touch-action: none; user-select: none; }",
			".dr-panel-dragging .dr-panel-head { cursor: grabbing; }",
			".dr-close { background: none; border: none; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 14px; padding: 2px 6px; border-radius: 6px; }",
			".dr-close:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }",
			".dr-input { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; padding: 7px 9px; }",
			".dr-input:focus { outline: 1px solid var(--dsw-alias-brand-primary); }",
			".dr-textarea { resize: vertical; font-family: inherit; line-height: 1.5; }",
			".dr-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
			".dr-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }",
			".dr-depth, .dr-export { background: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 3px 10px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }",
			".dr-depth-on, .dr-export-on { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }",
			".dr-submit { background: var(--dsw-alias-brand-primary); color: #fff; border: none; border-radius: 8px; padding: 7px 12px; cursor: pointer; font-size: 13px; font-weight: 600; }",
			".dr-submit:disabled { opacity: 0.6; cursor: default; }",
			".dr-preflight { background: none; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 7px 12px; cursor: pointer; font-size: 13px; }",
			".dr-preflight:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }",
			".dr-preflight:disabled { opacity: 0.6; cursor: default; }",
			".dr-history { display: flex; flex-direction: column; gap: 4px; }",
			".dr-history-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 4px 0; }",
			".dr-history-item { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }",
			".dr-history-head { display: flex; align-items: flex-start; gap: 6px; width: 100%; background: none; border: none; padding: 6px 8px; cursor: pointer; text-align: left; box-sizing: border-box; }",
			".dr-history-arrow { color: var(--dsw-alias-label-secondary); width: 12px; flex-shrink: 0; margin-top: 1px; }",
			".dr-history-main { flex: 1; min-width: 0; }",
			".dr-history-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); line-height: 1.4; word-break: break-all; }",
			".dr-history-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }",
			".dr-history-time { color: var(--dsw-alias-label-secondary); font-size: 11px; }",
			".dr-history-detail { padding: 2px 8px 8px; }",
			".dr-history-reread { background: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 2px 10px; cursor: pointer; color: var(--dsw-alias-brand-primary); font-size: 12px; margin-top: 6px; }",
			".dr-history-reread:hover { border-color: var(--dsw-alias-brand-primary); }"
		].join("\n");
		function injectCss(css) {
			if (typeof document === "undefined") return () => {};
			const el = document.createElement("style");
			el.setAttribute("data-plugin", "dsh-deepread");
			el.textContent = css;
			document.head.appendChild(el);
			return () => {
				if (el.parentNode !== null) el.parentNode.removeChild(el);
			};
		}
		const DEPTH_LABELS = {
			quick: "快速要点",
			deep: "深度精读",
			book: "全书精读",
			map: "知识地图",
			feynman: "费曼读书法"
		};
		const KIND_LABELS = {
			url: "网页",
			pdf: "PDF",
			file: "文件",
			text: "粘贴文本"
		};
		const TYPE_ORDER = [
			"核心结论",
			"分论点",
			"原因或作用机制",
			"事实",
			"数据",
			"案例",
			"隐含前提",
			"反对意见",
			"限制条件",
			"可执行建议"
		];
		const CONF_CLASS = {
			"作者原意": "dr-conf-author",
			"原文事实与数据": "dr-conf-fact",
			"合理推断": "dr-conf-infer",
			"无法确认": "dr-conf-unknown"
		};
		const CONF_ORDER = [
			"作者原意",
			"原文事实与数据",
			"合理推断",
			"无法确认"
		];
		const EST_PROMPT_OVERHEAD = 600;
		const EST_CHUNK_CHARS = 6e3;
		const EST_MAX_PARTS = 20;
		const EST_MAX_INPUT_CHARS = 4e5;
		function estimateTokens(text) {
			let cjk = 0;
			let latin = 0;
			let other = 0;
			for (let i = 0; i < text.length; i++) {
				const c = text.charCodeAt(i);
				if (c >= 19968 && c <= 40959 || c >= 12288 && c <= 12351 || c >= 65280 && c <= 65519) cjk++;
				else if (c >= 32 && c < 127) latin++;
				else other++;
			}
			return Math.ceil(cjk * .6 + latin * .25 + other * .5);
		}
		function estimateCall(calls, inputTokens, outputTokens, rate, latency) {
			const totalTokens = inputTokens + outputTokens;
			return {
				calls,
				inputTokens,
				outputTokens,
				totalTokens,
				minutes: Math.round((totalTokens / rate / 60 + calls * latency / 6e4) * 10) / 10
			};
		}
		function estimateModes(text, rate, latency) {
			const chars = text.length;
			const tokOf = (len) => estimateTokens(text.slice(0, len));
			const effectiveLen = chars > EST_MAX_INPUT_CHARS ? EST_MAX_INPUT_CHARS : chars;
			const parts = Math.min(Math.ceil(effectiveLen / EST_CHUNK_CHARS), EST_MAX_PARTS);
			const perInput = tokOf(effectiveLen > EST_CHUNK_CHARS ? EST_CHUNK_CHARS : effectiveLen) + EST_PROMPT_OVERHEAD;
			const summaryInput = parts * 400 + EST_PROMPT_OVERHEAD;
			const quick = estimateCall(1, tokOf(Math.min(effectiveLen, 3e4)) + EST_PROMPT_OVERHEAD, 2500, rate, latency);
			const deep = effectiveLen <= 9e3 ? estimateCall(1, tokOf(effectiveLen) + EST_PROMPT_OVERHEAD, 4e3, rate, latency) : estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5e3 + 5e3, rate, latency);
			const bookParts = Math.max(1, parts);
			const book = estimateCall(bookParts + 1, bookParts * perInput + summaryInput, bookParts * 5e3 + 5e3, rate, latency);
			const map = effectiveLen <= 9e3 ? estimateCall(1, tokOf(effectiveLen) + EST_PROMPT_OVERHEAD, 5e3, rate, latency) : estimateCall(parts + 1, parts * perInput + summaryInput, parts * 5e3 + 5e3, rate, latency);
			const feynmanStruct = effectiveLen > 9e3 ? 1 : 0;
			const structInput = feynmanStruct > 0 ? tokOf(5e3) + EST_PROMPT_OVERHEAD : 0;
			return {
				quick,
				deep,
				book,
				map,
				feynman: estimateCall(Math.max(1, parts) + feynmanStruct + 1, Math.max(1, parts) * perInput + structInput + summaryInput, Math.max(1, parts) * 5e3 + 5e3, rate, latency)
			};
		}
		function formatTokens(n) {
			if (typeof n !== "number" || !isFinite(n)) return "≈? token";
			if (n >= 1e3) return "≈" + Math.round(n / 100) / 10 + "k token";
			return "≈" + n + " token";
		}
		function formatMinutes(m) {
			if (typeof m !== "number" || !isFinite(m)) return "≈?分钟";
			if (m < 1) return "≈<1分钟";
			if (m >= 60) return "≈" + Math.round(m / 6) / 10 + "小时";
			return "≈" + m + "分钟";
		}
		function badge(text) {
			return react.createElement("span", { className: "dr-badge" }, text);
		}
		function tag(text, cls) {
			return react.createElement("span", { className: "dr-tag" + (cls !== void 0 ? " " + cls : "") }, text);
		}
		function Section(props) {
			const [open, setOpen] = react.useState(props.defaultOpen !== false);
			return react.createElement("div", { className: "dr-section" }, react.createElement("button", {
				type: "button",
				className: "dr-section-head",
				onClick: () => setOpen(!open)
			}, react.createElement("span", { className: "dr-section-icon" }, open ? "▾" : "▸"), react.createElement("span", null, props.title), props.count !== void 0 ? react.createElement("span", { className: "dr-section-count" }, String(props.count)) : null), open ? react.createElement("div", { className: "dr-section-body" }, props.children) : null);
		}
		function Header(props) {
			const v = props.value;
			const meta = v.meta !== null && typeof v.meta === "object" ? v.meta : {};
			const isMap = v.kind === "map";
			const depthLabel = typeof meta.depth === "string" ? DEPTH_LABELS[meta.depth] ?? "精读" : "精读";
			const kindLabel = typeof meta.sourceKind === "string" ? KIND_LABELS[meta.sourceKind] ?? null : null;
			const files = isRecord(meta.files) ? meta.files : null;
			let estBadge = null;
			const est = isRecord(meta.estimate) && Array.isArray(meta.estimate.modes) ? meta.estimate : null;
			if (est !== null) {
				const row = (Array.isArray(est.modes) ? est.modes : []).find((candidate) => isRecord(candidate) && candidate.mode === meta.depth);
				if (isRecord(row) && typeof row.calls === "number") estBadge = "预算 ≈ " + String(row.totalTokens) + " token · " + String(row.minutes) + " 分钟";
			}
			return react.createElement("div", { className: "dr-head" }, react.createElement("div", { className: "dr-title" }, (isMap ? "🗺️" : "📖") + " " + (typeof v.title === "string" && v.title !== "" ? v.title : isMap ? "知识地图" : "精读报告")), react.createElement("div", { className: "dr-badges" }, badge(isMap ? "知识地图" : "文章"), kindLabel !== null ? badge(kindLabel) : null, badge(depthLabel), typeof meta.chars === "number" ? badge("约 " + meta.chars + " 字") : null, estBadge !== null ? badge(estBadge) : null), typeof meta.source === "string" && meta.source !== "" ? react.createElement("div", { className: "dr-source" }, "来源：" + meta.source) : null, files !== null ? react.createElement("div", { className: "dr-files" }, "已导出：" + [
				"md",
				"mm",
				"html"
			].map((k) => typeof files[k] === "string" ? files[k] : null).filter(Boolean).join(" · ")) : null);
		}
		function MapItemRow(o, i) {
			const evidence = typeof o.evidence === "string" ? o.evidence : "";
			const relations = Array.isArray(o.relations) ? o.relations : [];
			const conf = typeof o.confidence === "string" ? o.confidence : "";
			return react.createElement("div", {
				className: "dr-map-item",
				key: "mi-" + i
			}, react.createElement("div", { className: "dr-map-claim" }, i + 1 + ". " + (typeof o.claim === "string" ? o.claim : "")), evidence !== "" ? react.createElement("div", { className: evidence === "原文未提供证据" ? "dr-evidence-missing" : "dr-evidence" }, "证据：" + evidence) : null, typeof o.source === "string" && o.source !== "" || conf !== "" ? react.createElement("div", null, typeof o.source === "string" && o.source !== "" ? tag("位置：" + o.source) : null, conf !== "" ? tag(conf, CONF_CLASS[conf]) : null) : null, relations.map((r, ri) => {
				const ro = isRecord(r) ? r : { type: String(r) };
				if (typeof ro.to !== "string" || ro.to === "") return null;
				return react.createElement("span", {
					className: "dr-relation",
					key: "rel-" + ri
				}, "↳ " + (typeof ro.type === "string" ? ro.type : "支持") + " → " + ro.to);
			}));
		}
		function FeynmanSections(props) {
			const v = props.value;
			const toc = Array.isArray(v.toc) ? v.toc : [];
			const questions = Array.isArray(v.questions) ? v.questions : [];
			const chapters = Array.isArray(v.feynmanChapters) ? v.feynmanChapters : [];
			const reviewPlan = Array.isArray(v.reviewPlan) ? v.reviewPlan : [];
			return react.createElement("div", { className: "dr-sections" }, react.createElement(Header, { value: v }), typeof v.summary === "string" && v.summary !== "" ? react.createElement("div", { className: "dr-summary" }, v.summary) : null, typeof v.thesis === "string" && v.thesis !== "" ? react.createElement("div", { className: "dr-thesis" }, react.createElement("div", { className: "dr-thesis-label" }, "核心论点"), v.thesis) : null, toc.length > 0 ? react.createElement(Section, {
				title: "浏览目录",
				count: toc.length,
				defaultOpen: true
			}, react.createElement("ol", { className: "dr-toc" }, toc.map((t, i) => react.createElement("li", { key: "toc-" + i }, String(t))))) : null, questions.length > 0 ? react.createElement(Section, {
				title: "阅读问题清单",
				count: questions.length,
				defaultOpen: true
			}, react.createElement("ol", { className: "dr-questions" }, questions.map((q, i) => react.createElement("li", { key: "q-" + i }, String(q))))) : null, chapters.map((ch, i) => {
				const o = ch !== null && typeof ch === "object" ? ch : {};
				const points = Array.isArray(o.points) ? o.points : [];
				const gaps = Array.isArray(o.gaps) ? o.gaps : [];
				const fixes = Array.isArray(o.corrections) ? o.corrections : [];
				const chapterIndex = typeof o.index === "number" ? o.index : i + 1;
				return react.createElement(Section, {
					title: "第 " + chapterIndex + " 章 · " + (typeof o.title === "string" ? o.title : ""),
					count: points.length,
					defaultOpen: chapterIndex <= 2,
					key: "fc-" + i
				}, points.length > 0 ? react.createElement("div", null, points.map((p, pi) => {
					const po = isRecord(p) ? p : { claim: String(p) };
					return react.createElement("div", {
						className: "dr-map-item",
						key: "fp-" + pi
					}, react.createElement("div", { className: "dr-map-claim" }, pi + 1 + ". " + (typeof po.claim === "string" ? po.claim : "")), typeof po.data === "string" && po.data !== "" ? react.createElement("div", { className: "dr-evidence" }, "数据：" + po.data) : null, typeof po.evidence === "string" && po.evidence !== "" ? react.createElement("div", { className: po.evidence === "原文未提供证据" ? "dr-evidence-missing" : "dr-evidence" }, "证据：" + po.evidence) : null);
				})) : null, typeof o.chapterMap === "string" && o.chapterMap !== "" ? react.createElement("pre", { className: "dr-pre" }, "mindmap\n" + String(o.chapterMap)) : null, typeof o.explanation === "string" && o.explanation !== "" ? react.createElement("div", { className: "dr-feynman-talk" }, "💬 合上书讲解\n" + o.explanation) : null, gaps.length > 0 ? react.createElement("div", { className: "dr-gap" }, "⚠️ 知识缺口：" + gaps.map(String).join("；")) : null, fixes.length > 0 ? react.createElement("div", { className: "dr-fix" }, "✅ 原文修正：" + fixes.map(String).join("；")) : null);
			}), typeof v.bookMap === "string" && v.bookMap !== "" ? react.createElement(Section, { title: "合并全书导图" }, react.createElement("pre", { className: "dr-pre" }, "mindmap\n" + String(v.bookMap))) : null, typeof v.finalExplanation === "string" && v.finalExplanation !== "" ? react.createElement(Section, {
				title: "再讲一次（全书终讲）",
				defaultOpen: true
			}, react.createElement("div", { className: "dr-feynman-talk" }, v.finalExplanation)) : null, reviewPlan.length > 0 ? react.createElement(Section, {
				title: "间隔复习计划",
				count: reviewPlan.length,
				defaultOpen: true
			}, react.createElement("div", null, reviewPlan.map((r, i) => {
				const ro = r !== null && typeof r === "object" ? r : { interval: String(r) };
				return react.createElement("div", {
					className: "dr-review-row",
					key: "rp-" + i
				}, react.createElement("span", { className: "dr-review-day" }, typeof ro.interval === "string" ? ro.interval : ""), react.createElement("span", null, (typeof ro.focus === "string" ? ro.focus : "") + (typeof ro.method === "string" && ro.method !== "" ? " —— " + ro.method : "")));
			}))) : null);
		}
		function Sections(props) {
			const v = props.value !== null && typeof props.value === "object" ? props.value : {};
			if (v.kind === "feynman") return react.createElement(FeynmanSections, { value: v });
			if (v.kind === "map") {
				const items = Array.isArray(v.items) ? v.items : [];
				const dataPoints = Array.isArray(v.dataPoints) ? v.dataPoints : [];
				const caveats = Array.isArray(v.caveats) ? v.caveats : [];
				const coreConclusions = Array.isArray(v.coreConclusions) ? v.coreConclusions : [];
				const recallQuestions = Array.isArray(v.recallQuestions) ? v.recallQuestions : [];
				const groups = {};
				for (const it of items) {
					const o = isRecord(it) ? it : { claim: String(it) };
					const t = typeof o.type === "string" && o.type !== "" ? o.type : "分论点";
					(groups[t] ?? (groups[t] = [])).push(isRecord(o) ? o : { claim: String(o) });
				}
				return react.createElement("div", { className: "dr-sections" }, react.createElement(Header, { value: v }), typeof v.summary === "string" && v.summary !== "" ? react.createElement("div", { className: "dr-summary" }, v.summary) : null, typeof v.coreQuestion === "string" && v.coreQuestion !== "" ? react.createElement("div", { className: "dr-question" }, react.createElement("div", { className: "dr-thesis-label" }, "核心问题（作者试图回答）"), v.coreQuestion) : null, coreConclusions.length > 0 ? react.createElement(Section, {
					title: "核心结论",
					count: coreConclusions.length,
					defaultOpen: true
				}, react.createElement("ol", { className: "dr-conclusions" }, coreConclusions.map((c, i) => react.createElement("li", { key: "cc-" + i }, String(c))))) : null, react.createElement("div", { className: "dr-legend" }, react.createElement("span", { className: "dr-legend-item" }, "置信度："), CONF_ORDER.map((c) => react.createElement("span", {
					className: "dr-legend-item",
					key: "lg-" + c
				}, tag(c, CONF_CLASS[c])))), TYPE_ORDER.map((t) => {
					const group = groups[t];
					if (group === void 0 || group.length === 0) return null;
					return react.createElement(Section, {
						title: t,
						count: group.length,
						defaultOpen: t === "核心结论" || t === "分论点",
						key: "g-" + t
					}, react.createElement("div", null, group.map(MapItemRow)));
				}), dataPoints.length > 0 ? react.createElement(Section, {
					title: "关键数据表",
					count: dataPoints.length,
					defaultOpen: true
				}, react.createElement("div", null, dataPoints.map((d, i) => {
					const o = isRecord(d) ? d : { value: String(d) };
					return react.createElement("div", {
						className: "dr-data-row",
						key: "dp-" + i
					}, react.createElement("div", { className: "dr-data-value" }, typeof o.value === "string" ? o.value : ""), typeof o.period === "string" && o.period !== "" ? react.createElement("div", { className: "dr-data-meta" }, "时间：" + o.period) : null, typeof o.subject === "string" && o.subject !== "" ? react.createElement("div", { className: "dr-data-meta" }, "对象：" + o.subject) : null, typeof o.baseline === "string" && o.baseline !== "" ? react.createElement("div", { className: "dr-data-meta" }, "基准：" + o.baseline) : null, typeof o.source === "string" && o.source !== "" ? react.createElement("div", { className: "dr-data-meta" }, "来源：" + o.source) : null, typeof o.location === "string" && o.location !== "" ? react.createElement("div", { className: "dr-data-meta" }, "位置：" + o.location) : null);
				}))) : null, caveats.length > 0 ? react.createElement(Section, {
					title: "反对意见与局限",
					count: caveats.length
				}, react.createElement("ul", { className: "dr-questions" }, caveats.map((c, i) => react.createElement("li", { key: "cv-" + i }, String(c))))) : null, typeof v.mermaid === "string" && v.mermaid !== "" ? react.createElement(Section, { title: "Mermaid 思维导图" }, react.createElement("pre", { className: "dr-pre" }, "mindmap\n" + String(v.mermaid))) : null, recallQuestions.length > 0 ? react.createElement(Section, {
					title: "主动回忆问题",
					count: recallQuestions.length,
					defaultOpen: true
				}, react.createElement("ol", { className: "dr-questions" }, recallQuestions.map((q, i) => react.createElement("li", { key: "rq-" + i }, String(q))))) : null, typeof v.meta === "object" && v.meta !== null && v.meta.note ? react.createElement("div", { className: "dr-note" }, String(v.meta.note)) : null);
			}
			const args = Array.isArray(v.arguments) ? v.arguments : [];
			const quotes = Array.isArray(v.quotes) ? v.quotes : [];
			const concepts = Array.isArray(v.concepts) ? v.concepts : [];
			const questions = Array.isArray(v.questions) ? v.questions : [];
			const structure = Array.isArray(v.structure) ? v.structure : [];
			const chapters = Array.isArray(v.chapters) ? v.chapters : [];
			const meta = v.meta !== null && typeof v.meta === "object" ? v.meta : {};
			const isBook = v.kind === "book";
			return react.createElement("div", { className: "dr-sections" }, react.createElement(Header, { value: v }), typeof v.summary === "string" && v.summary !== "" ? react.createElement("div", { className: "dr-summary" }, v.summary) : null, typeof v.thesis === "string" && v.thesis !== "" ? react.createElement("div", { className: "dr-thesis" }, react.createElement("div", { className: "dr-thesis-label" }, "核心论点"), v.thesis) : null, args.length > 0 ? react.createElement(Section, {
				title: "论证结构",
				count: args.length,
				defaultOpen: true
			}, react.createElement("ol", { className: "dr-args" }, args.map((a, i) => {
				const o = a !== null && typeof a === "object" ? a : { claim: String(a) };
				return react.createElement("li", { key: "arg-" + i }, react.createElement("div", { className: "dr-arg-claim" }, typeof o.claim === "string" ? o.claim : ""), typeof o.evidence === "string" && o.evidence !== "" ? react.createElement("div", null, "论据：" + o.evidence) : null, typeof o.quote === "string" && o.quote !== "" ? react.createElement("div", { className: "dr-arg-quote" }, "“" + o.quote + "”") : null);
			}))) : null, structure.length > 0 ? react.createElement(Section, {
				title: "论证脉络",
				count: structure.length
			}, react.createElement("ol", { className: "dr-flow" }, structure.map((s, i) => react.createElement("li", { key: "st-" + i }, String(s))))) : null, chapters.length > 0 ? react.createElement(Section, {
				title: isBook ? "章节脉络" : "各部分要点",
				count: chapters.length
			}, react.createElement("ol", { className: "dr-chapters" }, chapters.map((c, i) => {
				const o = c !== null && typeof c === "object" ? c : {};
				return react.createElement("li", { key: "ch-" + i }, react.createElement("div", { className: "dr-chapter-title" }, typeof o.title === "string" ? o.title : "第 " + (i + 1) + " 部分"), typeof o.summary === "string" && o.summary !== "" ? react.createElement("div", { className: "dr-chapter-summary" }, o.summary) : null);
			}))) : null, quotes.length > 0 ? react.createElement(Section, {
				title: "金句摘录",
				count: quotes.length
			}, react.createElement("ul", { className: "dr-quotes" }, quotes.map((q, i) => {
				const o = q !== null && typeof q === "object" ? q : { text: String(q) };
				return react.createElement("li", { key: "q-" + i }, "“" + (typeof o.text === "string" ? o.text : "") + "”");
			}))) : null, concepts.length > 0 ? react.createElement(Section, {
				title: "核心概念",
				count: concepts.length
			}, react.createElement("ul", { className: "dr-concepts" }, concepts.map((c, i) => {
				const o = c !== null && typeof c === "object" ? c : { term: String(c) };
				return react.createElement("li", { key: "c-" + i }, react.createElement("span", { className: "dr-concept-term" }, typeof o.term === "string" ? o.term : ""), typeof o.explanation === "string" && o.explanation !== "" ? react.createElement("span", { className: "dr-concept-expl" }, " — " + o.explanation) : null);
			}))) : null, questions.length > 0 ? react.createElement(Section, {
				title: "批判性思考",
				count: questions.length
			}, react.createElement("ul", { className: "dr-questions" }, questions.map((q, i) => react.createElement("li", { key: "qn-" + i }, String(q))))) : null, meta.note ? react.createElement("div", { className: "dr-note" }, String(meta.note)) : null);
		}
		function relativeTime(time) {
			if (typeof time !== "number" || !isFinite(time)) return "";
			const diff = Date.now() - time;
			const minute = 6e4;
			const hour = 60 * minute;
			const day = 24 * hour;
			if (diff < minute) return "刚刚";
			if (diff < hour) return Math.floor(diff / minute) + " 分钟前";
			if (diff < day) return Math.floor(diff / hour) + " 小时前";
			if (diff < 2 * day) return "昨天";
			if (diff < 7 * day) return Math.floor(diff / day) + " 天前";
			const d = new Date(time);
			const mm = String(d.getMonth() + 1);
			const dd = String(d.getDate());
			return d.getFullYear() + "-" + (mm.length < 2 ? "0" + mm : mm) + "-" + (dd.length < 2 ? "0" + dd : dd);
		}
		function HistoryItem(props) {
			const item = props.item;
			const [open, setOpen] = react.useState(false);
			const title = typeof item.title === "string" ? item.title : "";
			const displayTitle = title.length > 40 ? title.slice(0, 40) + "…" : title;
			const depthLabel = DEPTH_LABELS[item.depth] !== void 0 ? DEPTH_LABELS[item.depth] : "精读";
			const timeText = relativeTime(item.time);
			const summary = typeof item.summary === "string" ? item.summary : "";
			const thesis = typeof item.thesis === "string" ? item.thesis : "";
			const onReread = props.onReread;
			return react.createElement("div", { className: "dr-history-item" }, react.createElement("button", {
				type: "button",
				className: "dr-history-head",
				title,
				onClick: () => setOpen(!open)
			}, react.createElement("span", { className: "dr-history-arrow" }, open ? "▾" : "▸"), react.createElement("div", { className: "dr-history-main" }, react.createElement("div", { className: "dr-history-title" }, displayTitle), react.createElement("div", { className: "dr-history-meta" }, badge(depthLabel), timeText !== "" ? react.createElement("span", { className: "dr-history-time" }, timeText) : null))), open ? react.createElement("div", { className: "dr-history-detail" }, summary !== "" ? react.createElement("div", { className: "dr-summary" }, summary) : null, thesis !== "" ? react.createElement("div", { className: "dr-thesis" }, react.createElement("div", { className: "dr-thesis-label" }, "核心论点"), thesis) : null, typeof onReread === "function" ? react.createElement("button", {
				type: "button",
				className: "dr-history-reread",
				onClick: () => onReread(item)
			}, "↺ 重新精读") : null) : null);
		}
		function BackgroundCard(props) {
			const v = props.value !== null && typeof props.value === "object" ? props.value : {};
			const meta = v.meta !== null && typeof v.meta === "object" ? v.meta : {};
			const depthLabel = meta.depth === "batch" ? "批量精读" : typeof meta.depth === "string" ? DEPTH_LABELS[meta.depth] ?? null : null;
			const kindLabel = typeof meta.sourceKind === "string" ? KIND_LABELS[meta.sourceKind] ?? null : null;
			return react.createElement("div", { className: "dr-card" }, react.createElement("div", { className: "dr-title" }, "⏳ 后台精读已启动"), react.createElement("div", { className: "dr-badges" }, kindLabel !== null ? badge(kindLabel) : null, depthLabel !== null ? badge(depthLabel) : null), typeof v.jobId === "string" && v.jobId !== "" ? react.createElement("div", { className: "dr-job-id" }, v.jobId) : null, typeof v.label === "string" && v.label !== "" ? react.createElement("div", { className: "dr-source" }, v.label) : null, react.createElement("div", { className: "dr-note" }, "用 job_output 读取进度与最终报告；job_kill 可取消"));
		}
		function DeepReadCard(props) {
			const block = isRecord(props.block) ? props.block : {};
			const value = isRecord(block.meta) ? block.meta : null;
			react.useEffect(() => {
				if (value === null) return;
				if (value.kind === "estimate") return;
				if (value.kind === "background") return;
				const meta = isRecord(value.meta) ? value.meta : {};
				const est = isRecord(meta.estimate) ? meta.estimate : null;
				if (est !== null) {
					const rate = typeof est.estTokensPerSecond === "number" ? est.estTokensPerSecond : null;
					const latency = typeof est.estLatencyPerCallMs === "number" ? est.estLatencyPerCallMs : null;
					if (rate !== null && latency !== null || est.calibrated === true) writeCalibration(rate !== null ? rate : 100, latency !== null ? latency : 800);
				}
				if (!historyKindAllowed(value.kind)) return;
				const title = typeof value.title === "string" ? value.title : "";
				if (title === "") return;
				const source = typeof meta.source === "string" ? meta.source : "";
				writeHistory({
					id: String(source) + "|" + value.kind + "|" + title,
					title,
					kind: value.kind,
					depth: typeof meta.depth === "string" ? meta.depth : "",
					source,
					chars: typeof meta.chars === "number" ? meta.chars : 0,
					time: Date.now(),
					summary: typeof value.summary === "string" ? value.summary : "",
					thesis: typeof value.thesis === "string" ? value.thesis : ""
				});
			}, [value]);
			if (!(Array.isArray(block.content) || block.meta !== void 0)) return react.createElement("div", { className: "dr-card" }, react.createElement("div", { className: "dr-note" }, "📖 正在精读分析…（长文会自动分部分处理，请稍候）"));
			if (block.isError === true) {
				const message = isRecord(block.error) && typeof block.error.name === "string" ? block.error.name : "精读失败";
				return react.createElement("div", { className: "dr-card" }, react.createElement("div", { className: "dr-error" }, message));
			}
			const meta = isRecord(block.meta) ? block.meta : null;
			if (meta === null) return react.createElement("div", { className: "dr-card" }, react.createElement("div", { className: "dr-note" }, "精读已完成，请查看上方对话中的分析。"));
			if (meta.kind === "background") return react.createElement(BackgroundCard, { value: meta });
			return react.createElement("div", { className: "dr-card" }, react.createElement(Sections, { value: meta }));
		}
		function ComposerButton(props) {
			const open = props.usePanelState((state) => state.open);
			const accessibleName = open ? "关闭精读助手" : "打开精读助手";
			return react.createElement("button", {
				type: "button",
				className: "dr-composer-btn",
				title: accessibleName,
				"aria-label": accessibleName,
				"aria-expanded": open,
				"aria-controls": "deepread-panel",
				onClick: props.togglePanel
			}, "📖");
		}
		function Panel(props) {
			const open = props.usePanelState((state) => state.open);
			const position = props.usePanelState((state) => state.position);
			const [url, setUrl] = react.useState("");
			const [text, setText] = react.useState("");
			const [path, setPath] = react.useState("");
			const [focus, setFocus] = react.useState("");
			const [depth, setDepth] = react.useState("deep");
			const [exportFmt, setExportFmt] = react.useState("none");
			const [error, setError] = react.useState(null);
			const [note, setNote] = react.useState(null);
			const [history, setHistory] = react.useState([]);
			const [budget, setBudget] = react.useState(null);
			const [dragging, setDragging] = react.useState(false);
			const panelRef = react.useRef(null);
			const headerRef = react.useRef(null);
			const dragRef = react.useRef(null);
			const clampPosition = (left, top, panelWidth, headerHeight) => ({
				left: Math.min(Math.max(left, 0), Math.max(window.innerWidth - panelWidth, 0)),
				top: Math.min(Math.max(top, 0), Math.max(window.innerHeight - headerHeight, 0))
			});
			const finishDrag = (event, releaseCapture) => {
				const active = dragRef.current;
				if (active === null || active.pointerId !== event.pointerId) return;
				dragRef.current = null;
				setDragging(false);
				if (releaseCapture && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
			};
			const releaseActiveDrag = () => {
				const active = dragRef.current;
				dragRef.current = null;
				if (active === null) return false;
				if (active.captureTarget.hasPointerCapture(active.pointerId)) active.captureTarget.releasePointerCapture(active.pointerId);
				return true;
			};
			const onPointerDown = (event) => {
				if (dragRef.current !== null) return;
				if (event.pointerType === "mouse" && event.button !== 0) return;
				const interactive = event.target?.closest?.("button, a, input, textarea, select, [role=\"button\"], [contenteditable=\"true\"]");
				if (interactive !== null && interactive !== void 0) return;
				const panel = panelRef.current;
				const header = headerRef.current;
				if (panel === null || header === null) return;
				const panelRect = panel.getBoundingClientRect();
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					originLeft: panelRect.left,
					originTop: panelRect.top,
					captureTarget: event.currentTarget
				};
				setDragging(true);
			};
			const onPointerMove = (event) => {
				const active = dragRef.current;
				if (active === null || active.pointerId !== event.pointerId) return;
				if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
				const panel = panelRef.current;
				const header = headerRef.current;
				if (panel === null || header === null) return;
				props.setPanelPosition(clampPosition(active.originLeft + event.clientX - active.startX, active.originTop + event.clientY - active.startY, panel.getBoundingClientRect().width, header.getBoundingClientRect().height));
			};
			react.useEffect(() => {
				if (!open) return;
				const onResize = () => {
					const panel = panelRef.current;
					const header = headerRef.current;
					if (panel === null || header === null) return;
					const panelRect = panel.getBoundingClientRect();
					const next = clampPosition(panelRect.left, panelRect.top, panelRect.width, header.getBoundingClientRect().height);
					if (next.left !== panelRect.left || next.top !== panelRect.top) props.setPanelPosition(next);
				};
				window.addEventListener("resize", onResize);
				return () => {
					window.removeEventListener("resize", onResize);
				};
			}, [open, props.setPanelPosition]);
			react.useEffect(() => {
				if (!open && releaseActiveDrag()) setDragging(false);
			}, [open]);
			react.useEffect(() => () => {
				releaseActiveDrag();
			}, []);
			react.useEffect(() => {
				if (open) setHistory(readHistory().slice(0, 8));
			}, [open]);
			if (!open) return null;
			const submitDeepread = props.submitDeepread;
			const buildTarget = () => {
				const link = url.trim();
				const pasted = text.trim();
				const filePath = path.trim();
				if (link === "" && pasted === "" && filePath === "") return { error: "请填写链接、粘贴文本，或提供文件路径（三者其一）" };
				if (typeof submitDeepread !== "function") return { error: "精读提交通道不可用，请直接对对话说：请用 deepread 精读 <内容>" };
				if (pasted !== "") return { target: "正文如下：\n" + pasted };
				if (/^https?:\/\//i.test(link) || link.startsWith("mp.weixin.qq.com") || link.includes("weixin.qq.com")) return { target: "链接：" + link };
				if (filePath !== "") return { target: "文件路径：" + filePath };
				if (link !== "") return { target: "文件路径：" + link };
				return { error: "无法识别输入内容" };
			};
			const submit = () => {
				const built = buildTarget();
				if (built.error !== void 0) {
					setError(built.error);
					return;
				}
				const target = built.target;
				const depthLabel = DEPTH_LABELS[depth] || depth;
				const exportLabel = {
					none: "不导出，仅会话展示",
					md: "MD",
					mm: "思维导图",
					html: "网页",
					all: "全部"
				}[exportFmt] || exportFmt;
				let instruction = "请使用 deepread 工具精读以下内容（模式：" + depthLabel + "；导出：" + exportLabel;
				if (focus.trim() !== "") instruction += "；关注重点：" + focus.trim();
				instruction += "）。\n" + target;
				const failure = submitDeepread(instruction);
				if (failure !== null) {
					setError(failure);
					return;
				}
				props.closePanel();
			};
			const preflightBudget = async () => {
				const built = buildTarget();
				if (built.error !== void 0) {
					setError(built.error);
					return;
				}
				setBudget({
					status: "loading",
					line: "预算计算中…",
					data: null
				});
				setError(null);
				setNote(null);
				try {
					const res = await fetch("/api/deepread/budget", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							url: url.trim(),
							path: path.trim(),
							text: text.trim()
						})
					});
					let data = null;
					try {
						data = await res.json();
					} catch (err) {
						data = null;
					}
					if (!res.ok || !isRecord(data)) {
						setBudget({
							status: "error",
							line: "预算预检失败：HTTP " + res.status,
							data: null
						});
						return;
					}
					if (data.ok !== true) {
						setBudget({
							status: "error",
							line: typeof data.error === "string" && data.error !== "" ? data.error : "预算预检失败",
							data: null
						});
						return;
					}
					if (!isBudgetSuccess(data)) {
						setBudget({
							status: "error",
							line: "预算预检失败：结果格式无效",
							data: null
						});
						return;
					}
					setBudget({
						status: "done",
						line: "",
						data
					});
				} catch (err) {
					setBudget({
						status: "error",
						line: "预算预检失败：" + errorMessage(err),
						data: null
					});
				}
			};
			const depthOption = (value) => {
				const full = DEPTH_LABELS[value] !== void 0 ? DEPTH_LABELS[value] : value;
				const est = budgetModes !== null && budgetModes[value] !== void 0 ? budgetModes[value] : null;
				const label = est !== null ? full + " (" + formatTokens(est.totalTokens) + " · " + formatMinutes(est.minutes) + ")" : full;
				return react.createElement("button", {
					type: "button",
					className: "dr-depth" + (depth === value ? " dr-depth-on" : ""),
					key: value,
					onClick: () => setDepth(value)
				}, label);
			};
			const exportOption = (value, label) => react.createElement("button", {
				type: "button",
				className: "dr-export" + (exportFmt === value ? " dr-export-on" : ""),
				key: value,
				onClick: () => setExportFmt(value)
			}, label);
			const reread = (item) => {
				if (item !== null && typeof item === "object" && typeof item.source === "string" && item.source !== "") setText(item.source);
				if (panelRef.current !== null && panelRef.current !== void 0) panelRef.current.scrollTop = 0;
			};
			const calib = readCalibration();
			const hasText = text.trim() !== "";
			const hasTarget = url.trim() !== "" || path.trim() !== "";
			const budgetModes = hasText ? estimateModes(text, calib.rate, calib.latency) : null;
			let budgetLine = "预算：输入内容后自动计算";
			if (budgetModes !== null && budgetModes[depth] !== void 0) budgetLine = "预算：" + formatTokens(budgetModes[depth].totalTokens) + " · " + formatMinutes(budgetModes[depth].minutes);
			else if (hasTarget) budgetLine = "预算：链接/文件点「预算预检」立即查看";
			let displayLine = budgetLine;
			let budgetCls = "dr-budget";
			if (budget?.status === "loading") displayLine = budget.line;
			else if (budget?.status === "error") {
				displayLine = budget.line;
				budgetCls += " dr-budget-error";
			} else if (budget?.status === "done") {
				const d = budget.data;
				const row = (Array.isArray(d.modes) ? d.modes : []).find((m) => m !== null && typeof m === "object" && m.mode === depth) || null;
				const chars = typeof d.chars === "number" ? d.chars : 0;
				if (row !== null && typeof row.totalTokens === "number") displayLine = "预算：约 " + chars + " 字 · " + formatTokens(row.totalTokens) + " · " + formatMinutes(row.minutes);
				else displayLine = "预算：约 " + chars + " 字（结果解析失败）";
				budgetCls += " dr-budget-result";
			}
			return react.createElement("div", {
				id: "deepread-panel",
				className: "dr-panel" + (dragging ? " dr-panel-dragging" : ""),
				ref: panelRef,
				style: position === null ? void 0 : {
					left: position.left,
					top: position.top,
					right: "auto"
				}
			}, react.createElement("div", {
				className: "dr-panel-head",
				ref: headerRef,
				onPointerDown,
				onPointerMove,
				onPointerUp: (event) => {
					finishDrag(event, true);
				},
				onPointerCancel: (event) => {
					finishDrag(event, true);
				},
				onLostPointerCapture: (event) => {
					finishDrag(event, false);
				}
			}, react.createElement("span", null, "📖 精读助手"), react.createElement("button", {
				type: "button",
				className: "dr-close",
				title: "关闭精读助手",
				"aria-label": "关闭精读助手",
				onClick: props.togglePanel
			}, "✕")), react.createElement("input", {
				className: "dr-input",
				placeholder: "微信公众号文章链接（mp.weixin.qq.com，需稳定链接）",
				value: url,
				onChange: (event) => setUrl(event.target.value)
			}), react.createElement("textarea", {
				className: "dr-input dr-textarea",
				placeholder: "或粘贴要精读的文章 / 章节内容…",
				rows: 6,
				value: text,
				onChange: (event) => setText(event.target.value)
			}), react.createElement("input", {
				className: "dr-input",
				placeholder: "或填写文件路径（.txt / .md / .pdf），如 notes/第一章.md",
				value: path,
				onChange: (event) => setPath(event.target.value)
			}), react.createElement(Section, {
				title: "📚 最近读过",
				count: history.length,
				defaultOpen: true
			}, history.length === 0 ? react.createElement("div", { className: "dr-history-empty" }, "还没有精读记录，完成一次精读后会自动出现在这里。") : null, react.createElement("div", { className: "dr-history" }, history.map((item, i) => react.createElement(HistoryItem, {
				item,
				onReread: reread,
				key: "h-" + i
			})))), react.createElement("div", { className: budgetCls }, displayLine), react.createElement("div", { className: "dr-row" }, react.createElement("span", { className: "dr-label" }, "深度"), depthOption("quick"), depthOption("deep"), depthOption("map"), depthOption("feynman"), depthOption("book")), react.createElement("div", { className: "dr-row" }, react.createElement("span", { className: "dr-label" }, "导出"), exportOption("none", "仅会话"), exportOption("md", "MD"), exportOption("mm", "导图"), exportOption("html", "网页"), exportOption("all", "全部")), react.createElement("input", {
				className: "dr-input",
				placeholder: "关注重点（可选），如：论证逻辑 / 研究方法",
				value: focus,
				onChange: (event) => setFocus(event.target.value)
			}), react.createElement("div", { className: "dr-row" }, react.createElement("button", {
				type: "button",
				className: "dr-submit",
				onClick: submit
			}, "开始精读"), react.createElement("button", {
				type: "button",
				className: "dr-preflight",
				onClick: preflightBudget,
				disabled: budget?.status === "loading"
			}, "🔍 预算预检")), error !== null ? react.createElement("div", { className: "dr-error" }, String(error)) : null, note !== null ? react.createElement("div", { className: "dr-note" }, String(note)) : null);
		}
		//#endregion
		//#region src/client/index.ts
		function submitFromContext(ctx) {
			return (instruction) => {
				try {
					const currentId = ctx.sessions.list.getSnapshot().current;
					if (currentId === void 0) return "当前没有打开的会话，请先在对话中打开一个会话";
					const sessionCtx = ctx.sessions.scope(currentId);
					if (sessionCtx === void 0) return "精读提交通道不可用，请直接对对话说：请用 deepread 精读 <内容>";
					const input = ctx.conversation.input.for(sessionCtx);
					input.setDraft(instruction);
					input.submit("queue");
					return null;
				} catch (error) {
					return errorMessage(error);
				}
			};
		}
		const inject = [
			"slots",
			"sessions",
			"conversation"
		];
		function apply(ctx) {
			ctx.effect(() => injectCss(CSS), "dsh-deepread: styles");
			const submitDeepread = submitFromContext(ctx);
			const panelState = createPanelState();
			const panelFace = {
				hooks: { panelState: panelState.source },
				togglePanel: panelState.actions.togglePanel
			};
			ctx.slots.inject("shell.overlay", () => {
				return ctx.slots.register({
					name: "shell.overlay",
					id: "deepread-panel",
					order: 10,
					label: "精读助手面板",
					inject: () => ({
						...panelFace,
						closePanel: panelState.actions.closePanel,
						setPanelPosition: panelState.actions.setPanelPosition,
						submitDeepread
					})
				}, Panel);
			});
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "deepread-composer",
				order: 30,
				label: "精读",
				inject: () => panelFace
			}, ComposerButton));
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "deepread"
			}, DeepReadCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map