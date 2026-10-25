// ==UserScript==
// @name         BiliRemark
// @namespace    https://github.com/YoinSama/BiliRemark
// @version      1.6.2
// @author       Yoin
// @description  B 站网页端本地用户备注：给 UP 主 / 评论者打只属于你自己的备注，数据不出本机。
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/YoinSama/BiliRemark/main/dist/BiliRemark.user.js
// @updateURL    https://raw.githubusercontent.com/YoinSama/BiliRemark/main/dist/BiliRemark.user.js
// @match        https://www.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://t.bilibili.com/*
// @match        https://live.bilibili.com/*
// @match        https://message.bilibili.com/*
// @match        https://search.bilibili.com/*
// @connect      api.bilibili.com
// @grant        GM_addValueChangeListener
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
	"use strict";
	var STORAGE = {
		data: "brmk.data.v1",
		settings: "brmk.settings.v1",
		meta: "brmk.meta.v1",
		backupPrefix: "brmk.data.backup."
	};
	var LIMITS = {
		remark: 50,
		tag: 16,
		tags: 5,
		note: 500,
		records: 5e3,
		warnBytes: 4194304
	};
	var DEFAULT_SETTINGS = {
		schema: 1,
		enabled: true,
		scenes: {
			videoUp: true,
			comment: true,
			space: true,
			dynamic: true,
			card: true,
			live: false,
			relation: true,
			message: true
		},
		display: {
			position: "afterName",
			showTags: true,
			showColorDot: true,
			maxTags: 3,
			replaceNickname: false,
			showOnHoverOnly: false
		},
		editor: {
			entry: "clickBadge",
			hotkey: "Alt+R"
		},
		manager: {
			pageSize: 50,
			theme: "auto",
			zIndex: 99999
		},
		backup: {
			lastExportAt: 0,
			remindIntervalDays: 30
		},
		advanced: {
			observerDebounceMs: 150,
			maxNodesPerTick: 50,
			debug: false
		}
	};
	var TAG_PRESET_COLORS = [
		"#FB7299",
		"#FF7F50",
		"#F5C242",
		"#7BC96F",
		"#3FA9F5",
		"#9B7BFF",
		"#FF6B6B",
		"#8C8C8C"
	];
	var handlers = new Map();
	function on(event, fn) {
		let set = handlers.get(event);
		if (!set) {
			set = new Set();
			handlers.set(event, set);
		}
		set.add(fn);
		return () => {
			set?.delete(fn);
		};
	}
	function emit(event, payload) {
		const set = handlers.get(event);
		if (!set) return;
		for (const fn of Array.from(set)) try {
			fn(payload);
		} catch (err) {
			console.warn("[BiliRemark] 事件处理异常", event, err);
		}
	}
	var debugEnabled = false;
	function setDebug(on) {
		debugEnabled = on;
	}
	function log(...args) {
		if (debugEnabled) console.log("%c[BiliRemark]", "color:#FB7299", ...args);
	}
	function warn(...args) {
		console.warn("[BiliRemark]", ...args);
	}
	function guard(label, fn, fallback) {
		try {
			return fn();
		} catch (err) {
			warn(`模块 ${label} 异常：`, err);
			return fallback;
		}
	}
	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}
	function readRaw() {
		try {
			const raw = GM_getValue(STORAGE.settings, null);
			if (typeof raw === "string") try {
				return JSON.parse(raw);
			} catch {
				return null;
			}
			return raw;
		} catch (err) {
			warn("读取设置失败，使用默认设置", err);
			return null;
		}
	}
	function num(value, fallback, min, max) {
		const n = typeof value === "number" ? value : Number(value);
		if (!Number.isFinite(n)) return fallback;
		return Math.min(max, Math.max(min, Math.round(n)));
	}
	function bool(value, fallback) {
		return typeof value === "boolean" ? value : fallback;
	}
	function mergeSettings(base, raw) {
		if (!raw || typeof raw !== "object") return base;
		const r = raw;
		base.enabled = bool(r.enabled, base.enabled);
		if (r.scenes && typeof r.scenes === "object") for (const key of Object.keys(base.scenes)) base.scenes[key] = bool(r.scenes[key], base.scenes[key]);
		const MIGRATION_SCENE_DEFAULTS = "sceneDefaults20261025";
		const storedMigrations = r.migrations && typeof r.migrations === "object" ? r.migrations : {};
		if (!storedMigrations[MIGRATION_SCENE_DEFAULTS]) {
			base.scenes.relation = DEFAULT_SETTINGS.scenes.relation;
			base.scenes.message = DEFAULT_SETTINGS.scenes.message;
			base.scenes.live = DEFAULT_SETTINGS.scenes.live;
		}
		base.migrations = {
			...storedMigrations,
			[MIGRATION_SCENE_DEFAULTS]: true
		};
		if (r.display && typeof r.display === "object") {
			const d = r.display;
			base.display.position = "afterName";
			base.display.showTags = bool(d.showTags, base.display.showTags);
			base.display.showColorDot = bool(d.showColorDot, base.display.showColorDot);
			base.display.maxTags = num(d.maxTags, base.display.maxTags, 0, 5);
			base.display.replaceNickname = false;
			base.display.showOnHoverOnly = bool(d.showOnHoverOnly, base.display.showOnHoverOnly);
		}
		if (r.editor && typeof r.editor === "object") {
			base.editor.entry = "clickBadge";
			base.editor.hotkey = typeof r.editor.hotkey === "string" && r.editor.hotkey.trim() ? r.editor.hotkey.trim() : base.editor.hotkey;
		}
		if (r.manager && typeof r.manager === "object") {
			const m = r.manager;
			base.manager.pageSize = num(m.pageSize, base.manager.pageSize, 10, 500);
			base.manager.theme = m.theme === "dark" || m.theme === "light" ? m.theme : "auto";
			base.manager.zIndex = num(m.zIndex, base.manager.zIndex, 1e3, 2147483e3);
		}
		if (r.backup && typeof r.backup === "object") {
			const b = r.backup;
			base.backup.lastExportAt = num(b.lastExportAt, 0, 0, Number.MAX_SAFE_INTEGER);
			base.backup.remindIntervalDays = num(b.remindIntervalDays, base.backup.remindIntervalDays, 0, 365);
		}
		if (r.advanced && typeof r.advanced === "object") {
			const a = r.advanced;
			base.advanced.observerDebounceMs = num(a.observerDebounceMs, base.advanced.observerDebounceMs, 50, 2e3);
			base.advanced.maxNodesPerTick = num(a.maxNodesPerTick, base.advanced.maxNodesPerTick, 5, 200);
			base.advanced.debug = bool(a.debug, base.advanced.debug);
		}
		return base;
	}
	var cache = null;
	function getSettings() {
		if (!cache) {
			cache = mergeSettings(clone(DEFAULT_SETTINGS), readRaw());
			cache.schema = 1;
			setDebug(cache.advanced.debug);
		}
		return cache;
	}
	function saveSettings() {
		const settings = getSettings();
		try {
			GM_setValue(STORAGE.settings, settings);
		} catch (err) {
			warn("保存设置失败", err);
		}
	}
	function updateSettings(mutator) {
		const settings = getSettings();
		mutator(settings);
		setDebug(settings.advanced.debug);
		saveSettings();
		emit("settings-changed", settings);
	}
	function reloadSettings(remoteValue) {
		cache = mergeSettings(clone(DEFAULT_SETTINGS), remoteValue);
		cache.schema = 1;
		setDebug(cache.advanced.debug);
		emit("settings-changed", cache);
	}
	function resetSettings() {
		cache = clone(DEFAULT_SETTINGS);
		saveSettings();
		emit("settings-changed", cache);
	}
	function qs(sel, root = document) {
		try {
			return root.querySelector(sel);
		} catch {
			return null;
		}
	}
	function qsa(sel, root = document) {
		try {
			return Array.from(root.querySelectorAll(sel));
		} catch {
			return [];
		}
	}
	function h(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== void 0) node.textContent = text;
		return node;
	}
	function truncate(text, max) {
		const s = text ?? "";
		return s.length > max ? s.slice(0, max - 1) + "…" : s;
	}
	function isVisible(el) {
		if (!el) return false;
		const r = el.getBoundingClientRect();
		if (r.width <= 0 && r.height <= 0) return false;
		const cs = getComputedStyle(el);
		return cs.visibility !== "hidden" && cs.display !== "none";
	}
	function closestDeep(node, selector) {
		let cur = node;
		let guard = 0;
		while (cur && guard++ < 64) {
			if (cur.nodeType === Node.ELEMENT_NODE) {
				const hit = cur.closest(selector);
				if (hit) return hit;
			}
			const parent = cur.parentNode;
			if (parent) {
				cur = parent;
				continue;
			}
			cur = cur.host ?? null;
		}
		return null;
	}
	function queryDeepAll(root, selector, opts = {}) {
		const maxDepth = opts.maxDepth ?? 8;
		const limit = opts.limit ?? 500;
		const out = [];
		const seen = new Set();
		const walk = (scope, depth) => {
			if (out.length >= limit || depth > maxDepth) return;
			out.push(...qsa(selector, scope));
			if (out.length >= limit) return;
			const elems = qsa("*", scope);
			for (const el of elems) {
				if (out.length >= limit) break;
				const sr = el.shadowRoot;
				if (sr && !seen.has(sr)) {
					seen.add(sr);
					walk(sr, depth + 1);
				}
			}
		};
		walk(root, 0);
		return out.slice(0, limit);
	}
	var MID_RE = /space\.bilibili\.com\/(\d{1,20})/;
	function midFromHref(href) {
		if (!href) return null;
		const m = MID_RE.exec(href);
		return m ? m[1] : null;
	}
	var MID_ATTRS = [
		"data-mid",
		"data-user-id",
		"data-uid",
		"data-userid"
	];
	function midFromAttrs(el) {
		for (const attr of MID_ATTRS) {
			const v = el.getAttribute(attr);
			if (v && /^\d{1,20}$/.test(v.trim()) && v.trim() !== "0") return v.trim();
		}
		return null;
	}
	function resolveFromElement(el, opts = {}) {
		const own = midFromAttrs(el);
		if (own) return {
			mid: own,
			source: "attr"
		};
		const selfMid = midFromHref(el.getAttribute("href"));
		if (selfMid) return {
			mid: selfMid,
			source: "href"
		};
		const link = closestDeep(el, "a[href*=\"space.bilibili.com/\"]");
		if (link) {
			const mid = midFromHref(link.getAttribute("href"));
			if (mid) return {
				mid,
				source: "href"
			};
		}
		const attrHost = closestDeep(el, "[data-mid], [data-user-id], [data-uid], [data-userid]");
		if (attrHost) {
			const mid = midFromAttrs(attrHost);
			if (mid) return {
				mid,
				source: "attr"
			};
		}
		if (opts.allowDescendant !== false) for (const a of queryDeepAll(el, "a[href*=\"space.bilibili.com/\"]", {
			maxDepth: 4,
			limit: 10
		})) {
			const mid = midFromHref(a.getAttribute("href"));
			if (mid) return {
				mid,
				source: "descendant"
			};
		}
		return null;
	}
	function pageWindow() {
		try {
			if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
		} catch {}
		try {
			return window;
		} catch {
			return null;
		}
	}
	function pageState() {
		const w = pageWindow();
		if (!w) return null;
		try {
			const s = w.__INITIAL_STATE__;
			return s && typeof s === "object" ? s : null;
		} catch {
			return null;
		}
	}
	function pickMid(value) {
		if (typeof value === "number") {
			const s = String(value);
			return /^\d{1,20}$/.test(s) && s !== "0" ? s : null;
		}
		if (typeof value === "string" && /^\d{1,20}$/.test(value.trim()) && value.trim() !== "0") return value.trim();
		return null;
	}
	function pageUpMid() {
		const w = pageWindow();
		if (!w) return null;
		try {
			const s = w.__INITIAL_STATE__;
			if (!s || typeof s !== "object") return null;
			const candidates = [
				s.upData?.mid,
				s.upData?.midNum,
				s.videoData?.owner?.mid,
				s.videoData?.upInfo?.mid,
				s.mediaInfo?.up_info?.mid,
				s.epInfo?.up_info?.mid,
				s.upInfo?.mid
			];
			for (const c of candidates) {
				const mid = pickMid(c);
				if (mid) return mid;
			}
		} catch (err) {
			log("读取页面状态失败", err);
		}
		return null;
	}
	function pageUpName() {
		const w = pageWindow();
		if (!w) return "";
		try {
			const s = w.__INITIAL_STATE__;
			const name = s?.upData?.name ?? s?.videoData?.owner?.name ?? s?.mediaInfo?.up_info?.uname ?? s?.epInfo?.up_info?.uname ?? "";
			return typeof name === "string" ? name : "";
		} catch {
			return "";
		}
	}
	function pageUrlMid() {
		return midFromHref(location.href);
	}
	function snapshotNickname(anchor) {
		return (anchor.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
	}
	var nickCache = new Map();
	function rememberNick(mid, nickname) {
		const nick = (nickname || "").trim();
		if (!mid || !nick) return;
		if (!nickCache.has(mid)) nickCache.set(mid, nick);
	}
	var faceCache = new Map();
	function rememberFace(mid, face) {
		const url = (face || "").trim();
		if (!mid || !url) return;
		if (!faceCache.has(mid)) {
			faceCache.set(mid, url);
			emit("face-seen", {
				mid,
				url
			});
		}
	}
	function faceOf(mid) {
		return faceCache.get(mid);
	}
	var diagnostics = new Map();
	function setDiagnostic(diag) {
		diagnostics.set(diag.scene, diag);
	}
	function getDiagnostics() {
		return Array.from(diagnostics.values());
	}
	function pad2(n) {
		return n < 10 ? "0" + n : String(n);
	}
	function formatTime(ts) {
		if (!ts) return "—";
		const d = new Date(ts);
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
	}
	function formatDay(ts) {
		if (!ts) return "—";
		const d = new Date(ts);
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	}
	function relativeTime(ts, now = Date.now()) {
		if (!ts) return "—";
		const diff = Math.max(0, now - ts);
		const min = 6e4;
		const hour = 60 * min;
		const day = 24 * hour;
		if (diff < min) return "刚刚";
		if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
		if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
		if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
		return formatDay(ts);
	}
	function daysSince(ts, now = Date.now()) {
		if (!ts) return Number.POSITIVE_INFINITY;
		return Math.floor((now - ts) / 864e5);
	}
	function byteLength(text) {
		try {
			return new TextEncoder().encode(text).length;
		} catch {
			return text.length;
		}
	}
	function formatBytes(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	}
	function csvCell(value) {
		const s = value === null || value === void 0 ? "" : String(value);
		return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
	}
	function downloadText(filename, text, mime) {
		const blob = new Blob([text], { type: mime + ";charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.style.display = "none";
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			a.remove();
			URL.revokeObjectURL(url);
		}, 1e3);
	}
	function stampForFile(ts = Date.now()) {
		const d = new Date(ts);
		return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
	}
	function now() {
		return Date.now();
	}
	function asString(value, fallback = "") {
		return typeof value === "string" ? value : fallback;
	}
	function timeOf(value, fallback) {
		const n = typeof value === "number" ? value : Number(value);
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
	}
	function normalizeMid(value) {
		const raw = String(value ?? "").trim();
		if (!/^\d{1,20}$/.test(raw)) return null;
		if (raw === "0") return null;
		return raw;
	}
	function normalizeTags(value) {
		const arr = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\s]+/) : [];
		const out = [];
		for (const item of arr) {
			const tag = String(item ?? "").trim().slice(0, LIMITS.tag);
			if (!tag) continue;
			if (out.includes(tag)) continue;
			out.push(tag);
			if (out.length >= LIMITS.tags) break;
		}
		return out;
	}
	function normalizeColor(value) {
		if (typeof value !== "string") return null;
		const v = value.trim();
		if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
		if (/^rgba?\([\d\s.,%]+\)$/.test(v)) return v;
		return null;
	}
	function normalizeRecord(input, fallbackNow = now()) {
		const mid = normalizeMid(input.mid);
		if (!mid) return null;
		const createdAt = timeOf(input.createdAt, fallbackNow);
		const updatedAt = timeOf(input.updatedAt, createdAt);
		const firstSeenRaw = input.firstSeen;
		const firstSeen = firstSeenRaw && typeof firstSeenRaw === "object" ? {
			scene: asString(firstSeenRaw.scene, "manual") || "manual",
			url: asString(firstSeenRaw.url, "")
		} : void 0;
		return {
			mid,
			remark: asString(input.remark).trim().slice(0, LIMITS.remark),
			tags: normalizeTags(input.tags),
			color: normalizeColor(input.color),
			note: asString(input.note).slice(0, LIMITS.note),
			nickSnapshot: asString(input.nickSnapshot).slice(0, 100),
			faceSnapshot: asString(input.faceSnapshot).slice(0, 500),
			createdAt,
			updatedAt,
			...firstSeen ? { firstSeen } : {}
		};
	}
	function emptyData() {
		return {
			schema: 1,
			updatedAt: now(),
			users: {}
		};
	}
	function parseData(raw) {
		let value = raw;
		if (typeof value === "string") try {
			value = JSON.parse(value);
		} catch {
			return {
				data: emptyData(),
				corrupted: true
			};
		}
		if (!value || typeof value !== "object") return {
			data: emptyData(),
			corrupted: false
		};
		const obj = value;
		const users = {};
		const rawUsers = obj.users;
		if (rawUsers && typeof rawUsers === "object") for (const [key, item] of Object.entries(rawUsers)) {
			if (!item || typeof item !== "object") continue;
			const rec = normalizeRecord({
				...item,
				mid: item.mid ?? key
			});
			if (rec) users[rec.mid] = rec;
		}
		return {
			data: {
				schema: 1,
				updatedAt: timeOf(obj.updatedAt, now()),
				users
			},
			corrupted: false
		};
	}
	var RemarkStore = class {
		constructor() {
			this.data = emptyData();
			this.saveTimer = null;
			this.loaded = false;
			this.dirty = false;
			this.lastError = null;
		}
		load() {
			if (this.loaded) return;
			this.loaded = true;
			try {
				const raw = GM_getValue(STORAGE.data, null);
				const { data, corrupted } = parseData(raw);
				this.data = data;
				if (corrupted) {
					try {
						GM_setValue(STORAGE.backupPrefix + now(), raw);
					} catch {}
					this.lastError = "本地数据无法解析，已另存原始备份并启用空数据";
					warn(this.lastError);
				}
			} catch (err) {
				warn("读取备注数据失败", err);
				this.lastError = "读取备注数据失败（存储不可用？）";
				this.data = emptyData();
			}
		}
		get users() {
			return this.data.users;
		}
		get count() {
			return Object.keys(this.data.users).length;
		}
		get(mid) {
			return this.data.users[mid];
		}
		all() {
			return Object.values(this.data.users);
		}
		upsert(input, meta = {}) {
			const existing = input.mid !== void 0 ? this.data.users[String(input.mid)] : void 0;
			const ts = now();
			const colorValue = "color" in input ? input.color : existing?.color;
			const merged = normalizeRecord({
				mid: input.mid,
				remark: input.remark ?? existing?.remark,
				tags: input.tags ?? existing?.tags,
				color: colorValue,
				note: input.note ?? existing?.note,
				nickSnapshot: meta.nickSnapshot ?? input.nickSnapshot ?? existing?.nickSnapshot,
				faceSnapshot: meta.faceSnapshot ?? input.faceSnapshot ?? existing?.faceSnapshot,
				createdAt: existing?.createdAt ?? ts,
				updatedAt: ts,
				firstSeen: existing?.firstSeen ?? (meta.scene ? {
					scene: meta.scene,
					url: meta.url ?? location.href
				} : {
					scene: "manual",
					url: location.href
				})
			}, ts);
			if (!merged) return null;
			this.data.users[merged.mid] = merged;
			this.data.updatedAt = ts;
			this.persistSoon();
			emit("data-changed", {
				reason: "upsert",
				mids: [merged.mid]
			});
			return merged;
		}
		patchFaces(faces) {
			const patched = [];
			for (const [mid, face] of faces) {
				const url = String(face ?? "").trim();
				if (!/^https?:\/\//.test(url)) continue;
				const rec = this.data.users[mid];
				if (!rec || rec.faceSnapshot) continue;
				rec.faceSnapshot = url.slice(0, 500);
				patched.push(mid);
			}
			if (!patched.length) return [];
			this.data.updatedAt = now();
			this.dirty = true;
			this.persistSoon();
			emit("data-changed", {
				reason: "patch-faces",
				mids: patched
			});
			return patched;
		}
		remove(mid) {
			const rec = this.data.users[mid];
			if (!rec) return null;
			delete this.data.users[mid];
			this.data.updatedAt = now();
			this.persistSoon();
			emit("data-changed", {
				reason: "remove",
				mids: [mid]
			});
			return rec;
		}
		removeMany(mids) {
			const removed = [];
			for (const mid of mids) {
				const rec = this.data.users[mid];
				if (rec) {
					delete this.data.users[mid];
					removed.push(rec);
				}
			}
			if (removed.length) {
				this.data.updatedAt = now();
				this.persistSoon();
				emit("data-changed", {
					reason: "remove",
					mids: removed.map((r) => r.mid)
				});
			}
			return removed;
		}
		restore(records) {
			for (const rec of records) this.data.users[rec.mid] = rec;
			this.data.updatedAt = now();
			this.persistSoon();
			emit("data-changed", {
				reason: "restore",
				mids: records.map((r) => r.mid)
			});
		}
		clearAll() {
			this.backupNow("clear");
			this.data = emptyData();
			this.persistSoon();
			emit("data-changed", { reason: "clear" });
		}
		previewImport(records, strategy) {
			let added = 0;
			let updated = 0;
			let skipped = 0;
			const incoming = new Map(records.map((r) => [r.mid, r]));
			for (const rec of incoming.values()) {
				const existing = this.data.users[rec.mid];
				if (!existing) {
					added++;
					continue;
				}
				if (strategy === "replace") updated++;
				else if (strategy === "newer") {
					if (rec.updatedAt > existing.updatedAt) updated++;
					else skipped++;
				} else skipped++;
			}
			let removed = 0;
			if (strategy === "replace") {
				for (const mid of Object.keys(this.data.users)) if (!incoming.has(mid)) removed++;
			}
			return {
				added,
				updated,
				skipped,
				invalid: 0,
				removed
			};
		}
		applyImport(records, strategy) {
			this.backupNow("import");
			const preview = this.previewImport(records, strategy);
			const incoming = new Map(records.map((r) => [r.mid, r]));
			if (strategy === "replace") {
				const next = {};
				for (const rec of incoming.values()) next[rec.mid] = rec;
				this.data.users = next;
			} else if (strategy === "newer") for (const rec of incoming.values()) {
				const existing = this.data.users[rec.mid];
				if (!existing || rec.updatedAt > existing.updatedAt) this.data.users[rec.mid] = rec;
			}
			else for (const rec of incoming.values()) if (!this.data.users[rec.mid]) this.data.users[rec.mid] = rec;
			this.data.updatedAt = now();
			this.dirty = true;
			this.persistNow();
			emit("data-changed", { reason: "import" });
			return preview;
		}
		exportJSON() {
			return JSON.stringify({
				schema: 1,
				exportedAt: now(),
				generator: "BiliRemark",
				users: this.data.users
			}, null, 2);
		}
		exportCSV() {
			const head = [
				"mid",
				"remark",
				"tags",
				"color",
				"note",
				"nickSnapshot",
				"createdAt",
				"updatedAt",
				"firstSeenScene",
				"firstSeenUrl"
			];
			const rows = this.all().sort((a, b) => b.updatedAt - a.updatedAt).map((r) => [
				r.mid,
				r.remark,
				r.tags.join("|"),
				r.color ?? "",
				r.note,
				r.nickSnapshot,
				formatTime(r.createdAt),
				formatTime(r.updatedAt),
				r.firstSeen?.scene ?? "",
				r.firstSeen?.url ?? ""
			].map(csvCell).join(","));
			return "﻿" + [head.join(","), ...rows].join("\r\n");
		}
		stats() {
			const list = this.all();
			const startOfMonth = new Date();
			startOfMonth.setDate(1);
			startOfMonth.setHours(0, 0, 0, 0);
			const monthAdded = list.filter((r) => r.createdAt >= startOfMonth.getTime()).length;
			const tagMap = new Map();
			for (const rec of list) for (const tag of rec.tags) tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
			const tags = Array.from(tagMap.entries()).map(([tag, count]) => ({
				tag,
				count
			})).sort((a, b) => b.count - a.count);
			const bytes = byteLength(JSON.stringify(this.data));
			return {
				count: list.length,
				bytes,
				monthAdded,
				tags
			};
		}
		backupNow(reason) {
			try {
				GM_setValue(`${STORAGE.backupPrefix}${reason}.${now()}`, JSON.stringify(this.data));
			} catch (err) {
				warn("自动备份失败", err);
			}
		}
		replaceFromRemote(value) {
			const { data } = parseData(value);
			this.data = data;
			this.dirty = false;
			emit("data-changed", { reason: "remote" });
		}
		persistSoon() {
			this.dirty = true;
			if (this.saveTimer !== null) clearTimeout(this.saveTimer);
			this.saveTimer = setTimeout(() => {
				this.saveTimer = null;
				this.persistNow();
			}, 250);
		}
		persistNow() {
			if (this.saveTimer !== null) {
				clearTimeout(this.saveTimer);
				this.saveTimer = null;
			}
			if (!this.dirty) return;
			this.dirty = false;
			try {
				GM_setValue(STORAGE.data, this.data);
				this.lastError = null;
			} catch (err) {
				this.dirty = true;
				this.lastError = "写入本地存储失败，可能是容量已满";
				warn(this.lastError, err);
			}
		}
		flush() {
			this.persistNow();
		}
	};
	var store = new RemarkStore();
	var FALLBACK_RGB = [
		251,
		113,
		152
	];
	function parseColor(value) {
		const v = (value || "").trim().toLowerCase();
		if (!v) return null;
		const hex = v.match(/^#([0-9a-f]{3,8})$/);
		if (hex) {
			let h = hex[1];
			if (h.length === 3 || h.length === 4) h = h.split("").slice(0, 3).map((c) => c + c).join("");
			if (h.length < 6) return null;
			return [
				parseInt(h.slice(0, 2), 16),
				parseInt(h.slice(2, 4), 16),
				parseInt(h.slice(4, 6), 16)
			];
		}
		const rgb = v.match(/^rgba?\(([^)]+)\)$/);
		if (rgb) {
			const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
			if (parts.length >= 3) {
				const nums = parts.slice(0, 3).map((p) => p.endsWith("%") ? parseFloat(p) * 255 / 100 : parseFloat(p));
				if (nums.every((n) => Number.isFinite(n))) return [
					Math.round(nums[0]),
					Math.round(nums[1]),
					Math.round(nums[2])
				];
			}
		}
		return null;
	}
	function rgba(rgb, alpha) {
		return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
	}
	function toHex(rgb) {
		return "#" + rgb.map((n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0")).join("");
	}
	function cssVar(name) {
		try {
			return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		} catch {
			return "";
		}
	}
	function relativeLuminance(rgb) {
		const [r, g, b] = rgb.map((n) => {
			const c = n / 255;
			return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
		});
		return .2126 * r + .7152 * g + .0722 * b;
	}
	function luminanceOf(color) {
		const rgb = parseColor(color);
		return rgb ? relativeLuminance(rgb) : null;
	}
	function contrastOf(a, b) {
		const la = relativeLuminance(a);
		const lb = relativeLuminance(b);
		return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05);
	}
	function readableOn(color, bg, min = 4.5) {
		const fg = parseColor(color);
		if (!fg) return color;
		if (contrastOf(fg, bg) >= min) return color;
		const target = relativeLuminance(bg) < .25 ? 255 : 0;
		for (let t = .06; t <= .9; t += .06) {
			const mix = fg.map((v) => v + (target - v) * t);
			if (contrastOf(mix, bg) >= min) return toHex(mix);
		}
		return target === 255 ? "#e9e9e9" : "#18191c";
	}
	function readableBadgeColor(color, dark) {
		if (!dark) return color;
		let c = parseColor(color);
		if (!c) return color;
		const base = [
			31,
			31,
			31
		];
		for (let i = 0; i < 6; i++) {
			const pill = c.map((v, j) => Math.round(v * .14 + base[j] * .86));
			if (contrastOf(c, pill) >= 3) return toHex(c);
			const next = parseColor(readableOn(toHex(c), pill, 3));
			if (!next) break;
			c = next;
		}
		return toHex(c);
	}
	function bgLuminance(color) {
		const m = color.match(/^rgba?\(([^)]+)\)$/);
		if (!m) return null;
		const parts = m[1].split(/[,\s/]+/).filter(Boolean);
		if (parts.length < 3) return null;
		const nums = parts.slice(0, 3).map((p) => p.endsWith("%") ? parseFloat(p) * 255 / 100 : parseFloat(p));
		if (nums.some((n) => !Number.isFinite(n))) return null;
		if (parts.length >= 4) {
			const a = parseFloat(parts[3]);
			if (Number.isFinite(a) && a <= .05) return null;
		}
		return relativeLuminance([
			nums[0],
			nums[1],
			nums[2]
		]);
	}
	function detectDark() {
		if (document.documentElement.classList.contains("dark")) return true;
		if (document.body?.classList.contains("dark")) return true;
		if (document.documentElement.classList.contains("bili_dark")) return true;
		if (document.body?.classList.contains("bili_dark")) return true;
		if (document.documentElement.getAttribute("data-theme") === "dark") return true;
		const scheme = document.querySelector("meta[name=\"color-scheme\"]")?.getAttribute("content")?.trim().toLowerCase();
		if (scheme === "dark") return true;
		if (scheme === "light") return false;
		try {
			for (const el of [document.body, document.documentElement]) {
				if (!el) continue;
				const lum = bgLuminance(getComputedStyle(el).backgroundColor);
				if (lum !== null) return lum < .4;
			}
		} catch {}
		return false;
	}
	function detectTheme() {
		const rawColor = cssVar("--theme-color");
		const rgb = parseColor(rawColor) ?? FALLBACK_RGB;
		return {
			dark: detectDark(),
			color: rawColor || toHex(FALLBACK_RGB),
			rgb,
			evolved: !!rawColor
		};
	}
	function watchTheme(callback) {
		let timer = null;
		const schedule = () => {
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				callback();
			}, 250);
		};
		const obs = new MutationObserver(schedule);
		try {
			obs.observe(document.documentElement, {
				attributes: true,
				attributeFilter: [
					"class",
					"style",
					"data-theme"
				]
			});
			if (document.body) obs.observe(document.body, {
				attributes: true,
				attributeFilter: ["class", "style"]
			});
		} catch {}
		let mq = null;
		const onMq = () => schedule();
		try {
			mq = window.matchMedia("(prefers-color-scheme: dark)");
			mq.addEventListener("change", onMq);
		} catch {}
		return () => {
			obs.disconnect();
			if (mq) mq.removeEventListener("change", onMq);
			if (timer !== null) clearTimeout(timer);
		};
	}
	var SVG_NS = "http://www.w3.org/2000/svg";
	var PATHS = {
		pencil: "M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z",
		bookmark: "M17 3H7a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2z",
		close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
	};
	function icon(name, size = 16) {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("width", String(size));
		svg.setAttribute("height", String(size));
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("focusable", "false");
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", PATHS[name] ?? PATHS.pencil);
		path.setAttribute("fill", "currentColor");
		svg.appendChild(path);
		return svg;
	}
	var root$2 = null;
	function ensureRoot() {
		if (root$2 && root$2.isConnected) return root$2;
		root$2 = document.createElement("div");
		root$2.id = "brmk-toast";
		document.body.appendChild(root$2);
		return root$2;
	}
	function toast(message, options = {}) {
		const host = ensureRoot();
		const item = document.createElement("div");
		item.className = "brmk-toast-item";
		const text = document.createElement("span");
		text.textContent = message;
		item.appendChild(text);
		let timer = null;
		const close = () => {
			if (timer !== null) clearTimeout(timer);
			item.remove();
		};
		if (options.actionLabel && options.onAction) {
			const action = document.createElement("button");
			action.type = "button";
			action.textContent = options.actionLabel;
			action.addEventListener("click", () => {
				close();
				try {
					options.onAction?.();
				} catch (err) {
					console.warn("[BiliRemark] toast action failed", err);
				}
			});
			item.appendChild(action);
		}
		host.appendChild(item);
		timer = setTimeout(close, options.duration ?? 2600);
	}
	var root$1 = null;
	var cleanupFns = [];
	function closeEditor() {
		for (const fn of cleanupFns) fn();
		cleanupFns = [];
		if (root$1) {
			root$1.remove();
			root$1 = null;
		}
	}
	function clampPosition(el, anchor) {
		const margin = 8;
		const rect = el.getBoundingClientRect();
		let left;
		let top;
		if (anchor && anchor.isConnected) {
			const a = anchor.getBoundingClientRect();
			left = a.left;
			top = a.bottom + 6;
			if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, a.top - rect.height - 6);
		} else {
			left = (window.innerWidth - rect.width) / 2;
			top = (window.innerHeight - rect.height) / 2;
		}
		left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin));
		top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
		el.style.left = `${Math.round(left)}px`;
		el.style.top = `${Math.round(top)}px`;
	}
	function openEditor(options = {}) {
		closeEditor();
		const existing = options.mid ? store.get(options.mid) : null;
		const record = options.record ?? existing ?? null;
		let mid = options.mid ?? record?.mid ?? "";
		let tags = record?.tags ? [...record.tags] : [];
		let color = record?.color ?? null;
		const allowMidEdit = options.allowMidEdit ?? !mid;
		const el = h("div");
		el.id = "brmk-editor";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-label", "用户备注");
		el.style.position = "fixed";
		el.style.zIndex = String(Math.max(getSettings().manager.zIndex + 10, 1e4));
		const head = h("div", "brmk-ed-head");
		const titleWrap = h("div");
		const title = h("div", "brmk-ed-title", record ? "编辑备注" : "添加备注");
		const sub = h("div", "brmk-ed-sub", [options.nickname || record?.nickSnapshot || "", mid ? `mid ${mid}` : "尚未选择用户"].filter(Boolean).join(" · "));
		titleWrap.append(title, sub);
		const closeBtn = h("button", "brmk-ed-close", "✕");
		closeBtn.type = "button";
		closeBtn.title = "关闭（Esc）";
		closeBtn.addEventListener("click", () => closeEditor());
		head.append(titleWrap, closeBtn);
		el.appendChild(head);
		const hint = h("div", "brmk-ed-hint", "");
		const midInputWrapper = h("div", "brmk-field");
		const midLabel = h("label", "brmk-label", "用户 mid");
		const midInput = h("input", "brmk-input");
		midInput.type = "text";
		midInput.inputMode = "numeric";
		midInput.placeholder = "纯数字，如 946974";
		midInput.setAttribute("data-field", "mid");
		midInput.value = mid;
		if (!allowMidEdit) {
			midInput.disabled = true;
			midInput.title = "已有记录不可改 mid";
		}
		midInputWrapper.append(midLabel, midInput);
		const remarkField = h("div", "brmk-field");
		const remarkLabel = h("label", "brmk-label", `备注名（≤${LIMITS.remark} 字）`);
		const remarkInput = h("input", "brmk-input");
		remarkInput.type = "text";
		remarkInput.maxLength = LIMITS.remark;
		remarkInput.placeholder = "例如：老番茄 / 某某的另一个号";
		remarkInput.setAttribute("data-field", "remark");
		remarkInput.value = record?.remark ?? "";
		remarkField.append(remarkLabel, remarkInput);
		const tagField = h("div", "brmk-field");
		const tagLabel = h("label", "brmk-label", `标签（≤${LIMITS.tags} 个，回车添加）`);
		const chips = h("div", "brmk-chips");
		const tagInput = h("input", "brmk-input");
		tagInput.type = "text";
		tagInput.maxLength = LIMITS.tag;
		tagInput.placeholder = tags.length >= LIMITS.tags ? "已达标签上限" : "输入后按回车";
		tagInput.setAttribute("data-field", "tag");
		tagField.append(tagLabel, chips, tagInput);
		const renderChips = () => {
			chips.textContent = "";
			tags.forEach((tag, index) => {
				const chip = h("span", "brmk-chip", tag);
				const remove = h("button", "", "×");
				remove.type = "button";
				remove.title = "移除标签";
				remove.addEventListener("click", () => {
					tags.splice(index, 1);
					renderChips();
				});
				chip.appendChild(remove);
				chips.appendChild(chip);
			});
			tagInput.disabled = tags.length >= LIMITS.tags;
			tagInput.placeholder = tags.length >= LIMITS.tags ? "已达标签上限" : "输入后按回车";
		};
		const addTag = () => {
			const raw = tagInput.value.trim().replace(/[,，;；]/g, "");
			tagInput.value = "";
			if (!raw) return;
			if (tags.length >= LIMITS.tags) {
				toast(`最多 ${LIMITS.tags} 个标签`);
				return;
			}
			const tag = truncate(raw, LIMITS.tag);
			if (tags.includes(tag)) return;
			tags.push(tag);
			renderChips();
		};
		tagInput.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" || ev.key === "," || ev.key === "，") {
				ev.preventDefault();
				addTag();
			} else if (ev.key === "Backspace" && !tagInput.value && tags.length) {
				tags.pop();
				renderChips();
			}
		});
		tagInput.addEventListener("blur", () => {
			if (tagInput.value.trim()) addTag();
		});
		renderChips();
		const colorField = h("div", "brmk-field");
		const colorLabel = h("label", "brmk-label", "颜色");
		const colorRow = h("div", "brmk-colors");
		const makeSwatch = (value, titleText) => {
			const btn = h("button", "brmk-swatch");
			btn.type = "button";
			btn.title = titleText;
			btn.setAttribute("aria-pressed", String(color === value));
			btn.style.background = value ?? "transparent";
			if (value === null) btn.style.background = "linear-gradient(135deg, #FB7299 50%, #3FA9F5 50%)";
			btn.addEventListener("click", () => {
				color = value;
				for (const child of Array.from(colorRow.querySelectorAll(".brmk-swatch"))) child.setAttribute("aria-pressed", "false");
				btn.setAttribute("aria-pressed", "true");
				colorInput.value = value ?? "#fb7299";
			});
			return btn;
		};
		colorRow.appendChild(makeSwatch(null, "跟随主题色"));
		for (const preset of TAG_PRESET_COLORS) colorRow.appendChild(makeSwatch(preset, preset));
		const colorInput = h("input", "brmk-color-input");
		colorInput.type = "color";
		colorInput.value = color ?? "#fb7299";
		colorInput.title = "自定义颜色";
		colorInput.addEventListener("input", () => {
			color = colorInput.value;
			for (const child of Array.from(colorRow.querySelectorAll(".brmk-swatch"))) child.setAttribute("aria-pressed", "false");
		});
		colorRow.appendChild(colorInput);
		colorField.append(colorLabel, colorRow);
		const noteField = h("div", "brmk-field");
		const noteLabel = h("label", "brmk-label", `长文本备注（≤${LIMITS.note} 字，仅自己可见）`);
		const noteInput = h("textarea", "brmk-textarea");
		noteInput.maxLength = LIMITS.note;
		noteInput.placeholder = "为什么备注这个人、注意什么……";
		noteInput.setAttribute("data-field", "note");
		noteInput.value = record?.note ?? "";
		noteField.append(noteLabel, noteInput);
		const foot = h("div", "brmk-ed-foot");
		const deleteBtn = h("button", "brmk-btn brmk-btn-danger", "删除");
		deleteBtn.type = "button";
		deleteBtn.setAttribute("data-act", "delete");
		deleteBtn.style.display = record ? "" : "none";
		const cancelBtn = h("button", "brmk-btn", "取消");
		cancelBtn.type = "button";
		cancelBtn.setAttribute("data-act", "cancel");
		const saveBtn = h("button", "brmk-btn brmk-btn-primary", "保存");
		saveBtn.type = "button";
		saveBtn.setAttribute("data-act", "save");
		foot.append(hint, deleteBtn, cancelBtn, saveBtn);
		el.append(midInputWrapper, remarkField, tagField, colorField, noteField, foot);
		const doSave = () => {
			const finalMid = (allowMidEdit ? midInput.value : mid).trim();
			if (!/^\d{1,20}$/.test(finalMid) || finalMid === "0") {
				hint.textContent = "请填写正确的数字 mid";
				midInput.focus();
				return;
			}
			const remark = remarkInput.value.trim();
			const note = noteInput.value;
			if (!remark && !tags.length && !note.trim() && !color) {
				hint.textContent = "备注名、标签、正文至少填一项";
				remarkInput.focus();
				return;
			}
			const saved = store.upsert({
				mid: finalMid,
				remark,
				tags,
				color,
				note,
				nickSnapshot: options.nickname ?? record?.nickSnapshot ?? "",
				faceSnapshot: options.face ?? faceOf(finalMid) ?? record?.faceSnapshot ?? ""
			}, {
				scene: options.scene ?? "manual",
				url: location.href
			});
			if (!saved) {
				hint.textContent = "保存失败，请检查输入";
				return;
			}
			mid = finalMid;
			toast(record ? "备注已更新" : "备注已保存");
			closeEditor();
			options.onSaved?.(saved);
		};
		const doDelete = () => {
			if (!mid) return;
			const removed = store.remove(mid);
			if (removed) {
				toast("备注已删除", {
					actionLabel: "撤销",
					duration: 5e3,
					onAction: () => store.restore([removed])
				});
				options.onDeleted?.(mid);
			}
			closeEditor();
		};
		saveBtn.addEventListener("click", doSave);
		cancelBtn.addEventListener("click", () => closeEditor());
		deleteBtn.addEventListener("click", doDelete);
		el.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
				ev.preventDefault();
				doSave();
			}
		});
		document.body.appendChild(el);
		root$1 = el;
		requestAnimationFrame(() => {
			if (root$1 !== el) return;
			clampPosition(el, options.anchor ?? null);
			if (allowMidEdit && !mid) midInput.focus();
			else remarkInput.focus();
		});
		const onKey = (ev) => {
			if (ev.key === "Escape") {
				ev.stopPropagation();
				closeEditor();
			}
		};
		const onPointer = (ev) => {
			if (!root$1) return;
			const target = ev.target;
			if (target && !root$1.contains(target)) closeEditor();
		};
		const onResize = () => {
			if (root$1) clampPosition(root$1, options.anchor ?? null);
		};
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("pointerdown", onPointer, true);
		window.addEventListener("resize", onResize);
		cleanupFns.push(() => document.removeEventListener("keydown", onKey, true), () => document.removeEventListener("pointerdown", onPointer, true), () => window.removeEventListener("resize", onResize));
	}
	var SLOTS = ["badge", "pencil"];
	var GAP = 6;
	var MIN_W = 60;
	var INLINE_MIN_W = 34;
	var MARGIN = 4;
	var POLL_MS = 200;
	var byAnchor = new Map();
	var byEl = new WeakMap();
	var lastPos = new WeakMap();
	var docRect = new WeakMap();
	var layer = null;
	var rafId = 0;
	var pollTimer = null;
	var bound = false;
	function ensureLayer() {
		if (layer && layer.isConnected) return layer;
		if (!document.body) return null;
		let el = document.getElementById("brmk-layer");
		if (!el) {
			el = document.createElement("div");
			el.id = "brmk-layer";
			document.body.appendChild(el);
		}
		el.style.zIndex = String(Math.max(1e3, getSettings().manager.zIndex - 2));
		layer = el;
		return layer;
	}
	function onViewportChange() {
		schedule();
	}
	function onScroll(ev) {
		const t = ev.target;
		if (!t || t === document || t === document.documentElement) {
			refreshVisibility();
			return;
		}
		schedule();
	}
	function refreshVisibility() {
		const sx = window.scrollX;
		const sy = window.scrollY;
		const vw = document.documentElement.clientWidth || window.innerWidth;
		const vh = window.innerHeight;
		for (const slots of byAnchor.values()) for (const slot of SLOTS) {
			const el = slots[slot];
			if (!el || !el.isConnected) continue;
			const c = docRect.get(el);
			if (!c || !c.ok) continue;
			if (c.y + c.h < sy - 8 || c.y > sy + vh + 8 || c.x + c.w < sx - 8 || c.x > sx + vw + 8) hide(el);
			else show(el);
		}
	}
	function bind$1() {
		if (bound) return;
		bound = true;
		window.addEventListener("scroll", onScroll, {
			passive: true,
			capture: true
		});
		window.addEventListener("resize", onViewportChange, { passive: true });
		try {
			window.visualViewport?.addEventListener("resize", onViewportChange, { passive: true });
		} catch {}
	}
	function ensurePoll() {
		if (pollTimer !== null) return;
		pollTimer = window.setInterval(() => {
			if (document.hidden) return;
			sync();
		}, POLL_MS);
	}
	function stopPoll() {
		if (pollTimer === null) return;
		window.clearInterval(pollTimer);
		pollTimer = null;
	}
	function clamp(value, min, max) {
		return Math.min(Math.max(value, min), Math.max(min, max));
	}
	function hide(el) {
		if (el.style.visibility === "hidden") return;
		el.style.visibility = "hidden";
		el.style.pointerEvents = "none";
		lastPos.delete(el);
	}
	function show(el) {
		if (el.style.visibility !== "hidden") return;
		el.style.visibility = "visible";
		el.style.pointerEvents = "";
	}
	function blockedBySibling(anchor, x, y, w, h) {
		const parent = anchor.parentElement;
		if (!parent) return false;
		const right = x + w;
		const bottom = y + h;
		let checked = 0;
		for (const sib of Array.from(parent.children)) {
			if (sib === anchor) continue;
			if (sib.classList.contains("brmk-badge") || sib.classList.contains("brmk-pencil")) continue;
			if (checked++ >= 8) break;
			const s = sib.getBoundingClientRect();
			if (!s.width && !s.height) continue;
			if (x < s.right && right > s.left && y < s.bottom && bottom > s.top) return true;
		}
		return false;
	}
	function rowRightOf(anchor) {
		const own = anchor.getBoundingClientRect();
		const parent = anchor.parentElement;
		if (!parent) return own.right;
		let right = own.right;
		let n = 0;
		for (const sib of Array.from(parent.children)) {
			if (n++ >= 12) break;
			const s = sib.getBoundingClientRect();
			if (s.width || s.height) right = Math.max(right, s.right);
		}
		return right;
	}
	function lastTextRect(anchor) {
		try {
			const range = document.createRange();
			range.selectNodeContents(anchor);
			const rects = range.getClientRects();
			if (!rects.length) return null;
			const last = rects[rects.length - 1];
			return {
				right: last.right,
				top: last.top,
				height: last.height
			};
		} catch {
			return null;
		}
	}
	function place(anchor, el, vw, vh, lrx, lry) {
		const r = anchor.getBoundingClientRect();
		if (!r.width && !r.height) {
			hide(el);
			docRect.set(el, {
				x: 0,
				y: 0,
				w: 0,
				h: 0,
				ok: false
			});
			return;
		}
		if (r.bottom < -8 || r.top > vh + 8 || r.right < -8 || r.left > vw + 8) {
			hide(el);
			docRect.set(el, {
				x: 0,
				y: 0,
				w: 0,
				h: 0,
				ok: false
			});
			return;
		}
		el.removeAttribute("data-brmk-tight");
		if (el.style.maxWidth) el.style.maxWidth = "";
		let naturalW = el.offsetWidth;
		const h = el.offsetHeight;
		if (!naturalW || !h) {
			hide(el);
			return;
		}
		const parent = anchor.parentElement;
		const pr = parent ? parent.getBoundingClientRect() : null;
		const limitRight = Math.min(vw - 8, pr ? Math.max(pr.right - 2, r.right + MIN_W) : vw - 8);
		const need = Math.min(naturalW, MIN_W);
		const centeredY = Math.round(r.top + (r.height - h) / 2);
		const rightX = Math.round(r.right + GAP);
		const rowX = Math.round(rowRightOf(anchor) + GAP);
		let x;
		let y;
		let maxW;
		let fits = true;
		const floorW = el.getAttribute("data-brmk-place") === "inline" ? INLINE_MIN_W : MIN_W;
		const mode = el.getAttribute("data-brmk-place");
		const wantBelow = mode === "below" && !!pr;
		const wantInline = mode === "inline" && !!pr;
		if (wantBelow) {
			x = Math.max(MARGIN, Math.round(r.left));
			y = Math.round(r.bottom + 2);
			maxW = Math.round(pr.right - 2) - x;
			if (maxW < need) {
				fits = false;
				maxW = Math.max(need, vw - 8 - x);
			}
		} else if (wantInline) {
			const text = lastTextRect(anchor) ?? {
				right: r.right,
				top: r.top,
				height: r.height
			};
			x = Math.round(text.right + GAP);
			y = Math.round(text.top + (text.height - h) / 2);
			maxW = Math.round(pr.right - 2) - x;
			if (maxW < INLINE_MIN_W) {
				maxW = INLINE_MIN_W;
				x = Math.round(pr.right - 2) - maxW;
			}
		} else if (limitRight - rightX >= need && !blockedBySibling(anchor, rightX, centeredY, naturalW, h)) {
			x = rightX;
			y = centeredY;
			maxW = limitRight - x;
		} else if (limitRight - rowX >= need) {
			x = rowX;
			y = centeredY;
			maxW = limitRight - x;
		} else if (pr) {
			x = Math.max(MARGIN, Math.round(r.left));
			y = Math.round(pr.bottom + 2);
			maxW = Math.min(vw - 8 - x, pr.right - x);
			if (maxW < need) {
				fits = false;
				maxW = Math.max(need, vw - 8 - x);
			}
		} else {
			fits = false;
			x = rightX;
			y = centeredY;
			maxW = vw - 8 - x;
		}
		if (naturalW > maxW) {
			el.setAttribute("data-brmk-tight", "1");
			naturalW = el.offsetWidth || naturalW;
			if (naturalW > maxW) el.style.maxWidth = `${Math.max(floorW, Math.floor(maxW))}px`;
		}
		const width = el.offsetWidth || naturalW;
		if (!fits) {
			x = clamp(x, MARGIN, vw - 8 - width);
			y = clamp(y, MARGIN, vh - 8 - h);
		} else {
			x = Math.max(MARGIN, x);
			y = clamp(y, MARGIN, vh - 8 - h);
		}
		const docX = x + window.scrollX;
		const docY = y + window.scrollY;
		const sig = `${docX},${docY},${width}`;
		if (lastPos.get(el) !== sig) {
			el.style.translate = `${x - lrx}px ${y - lry}px`;
			lastPos.set(el, sig);
		}
		docRect.set(el, {
			x: docX,
			y: docY,
			w: width,
			h,
			ok: true
		});
		show(el);
	}
	function sync() {
		if (!byAnchor.size) {
			stopPoll();
			return;
		}
		const vw = document.documentElement.clientWidth || window.innerWidth;
		const vh = window.innerHeight;
		const lr = layer?.getBoundingClientRect();
		const lrx = lr ? lr.left : 0;
		const lry = lr ? lr.top : 0;
		const dead = [];
		for (const [anchor, slots] of byAnchor) {
			if (!anchor.isConnected) {
				dead.push(anchor);
				continue;
			}
			for (const slot of SLOTS) {
				const el = slots[slot];
				if (!el) continue;
				if (!el.isConnected) {
					slots[slot] = null;
					byEl.delete(el);
					continue;
				}
				place(anchor, el, vw, vh, lrx, lry);
			}
		}
		for (const anchor of dead) dropAnchor(anchor);
		if (!byAnchor.size) stopPoll();
	}
	function schedule() {
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			sync();
		});
	}
	function refresh() {
		sync();
	}
	function slotsOf(anchor, create) {
		let slots = byAnchor.get(anchor);
		if (!slots) {
			if (!create) return null;
			slots = {
				badge: null,
				pencil: null
			};
			byAnchor.set(anchor, slots);
		}
		return slots;
	}
	function attach(anchor, slot, el) {
		const root = ensureLayer();
		if (!root) return;
		bind$1();
		const slots = slotsOf(anchor, true);
		if (!slots) return;
		const old = slots[slot];
		if (old && old !== el) {
			old.remove();
			byEl.delete(old);
		}
		slots[slot] = el;
		byEl.set(el, {
			anchor,
			slot
		});
		if (el.parentElement !== root) root.appendChild(el);
		ensurePoll();
		refresh();
	}
	function get(anchor, slot) {
		const slots = byAnchor.get(anchor);
		const el = slots ? slots[slot] : null;
		return el && el.isConnected ? el : null;
	}
	function detach(anchor, slot) {
		const slots = byAnchor.get(anchor);
		if (!slots) return;
		const el = slots[slot];
		if (!el) return;
		slots[slot] = null;
		byEl.delete(el);
		el.remove();
		if (!slots.badge && !slots.pencil) byAnchor.delete(anchor);
	}
	function removeEl(el) {
		const info = byEl.get(el);
		if (info) {
			detach(info.anchor, info.slot);
			return;
		}
		el.remove();
	}
	function dropAnchor(anchor) {
		const slots = byAnchor.get(anchor);
		if (slots) for (const slot of SLOTS) {
			const el = slots[slot];
			if (el) {
				byEl.delete(el);
				el.remove();
			}
		}
		byAnchor.delete(anchor);
	}
	function clear() {
		for (const anchor of Array.from(byAnchor.keys())) dropAnchor(anchor);
		byAnchor.clear();
		if (layer) layer.textContent = "";
		stopPollIfEmpty();
	}
	function stopPollIfEmpty() {
		if (!byAnchor.size) stopPoll();
	}
	function list(slot) {
		if (!layer) return [];
		const cls = slot === "badge" ? ".brmk-badge" : ".brmk-pencil";
		return Array.from(layer.querySelectorAll(cls));
	}
	function count(slot) {
		return list(slot).length;
	}
	var current = {
		dark: false,
		color: "#FB7299",
		rgb: [
			251,
			113,
			152
		],
		evolved: false
	};
	var FONT_STACK = "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Microsoft YaHei\", \"PingFang SC\", \"Hiragino Sans GB\", sans-serif";
	function paletteOf(theme, force) {
		const dark = force === "dark" ? true : force === "light" ? false : theme.dark;
		const [r, g, b] = theme.rgb;
		return {
			dark,
			bg: dark ? "#1f1f1f" : "#ffffff",
			bg2: dark ? "#2a2a2a" : "#f6f7f8",
			bg3: dark ? "#353535" : "#eaecef",
			fg: dark ? "#e9e9e9" : "#18191c",
			fg2: dark ? "rgba(233,233,233,.62)" : "rgba(24,25,28,.6)",
			border: dark ? "rgba(255,255,255,.13)" : "rgba(0,0,0,.1)",
			shadow: dark ? "0 8px 32px rgba(0,0,0,.55)" : "0 8px 32px rgba(0,0,0,.16)",
			accent: theme.color,
			accentWeak: rgba([
				r,
				g,
				b
			], dark ? .18 : .1),
			accentBorder: rgba([
				r,
				g,
				b
			], dark ? .45 : .35),
			overlay: "rgba(0,0,0,.45)"
		};
	}
	function getTheme() {
		return current;
	}
	function refreshTheme() {
		current = detectTheme();
		return current;
	}
	function managerPalette() {
		const p = getSettings().manager.theme;
		return paletteOf(current, p);
	}
	function buildCss(theme) {
		const p = paletteOf(theme, "auto");
		return `
/* ===== BiliRemark 样式（全部 brmk- 前缀，不覆盖页面既有样式） ===== */
/* 页面内浮层：徽标 / 铅笔都挂在这里，绝不进入 B 站自己的容器 */
/* 页面内浮层：徽标 / 铅笔都挂在这里，绝不进入 B 站自己的容器。
   层钉在文档原点（absolute 而非 fixed），徽标按文档坐标定位 —— 主文档滚动时
   徽标与页面内容同帧移动，不需要 JS 追帧重算（那会慢一帧，看起来在飘）。
   width:100% 不能省：徽标 max-width 里的 100% 和 shrink-to-fit 都按包含块解析，
   层宽为 0 会把徽标塌缩成一个点。height:0 不参与布局，仅作定位原点。 */
#brmk-layer{
  position:absolute; left:0; top:0; width:100%; height:0;
  z-index:99997; pointer-events:none; overflow:visible;
  contain:layout style;
}
/* portal 用 translate 属性定位（不用 transform，避免被 .brmk-badge 的 transform 过渡拖成飞入/弹跳） */
#brmk-layer>.brmk-badge,#brmk-layer>.brmk-pencil{
  position:absolute; left:0; top:0; margin:0; pointer-events:auto;
  will-change:translate;
}
.brmk-badge{
  display:inline-flex; align-items:center; gap:4px;
  margin:0; padding:0 7px; height:18px; max-width:min(240px, 100%);
  border-radius:9px; vertical-align:middle;
  /* 内联挂法（评论区夹在昵称和等级之间）：flex 组里垂直居中、不被压缩 */
  align-self:center; flex:none;
  font-family:${FONT_STACK}; font-size:12px; font-weight:500; line-height:16px;
  letter-spacing:0; white-space:nowrap; cursor:pointer; user-select:none;
  color:var(--brmk-c, ${p.accent});
  /* 不透明底：浮层徽标会盖在页面文字上，透底会显得到处叠字 */
  background:color-mix(in srgb, var(--brmk-c, ${p.accent}) 14%, ${p.bg});
  border:1px solid color-mix(in srgb, var(--brmk-c, ${p.accent}) 38%, transparent);
  transition:background .12s ease, transform .12s ease;
}
.brmk-badge:hover{
  background:color-mix(in srgb, var(--brmk-c, ${p.accent}) 24%, ${p.bg});
}
.brmk-badge:active{ transform:scale(.97); }
.brmk-badge.brmk-hover-only{ opacity:0; }
.brmk-badge.brmk-hover-only:hover{ opacity:1; }
.brmk-badge:focus-visible{ outline:2px solid var(--brmk-c, ${p.accent}); outline-offset:1px; }
.brmk-badge .brmk-dot{
  width:6px; height:6px; border-radius:50%; flex:0 0 auto;
  background:var(--brmk-c, ${p.accent});
}
.brmk-badge .brmk-name{
  overflow:hidden; text-overflow:ellipsis; max-width:140px;
}
.brmk-badge .brmk-tags{ display:inline-flex; gap:3px; overflow:hidden; }
.brmk-badge .brmk-tag{
  font-size:10px; line-height:14px; padding:0 4px; border-radius:4px;
  background:color-mix(in srgb, currentColor 14%, transparent);
  white-space:nowrap; max-width:80px; overflow:hidden; text-overflow:ellipsis;
}
.brmk-badge .brmk-more{ font-size:10px; opacity:.7; }
/* 浮层给的空间不够时（portal 打的标记），先让位给备注名，标签胶囊收起 */
.brmk-badge[data-brmk-tight] .brmk-tags{ display:none; }
.brmk-badge[data-brmk-tight] .brmk-name{ max-width:100%; }
/* 行内挂法（关系卡：贴昵称文字右侧——锚点是块级全宽元素，portal 用 Range 量文字右缘定位）：
   备注名允许在徽标自身 maxWidth 内收缩省略，标签不参与收缩（tight 时整体隐藏） */
.brmk-badge[data-brmk-place="inline"] .brmk-name{ min-width:0; max-width:none; }
.brmk-badge[data-brmk-place="inline"] .brmk-tags{ flex:0 0 auto; }
/* 内联挂法（评论区夹在昵称和等级之间）：边距对齐原生昵称行节奏 ——
   真机实测等级图标 margin-left 5px，徽标跟它同节奏；右侧不另加，
   让后面元素（等级图标）自带的 5px 左边距生效 */
.brmk-badge.brmk-inline{ margin:0 0 0 5px; }
/* 内联徽标随评论淡入（160ms），避免加载完成后成批突现 */
.brmk-badge.brmk-inline{ animation:brmk-badge-in .16s ease-out; }
@keyframes brmk-badge-in{ from{ opacity:0 } }

/* S5 视频页右栏三行布局：备注行作为卡片 .info 内的一行（.upname 与 .playinfo 之间）。
   边距对齐原生节奏（2026-10-25 实测：.upname 上下 margin 2px、字号 13px/行高 15px、.playinfo 高 18px）：
   display:flex 消除 inline 徽标 baseline 对齐带来的不对称空隙，行高 = 徽标实际高度 */
.brmk-card-badge-row{ display:flex; margin:2px 0; }
.brmk-card-badge-row .brmk-badge{ max-width:100%; animation:brmk-badge-in .16s ease-out; }

.brmk-pencil{
  display:inline-flex; align-items:center; justify-content:center;
  width:16px; height:16px; margin:0; padding:0; border:0; border-radius:50%;
  vertical-align:middle; cursor:pointer; opacity:0; pointer-events:none;
  color:${p.fg2}; background:${p.bg3};
  transition:opacity .14s ease, background .14s ease, color .14s ease;
}
.brmk-pencil svg{ width:9px; height:9px; display:block; }
.brmk-pencil.brmk-pencil-on{ opacity:1; pointer-events:auto; }
.brmk-pencil:hover{ color:#fff; background:${p.accent}; }

/* ===== 编辑气泡 ===== */
#brmk-editor{
  position:fixed; z-index:2147483000; width:344px; max-width:calc(100vw - 16px);
  box-sizing:border-box; padding:14px; border-radius:12px;
  font-family:${FONT_STACK}; font-size:13px; color:${p.fg};
  background:${p.bg}; border:1px solid ${p.border}; box-shadow:${p.shadow};
  animation:brmk-pop .16s ease-out;
}
@keyframes brmk-pop{ from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:none} }
#brmk-editor *{ box-sizing:border-box; font-family:inherit; }
.brmk-ed-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
.brmk-ed-title{ font-size:14px; font-weight:600; }
.brmk-ed-sub{ font-size:11px; color:${p.fg2}; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.brmk-ed-close{
  border:0; background:transparent; color:${p.fg2}; cursor:pointer; font-size:16px; line-height:1;
  padding:4px 6px; border-radius:6px;
}
.brmk-ed-close:hover{ background:${p.bg2}; color:${p.fg}; }
.brmk-field{ margin-bottom:10px; }
.brmk-label{ display:block; font-size:12px; color:${p.fg2}; margin-bottom:5px; }
.brmk-input,.brmk-textarea{
  width:100%; border:1px solid ${p.border}; border-radius:6px; background:${p.bg2}; color:${p.fg};
  font-size:13px; line-height:20px; padding:6px 8px; outline:none;
  transition:border-color .12s ease, box-shadow .12s ease;
}
.brmk-input:focus,.brmk-textarea:focus{ border-color:${p.accent}; box-shadow:0 0 0 2px ${p.accentWeak}; }
.brmk-textarea{ resize:vertical; min-height:64px; max-height:180px; }
.brmk-chips{ display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }
.brmk-chip{
  display:inline-flex; align-items:center; gap:3px; height:20px; padding:0 6px;
  border-radius:10px; font-size:11px; line-height:20px;
  background:${p.accentWeak}; color:${p.accent}; border:1px solid ${p.accentBorder};
}
.brmk-chip button{ border:0; background:transparent; color:inherit; cursor:pointer; font-size:12px; line-height:1; padding:0 0 0 1px; }
.brmk-colors{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.brmk-swatch{
  width:18px; height:18px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0;
  box-shadow:inset 0 0 0 1px ${p.border};
}
.brmk-swatch[aria-pressed="true"]{ border-color:${p.fg}; }
.brmk-color-input{
  width:24px; height:20px; padding:0; border:1px solid ${p.border}; border-radius:4px; background:${p.bg2}; cursor:pointer;
}
.brmk-ed-foot{ display:flex; align-items:center; gap:8px; margin-top:12px; }
.brmk-ed-hint{ flex:1; font-size:11px; color:${p.fg2}; }
.brmk-btn{
  appearance:none; border:1px solid ${p.border}; border-radius:6px; padding:0 12px; height:28px;
  font-size:12px; font-family:inherit; cursor:pointer; color:${p.fg}; background:${p.bg2};
  transition:background .12s ease, border-color .12s ease, color .12s ease;
}
.brmk-btn:hover{ border-color:${p.accentBorder}; color:${p.accent}; }
.brmk-btn-primary{ background:${p.accent}; border-color:${p.accent}; color:#fff; }
.brmk-btn-primary:hover{ color:#fff; filter:brightness(1.06); }
.brmk-btn-danger{ color:#e5484d; border-color:rgba(229,72,77,.4); background:transparent; }
.brmk-btn-danger:hover{ background:rgba(229,72,77,.12); color:#e5484d; border-color:#e5484d; }
.brmk-btn:disabled{ opacity:.45; cursor:not-allowed; }

/* ===== 空间页侧栏「备注」模块（跟随原生侧栏深浅：默认浅色原生样式，深色侧栏由 data-brmk-sp-theme 覆盖） ===== */
/* 浅色取自 2026-10 实测原生卡面：#F6F7F8 底 / 6px 圆角 / 无边框，标题 16px 500 #18191C，间距节奏 10px */
#brmk-space-card{
  box-sizing:border-box; margin:0 0 10px; padding:14px 16px;
  border-radius:6px; border:0;
  background:#f6f7f8; color:#18191c;
  font-family:${FONT_STACK}; font-size:13px; line-height:1.6;
  --brmk-sp-c:${p.accent};
}
#brmk-space-card *{ box-sizing:border-box; font-family:inherit; }
#brmk-space-card [hidden]{ display:none !important; }
.brmk-sp-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.brmk-sp-title{ font-size:16px; font-weight:500; color:#18191c; }
.brmk-sp-link{
  appearance:none; border:0; border-radius:4px; padding:2px 4px; cursor:pointer;
  background:transparent; color:#61666d;
  font-size:12px; font-family:inherit; line-height:18px;
  transition:color .12s ease, background .12s ease;
}
.brmk-sp-link:hover{ color:${p.accent}; background:rgba(0,0,0,.05); }
.brmk-sp-link:focus-visible{ outline:2px solid ${p.accent}; outline-offset:1px; }
.brmk-sp-name{ display:flex; align-items:center; gap:7px; margin:2px 0 8px; }
.brmk-sp-dot{ width:8px; height:8px; border-radius:50%; background:var(--brmk-sp-c); flex:0 0 auto; }
.brmk-sp-nametext{ font-size:15px; font-weight:600; color:var(--brmk-sp-c); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.brmk-sp-tags{ display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px; }
.brmk-sp-tag{
  font-size:11px; line-height:18px; padding:0 7px; border-radius:9px; max-width:120px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--brmk-sp-c, ${p.accent});
  background:color-mix(in srgb, var(--brmk-sp-c, ${p.accent}) 13%, transparent);
  border:1px solid color-mix(in srgb, var(--brmk-sp-c, ${p.accent}) 35%, transparent);
}
.brmk-sp-note{ color:#61666d; white-space:pre-wrap; word-break:break-word; max-height:168px; overflow:auto; }
.brmk-sp-foot{ display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap; }
.brmk-sp-meta{ color:#9499a0; font-size:11px; }
.brmk-sp-mid{
  appearance:none; border:0; background:transparent; padding:0; cursor:pointer;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:11px; line-height:1.6; color:#9499a0;
  transition:color .12s ease;
}
.brmk-sp-mid:hover{ color:${p.accent}; text-decoration:underline; }
.brmk-sp-spacer{ flex:1; }
.brmk-sp-adv{ font-size:11px; color:#9499a0; white-space:nowrap; }
.brmk-sp-emptytext{ color:#9499a0; margin-bottom:10px; }
.brmk-sp-label{ display:block; font-size:11px; color:#9499a0; margin:8px 0 4px; }
.brmk-sp-input,.brmk-sp-textarea{
  width:100%; font-size:13px; line-height:20px; padding:7px 9px; outline:none;
  color:#18191c; background:#fff;
  border:1px solid #e3e5e7; border-radius:6px;
  transition:border-color .12s ease, background .12s ease;
}
.brmk-sp-input::placeholder,.brmk-sp-textarea::placeholder{ color:#9499a0; }
.brmk-sp-input:focus,.brmk-sp-textarea:focus{ border-color:${p.accent}; box-shadow:0 0 0 2px ${p.accentWeak}; }
.brmk-sp-textarea{ resize:vertical; min-height:64px; max-height:180px; }
.brmk-sp-chips{ display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }
.brmk-sp-chip{
  display:inline-flex; align-items:center; gap:3px; height:20px; padding:0 6px; border-radius:10px;
  font-size:11px; line-height:20px; color:${p.accent};
  background:color-mix(in srgb, ${p.accent} 15%, transparent);
  border:1px solid color-mix(in srgb, ${p.accent} 38%, transparent);
}
.brmk-sp-chipx{ border:0; background:transparent; color:inherit; cursor:pointer; font-size:12px; line-height:1; padding:0 0 0 1px; }
.brmk-sp-counter{ text-align:right; font-size:11px; color:#9499a0; margin-top:3px; }
.brmk-sp-actions{ display:flex; justify-content:flex-end; gap:8px; margin-top:10px; }
#brmk-space-card .brmk-btn{
  border:1px solid #e3e5e7; background:#fff; color:#61666d;
  height:28px; padding:0 14px; border-radius:6px; font-size:12px;
}
#brmk-space-card .brmk-btn:hover{ color:${p.accent}; border-color:${p.accentBorder}; background:#fff; }
#brmk-space-card .brmk-btn-primary{ background:${p.accent}; border-color:${p.accent}; color:#fff; }
#brmk-space-card .brmk-btn-primary:hover{ color:#fff; filter:brightness(1.06); background:${p.accent}; }

/* 深色侧栏（B 站灰度或旧版布局）时的覆盖：沿用原深色配色 */
#brmk-space-card[data-brmk-sp-theme="dark"]{ background:rgba(255,255,255,.055); color:#e9e9e9; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-title{ color:#f1f1f3; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-link{ color:rgba(255,255,255,.55); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-link:hover{ color:${p.accent}; background:rgba(255,255,255,.06); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-mid:hover{ color:${p.accent}; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-note{ color:rgba(255,255,255,.78); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-meta,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-mid,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-adv,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-counter,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-emptytext,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-label{ color:rgba(255,255,255,.45); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-input,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-textarea{
  color:#f1f1f3; background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.14); border-radius:8px;
}
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-input::placeholder,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-textarea::placeholder{ color:rgba(255,255,255,.32); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-input:focus,
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-sp-textarea:focus{ background:rgba(255,255,255,.1); box-shadow:none; }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-btn{ border-color:rgba(255,255,255,.16); background:transparent; color:rgba(255,255,255,.75); }
#brmk-space-card[data-brmk-sp-theme="dark"] .brmk-btn:hover{ color:#fff; border-color:rgba(255,255,255,.3); background:rgba(255,255,255,.06); }

/* ===== 管理页 ===== */
#brmk-manager{
  position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center;
  font-family:${FONT_STACK}; color:var(--brmk-fg, ${p.fg});
  --brmk-bg:${p.bg}; --brmk-bg2:${p.bg2}; --brmk-bg3:${p.bg3}; --brmk-fg:${p.fg}; --brmk-fg2:${p.fg2};
  --brmk-border:${p.border}; --brmk-shadow:${p.shadow}; --brmk-accent:${p.accent};
  --brmk-accent-weak:${p.accentWeak}; --brmk-accent-border:${p.accentBorder};
  background:${p.overlay}; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  animation:brmk-fade .16s ease-out;
}
@keyframes brmk-fade{ from{opacity:0} to{opacity:1} }
#brmk-manager *{ box-sizing:border-box; font-family:inherit; }
#brmk-manager .brmk-panel{
  display:flex; flex-direction:column; width:min(1100px, calc(100vw - 64px)); height:84vh; min-height:420px;
  position:relative;
  border-radius:12px; overflow:hidden; background:var(--brmk-bg); color:var(--brmk-fg);
  border:1px solid var(--brmk-border); box-shadow:var(--brmk-shadow);
  animation:brmk-rise .18s ease-out;
}
@keyframes brmk-rise{ from{opacity:0; transform:translateY(4px)} to{opacity:1; transform:none} }
#brmk-manager .brmk-head{
  display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid var(--brmk-border);
  flex:0 0 auto; flex-wrap:wrap;
}
#brmk-manager .brmk-title{ font-size:16px; font-weight:600; white-space:nowrap; }
#brmk-manager .brmk-title small{ font-size:12px; font-weight:400; color:var(--brmk-fg2); margin-left:6px; }
#brmk-manager .brmk-search{
  flex:1 1 220px; min-width:160px; height:30px; padding:0 10px; font-size:13px;
  border:1px solid var(--brmk-border); border-radius:6px; background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
}
#brmk-manager .brmk-search:focus{ border-color:var(--brmk-accent); box-shadow:0 0 0 2px var(--brmk-accent-weak); }
#brmk-manager .brmk-head-actions{ display:flex; align-items:center; gap:6px; margin-left:auto; }
#brmk-manager .brmk-tabs{ display:flex; gap:2px; padding:0 18px; border-bottom:1px solid var(--brmk-border); flex:0 0 auto; }
#brmk-manager .brmk-tab{
  border:0; background:transparent; color:var(--brmk-fg2); font-size:13px; padding:9px 12px; cursor:pointer;
  border-bottom:2px solid transparent; margin-bottom:-1px;
}
#brmk-manager .brmk-tab[aria-selected="true"]{ color:var(--brmk-accent); border-bottom-color:var(--brmk-accent); }
#brmk-manager .brmk-stats{
  display:flex; flex-wrap:wrap; gap:8px; padding:12px 18px 0; flex:0 0 auto;
}
#brmk-manager .brmk-stat{
  flex:1 1 120px; min-width:110px; padding:8px 10px; border-radius:8px;
  background:var(--brmk-bg2); border:1px solid var(--brmk-border);
}
#brmk-manager .brmk-stat b{ display:block; font-size:16px; font-weight:600; margin-bottom:2px; }
#brmk-manager .brmk-stat span{ font-size:11px; color:var(--brmk-fg2); }
#brmk-manager .brmk-warn{
  margin:10px 18px 0; padding:8px 10px; border-radius:6px; font-size:12px;
  background:rgba(245,194,66,.12); border:1px solid rgba(245,194,66,.4); color:${p.dark ? "#f5c242" : "#8a6100"};
}
#brmk-manager .brmk-toolbar{
  display:flex; align-items:center; gap:8px; padding:10px 18px; flex-wrap:wrap; flex:0 0 auto;
}
#brmk-manager select{
  height:28px; padding:0 6px; font-size:12px; border-radius:6px; border:1px solid var(--brmk-border);
  background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
}
#brmk-manager .brmk-spacer{ flex:1; }
#brmk-manager .brmk-body{ flex:1 1 auto; overflow:auto; margin:0 18px; border:1px solid var(--brmk-border); border-radius:8px; }
#brmk-manager table{ width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
#brmk-manager thead th{
  position:sticky; top:0; z-index:2; background:var(--brmk-bg2); color:var(--brmk-fg2);
  font-size:12px; font-weight:500; text-align:left; padding:9px 10px; border-bottom:1px solid var(--brmk-border);
  white-space:nowrap;
}
#brmk-manager tbody td{ padding:8px 10px; border-bottom:1px solid var(--brmk-border); vertical-align:middle; }
#brmk-manager tbody tr:hover td{ background:var(--brmk-accent-weak); }
#brmk-manager tbody tr:last-child td{ border-bottom:0; }
#brmk-manager .brmk-cell-main{ font-weight:500; }
#brmk-manager .brmk-cell-sub{ font-size:11px; color:var(--brmk-fg2); margin-top:1px; }
#brmk-manager .brmk-mid{
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px;
  color:var(--brmk-fg2); cursor:pointer; border:0; background:transparent; padding:0;
}
#brmk-manager .brmk-mid:hover{ color:var(--brmk-accent); text-decoration:underline; }
#brmk-manager .brmk-row-tag{
  display:inline-block; height:18px; padding:0 6px; margin:1px 3px 1px 0; border-radius:9px; font-size:11px; line-height:18px;
  background:var(--brmk-accent-weak); color:var(--brmk-accent); white-space:nowrap;
}
#brmk-manager .brmk-mark{
  display:inline-block; margin-left:4px; padding:0 4px; border-radius:3px; font-size:10px;
  background:rgba(245,194,66,.15); color:#b98900; border:1px solid rgba(245,194,66,.4);
}
#brmk-manager .brmk-note-clip{
  max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--brmk-fg2); font-size:12px;
}
#brmk-manager .brmk-row-actions{ display:flex; gap:4px; white-space:nowrap; }
#brmk-manager .brmk-link-btn{
  border:0; background:transparent; color:var(--brmk-accent); font-size:12px; cursor:pointer; padding:2px 4px; border-radius:4px;
}
#brmk-manager .brmk-link-btn:hover{ background:var(--brmk-accent-weak); }
#brmk-manager .brmk-link-btn.brmk-danger{ color:#e5484d; }
#brmk-manager .brmk-pager{
  display:flex; align-items:center; gap:8px; padding:10px 18px; flex:0 0 auto; font-size:12px; color:var(--brmk-fg2);
}
#brmk-manager .brmk-pager .brmk-btn{ height:26px; padding:0 10px; }
#brmk-manager .brmk-empty{ padding:48px 16px; text-align:center; color:var(--brmk-fg2); font-size:13px; }
#brmk-manager .brmk-empty b{ display:block; font-size:15px; color:var(--brmk-fg); margin-bottom:6px; }

/* 设置页 */
#brmk-manager .brmk-settings{ flex:1 1 auto; overflow:auto; padding:14px 18px 24px; }
#brmk-manager .brmk-sec{ margin-bottom:18px; border:1px solid var(--brmk-border); border-radius:8px; overflow:hidden; }
#brmk-manager .brmk-sec-head{ padding:10px 12px; background:var(--brmk-bg2); font-size:13px; font-weight:600; border-bottom:1px solid var(--brmk-border); }
#brmk-manager .brmk-row{
  display:flex; align-items:center; gap:12px; padding:9px 12px; border-bottom:1px solid var(--brmk-border); font-size:13px;
}
#brmk-manager .brmk-row:last-child{ border-bottom:0; }
#brmk-manager .brmk-row-label{ flex:1; min-width:140px; }
#brmk-manager .brmk-row-label small{ display:block; color:var(--brmk-fg2); font-size:11px; margin-top:1px; }
#brmk-manager .brmk-row-control{ flex:0 0 auto; display:flex; align-items:center; gap:6px; }
#brmk-manager .brmk-row-control input[type="number"],#brmk-manager .brmk-row-control input[type="text"]{
  width:110px; height:26px; padding:0 6px; font-size:12px; border-radius:6px;
  border:1px solid var(--brmk-border); background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
}
#brmk-manager .brmk-soon{ font-size:10px; color:var(--brmk-fg2); border:1px solid var(--brmk-border); border-radius:3px; padding:0 3px; }
.brmk-switch{
  position:relative; width:34px; height:19px; border-radius:10px; border:1px solid var(--brmk-border);
  background:var(--brmk-bg3); cursor:pointer; padding:0; transition:background .12s ease, border-color .12s ease;
}
.brmk-switch::after{
  content:""; position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:50%;
  background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.3); transition:transform .12s ease;
}
.brmk-switch[aria-checked="true"]{ background:var(--brmk-accent); border-color:var(--brmk-accent); }
.brmk-switch[aria-checked="true"]::after{ transform:translateX(15px); }

/* 导入弹窗 / 确认 */
#brmk-manager .brmk-submask{
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,.45); z-index:3;
}
#brmk-manager .brmk-subpanel{
  width:min(520px, calc(100% - 48px)); max-height:80%; overflow:auto;
  background:var(--brmk-bg); color:var(--brmk-fg); border-radius:10px; border:1px solid var(--brmk-border);
  box-shadow:var(--brmk-shadow); padding:16px;
}
#brmk-manager .brmk-subpanel h3{ margin:0 0 10px; font-size:15px; }
#brmk-manager .brmk-subpanel p{ margin:0 0 10px; font-size:12px; color:var(--brmk-fg2); line-height:1.6; }
#brmk-manager .brmk-subpanel textarea{
  width:100%; height:120px; resize:vertical; padding:8px; font-size:12px; line-height:1.5;
  border:1px solid var(--brmk-border); border-radius:6px; background:var(--brmk-bg2); color:var(--brmk-fg); outline:none;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#brmk-manager .brmk-preview{ display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
#brmk-manager .brmk-preview span{ font-size:12px; padding:3px 8px; border-radius:5px; background:var(--brmk-bg2); border:1px solid var(--brmk-border); }
#brmk-manager .brmk-subfoot{ display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }

/* 浮动按钮 */
#brmk-fab{
  position:fixed; right:0; top:50%; transform:translateY(-50%); z-index:99998;
  display:flex; align-items:center; gap:6px; height:38px; padding:0 8px 0 10px;
  border-radius:19px 0 0 19px; border:1px solid ${p.border}; border-right:0;
  background:${p.bg}; color:${p.fg}; box-shadow:${p.shadow}; cursor:pointer;
  font-family:${FONT_STACK}; font-size:12px; opacity:.55; transition:opacity .16s ease, padding .16s ease;
}
#brmk-fab:hover{ opacity:1; }
#brmk-fab svg{ width:16px; height:16px; flex:0 0 auto; color:${p.accent}; }
#brmk-fab .brmk-fab-label{ max-width:0; overflow:hidden; white-space:nowrap; transition:max-width .18s ease; }
#brmk-fab:hover .brmk-fab-label{ max-width:120px; }

/* toast */
#brmk-toast{
  position:fixed; left:50%; bottom:48px; transform:translateX(-50%); z-index:2147483001;
  display:flex; flex-direction:column; gap:6px; align-items:center; pointer-events:none;
  font-family:${FONT_STACK};
}
#brmk-toast .brmk-toast-item{
  display:flex; align-items:center; gap:10px; pointer-events:auto;
  padding:8px 14px; border-radius:8px; font-size:12px; color:${p.dark ? "#fff" : "#fff"};
  background:rgba(30,30,30,.92); box-shadow:0 6px 20px rgba(0,0,0,.3);
  animation:brmk-toast-in .16s ease-out;
}
@keyframes brmk-toast-in{ from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none} }
#brmk-toast button{ border:0; background:transparent; color:${p.accent}; font-size:12px; cursor:pointer; padding:0; }

/* 选择器体检 */
#brmk-doctor{
  position:fixed; right:16px; bottom:16px; z-index:2147483000; width:360px; max-height:70vh; overflow:auto;
  padding:12px; border-radius:10px; background:${p.bg}; color:${p.fg}; border:1px solid ${p.border};
  box-shadow:${p.shadow}; font-family:${FONT_STACK}; font-size:12px; line-height:1.6;
}
#brmk-doctor h4{ margin:0 0 8px; font-size:13px; display:flex; justify-content:space-between; align-items:center; }
#brmk-doctor .brmk-doc-row{ display:flex; justify-content:space-between; gap:8px; border-bottom:1px dashed ${p.border}; padding:3px 0; }
#brmk-doctor .brmk-doc-row b{ color:${p.accent}; font-weight:600; }
#brmk-doctor pre{
  white-space:pre-wrap; word-break:break-all; margin:8px 0 0; padding:8px; border-radius:6px;
  background:${p.bg2}; color:${p.fg2}; max-height:160px; overflow:auto; font-size:11px;
}

@media (prefers-reduced-motion: reduce){
  #brmk-editor,#brmk-manager,#brmk-manager .brmk-panel,#brmk-toast .brmk-toast-item{ animation:none !important; }
  .brmk-badge,.brmk-pencil,.brmk-switch,.brmk-switch::after{ transition:none !important; }
  .brmk-badge.brmk-inline{ animation:none !important; }
}
`.trim();
	}
	var cssText = "";
	var docStyleEl = null;
	var sharedSheet = null;
	var canAdopt = false;
	var shadowRoots = new Set();
	var fallbackStyles = new Map();
	function supportsConstructable() {
		try {
			return typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype && "adoptedStyleSheets" in Document.prototype;
		} catch {
			return false;
		}
	}
	function getSheet() {
		if (!canAdopt) return null;
		if (!sharedSheet) try {
			sharedSheet = new CSSStyleSheet();
			sharedSheet.replaceSync(cssText);
		} catch {
			canAdopt = false;
			sharedSheet = null;
		}
		return sharedSheet;
	}
	function installStyles(theme = current) {
		current = theme;
		cssText = buildCss(theme);
		canAdopt = supportsConstructable();
		if (!docStyleEl || !docStyleEl.isConnected) {
			docStyleEl = document.getElementById("brmk-style");
			if (!docStyleEl) {
				docStyleEl = document.createElement("style");
				docStyleEl.id = "brmk-style";
				(document.head ?? document.documentElement).appendChild(docStyleEl);
			}
		}
		docStyleEl.textContent = cssText;
		const sheet = getSheet();
		if (sheet) try {
			sheet.replaceSync(cssText);
		} catch {}
		for (const [root, el] of fallbackStyles) {
			if (!root.host?.isConnected) {
				fallbackStyles.delete(root);
				shadowRoots.delete(root);
				continue;
			}
			el.textContent = cssText;
		}
		for (const root of shadowRoots) ensureShadowStyle(root);
	}
	function ensureShadowStyle(root) {
		shadowRoots.add(root);
		const sheet = getSheet();
		if (sheet && "adoptedStyleSheets" in root) try {
			const currentSheets = root.adoptedStyleSheets;
			if (!Array.from(currentSheets).includes(sheet)) root.adoptedStyleSheets = [...currentSheets, sheet];
			return;
		} catch {}
		let el = fallbackStyles.get(root);
		if (!el || !el.isConnected) {
			el = document.createElement("style");
			el.setAttribute("data-brmk-style", "1");
			el.textContent = cssText;
			root.appendChild(el);
			fallbackStyles.set(root, el);
		} else el.textContent = cssText;
	}
	var pencilMeta = new WeakMap();
	var anchorBound = new WeakSet();
	var pencilBound = new WeakSet();
	var hideTimers = new WeakMap();
	var HIDE_DELAY = 220;
	function buildBadgeContent(badge, record, options) {
		badge.textContent = "";
		if (options.showColorDot) badge.appendChild(h("span", "brmk-dot"));
		if (record.remark) {
			const name = h("span", "brmk-name", record.remark);
			badge.appendChild(name);
		}
		if (options.showTags && record.tags.length) {
			const wrap = h("span", "brmk-tags");
			const shown = options.maxTags <= 0 ? [] : record.tags.slice(0, options.maxTags);
			for (const tag of shown) wrap.appendChild(h("span", "brmk-tag", tag));
			if (record.tags.length > shown.length) wrap.appendChild(h("span", "brmk-more", `+${record.tags.length - shown.length}`));
			badge.appendChild(wrap);
		}
		const titleParts = [record.remark || record.nickSnapshot || record.mid];
		if (record.nickSnapshot) titleParts.push(`昵称：${record.nickSnapshot}`);
		titleParts.push(`mid：${record.mid}`);
		if (record.note) titleParts.push(record.note.length > 300 ? record.note.slice(0, 300) + "…" : record.note);
		badge.title = titleParts.join("\n");
	}
	function createBadge(mid, options) {
		const badge = h("span", "brmk-badge");
		badge.setAttribute("role", "button");
		badge.tabIndex = 0;
		if (options.placeBelow) badge.setAttribute("data-brmk-place", "below");
		if (options.placeInline) badge.setAttribute("data-brmk-place", "inline");
		badge.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			const id = badge.getAttribute("data-brmk-mid") || mid;
			const current = store.get(id);
			if (!current) return;
			openEditor({
				mid: id,
				record: current,
				anchor: badge,
				nickname: current.nickSnapshot,
				scene: options.scene
			});
		});
		badge.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" || ev.key === " ") {
				ev.preventDefault();
				badge.click();
			}
		});
		return badge;
	}
	function renderBadge(anchor, record, options) {
		if (!record.remark && !record.tags.length) {
			removeBadge(record.mid);
			return null;
		}
		if (!anchor.isConnected) return null;
		let badge = get(anchor, "badge");
		if (!badge) {
			badge = createBadge(record.mid, options);
			attach(anchor, "badge", badge);
		}
		paintBadge(badge, record, options);
		detach(anchor, "pencil");
		refresh();
		return badge;
	}
	function badgeSignature(record, options) {
		return [
			record.remark,
			record.tags.join(""),
			record.color ?? "",
			record.note,
			record.nickSnapshot,
			options.showTags ? 1 : 0,
			options.showColorDot ? 1 : 0,
			options.maxTags,
			options.showOnHoverOnly ? 1 : 0,
			getTheme().color
		].join("");
	}
	function paintBadge(badge, record, options) {
		badge.setAttribute("data-brmk-mid", record.mid);
		badge.style.setProperty("--brmk-c", readableBadgeColor(record.color ?? getTheme().color, getTheme().dark));
		badge.classList.toggle("brmk-hover-only", !!options.showOnHoverOnly);
		const signature = badgeSignature(record, options);
		if (badge.dataset.brmkSig !== signature) {
			buildBadgeContent(badge, record, options);
			badge.dataset.brmkSig = signature;
		}
	}
	function buildBadgeElement(record, options) {
		const badge = createBadge(record.mid, options);
		paintBadge(badge, record, options);
		return badge;
	}
	var inlineBadges = new Set();
	function renderInlineBadge(reference, record, options) {
		if (!record.remark && !record.tags.length) {
			removeBadge(record.mid);
			return null;
		}
		const parent = reference.parentElement;
		if (!parent || !reference.isConnected) return null;
		const root = reference.getRootNode();
		if (root instanceof ShadowRoot) ensureShadowStyle(root);
		let badge = parent.querySelector(":scope > .brmk-badge");
		if (badge && badge.getAttribute("data-brmk-mid") !== record.mid) {
			badge.remove();
			inlineBadges.delete(badge);
			badge = null;
		}
		if (!badge) {
			badge = createBadge(record.mid, options);
			badge.classList.add("brmk-inline");
			inlineBadges.add(badge);
		}
		if (badge.previousElementSibling !== reference) reference.after(badge);
		badge.style.marginLeft = options.inlineGap ? `${options.inlineGap}px` : "";
		paintBadge(badge, record, options);
		detach(reference, "pencil");
		refresh();
		return badge;
	}
	function removeBadge(mid) {
		for (const el of list("badge")) if (el.getAttribute("data-brmk-mid") === mid) removeEl(el);
		for (const el of inlineBadges) if (el.getAttribute("data-brmk-mid") === mid) {
			el.remove();
			inlineBadges.delete(el);
		}
	}
	function showPencil(anchor) {
		const timer = hideTimers.get(anchor);
		if (timer !== void 0) {
			window.clearTimeout(timer);
			hideTimers.delete(anchor);
		}
		get(anchor, "pencil")?.classList.add("brmk-pencil-on");
	}
	function hidePencilSoon(anchor) {
		const timer = hideTimers.get(anchor);
		if (timer !== void 0) window.clearTimeout(timer);
		hideTimers.set(anchor, window.setTimeout(() => {
			hideTimers.delete(anchor);
			get(anchor, "pencil")?.classList.remove("brmk-pencil-on");
		}, HIDE_DELAY));
	}
	function ensurePencil(anchor, mid, nickname, scene, placeInline = false) {
		if (!anchor.isConnected) return;
		if (get(anchor, "badge")) return;
		let pencil = get(anchor, "pencil");
		if (!pencil) {
			const btn = h("button", "brmk-pencil");
			btn.type = "button";
			btn.title = "给 TA 加备注";
			btn.setAttribute("aria-label", "给 TA 加备注");
			if (placeInline) btn.setAttribute("data-brmk-place", "inline");
			btn.appendChild(icon("pencil", 9));
			attach(anchor, "pencil", btn);
			pencil = btn;
		}
		pencilMeta.set(pencil, {
			mid,
			nickname,
			scene
		});
		if (!pencilBound.has(pencil)) {
			pencilBound.add(pencil);
			pencil.addEventListener("mouseenter", () => showPencil(anchor));
			pencil.addEventListener("mouseleave", () => hidePencilSoon(anchor));
			pencil.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				const meta = pencilMeta.get(pencil);
				if (!meta) return;
				openEditor({
					mid: meta.mid,
					anchor: pencil,
					nickname: meta.nickname,
					scene: meta.scene
				});
			});
		}
		if (!anchorBound.has(anchor)) {
			anchorBound.add(anchor);
			anchor.addEventListener("mouseenter", () => showPencil(anchor));
			anchor.addEventListener("mouseleave", () => hidePencilSoon(anchor));
			anchor.addEventListener("focus", () => showPencil(anchor));
			anchor.addEventListener("blur", () => hidePencilSoon(anchor));
			anchor.parentElement?.addEventListener("mouseleave", () => hidePencilSoon(anchor));
		}
		refresh();
	}
	function pruneBadges() {
		for (const el of list("badge")) {
			const mid = el.getAttribute("data-brmk-mid") ?? "";
			const rec = store.get(mid);
			if (!rec || !rec.remark && !rec.tags.length) removeEl(el);
		}
		for (const el of inlineBadges) {
			if (!el.isConnected) {
				inlineBadges.delete(el);
				continue;
			}
			const mid = el.getAttribute("data-brmk-mid") ?? "";
			const rec = store.get(mid);
			if (!rec || !rec.remark && !rec.tags.length) {
				el.remove();
				inlineBadges.delete(el);
			}
		}
	}
	function clearPencilsOfScene(scene) {
		for (const el of list("pencil")) if (pencilMeta.get(el)?.scene === scene) removeEl(el);
	}
	function badgeCount() {
		let count$1 = count("badge");
		for (const el of inlineBadges) if (el.isConnected) count$1++;
		else inlineBadges.delete(el);
		return count$1;
	}
	function clearAll() {
		clear();
		for (const el of inlineBadges) el.remove();
		inlineBadges.clear();
	}
	function badgeOptions() {
		const s = getSettings().display;
		return {
			showTags: s.showTags,
			showColorDot: s.showColorDot,
			maxTags: s.maxTags,
			showOnHoverOnly: s.showOnHoverOnly
		};
	}
	var HOST = "bili-comments";
	var USER_INFO = "bili-comment-user-info";
	var MID_LINK = "a[href*=\"space.bilibili.com/\"]";
	var RENDERERS = "bili-comment-renderer, bili-comment-reply-renderer";
	var MAX_ANCHORS = 300;
	function hasCommentHost() {
		return !!qs(HOST);
	}
	function faceOfComment(renderer) {
		if (!renderer) return "";
		for (const img of queryDeepAll(renderer.shadowRoot ?? renderer, "img", {
			maxDepth: 6,
			limit: 20
		})) {
			const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
			if (src.includes("/bfs/face/")) return src;
		}
		return "";
	}
	function pickTargets$5() {
		const hosts = qsa(HOST);
		const hits = [{
			selector: HOST,
			hits: hosts.length
		}];
		const targets = [];
		let userInfoHits = 0;
		for (const host of hosts) {
			const users = queryDeepAll(host.shadowRoot ?? host, USER_INFO, {
				maxDepth: 12,
				limit: MAX_ANCHORS
			});
			userInfoHits += users.length;
			for (const ui of users) {
				if (targets.length >= MAX_ANCHORS) break;
				const sr = ui.shadowRoot;
				if (!sr) continue;
				const mid = midFromHref(sr.querySelector(MID_LINK)?.getAttribute("href") ?? null);
				if (!mid) continue;
				const nameEl = sr.querySelector("#user-name");
				const nickname = (nameEl?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
				const anchor = nameEl?.parentElement ?? nameEl ?? ui;
				const badgeAnchor = nameEl ?? void 0;
				const renderer = closestDeep(ui, RENDERERS);
				targets.push({
					anchor,
					badgeAnchor,
					mid,
					nickname,
					face: faceOfComment(renderer)
				});
			}
		}
		hits.push({
			selector: USER_INFO,
			hits: userInfoHits
		});
		return {
			targets,
			hits
		};
	}
	function inject$5(targets) {
		const opts = {
			...badgeOptions(),
			scene: "comment",
			showTags: false
		};
		let injected = 0;
		for (const target of targets) {
			if (!target.anchor.isConnected) continue;
			rememberNick(target.mid, target.nickname);
			if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face);
			const record = store.get(target.mid);
			if (record) {
				let ok = null;
				if (target.badgeAnchor) {
					ok = renderInlineBadge(target.badgeAnchor, record, opts);
					detach(target.anchor, "pencil");
				} else ok = renderBadge(target.anchor, record, opts);
				if (ok) injected++;
			} else ensurePencil(target.anchor, target.mid, target.nickname, "comment");
		}
		return injected;
	}
	var batchToken = 0;
	var hostObserver = null;
	var hostObserved = null;
	var hostScanTimer = null;
	function watchHost() {
		const root = qs(HOST)?.shadowRoot;
		if (!root) return;
		if (hostObserved === root) return;
		unwatchHost();
		hostObserved = root;
		hostObserver = new MutationObserver(() => {
			if (hostScanTimer !== null) return;
			hostScanTimer = window.setTimeout(() => {
				hostScanTimer = null;
				const settings = getSettings();
				if (settings.enabled && settings.scenes.comment) scanComments();
			}, 50);
		});
		hostObserver.observe(root, {
			childList: true,
			subtree: true
		});
	}
	function unwatchHost() {
		hostObserver?.disconnect();
		hostObserver = null;
		hostObserved = null;
		if (hostScanTimer !== null) {
			window.clearTimeout(hostScanTimer);
			hostScanTimer = null;
		}
	}
	var retryToken = 0;
	var retryCount = 0;
	var RETRY_MAX = 20;
	function scheduleRetryScan() {
		if (retryCount >= RETRY_MAX) return;
		retryCount++;
		const token = ++retryToken;
		window.setTimeout(() => {
			if (token !== retryToken) return;
			const settings = getSettings();
			if (settings.enabled && settings.scenes.comment && hasCommentHost()) scanComments();
		}, 250);
	}
	function scanComments() {
		const token = ++batchToken;
		watchHost();
		const { targets, hits } = pickTargets$5();
		const diag = {
			scene: "comment",
			label: "评论区",
			selectors: hits,
			midResolved: targets.length,
			injected: 0,
			notes: []
		};
		if (!targets.length) {
			diag.notes.push("评论区组件存在但未解析到评论者（可能尚未加载完或结构已变）");
			setDiagnostic(diag);
			scheduleRetryScan();
			return;
		}
		retryCount = 0;
		setDiagnostic(diag);
		const size = Math.max(1, getSettings().advanced.maxNodesPerTick);
		let index = 0;
		let injected = 0;
		const step = () => {
			if (token !== batchToken) return;
			const settings = getSettings();
			if (!settings.enabled || !settings.scenes.comment) return;
			const slice = targets.slice(index, index + size);
			index += slice.length;
			injected += inject$5(slice);
			if (index < targets.length) window.setTimeout(step, 0);
			else {
				diag.injected = injected;
				setDiagnostic(diag);
			}
		};
		step();
	}
	function cancelCommentBatch() {
		batchToken++;
		retryToken++;
		unwatchHost();
	}
	function clearCommentPencils() {
		cancelCommentBatch();
		clearPencilsOfScene("comment");
	}
	var CANDIDATES$1 = ["a.bili-video-card__info--owner", ".video-page-card-small .upname a[href*=\"space.bilibili.com/\"]"];
	function hasCardHost() {
		return !!qs(".bili-video-card, .video-page-card-small .upname");
	}
	var SIDE_ITEM = ".video-page-card-small";
	var ROW_MIN_AGE_MS$1 = 3e3;
	var rowFirstSeen$1 = new WeakMap();
	function isSidebarAnchor(anchor) {
		return !!anchor.closest(SIDE_ITEM);
	}
	function ensureSidebarRow(anchor, record, options) {
		const upname = anchor.closest(".upname");
		const info = upname?.parentElement;
		if (!upname || !info) return;
		if (!record.remark && !record.tags.length) {
			info.querySelector(":scope > .brmk-card-badge-row")?.remove();
			return;
		}
		const now = Date.now();
		const born = rowFirstSeen$1.get(upname);
		if (born === void 0) {
			rowFirstSeen$1.set(upname, now);
			return;
		}
		if (now - born < ROW_MIN_AGE_MS$1) return;
		const play = info.querySelector(".playinfo");
		if (!play || !play.textContent?.trim()) return;
		const sig = badgeSignature(record, options);
		const existing = info.querySelector(":scope > .brmk-card-badge-row");
		if (!existing) {
			const row = h("div", "brmk-card-badge-row");
			row.setAttribute("data-brmk-mid", record.mid);
			row.appendChild(buildBadgeElement(record, options));
			const next = upname.nextElementSibling;
			try {
				info.insertBefore(row, next);
			} catch {
				row.remove();
				return;
			}
		} else if (existing.firstElementChild?.getAttribute("data-brmk-sig") !== sig) {
			const fresh = buildBadgeElement(record, options);
			const old = existing.firstElementChild;
			if (old) existing.replaceChild(fresh, old);
			else existing.appendChild(fresh);
		}
	}
	function pruneSidebarRows() {
		for (const row of qsa(".brmk-card-badge-row")) {
			const rec = store.get(row.getAttribute("data-brmk-mid") ?? "");
			if (!rec || !rec.remark && !rec.tags.length) row.remove();
		}
	}
	function clearSidebarRows() {
		for (const row of qsa(".brmk-card-badge-row")) row.remove();
	}
	function nicknameOf(anchor) {
		return snapshotNickname(qs("span.bili-video-card__info--author, span.name", anchor) ?? anchor);
	}
	var lazyBound$2 = new WeakSet();
	function bindLazyPencil$2(anchor, mid, nickname) {
		if (lazyBound$2.has(anchor)) return;
		lazyBound$2.add(anchor);
		anchor.addEventListener("mouseenter", () => {
			if (!anchor.isConnected) return;
			ensurePencil(anchor, mid, nickname, "card");
			showPencil(anchor);
		});
	}
	function pickTargets$4() {
		const hits = [];
		const targets = [];
		const seen = new Set();
		for (let ci = 0; ci < CANDIDATES$1.length; ci++) {
			const selector = CANDIDATES$1[ci];
			const found = qsa(selector).filter((el) => isVisible(el) && !seen.has(el));
			hits.push({
				selector,
				hits: found.length
			});
			for (const el of found) {
				seen.add(el);
				const resolved = resolveFromElement(el);
				if (!resolved) continue;
				if (targets.some((t) => t.mid === resolved.mid && (t.anchor.contains(el) || el.contains(t.anchor)))) continue;
				targets.push({
					anchor: el,
					mid: resolved.mid,
					nickname: nicknameOf(el),
					below: ci === 0
				});
			}
		}
		return {
			targets,
			hits
		};
	}
	function inject$4(targets) {
		const opts = {
			...badgeOptions(),
			scene: "card"
		};
		let injected = 0;
		for (const target of targets) {
			if (!target.anchor.isConnected) continue;
			rememberNick(target.mid, target.nickname);
			const record = store.get(target.mid);
			if (record) {
				if (isSidebarAnchor(target.anchor)) {
					ensureSidebarRow(target.anchor, record, opts);
					injected++;
				} else if (renderBadge(target.anchor, record, target.below ? {
					...opts,
					placeBelow: true
				} : opts)) injected++;
			} else bindLazyPencil$2(target.anchor, target.mid, target.nickname);
		}
		return injected;
	}
	function scanCards() {
		const { targets, hits } = pickTargets$4();
		let injected = 0;
		if (getSettings().scenes.card && getSettings().enabled) {
			pruneSidebarRows();
			injected = inject$4(targets);
		}
		const diag = {
			scene: "card",
			label: "视频卡片",
			selectors: hits,
			midResolved: targets.length,
			injected,
			notes: []
		};
		if (!targets.length) diag.notes.push("未找到卡片 UP 主锚点（可能尚未水合、不是卡片页或结构已变）");
		setDiagnostic(diag);
		return diag;
	}
	function clearCardPencils() {
		clearPencilsOfScene("card");
		clearSidebarRows();
	}
	function clearCardInline() {
		clearSidebarRows();
	}
	var AUTHOR_CANDIDATES = [".opus-module-author__name"];
	function isDynamicPage() {
		return /\/opus\//i.test(location.pathname) || location.hostname === "t.bilibili.com";
	}
	function midText(v) {
		const s = String(v ?? "").trim();
		return /^\d{1,20}$/.test(s) && s !== "0" ? s : null;
	}
	function authorFromState() {
		const s = pageState();
		if (!s) return null;
		try {
			const modules = s.detail?.modules;
			if (!Array.isArray(modules)) return null;
			const m = modules.find((x) => x?.module_type === "MODULE_TYPE_AUTHOR")?.module_author;
			if (!m) return null;
			const mid = midFromHref(typeof m.jump_url === "string" ? m.jump_url : null) ?? midText(m.mid);
			if (!mid) return null;
			return {
				mid,
				name: typeof m.name === "string" ? m.name : "",
				face: typeof m.face === "string" ? m.face : ""
			};
		} catch {
			return null;
		}
	}
	function authorFromLink(container) {
		const mid = midFromHref(qs("a[href*=\"space.bilibili.com/\"]", container)?.getAttribute("href") ?? null);
		if (!mid) return null;
		let face = "";
		for (const img of qsa("img", container)) {
			const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
			if (src.includes("/bfs/face/")) {
				face = src;
				break;
			}
		}
		return {
			mid,
			face
		};
	}
	function pickTargets$3() {
		const hits = [];
		const targets = [];
		for (const selector of AUTHOR_CANDIDATES) {
			const found = qsa(selector).filter((el) => isVisible(el));
			hits.push({
				selector,
				hits: found.length
			});
			const anchor = found[0];
			if (!anchor) continue;
			const container = anchor.closest(".opus-module-author");
			const state = authorFromState();
			if (state) {
				targets.push({
					anchor,
					mid: state.mid,
					nickname: state.name || snapshotNickname(anchor),
					face: state.face
				});
				break;
			}
			const viaLink = container ? authorFromLink(container) : null;
			if (viaLink) targets.push({
				anchor,
				mid: viaLink.mid,
				nickname: snapshotNickname(anchor),
				face: viaLink.face
			});
			break;
		}
		return {
			targets,
			hits
		};
	}
	function inject$3(targets) {
		const opts = {
			...badgeOptions(),
			scene: "dynamic"
		};
		let injected = 0;
		for (const target of targets) {
			if (!target.anchor.isConnected) continue;
			rememberNick(target.mid, target.nickname);
			if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face);
			const record = store.get(target.mid);
			if (record) {
				if (renderBadge(target.anchor, record, opts)) injected++;
			} else ensurePencil(target.anchor, target.mid, target.nickname, "dynamic");
		}
		return injected;
	}
	function scanDynamic() {
		const { targets, hits } = pickTargets$3();
		let injected = 0;
		if (getSettings().scenes.dynamic && getSettings().enabled) injected = inject$3(targets);
		const diag = {
			scene: "dynamic",
			label: "动态页",
			selectors: hits,
			midResolved: targets.length,
			injected,
			notes: []
		};
		if (!targets.length) diag.notes.push("未找到动态作者锚点（可能尚未渲染完成、不是动态详情页或结构已变）");
		setDiagnostic(diag);
		return diag;
	}
	function clearDynamicPencils() {
		clearPencilsOfScene("dynamic");
	}
	var SCOPES = [
		"#v_upinfo",
		".up-detail",
		".video-info-meta",
		".up-info--right",
		".video-info-container"
	];
	var CANDIDATES = [
		"#v_upinfo .up-name",
		".up-detail .up-name",
		".video-info-meta .up-name",
		".up-info--right .up-name",
		".up-info .up-name",
		"#v_upinfo a[href*=\"space.bilibili.com/\"]",
		".up-detail a[href*=\"space.bilibili.com/\"]"
	];
	function isVideoPage() {
		return /^\/(video\/(BV|av)|list\/)/i.test(location.pathname);
	}
	function inScope(el) {
		for (const scope of SCOPES) if (el.closest(scope)) return true;
		return false;
	}
	var FACE_IMGS = [
		"img[src*=\"/bfs/face/\"]",
		"img[data-src*=\"/bfs/face/\"]",
		".up-avatar-wrap img",
		".up-avatar img",
		".bili-avatar img"
	];
	function faceNear(el) {
		const container = closestDeep(el, SCOPES.join(","));
		if (!container) return "";
		for (const selector of FACE_IMGS) {
			const img = qs(selector, container);
			const src = img?.getAttribute("src") ?? img?.getAttribute("data-src") ?? "";
			if (src && !src.startsWith("data:")) return src;
		}
		return "";
	}
	function pickTargets$2() {
		const hits = [];
		const targets = [];
		const seen = new Set();
		for (const selector of CANDIDATES) {
			const found = qsa(selector).filter((el) => inScope(el));
			hits.push({
				selector,
				hits: found.length
			});
			for (const el of found) {
				if (targets.length >= 3) continue;
				const mid = resolveFromElement(el, { allowDescendant: false })?.mid ?? null;
				if (!mid || seen.has(mid)) continue;
				seen.add(mid);
				targets.push({
					anchor: el,
					mid,
					nickname: snapshotNickname(el) || (targets.length === 0 ? pageUpName() : ""),
					face: faceNear(el)
				});
			}
			if (targets.length) break;
		}
		if (!targets.length) {
			const mid = pageUpMid();
			if (mid) for (const scope of SCOPES) {
				const container = qs(scope);
				if (!container) continue;
				const link = qs("a[href*=\"space.bilibili.com/\"]", container);
				if (link && isVisible(link)) {
					targets.push({
						anchor: link,
						mid,
						nickname: pageUpName() || snapshotNickname(link),
						face: faceNear(link)
					});
					break;
				}
			}
		}
		return {
			targets,
			hits
		};
	}
	function inject$2(targets) {
		const settings = getSettings();
		const opts = {
			...badgeOptions(),
			scene: "videoUp"
		};
		let injected = 0;
		for (const target of targets) {
			if (!target.anchor.isConnected) continue;
			rememberNick(target.mid, target.nickname);
			if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face);
			const record = store.get(target.mid);
			if (record) {
				if (renderBadge(target.anchor, record, opts)) injected++;
			} else ensurePencil(target.anchor, target.mid, target.nickname, settings.scenes.videoUp ? "videoUp" : void 0);
		}
		return injected;
	}
	function scanVideoUp() {
		const { targets, hits } = pickTargets$2();
		let injected = 0;
		if (getSettings().scenes.videoUp && getSettings().enabled) injected = inject$2(targets);
		const diag = {
			scene: "videoUp",
			label: "视频页 UP 主",
			selectors: hits,
			midResolved: targets.length,
			injected,
			notes: []
		};
		if (!targets.length) diag.notes.push("未找到 UP 主锚点，页面结构可能已变");
		setDiagnostic(diag);
		return diag;
	}
	function clearVideoUpPencils() {
		clearPencilsOfScene("videoUp");
	}
	var IM_HOST_RE = /(^|\.)message\.bilibili\.com$/i;
	var FIXTURE_ATTR$2 = "data-brmk-im-fixture";
	var MID_FROM_HASH_RE = /\/whisper\/mid(\d{1,20})/;
	var ROW_CONTAINER_RE = /(?:^|\s)_SessionItem_[A-Za-z0-9]+_\d+/;
	var ROW_SELECTOR = "[class*=\"SessionItem_\"]";
	var NAME_SELECTOR = "[class*=\"SessionItem__Name\"]";
	var TITLE_SELECTOR = "[class*=\"SessionItem__Title\"]";
	var CONTACT_SELECTOR = "[class*=\"ContactName\"]";
	function isImPage() {
		if (document.documentElement.hasAttribute(FIXTURE_ATTR$2)) return !!document.getElementById("message-pc-app");
		if (!IM_HOST_RE.test(location.hostname)) return false;
		if (location.pathname !== "/") return false;
		return !!qs("#app .message-layout") || !!document.getElementById("message-pc-app");
	}
	function isRowContainer(el) {
		const cls = typeof el.className === "string" ? el.className : "";
		return ROW_CONTAINER_RE.test(cls) && !cls.includes("SessionItem__");
	}
	function midFromRow(row) {
		const dataId = row.getAttribute("data-id") ?? "";
		const mid = /^contact_(\d{1,20})$/.exec(dataId)?.[1];
		return mid && mid !== "0" ? mid : null;
	}
	function anchorOfRow(row) {
		return qs(NAME_SELECTOR, row) ?? qs(TITLE_SELECTOR, row) ?? row;
	}
	function faceFromRow(row) {
		return row.querySelector("img[src*=\"/bfs/face/\"]")?.getAttribute("src") ?? "";
	}
	var ROW_MIN_AGE_MS = 3e3;
	var rowFirstSeen = new WeakMap();
	var imInline = new Set();
	function pickTargets$1() {
		const rows = qsa(ROW_SELECTOR).filter((el) => isRowContainer(el) && isVisible(el));
		const contacts = qsa(CONTACT_SELECTOR).filter((el) => isVisible(el));
		const hits = [
			{
				selector: ROW_SELECTOR,
				hits: rows.length
			},
			{
				selector: NAME_SELECTOR,
				hits: qsa(NAME_SELECTOR).length
			},
			{
				selector: CONTACT_SELECTOR,
				hits: contacts.length
			}
		];
		const targets = [];
		for (const row of rows) {
			const mid = midFromRow(row);
			if (!mid) continue;
			const anchor = anchorOfRow(row);
			if (targets.some((t) => t.mid === mid && (t.anchor.contains(anchor) || anchor.contains(t.anchor)))) continue;
			targets.push({
				anchor,
				mid,
				nickname: snapshotNickname(anchor),
				face: faceFromRow(row),
				lazy: true
			});
		}
		const hashMid = MID_FROM_HASH_RE.exec(location.hash)?.[1];
		if (hashMid && hashMid !== "0" && contacts.length) {
			const anchor = contacts[0];
			if (!targets.some((t) => t.mid === hashMid && (t.anchor.contains(anchor) || anchor.contains(t.anchor)))) targets.push({
				anchor,
				mid: hashMid,
				nickname: snapshotNickname(anchor),
				face: "",
				lazy: false
			});
		}
		for (const row of rows) {
			if (midFromRow(row)) continue;
			const resolved = resolveFromElement(anchorOfRow(row));
			if (resolved && !targets.some((t) => t.mid === resolved.mid)) {
				const anchor = anchorOfRow(row);
				targets.push({
					anchor,
					mid: resolved.mid,
					nickname: snapshotNickname(anchor),
					face: faceFromRow(row),
					lazy: true
				});
			}
		}
		return {
			targets,
			hits
		};
	}
	var lazyBound$1 = new WeakSet();
	function bindLazyPencil$1(anchor, mid, nickname) {
		if (lazyBound$1.has(anchor)) return;
		lazyBound$1.add(anchor);
		anchor.addEventListener("mouseenter", () => {
			if (!anchor.isConnected) return;
			ensurePencil(anchor, mid, nickname, "message");
			showPencil(anchor);
		});
	}
	function inject$1(targets) {
		const rowOpts = {
			...badgeOptions(),
			scene: "message",
			showTags: false,
			inlineGap: 6
		};
		const headerOpts = {
			...badgeOptions(),
			scene: "message"
		};
		let injected = 0;
		for (const target of targets) {
			if (!target.anchor.isConnected) continue;
			rememberNick(target.mid, target.nickname);
			if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face);
			const record = store.get(target.mid);
			if (!record) {
				if (target.lazy) bindLazyPencil$1(target.anchor, target.mid, target.nickname);
				else ensurePencil(target.anchor, target.mid, target.nickname, "message");
				continue;
			}
			if (!target.lazy) {
				if (renderBadge(target.anchor, record, headerOpts)) injected++;
				continue;
			}
			if (!target.anchor.parentElement?.className.includes("SessionItem__Title")) {
				if (renderBadge(target.anchor, record, rowOpts)) injected++;
				continue;
			}
			const born = rowFirstSeen.get(target.anchor);
			if (born === void 0) {
				rowFirstSeen.set(target.anchor, Date.now());
				continue;
			}
			if (Date.now() - born < ROW_MIN_AGE_MS) continue;
			const el = renderInlineBadge(target.anchor, record, rowOpts);
			if (el) {
				imInline.add(el);
				injected++;
			}
		}
		return injected;
	}
	function scanIm() {
		const { targets, hits } = pickTargets$1();
		let injected = 0;
		for (const el of imInline) if (!el.isConnected) imInline.delete(el);
		if (getSettings().scenes.message && getSettings().enabled) injected = inject$1(targets);
		const diag = {
			scene: "message",
			label: "私信",
			selectors: hits,
			midResolved: targets.length,
			injected,
			notes: []
		};
		if (!targets.length) diag.notes.push("未找到会话行/联系人锚点（列表为空、未打开会话、结构已变或行 data-id 非 contact_ 前缀）");
		setDiagnostic(diag);
		return diag;
	}
	function clearImPencils() {
		clearPencilsOfScene("message");
		for (const el of imInline) el.remove();
		imInline.clear();
	}
	var SPACE_HOST_RE$1 = /(^|\.)space\.bilibili\.com$/i;
	var FIXTURE_ATTR$1 = "data-brmk-relation-fixture";
	var RELATION_PATH_RE = /^\/\d{1,20}\/relation\/(?:fans|follow)\/?$/;
	var UNAME_SELECTOR = ".relation-content .items a.relation-card-info__uname";
	var CARD_LINK_SELECTOR = ".relation-content .items .relation-card a[href*=\"space.bilibili.com/\"]";
	function isRelationPage() {
		if (!document.documentElement.hasAttribute(FIXTURE_ATTR$1) && !SPACE_HOST_RE$1.test(location.hostname)) return false;
		if (!RELATION_PATH_RE.test(location.pathname)) return false;
		return !!qs("main.route_relationFans, main.route_relationFollow");
	}
	function faceFromCard(anchor) {
		return (anchor.closest(".relation-card") ?? anchor.closest(".items"))?.querySelector("img[src*=\"/bfs/face/\"]")?.getAttribute("src") ?? "";
	}
	function pickTargets() {
		const unames = qsa(UNAME_SELECTOR).filter((el) => isVisible(el));
		const cardLinks = qsa(CARD_LINK_SELECTOR).filter((el) => isVisible(el));
		const hits = [{
			selector: UNAME_SELECTOR,
			hits: unames.length
		}, {
			selector: CARD_LINK_SELECTOR,
			hits: cardLinks.length
		}];
		const targets = [];
		const cardOf = (el) => el.closest(".relation-card");
		const doneCards = new Set();
		for (const anchor of unames) {
			const resolved = resolveFromElement(anchor, { allowDescendant: false });
			if (!resolved) continue;
			const card = cardOf(anchor);
			if (card && doneCards.has(card)) continue;
			if (card) doneCards.add(card);
			targets.push({
				anchor,
				mid: resolved.mid,
				nickname: snapshotNickname(anchor),
				face: faceFromCard(anchor)
			});
		}
		for (const link of cardLinks) {
			const card = cardOf(link);
			if (card && doneCards.has(card)) continue;
			const resolved = resolveFromElement(link, { allowDescendant: false });
			if (!resolved) continue;
			if (card) doneCards.add(card);
			targets.push({
				anchor: link,
				mid: resolved.mid,
				nickname: snapshotNickname(link),
				face: faceFromCard(link)
			});
		}
		return {
			targets,
			hits
		};
	}
	var lazyBound = new WeakSet();
	function bindLazyPencil(anchor, mid, nickname) {
		if (lazyBound.has(anchor)) return;
		lazyBound.add(anchor);
		anchor.addEventListener("mouseenter", () => {
			if (!anchor.isConnected) return;
			ensurePencil(anchor, mid, nickname, "relation", true);
			showPencil(anchor);
		});
	}
	function inject(targets) {
		const opts = {
			...badgeOptions(),
			scene: "relation",
			placeInline: true
		};
		let injected = 0;
		for (const target of targets) {
			if (!target.anchor.isConnected) continue;
			rememberNick(target.mid, target.nickname);
			if (target.face && !faceOf(target.mid)) rememberFace(target.mid, target.face);
			const record = store.get(target.mid);
			if (record) {
				if (renderBadge(target.anchor, record, opts)) injected++;
			} else bindLazyPencil(target.anchor, target.mid, target.nickname);
		}
		return injected;
	}
	function scanRelation() {
		const { targets, hits } = pickTargets();
		let injected = 0;
		if (getSettings().scenes.relation && getSettings().enabled) injected = inject(targets);
		const diag = {
			scene: "relation",
			label: "粉丝/关注",
			selectors: hits,
			midResolved: targets.length,
			injected,
			notes: []
		};
		if (!targets.length) diag.notes.push("未找到关系列表行（未登录登录墙 / 列表为空 / 非卡片壳或结构已变）");
		setDiagnostic(diag);
		return diag;
	}
	function clearRelationPencils() {
		clearPencilsOfScene("relation");
	}
	var HOST_CANDIDATES = [".aside", ".space-dynamic__right"];
	var CARD_ID = "brmk-space-card";
	var SCENE = "space";
	var ANN_ANCHORS = [".ann-section", "#ann-card"];
	var SURFACES = {
		light: [
			246,
			247,
			248
		],
		dark: [
			36,
			37,
			41
		]
	};
	var cardTheme = "light";
	var FIXTURE_ATTR = "data-brmk-space-fixture";
	var SPACE_HOST_RE = /^space\.bilibili\.com$/i;
	var SPACE_PATH_RE = /^\/(\d{1,20})(?:\/|$)/;
	var card = null;
	var cardMid = "";
	var editing = false;
	var lastSig = "";
	var draftTags = [];
	var refreshView = null;
	function isSpacePage() {
		if (!SPACE_HOST_RE.test(location.hostname) && !document.documentElement.hasAttribute(FIXTURE_ATTR)) return false;
		return SPACE_PATH_RE.test(location.pathname);
	}
	function spaceMid() {
		const m = SPACE_PATH_RE.exec(location.pathname);
		if (m && m[1] !== "0") return m[1];
		return pageUrlMid();
	}
	function titleNickname() {
		const title = document.title || "";
		const m = /^(.+?)(?:的个人空间|个人动态)/.exec(title);
		return m ? m[1].trim().slice(0, 100) : "";
	}
	function avatarFaceOf(host) {
		for (const img of queryDeepAll(host, "img", {
			maxDepth: 4,
			limit: 10
		})) {
			const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
			if (src.includes("/bfs/face/")) return src;
		}
		return "";
	}
	function findHost() {
		const hits = [];
		for (const selector of HOST_CANDIDATES) {
			const found = qsa(selector);
			hits.push({
				selector,
				hits: found.length
			});
			if (found.length) return {
				host: found[0],
				hits
			};
		}
		return {
			host: null,
			hits
		};
	}
	function announcementAnchor(host) {
		for (const selector of ANN_ANCHORS) {
			let el = qs(selector, host);
			while (el && el.parentElement !== host) el = el.parentElement;
			if (el && el.parentElement === host && el.id !== CARD_ID) return el;
		}
		for (const child of Array.from(host.children)) {
			if (child.id === CARD_ID) continue;
			if ((qs("[class*=\"header\"],[class*=\"head\"]", child)?.textContent ?? "").trim().startsWith("公告")) return child;
		}
		return null;
	}
	function surfaceThemeOf(host) {
		for (const selector of [
			".ann-section",
			".home-aside-section > div",
			".info-section",
			".elec-section"
		]) {
			const el = qs(selector, host);
			if (!el) continue;
			const bg = getComputedStyle(el).backgroundColor;
			if (!bg || /,\s*0\)$/.test(bg)) continue;
			const lum = luminanceOf(bg);
			if (lum === null) continue;
			return lum < .35 ? "dark" : "light";
		}
		return "light";
	}
	function hasContent(record) {
		if (!record) return false;
		return !!record.remark || record.tags.length > 0 || !!record.note.trim();
	}
	function signatureOf(record) {
		return [
			record?.remark ?? "",
			record?.tags.join("") ?? "",
			record?.note ?? "",
			String(record?.updatedAt ?? 0),
			record?.color ?? ""
		].join("");
	}
	function destroy() {
		card?.remove();
		card = null;
		cardMid = "";
		editing = false;
		lastSig = "";
		draftTags = [];
		refreshView = null;
	}
	function mount(host, mid) {
		const nickname = titleNickname();
		if (nickname) rememberNick(mid, nickname);
		const face = avatarFaceOf(host);
		if (face) rememberFace(mid, face);
		const el = h("div", "brmk-space-card");
		el.id = CARD_ID;
		el.setAttribute("data-brmk-mid", mid);
		el.setAttribute("data-brmk-scene", SCENE);
		cardTheme = surfaceThemeOf(host);
		el.setAttribute("data-brmk-sp-theme", cardTheme);
		const head = h("div", "brmk-sp-head");
		const title = h("span", "brmk-sp-title", "备注");
		const editBtn = h("button", "brmk-sp-link", "编辑备注");
		editBtn.type = "button";
		editBtn.setAttribute("data-act", "edit");
		head.append(title, editBtn);
		const view = h("div", "brmk-sp-view");
		const nameRow = h("div", "brmk-sp-name");
		const dot = h("span", "brmk-sp-dot");
		const nameText = h("span", "brmk-sp-nametext");
		nameRow.append(dot, nameText);
		const tagsRow = h("div", "brmk-sp-tags");
		const noteEl = h("div", "brmk-sp-note");
		const foot = h("div", "brmk-sp-foot");
		const midBtn = h("button", "brmk-sp-mid", mid);
		midBtn.type = "button";
		midBtn.title = "点击复制";
		midBtn.setAttribute("data-act", "copy-mid");
		const footSep = h("span", "brmk-sp-meta", "·");
		const footMeta = h("span", "brmk-sp-meta");
		const footSpacer = h("span", "brmk-sp-spacer");
		const advBtn = h("button", "brmk-sp-link brmk-sp-adv", "高级编辑");
		advBtn.type = "button";
		advBtn.setAttribute("data-act", "advanced");
		foot.append(midBtn, footSep, footMeta, footSpacer, advBtn);
		view.append(nameRow, tagsRow, noteEl, foot);
		const empty = h("div", "brmk-sp-empty");
		const emptyText = h("div", "brmk-sp-emptytext", "还没给这位用户写备注。");
		const addBtn = h("button", "brmk-btn brmk-btn-primary", "添加备注");
		addBtn.type = "button";
		addBtn.setAttribute("data-act", "add");
		empty.append(emptyText, addBtn);
		const editor = h("div", "brmk-sp-editor");
		const remarkLabel = h("label", "brmk-sp-label", `备注名（≤${LIMITS.remark} 字）`);
		const remarkInput = h("input", "brmk-sp-input");
		remarkInput.type = "text";
		remarkInput.maxLength = LIMITS.remark;
		remarkInput.placeholder = "例如：老番茄 / 某某的另一个号";
		remarkInput.setAttribute("data-field", "remark");
		const tagLabel = h("label", "brmk-sp-label", `标签（≤${LIMITS.tags} 个，回车添加）`);
		const chips = h("div", "brmk-sp-chips");
		const tagInput = h("input", "brmk-sp-input");
		tagInput.type = "text";
		tagInput.maxLength = LIMITS.tag;
		tagInput.placeholder = "输入后按回车";
		tagInput.setAttribute("data-field", "tag");
		const noteLabel = h("label", "brmk-sp-label", `长文本备注（≤${LIMITS.note} 字，仅自己可见）`);
		const noteInput = h("textarea", "brmk-sp-textarea");
		noteInput.maxLength = LIMITS.note;
		noteInput.placeholder = "为什么备注这个人、注意什么……";
		noteInput.setAttribute("data-field", "note");
		const counter = h("div", "brmk-sp-counter");
		const countNum = h("span", "brmk-sp-count", "0");
		counter.append(countNum, document.createTextNode(`/${LIMITS.note}`));
		const actions = h("div", "brmk-sp-actions");
		const cancelBtn = h("button", "brmk-btn", "取消");
		cancelBtn.type = "button";
		cancelBtn.setAttribute("data-act", "cancel");
		const saveBtn = h("button", "brmk-btn brmk-btn-primary", "保存");
		saveBtn.type = "button";
		saveBtn.setAttribute("data-act", "save");
		actions.append(cancelBtn, saveBtn);
		editor.append(remarkLabel, remarkInput, tagLabel, chips, tagInput, noteLabel, noteInput, counter, actions);
		el.append(head, view, empty, editor);
		const anchor = announcementAnchor(host);
		if (anchor) host.insertBefore(el, anchor);
		else host.appendChild(el);
		const currentRecord = () => store.get(mid);
		const renderChips = () => {
			chips.textContent = "";
			draftTags.forEach((tag, index) => {
				const chip = h("span", "brmk-sp-chip", tag);
				const remove = h("button", "brmk-sp-chipx", "×");
				remove.type = "button";
				remove.title = "移除标签";
				remove.setAttribute("data-act", "chip-remove");
				remove.addEventListener("click", () => {
					draftTags.splice(index, 1);
					renderChips();
				});
				chip.appendChild(remove);
				chips.appendChild(chip);
			});
			tagInput.disabled = draftTags.length >= LIMITS.tags;
			tagInput.placeholder = draftTags.length >= LIMITS.tags ? "已达标签上限" : "输入后按回车";
		};
		const addTag = () => {
			const raw = tagInput.value.trim().replace(/[,，;；]/g, "");
			tagInput.value = "";
			if (!raw) return;
			if (draftTags.length >= LIMITS.tags) {
				toast(`最多 ${LIMITS.tags} 个标签`);
				return;
			}
			const tag = raw.slice(0, LIMITS.tag);
			if (draftTags.includes(tag)) return;
			draftTags.push(tag);
			renderChips();
		};
		const syncCount = () => {
			countNum.textContent = String(noteInput.value.length);
		};
		const renderView = () => {
			const record = currentRecord();
			const filled = hasContent(record);
			view.hidden = !filled;
			empty.hidden = filled;
			editor.hidden = true;
			editBtn.hidden = !filled;
			editBtn.textContent = "编辑备注";
			if (!filled) return;
			nameText.textContent = record?.remark || record?.nickSnapshot || `mid ${mid}`;
			if (record?.color) el.style.setProperty("--brmk-sp-c", readableOn(record.color, SURFACES[cardTheme]));
			else el.style.removeProperty("--brmk-sp-c");
			tagsRow.textContent = "";
			for (const tag of record?.tags ?? []) tagsRow.appendChild(h("span", "brmk-sp-tag", tag));
			tagsRow.hidden = !(record?.tags.length ?? 0);
			noteEl.textContent = record?.note ?? "";
			noteEl.hidden = !record?.note.trim();
			footMeta.textContent = `更新于 ${formatDay(record?.updatedAt ?? Date.now())}`;
		};
		const enterEdit = () => {
			const record = currentRecord();
			draftTags = record?.tags ? [...record.tags] : [];
			remarkInput.value = record?.remark ?? "";
			noteInput.value = record?.note ?? "";
			tagInput.value = "";
			renderChips();
			syncCount();
			editing = true;
			view.hidden = true;
			empty.hidden = true;
			editor.hidden = false;
			editBtn.hidden = true;
			lastSig = "";
			remarkInput.focus();
		};
		const exitEdit = () => {
			editing = false;
			editor.hidden = true;
			lastSig = "";
			renderView();
		};
		const doSave = () => {
			const liveMid = spaceMid();
			if (!liveMid || liveMid !== mid) {
				toast("页面已切换用户，本次内容未保存");
				exitEdit();
				return;
			}
			const remark = remarkInput.value.trim();
			const note = noteInput.value;
			if (!remark && !draftTags.length && !note.trim()) {
				toast("备注名、标签、正文至少填一项");
				remarkInput.focus();
				return;
			}
			if (!store.upsert({
				mid,
				remark,
				tags: [...draftTags],
				note,
				nickSnapshot: currentRecord()?.nickSnapshot ?? titleNickname()
			}, {
				scene: SCENE,
				url: location.href
			})) {
				toast("保存失败，请检查输入");
				return;
			}
			toast("备注已保存");
			exitEdit();
		};
		editBtn.addEventListener("click", enterEdit);
		addBtn.addEventListener("click", enterEdit);
		midBtn.addEventListener("click", () => {
			if (typeof GM_setClipboard === "function") GM_setClipboard(mid, "text");
			else navigator.clipboard?.writeText(mid);
			toast("mid 已复制");
		});
		advBtn.addEventListener("click", () => {
			openEditor({
				mid,
				record: currentRecord() ?? null,
				anchor: el,
				nickname: currentRecord()?.nickSnapshot ?? titleNickname(),
				scene: SCENE
			});
		});
		cancelBtn.addEventListener("click", exitEdit);
		saveBtn.addEventListener("click", doSave);
		tagInput.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" || ev.key === "," || ev.key === "，") {
				ev.preventDefault();
				addTag();
			} else if (ev.key === "Backspace" && !tagInput.value && draftTags.length) {
				draftTags.pop();
				renderChips();
			}
		});
		tagInput.addEventListener("blur", () => {
			if (tagInput.value.trim()) addTag();
		});
		noteInput.addEventListener("input", syncCount);
		el.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape" && editing) {
				ev.stopPropagation();
				exitEdit();
			} else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && editing) {
				ev.preventDefault();
				doSave();
			}
		});
		renderView();
		lastSig = signatureOf(currentRecord());
		refreshView = renderView;
		log("空间侧栏备注模块已注入", mid);
		return el;
	}
	function scanSpaceAside() {
		const { host, hits } = findHost();
		const mid = spaceMid();
		const diag = {
			scene: SCENE,
			label: "个人空间侧栏",
			selectors: hits,
			midResolved: mid ? 1 : 0,
			injected: 0,
			notes: []
		};
		if (!isSpacePage()) {
			destroy();
			diag.notes.push("当前页不是空间页，已卸载模块");
			setDiagnostic(diag);
			return diag;
		}
		if (!mid) {
			destroy();
			diag.notes.push("URL 里没有解析到 mid，页面结构或路由可能已变");
			setDiagnostic(diag);
			return diag;
		}
		if (!host) {
			destroy();
			diag.notes.push("未找到右侧栏 .aside / .space-dynamic__right（可能未登录、页面未渲染完或已改版）");
			setDiagnostic(diag);
			return diag;
		}
		if (!(card && card.isConnected && card.parentElement === host) || cardMid !== mid) {
			destroy();
			try {
				card = mount(host, mid);
				cardMid = mid;
				diag.injected = 1;
			} catch (err) {
				warn("注入空间侧栏备注模块失败", err);
				diag.notes.push("注入异常，详见控制台");
			}
		} else {
			diag.injected = 1;
			if (!editing) {
				const anchor = announcementAnchor(host);
				if (card && anchor && anchor.previousElementSibling !== card) host.insertBefore(card, anchor);
				const theme = surfaceThemeOf(host);
				if (theme !== cardTheme) {
					cardTheme = theme;
					card?.setAttribute("data-brmk-sp-theme", theme);
					lastSig = "";
				}
				const sig = signatureOf(store.get(mid));
				if (sig !== lastSig) {
					lastSig = sig;
					refreshView?.();
				}
			}
		}
		if (!getSettings().scenes[SCENE]) {
			destroy();
			diag.injected = 0;
			diag.notes.push("「个人空间」场景开关已关闭");
		}
		setDiagnostic(diag);
		return diag;
	}
	function clearSpaceAside() {
		destroy();
	}
	var CARD_API = "https://api.bilibili.com/x/user/card";
	var FAIL_COOLDOWN_MS = 6e5;
	var QUEUE_GAP_MS = 300;
	var SEEN_FLUSH_MS = 2e3;
	function onBilibili() {
		return /(^|\.)bilibili\.com$/i.test(location.hostname);
	}
	function gmGetJson(url) {
		return new Promise((resolve, reject) => {
			if (typeof GM_xmlhttpRequest === "function") {
				GM_xmlhttpRequest({
					method: "GET",
					url,
					timeout: 1e4,
					onload: (res) => {
						try {
							resolve(JSON.parse(res.responseText));
						} catch (err) {
							reject(err);
						}
					},
					onerror: () => reject(new Error("网络错误")),
					ontimeout: () => reject(new Error("请求超时"))
				});
				return;
			}
			fetch(url, { credentials: "include" }).then((res) => res.json()).then(resolve, reject);
		});
	}
	var inflight = new Map();
	var failedAt = new Map();
	async function fetchFace(mid) {
		if (!onBilibili()) return null;
		const pending = inflight.get(mid);
		if (pending) return pending;
		const lastFail = failedAt.get(mid);
		if (lastFail && Date.now() - lastFail < FAIL_COOLDOWN_MS) return null;
		const task = (async () => {
			try {
				const json = await gmGetJson(`${CARD_API}?mid=${encodeURIComponent(mid)}`);
				if (json?.code !== 0) throw new Error(`接口返回 code=${json?.code}`);
				const face = typeof json.data?.face === "string" ? json.data.face : "";
				if (!/^https?:\/\//.test(face)) throw new Error("返回无头像");
				failedAt.delete(mid);
				return face;
			} catch (err) {
				failedAt.set(mid, Date.now());
				log(`头像补全失败 mid=${mid}`, err);
				return null;
			} finally {
				inflight.delete(mid);
			}
		})();
		inflight.set(mid, task);
		return task;
	}
	var queue = [];
	var draining = false;
	var pendingPatch = new Map();
	function shouldBackfill(mid) {
		const rec = store.get(mid);
		if (!rec || rec.faceSnapshot) return false;
		if (inflight.has(mid)) return false;
		const lastFail = failedAt.get(mid);
		return !(lastFail && Date.now() - lastFail < FAIL_COOLDOWN_MS);
	}
	function requestFaceBackfill(mids) {
		if (!onBilibili()) return;
		let added = false;
		for (const mid of mids) {
			if (!shouldBackfill(mid)) continue;
			if (!queue.includes(mid)) {
				queue.push(mid);
				added = true;
			}
		}
		if (added) drainQueue();
	}
	async function drainQueue() {
		if (draining) return;
		draining = true;
		try {
			while (queue.length) {
				const mid = queue.shift();
				const face = await fetchFace(mid);
				if (face) pendingPatch.set(mid, face);
				if (queue.length) await new Promise((r) => setTimeout(r, QUEUE_GAP_MS));
			}
		} finally {
			draining = false;
		}
		flushPendingPatch();
	}
	function flushPendingPatch() {
		if (!pendingPatch.size) return;
		const map = new Map(pendingPatch);
		pendingPatch.clear();
		store.patchFaces(map);
	}
	var seenFaces = new Map();
	var seenTimer = null;
	function initFaceBackfill() {
		on("face-seen", (payload) => {
			const mid = payload?.mid;
			if (typeof mid !== "string") return;
			if (!shouldBackfill(mid)) return;
			const face = faceOf(mid);
			if (!face) return;
			seenFaces.set(mid, face);
			if (seenTimer !== null) return;
			seenTimer = setTimeout(() => {
				seenTimer = null;
				const map = new Map(seenFaces);
				seenFaces.clear();
				store.patchFaces(map);
			}, SEEN_FLUSH_MS);
		});
	}
	var SCENE_LABELS = {
		videoUp: "视频 UP 主",
		comment: "评论区",
		space: "个人空间",
		dynamic: "动态",
		card: "视频卡片",
		live: "直播",
		relation: "粉丝/关注",
		message: "私信",
		manual: "手动添加"
	};
	var state = {
		tab: "list",
		search: "",
		tag: "",
		scene: "",
		hasNote: "any",
		sortKey: "updatedAt",
		sortDir: "desc",
		page: 1,
		selected: new Set()
	};
	var refs = null;
	var unbindBus = null;
	var prevOverflow = "";
	var keyHandler = null;
	function btn(label, className, onClick) {
		const b = h("button", className, label);
		b.type = "button";
		b.addEventListener("click", onClick);
		return b;
	}
	function btnAct(label, className, act, onClick) {
		const b = btn(label, className, onClick);
		b.setAttribute("data-act", act);
		return b;
	}
	function option(value, label) {
		const o = document.createElement("option");
		o.value = value;
		o.textContent = label;
		return o;
	}
	function switchEl(checked, onChange, disabled = false) {
		const b = h("button", "brmk-switch");
		b.type = "button";
		b.setAttribute("role", "switch");
		b.setAttribute("aria-checked", String(checked));
		if (disabled) {
			b.disabled = true;
			b.style.opacity = ".45";
			b.style.cursor = "not-allowed";
		}
		b.addEventListener("click", () => {
			if (disabled) return;
			const next = b.getAttribute("aria-checked") !== "true";
			b.setAttribute("aria-checked", String(next));
			onChange(next);
		});
		return b;
	}
	function filteredRecords() {
		const keyword = state.search.trim().toLowerCase();
		let list = store.all();
		if (keyword) list = list.filter((r) => {
			return r.remark.toLowerCase().includes(keyword) || r.nickSnapshot.toLowerCase().includes(keyword) || r.mid.includes(keyword) || r.note.toLowerCase().includes(keyword) || r.tags.some((t) => t.toLowerCase().includes(keyword));
		});
		if (state.tag) list = list.filter((r) => r.tags.includes(state.tag));
		if (state.scene) list = list.filter((r) => (r.firstSeen?.scene ?? "") === state.scene);
		if (state.hasNote === "yes") list = list.filter((r) => r.note.trim().length > 0);
		if (state.hasNote === "no") list = list.filter((r) => !r.note.trim());
		const dir = state.sortDir === "asc" ? 1 : -1;
		list.sort((a, b) => {
			switch (state.sortKey) {
				case "remark": return dir * (a.remark || a.nickSnapshot).localeCompare(b.remark || b.nickSnapshot, "zh-Hans-CN");
				case "mid": return dir * (Number(a.mid) - Number(b.mid));
				case "createdAt": return dir * (a.createdAt - b.createdAt);
				default: return dir * (a.updatedAt - b.updatedAt);
			}
		});
		return list;
	}
	function pageSize() {
		return Math.max(10, getSettings().manager.pageSize);
	}
	function renderStats(r) {
		const stats = store.stats();
		const settings = getSettings();
		const days = daysSince(settings.backup.lastExportAt);
		r.countBadge.textContent = String(stats.count);
		r.stats.textContent = "";
		const card = (value, label, title) => {
			const box = h("div", "brmk-stat");
			box.appendChild(h("b", "", value));
			box.appendChild(h("span", "", label));
			if (title) box.title = title;
			r.stats.appendChild(box);
		};
		card(String(stats.count), "备注总数");
		card(String(stats.monthAdded), "本月新增");
		card(formatBytes(stats.bytes), `估算占用 / ${LIMITS.records} 条上限`);
		card(Number.isFinite(days) ? `${days} 天` : "从未导出", "距上次导出", settings.backup.lastExportAt ? formatTime(settings.backup.lastExportAt) : "建议定期导出备份");
		if (stats.tags.length) {
			const tagsBox = h("div", "brmk-stat");
			tagsBox.appendChild(h("b", "", String(stats.tags.length)));
			tagsBox.appendChild(h("span", "", "标签种类"));
			tagsBox.title = stats.tags.slice(0, 12).map((t) => `${t.tag} (${t.count})`).join("，");
			r.stats.appendChild(tagsBox);
		}
	}
	function renderWarn(r) {
		r.warn.textContent = "";
		const messages = [];
		const stats = store.stats();
		const settings = getSettings();
		if (store.lastError) messages.push(store.lastError);
		if (stats.bytes > LIMITS.warnBytes) messages.push(`估算占用 ${formatBytes(stats.bytes)}，接近存储上限，建议先导出备份再清理。`);
		if (stats.count > LIMITS.records) messages.push(`记录数已超过 ${LIMITS.records} 条，建议导出后清理。`);
		const gap = daysSince(settings.backup.lastExportAt);
		if (settings.backup.remindIntervalDays > 0 && gap >= settings.backup.remindIntervalDays) messages.push(`距上次导出已有 ${Number.isFinite(gap) ? gap + " 天" : "很久"}，数据只存在本机，建议现在导出备份。`);
		if (!messages.length) return;
		for (const msg of messages) r.warn.appendChild(h("div", "brmk-warn", msg));
	}
	function renderTagOptions(r) {
		const current = state.tag;
		r.tagSelect.textContent = "";
		r.tagSelect.appendChild(option("", "全部标签"));
		const tags = store.stats().tags;
		for (const t of tags) r.tagSelect.appendChild(option(t.tag, `${t.tag} (${t.count})`));
		r.tagSelect.value = tags.some((t) => t.tag === current) ? current : "";
		if (r.tagSelect.value !== current) state.tag = r.tagSelect.value;
		const sceneCurrent = state.scene;
		r.sceneSelect.textContent = "";
		r.sceneSelect.appendChild(option("", "全部场景"));
		for (const [key, label] of Object.entries(SCENE_LABELS)) r.sceneSelect.appendChild(option(key, label));
		r.sceneSelect.value = sceneCurrent;
	}
	function renderBatchBar(r) {
		r.batchBar.textContent = "";
		if (!state.selected.size) {
			r.batchBar.style.display = "none";
			return;
		}
		r.batchBar.style.display = "flex";
		r.batchBar.appendChild(h("span", "", `已选 ${state.selected.size} 条`));
		r.batchBar.appendChild(btn("批量删除", "brmk-btn brmk-btn-danger", () => {
			const mids = Array.from(state.selected);
			confirmAction("批量删除", `将删除 ${mids.length} 条备注，可在 5 秒内撤销。`, "删除", () => {
				const removed = store.removeMany(mids);
				state.selected.clear();
				if (removed.length) toast(`已删除 ${removed.length} 条`, {
					actionLabel: "撤销",
					duration: 5e3,
					onAction: () => store.restore(removed)
				});
				renderAll();
			});
		}));
		r.batchBar.appendChild(btn("取消选择", "brmk-btn", () => {
			state.selected.clear();
			renderAll();
		}));
	}
	function renderTable(r) {
		const list = filteredRecords();
		const size = pageSize();
		const totalPages = Math.max(1, Math.ceil(list.length / size));
		if (state.page > totalPages) state.page = totalPages;
		const start = (state.page - 1) * size;
		const rows = list.slice(start, start + size);
		r.tbody.textContent = "";
		const allChecked = rows.length > 0 && rows.every((row) => state.selected.has(row.mid));
		const headCheck = r.panel.querySelector(".brmk-check-all");
		if (headCheck) {
			headCheck.checked = allChecked;
			headCheck.indeterminate = !allChecked && rows.some((row) => state.selected.has(row.mid));
		}
		for (const rec of rows) {
			const tr = document.createElement("tr");
			tr.setAttribute("data-mid", rec.mid);
			const tdCheck = document.createElement("td");
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.checked = state.selected.has(rec.mid);
			cb.addEventListener("change", () => {
				if (cb.checked) state.selected.add(rec.mid);
				else state.selected.delete(rec.mid);
				renderBatchBar(r);
				renderTable(r);
			});
			tdCheck.appendChild(cb);
			tr.appendChild(tdCheck);
			const tdUser = document.createElement("td");
			const userLine = h("div", "brmk-cell-main");
			const avatar = h("img");
			avatar.width = 20;
			avatar.height = 20;
			avatar.style.borderRadius = "50%";
			avatar.style.verticalAlign = "-5px";
			avatar.style.marginRight = "6px";
			avatar.style.objectFit = "cover";
			avatar.alt = "";
			if (rec.faceSnapshot) {
				avatar.src = rec.faceSnapshot;
				avatar.addEventListener("error", () => avatar.remove());
			} else avatar.style.display = "none";
			userLine.appendChild(avatar);
			userLine.appendChild(document.createTextNode(rec.nickSnapshot || "（无昵称快照）"));
			const currentNick = nickCache.get(rec.mid);
			if (currentNick && rec.nickSnapshot && currentNick !== rec.nickSnapshot) {
				const mark = h("span", "brmk-mark", "昵称已变");
				mark.title = `页面当前昵称：${currentNick}`;
				userLine.appendChild(mark);
			}
			tdUser.appendChild(userLine);
			if (rec.firstSeen?.url) {
				const sub = h("div", "brmk-cell-sub", truncate(rec.firstSeen.url, 42));
				sub.title = rec.firstSeen.url;
				tdUser.appendChild(sub);
			}
			tr.appendChild(tdUser);
			const tdMid = document.createElement("td");
			const midBtn = h("button", "brmk-mid", rec.mid);
			midBtn.type = "button";
			midBtn.title = "点击复制 mid";
			midBtn.addEventListener("click", () => {
				try {
					if (typeof GM_setClipboard === "function") GM_setClipboard(rec.mid, "text");
					else navigator.clipboard?.writeText(rec.mid);
					toast("mid 已复制");
				} catch {
					toast("复制失败");
				}
			});
			tdMid.appendChild(midBtn);
			tr.appendChild(tdMid);
			const tdRemark = document.createElement("td");
			const remarkDiv = h("div", "brmk-cell-main", rec.remark || "—");
			if (rec.color) remarkDiv.style.color = rec.color;
			tdRemark.appendChild(remarkDiv);
			tr.appendChild(tdRemark);
			const tdTags = document.createElement("td");
			if (rec.tags.length) for (const tag of rec.tags) tdTags.appendChild(h("span", "brmk-row-tag", tag));
			else {
				tdTags.textContent = "—";
				tdTags.style.color = "var(--brmk-fg2)";
			}
			tr.appendChild(tdTags);
			const tdNote = document.createElement("td");
			const noteDiv = h("div", "brmk-note-clip", rec.note ? truncate(rec.note, 30) : "—");
			if (rec.note) noteDiv.title = rec.note;
			tdNote.appendChild(noteDiv);
			tr.appendChild(tdNote);
			const tdScene = document.createElement("td");
			tdScene.textContent = SCENE_LABELS[rec.firstSeen?.scene ?? "manual"] ?? "—";
			tdScene.style.whiteSpace = "nowrap";
			tdScene.style.color = "var(--brmk-fg2)";
			tr.appendChild(tdScene);
			const tdTime = document.createElement("td");
			const timeDiv = h("div", "", relativeTime(rec.updatedAt));
			timeDiv.title = `创建：${formatTime(rec.createdAt)}\n更新：${formatTime(rec.updatedAt)}`;
			timeDiv.style.whiteSpace = "nowrap";
			tdTime.appendChild(timeDiv);
			tr.appendChild(tdTime);
			const tdActions = document.createElement("td");
			const actions = h("div", "brmk-row-actions");
			actions.appendChild(btnAct("编辑", "brmk-link-btn", "edit", () => {
				openEditor({
					mid: rec.mid,
					record: rec,
					nickname: rec.nickSnapshot,
					scene: "manual"
				});
			}));
			actions.appendChild(btnAct("空间", "brmk-link-btn", "open", () => {
				window.open(`https://space.bilibili.com/${rec.mid}`, "_blank", "noopener,noreferrer");
			}));
			actions.appendChild(btnAct("删除", "brmk-link-btn brmk-danger", "delete", () => {
				confirmAction("删除备注", `确定删除 mid ${rec.mid} 的备注吗？可在 5 秒内撤销。`, "删除", () => {
					const removed = store.remove(rec.mid);
					if (removed) toast("备注已删除", {
						actionLabel: "撤销",
						duration: 5e3,
						onAction: () => store.restore([removed])
					});
					state.selected.delete(rec.mid);
					renderAll();
				});
			}));
			tdActions.appendChild(actions);
			tr.appendChild(tdActions);
			r.tbody.appendChild(tr);
		}
		r.empty.style.display = list.length ? "none" : "block";
		if (!list.length) {
			r.empty.textContent = "";
			r.empty.appendChild(h("b", "", store.count ? "没有匹配的记录" : "还没有任何备注"));
			r.empty.appendChild(document.createTextNode(store.count ? "换个关键词或清空筛选试试。" : "去视频页把鼠标移到 UP 主昵称上，点小铅笔就能加备注。"));
		}
		renderPager(r, list.length, totalPages);
		renderBatchBar(r);
		requestFaceBackfill(rows.filter((rec) => !rec.faceSnapshot).map((rec) => rec.mid));
	}
	function renderPager(r, total, totalPages) {
		r.pager.textContent = "";
		const from = total ? (state.page - 1) * pageSize() + 1 : 0;
		const to = Math.min(total, state.page * pageSize());
		r.pager.appendChild(h("span", "", `共 ${total} 条，当前 ${from}-${to}`));
		r.pager.appendChild(h("span", "", " "));
		const prev = btn("上一页", "brmk-btn", () => {
			if (state.page > 1) {
				state.page--;
				renderTable(r);
			}
		});
		prev.disabled = state.page <= 1;
		const next = btn("下一页", "brmk-btn", () => {
			if (state.page < totalPages) {
				state.page++;
				renderTable(r);
			}
		});
		next.disabled = state.page >= totalPages;
		r.pager.append(prev, h("span", "", `${state.page} / ${totalPages}`), next);
	}
	function fieldRow(label, hint, control, soon = false) {
		const row = h("div", "brmk-row");
		const labelWrap = h("div", "brmk-row-label", label);
		if (hint) labelWrap.appendChild(h("small", "", hint));
		if (soon) {
			const tag = h("span", "brmk-soon", "后续版本");
			labelWrap.appendChild(tag);
		}
		const controlWrap = h("div", "brmk-row-control");
		controlWrap.appendChild(control);
		row.append(labelWrap, controlWrap);
		return row;
	}
	function numberInput(value, min, max, onChange) {
		const input = h("input");
		input.type = "number";
		input.min = String(min);
		input.max = String(max);
		input.value = String(value);
		input.addEventListener("change", () => {
			const n = Math.min(max, Math.max(min, Math.round(Number(input.value) || value)));
			input.value = String(n);
			onChange(n);
		});
		return input;
	}
	function renderSettings(r) {
		const settings = getSettings();
		r.settingsView.textContent = "";
		const section = (title) => {
			const sec = h("div", "brmk-sec");
			sec.appendChild(h("div", "brmk-sec-head", title));
			r.settingsView.appendChild(sec);
			return sec;
		};
		section("总览").appendChild(fieldRow("启用备注显示", "关闭后页面不再注入任何标签，数据保留", switchEl(settings.enabled, (next) => {
			updateSettings((s) => {
				s.enabled = next;
			});
			renderAll();
		})));
		const scenes = section("场景开关");
		const SCENE_HINTS = {
			videoUp: "视频页 UP 主昵称旁显示备注",
			comment: "评论者昵称旁显示备注（主楼 + 楼中楼回复）",
			space: "个人空间右侧侧栏显示独立备注卡片",
			dynamic: "动态发布者昵称旁显示备注（opus 图文动态）",
			card: "卡片 UP 主昵称旁显示备注（首页 / 搜索 / 视频页右栏）",
			relation: "关系列表用户昵称旁显示备注（粉丝 / 关注两个子页）",
			message: "私信会话列表与聊天窗对方昵称旁显示备注"
		};
		for (const def of [
			{
				key: "videoUp",
				soon: false
			},
			{
				key: "comment",
				soon: false
			},
			{
				key: "space",
				soon: false
			},
			{
				key: "dynamic",
				soon: false
			},
			{
				key: "card",
				soon: false
			},
			{
				key: "live",
				soon: true
			},
			{
				key: "relation",
				soon: false
			},
			{
				key: "message",
				soon: false
			}
		]) scenes.appendChild(fieldRow(SCENE_LABELS[def.key], def.soon ? "本里程碑未实现，开关暂不生效" : SCENE_HINTS[def.key] ?? "", switchEl(settings.scenes[def.key], (next) => {
			updateSettings((s) => {
				s.scenes[def.key] = next;
			});
		}, def.soon), def.soon));
		const display = section("显示");
		display.appendChild(fieldRow("显示标签胶囊", "备注标签跟在备注名后面", switchEl(settings.display.showTags, (next) => {
			updateSettings((s) => {
				s.display.showTags = next;
			});
			renderAll();
		})));
		display.appendChild(fieldRow("显示颜色圆点", "备注名前的小圆点", switchEl(settings.display.showColorDot, (next) => {
			updateSettings((s) => {
				s.display.showColorDot = next;
			});
			renderAll();
		})));
		display.appendChild(fieldRow("最多显示标签数", "0 表示不显示标签", numberInput(settings.display.maxTags, 0, 5, (n) => {
			updateSettings((s) => {
				s.display.maxTags = n;
			});
			renderAll();
		})));
		display.appendChild(fieldRow("仅 hover 时显示", "不悬浮时备注半透明隐藏", switchEl(settings.display.showOnHoverOnly, (next) => {
			updateSettings((s) => {
				s.display.showOnHoverOnly = next;
			});
			renderAll();
		})));
		const positionSelect = h("select");
		positionSelect.appendChild(option("afterName", "昵称之后（追加）"));
		positionSelect.disabled = true;
		display.appendChild(fieldRow("显示位置", "初版仅支持追加在昵称之后", positionSelect, true));
		const replaceSwitch = switchEl(false, () => {}, true);
		display.appendChild(fieldRow("用备注名替换昵称", "会改变页面原有文字，初版不做", replaceSwitch, true));
		const editorSec = section("编辑入口");
		const hotkey = h("input");
		hotkey.type = "text";
		hotkey.value = settings.editor.hotkey;
		hotkey.placeholder = "Alt+R";
		hotkey.addEventListener("change", () => {
			const v = hotkey.value.trim() || "Alt+R";
			hotkey.value = v;
			updateSettings((s) => {
				s.editor.hotkey = v;
			});
			toast("快捷键已保存，刷新页面后生效");
		});
		editorSec.appendChild(fieldRow("打开管理页快捷键", "格式如 Alt+R / Ctrl+Shift+R", hotkey));
		const entrySelect = h("select");
		entrySelect.appendChild(option("clickBadge", "点击备注标签"));
		entrySelect.disabled = true;
		editorSec.appendChild(fieldRow("编辑气泡入口", "点击页面上已存在的备注标签", entrySelect, true));
		const managerSec = section("管理页");
		managerSec.appendChild(fieldRow("每页条数", "10 ~ 500", numberInput(settings.manager.pageSize, 10, 500, (n) => {
			updateSettings((s) => {
				s.manager.pageSize = n;
			});
			state.page = 1;
			renderAll();
		})));
		const themeSelect = h("select");
		themeSelect.appendChild(option("auto", "跟随页面"));
		themeSelect.appendChild(option("dark", "强制深色"));
		themeSelect.appendChild(option("light", "强制浅色"));
		themeSelect.value = settings.manager.theme;
		themeSelect.addEventListener("change", () => {
			const value = themeSelect.value;
			updateSettings((s) => {
				s.manager.theme = value;
			});
			applyPalette();
		});
		managerSec.appendChild(fieldRow("管理页面板配色", "不影响页面内备注标签", themeSelect));
		managerSec.appendChild(fieldRow("面板层级 z-index", "与其他脚本冲突时调整", numberInput(settings.manager.zIndex, 1e3, 2147483e3, (n) => {
			updateSettings((s) => {
				s.manager.zIndex = n;
			});
			if (refs) refs.root.style.zIndex = String(n);
		})));
		const backupSec = section("备份");
		backupSec.appendChild(fieldRow("导出提醒间隔", "0 表示不提醒", numberInput(settings.backup.remindIntervalDays, 0, 365, (n) => {
			updateSettings((s) => {
				s.backup.remindIntervalDays = n;
			});
			renderAll();
		})));
		const lastExport = h("span", "", settings.backup.lastExportAt ? formatTime(settings.backup.lastExportAt) : "从未导出");
		lastExport.style.fontSize = "12px";
		lastExport.style.color = "var(--brmk-fg2)";
		backupSec.appendChild(fieldRow("上次导出时间", "导出的同时会写入时间", lastExport));
		backupSec.appendChild(fieldRow("立即备份", "导出完整 JSON 到本地", btn("导出 JSON", "brmk-btn brmk-btn-primary", () => doExportJson())));
		const advanced = section("高级");
		advanced.appendChild(fieldRow("DOM 观察去抖 (ms)", "150 ~ 2000，越大越省 CPU", numberInput(settings.advanced.observerDebounceMs, 50, 2e3, (n) => {
			updateSettings((s) => {
				s.advanced.observerDebounceMs = n;
			});
			toast("刷新页面后生效");
		})));
		advanced.appendChild(fieldRow("单批处理节点上限", "5 ~ 200", numberInput(settings.advanced.maxNodesPerTick, 5, 200, (n) => {
			updateSettings((s) => {
				s.advanced.maxNodesPerTick = n;
			});
		})));
		advanced.appendChild(fieldRow("调试模式", "控制台输出详细日志，并启用选择器体检", switchEl(settings.advanced.debug, (next) => {
			updateSettings((s) => {
				s.advanced.debug = next;
			});
		})));
		advanced.appendChild(fieldRow("清空全部数据", "不可恢复，执行前会自动写一份备份到 GM 存储", btn("清空数据", "brmk-btn brmk-btn-danger", () => {
			confirmAction("清空全部备注", `将删除 ${store.count} 条备注（会自动留一份备份）。确定继续？`, "清空", () => {
				store.clearAll();
				state.selected.clear();
				renderAll();
				toast("已清空全部备注");
			});
		})));
		advanced.appendChild(fieldRow("恢复默认设置", "只重置设置，不动备注数据", btn("恢复默认", "brmk-btn", () => {
			confirmAction("恢复默认设置", "所有开关将回到初始状态，备注数据不受影响。", "恢复", () => {
				resetSettings();
				renderAll();
			});
		})));
		const about = section("关于");
		const aboutText = h("div", "brmk-row");
		const aboutLabel = h("div", "brmk-row-label", "BiliRemark v1.0.0");
		aboutLabel.appendChild(h("small", "", "备注只存在本机浏览器扩展存储里，不会上传，也不会同步到 B 站账号。"));
		aboutText.appendChild(aboutLabel);
		about.appendChild(aboutText);
	}
	function renderAll() {
		const r = refs;
		if (!r) return;
		r.tabs.querySelectorAll(".brmk-tab").forEach((tab) => {
			tab.setAttribute("aria-selected", String(tab.dataset.tab === state.tab));
		});
		r.listView.style.display = state.tab === "list" ? "flex" : "none";
		r.settingsView.style.display = state.tab === "settings" ? "block" : "none";
		renderStats(r);
		renderWarn(r);
		if (state.tab === "list") {
			renderTagOptions(r);
			renderTable(r);
		} else renderSettings(r);
	}
	function applyPalette() {
		const r = refs;
		if (!r) return;
		const s = getSettings();
		r.root.style.zIndex = String(s.manager.zIndex);
		const p = managerPalette();
		const set = (name, value) => r.root.style.setProperty(name, value);
		set("--brmk-bg", p.bg);
		set("--brmk-bg2", p.bg2);
		set("--brmk-bg3", p.bg3);
		set("--brmk-fg", p.fg);
		set("--brmk-fg2", p.fg2);
		set("--brmk-border", p.border);
		set("--brmk-shadow", p.shadow);
		set("--brmk-accent", p.accent);
		set("--brmk-accent-weak", p.accentWeak);
		set("--brmk-accent-border", p.accentBorder);
		r.panel.style.background = p.bg;
		r.panel.style.color = p.fg;
	}
	function hideSub() {
		const r = refs;
		if (!r) return;
		r.subHost.textContent = "";
		r.subHost.style.display = "none";
	}
	function showSub(title, build) {
		const r = refs;
		if (!r) return;
		r.subHost.textContent = "";
		r.subHost.style.display = "flex";
		const mask = h("div", "brmk-submask");
		const panel = h("div", "brmk-subpanel");
		const heading = h("h3", "", title);
		panel.appendChild(heading);
		build(panel);
		panel.addEventListener("click", (ev) => ev.stopPropagation());
		mask.addEventListener("click", () => hideSub());
		mask.appendChild(panel);
		r.subHost.appendChild(mask);
	}
	function confirmAction(title, text, okLabel, onOk) {
		showSub(title, (panel) => {
			panel.appendChild(h("p", "", text));
			const foot = h("div", "brmk-subfoot");
			foot.appendChild(btn("取消", "brmk-btn", () => hideSub()));
			foot.appendChild(btnAct(okLabel, "brmk-btn brmk-btn-danger", "confirm-ok", () => {
				hideSub();
				try {
					onOk();
				} catch (err) {
					console.warn("[BiliRemark] 操作失败", err);
					toast("操作失败，详见控制台");
				}
			}));
			panel.appendChild(foot);
		});
	}
	function doExportJson() {
		try {
			const text = store.exportJSON();
			downloadText(`bili-remark-${stampForFile()}.json`, text, "application/json");
			updateSettings((s) => {
				s.backup.lastExportAt = Date.now();
			});
			renderAll();
			toast("已导出 JSON");
		} catch (err) {
			console.warn("[BiliRemark] 导出失败", err);
			toast("导出失败");
		}
	}
	function doExportCsv() {
		try {
			const text = store.exportCSV();
			downloadText(`bili-remark-${stampForFile()}.csv`, text, "text/csv");
			updateSettings((s) => {
				s.backup.lastExportAt = Date.now();
			});
			renderAll();
			toast("已导出 CSV");
		} catch (err) {
			console.warn("[BiliRemark] 导出失败", err);
			toast("导出失败");
		}
	}
	function openExportDialog() {
		showSub("导出备注", (panel) => {
			panel.appendChild(h("p", "", "JSON 是完整备份（含 schema 版本与来源信息），可再次导入；CSV 便于用表格软件查看，但不能导入。"));
			const foot = h("div", "brmk-subfoot");
			foot.appendChild(btnAct("导出 CSV", "brmk-btn", "export-csv", () => {
				hideSub();
				doExportCsv();
			}));
			foot.appendChild(btnAct("导出 JSON", "brmk-btn brmk-btn-primary", "export-json", () => {
				hideSub();
				doExportJson();
			}));
			panel.appendChild(foot);
		});
	}
	function parseImport(text) {
		let raw;
		try {
			raw = JSON.parse(text);
		} catch {
			return null;
		}
		if (!raw || typeof raw !== "object") return null;
		const obj = raw;
		let list = [];
		if (Array.isArray(raw)) list = raw;
		else if (obj.users && typeof obj.users === "object" && !Array.isArray(obj.users)) list = Object.entries(obj.users).map(([key, value]) => value && typeof value === "object" ? {
			...value,
			mid: value.mid ?? key
		} : value);
		else return null;
		const records = [];
		let invalid = 0;
		for (const item of list) {
			if (!item || typeof item !== "object") {
				invalid++;
				continue;
			}
			const rec = normalizeRecord(item);
			if (rec) records.push(rec);
			else invalid++;
		}
		return {
			records,
			invalid
		};
	}
	function openImportDialog() {
		showSub("导入备注", (panel) => {
			panel.appendChild(h("p", "", "支持本脚本导出的 JSON，或包含 users 对象的同结构 JSON。导入前会先展示将新增/更新/跳过多少条，确认后才写入。"));
			const fileRow = h("div");
			fileRow.style.display = "flex";
			fileRow.style.gap = "8px";
			fileRow.style.alignItems = "center";
			fileRow.style.marginBottom = "8px";
			const fileInput = h("input");
			fileInput.setAttribute("data-field", "import-file");
			fileInput.type = "file";
			fileInput.accept = ".json,application/json";
			fileInput.style.fontSize = "12px";
			fileRow.appendChild(fileInput);
			panel.appendChild(fileRow);
			const textarea = h("textarea");
			textarea.setAttribute("data-field", "import-text");
			textarea.placeholder = "或把 JSON 粘贴到这里";
			panel.appendChild(textarea);
			const strategyRow = h("div");
			strategyRow.style.display = "flex";
			strategyRow.style.alignItems = "center";
			strategyRow.style.gap = "8px";
			strategyRow.style.marginTop = "10px";
			strategyRow.appendChild(h("span", "", "合并策略"));
			const strategySelect = h("select");
			strategySelect.setAttribute("data-field", "import-strategy");
			strategySelect.appendChild(option("newer", "按 mid 合并，保留较新（默认）"));
			strategySelect.appendChild(option("only-new", "仅新增，不覆盖已有"));
			strategySelect.appendChild(option("replace", "覆盖全部（导入为准）"));
			strategyRow.appendChild(strategySelect);
			panel.appendChild(strategyRow);
			const preview = h("div", "brmk-preview");
			panel.appendChild(preview);
			let parsed = null;
			const refreshPreview = () => {
				preview.textContent = "";
				if (!parsed) return;
				const strategy = strategySelect.value;
				const p = store.previewImport(parsed.records, strategy);
				const add = (text) => {
					preview.appendChild(h("span", "", text));
				};
				add(`新增 ${p.added}`);
				add(`更新 ${p.updated}`);
				add(`跳过 ${p.skipped}`);
				if (p.removed) add(`删除 ${p.removed}`);
				if (parsed.invalid) add(`无效 ${parsed.invalid}`);
			};
			const tryParse = (text) => {
				if (!text.trim()) {
					parsed = null;
					preview.textContent = "";
					return;
				}
				parsed = parseImport(text);
				if (!parsed) {
					preview.textContent = "";
					preview.appendChild(h("span", "", "JSON 解析失败或结构不符合要求"));
					return;
				}
				refreshPreview();
			};
			textarea.addEventListener("input", () => tryParse(textarea.value));
			fileInput.addEventListener("change", () => {
				const file = fileInput.files?.[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					const text = String(reader.result ?? "");
					textarea.value = text;
					tryParse(text);
				};
				reader.readAsText(file);
			});
			strategySelect.addEventListener("change", refreshPreview);
			const foot = h("div", "brmk-subfoot");
			foot.appendChild(btn("取消", "brmk-btn", () => hideSub()));
			const okBtn = btnAct("确认导入", "brmk-btn brmk-btn-primary", "import-ok", () => {
				if (!parsed) {
					toast("请先选择文件或粘贴 JSON");
					return;
				}
				if (!parsed.records.length) {
					toast("没有可导入的记录");
					return;
				}
				const strategy = strategySelect.value;
				const p = store.applyImport(parsed.records, strategy);
				hideSub();
				renderAll();
				toast(`导入完成：新增 ${p.added}，更新 ${p.updated}，跳过 ${p.skipped}`);
			});
			foot.appendChild(okBtn);
			panel.appendChild(foot);
		});
	}
	function bind(r) {
		r.search.addEventListener("input", () => {
			state.search = r.search.value;
			state.page = 1;
			renderTable(r);
		});
		r.tabs.addEventListener("click", (ev) => {
			const target = ev.target.closest(".brmk-tab");
			if (!target || !target.dataset.tab) return;
			state.tab = target.dataset.tab;
			renderAll();
		});
		r.tagSelect.addEventListener("change", () => {
			state.tag = r.tagSelect.value;
			state.page = 1;
			renderTable(r);
		});
		r.sceneSelect.addEventListener("change", () => {
			state.scene = r.sceneSelect.value;
			state.page = 1;
			renderTable(r);
		});
		r.noteSelect.addEventListener("change", () => {
			state.hasNote = r.noteSelect.value;
			state.page = 1;
			renderTable(r);
		});
		r.sortSelect.addEventListener("change", () => {
			state.sortKey = r.sortSelect.value;
			renderTable(r);
		});
		r.dirBtn.addEventListener("click", () => {
			state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
			r.dirBtn.textContent = state.sortDir === "desc" ? "↓ 降序" : "↑ 升序";
			renderTable(r);
		});
		const checkAll = r.panel.querySelector(".brmk-check-all");
		checkAll?.addEventListener("change", () => {
			const list = filteredRecords();
			const start = (state.page - 1) * pageSize();
			const rows = list.slice(start, start + pageSize());
			if (checkAll.checked) for (const row of rows) state.selected.add(row.mid);
			else state.selected.clear();
			renderTable(r);
		});
		r.root.addEventListener("click", (ev) => {
			if (ev.target === r.root) closeManager();
		});
		const onKey = (ev) => {
			if (!refs) return;
			if (!refs.subHost.contains(document.activeElement) && ev.key === "Escape") {
				if (refs.subHost.style.display === "flex") {
					hideSub();
					return;
				}
				closeManager();
				return;
			}
			const active = document.activeElement;
			const inInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
			if (!inInput && ev.key === "/") {
				ev.preventDefault();
				refs.search.focus();
			}
			if (!inInput && ev.key === "Delete" && state.selected.size) {
				const mids = Array.from(state.selected);
				confirmAction("批量删除", `将删除 ${mids.length} 条备注，可在 5 秒内撤销。`, "删除", () => {
					const removed = store.removeMany(mids);
					state.selected.clear();
					if (removed.length) toast(`已删除 ${removed.length} 条`, {
						actionLabel: "撤销",
						duration: 5e3,
						onAction: () => store.restore(removed)
					});
					renderAll();
				});
			}
		};
		keyHandler = onKey;
		document.addEventListener("keydown", onKey);
	}
	function buildShell() {
		const settings = getSettings();
		const root = h("div");
		root.id = "brmk-manager";
		root.style.zIndex = String(settings.manager.zIndex);
		const panel = h("div", "brmk-panel");
		const head = h("div", "brmk-head");
		const title = h("div", "brmk-title", "备注管理");
		const countBadge = h("small", "", "0");
		title.appendChild(countBadge);
		const search = h("input", "brmk-search");
		search.type = "search";
		search.setAttribute("data-field", "search");
		search.placeholder = "搜索备注名 / 昵称 / mid / 正文（按 / 聚焦）";
		const headActions = h("div", "brmk-head-actions");
		headActions.appendChild(btnAct("新增", "brmk-btn", "add", () => {
			openEditor({
				allowMidEdit: true,
				scene: "manual"
			});
		}));
		headActions.appendChild(btnAct("导入", "brmk-btn", "import", () => openImportDialog()));
		headActions.appendChild(btnAct("导出", "brmk-btn", "export", () => openExportDialog()));
		headActions.appendChild(btnAct("设置", "brmk-btn", "settings", () => {
			state.tab = "settings";
			renderAll();
		}));
		headActions.appendChild(btnAct("✕", "brmk-btn", "close", () => closeManager()));
		head.append(title, search, headActions);
		const tabs = h("div", "brmk-tabs");
		const listTab = h("button", "brmk-tab", "列表");
		listTab.type = "button";
		listTab.dataset.tab = "list";
		const settingsTab = h("button", "brmk-tab", "设置");
		settingsTab.type = "button";
		settingsTab.dataset.tab = "settings";
		tabs.append(listTab, settingsTab);
		const stats = h("div", "brmk-stats");
		const warn = h("div");
		const listView = h("div");
		listView.style.display = "flex";
		listView.style.flexDirection = "column";
		listView.style.flex = "1 1 auto";
		listView.style.minHeight = "0";
		const toolbar = h("div", "brmk-toolbar");
		const tagSelect = h("select");
		tagSelect.setAttribute("data-field", "tag");
		const sceneSelect = h("select");
		sceneSelect.setAttribute("data-field", "scene");
		const noteSelect = h("select");
		noteSelect.setAttribute("data-field", "note");
		noteSelect.appendChild(option("any", "正文：全部"));
		noteSelect.appendChild(option("yes", "有正文"));
		noteSelect.appendChild(option("no", "无正文"));
		const sortSelect = h("select");
		sortSelect.setAttribute("data-field", "sort");
		sortSelect.appendChild(option("updatedAt", "按更新时间"));
		sortSelect.appendChild(option("createdAt", "按创建时间"));
		sortSelect.appendChild(option("remark", "按备注名"));
		sortSelect.appendChild(option("mid", "按 mid"));
		sortSelect.value = "updatedAt";
		const dirBtn = btn("↓ 降序", "brmk-btn", () => {});
		dirBtn.setAttribute("data-act", "sortdir");
		toolbar.append(tagSelect, sceneSelect, noteSelect, sortSelect, dirBtn, h("span", "brmk-spacer"));
		const batchBar = h("div", "brmk-toolbar");
		batchBar.style.display = "none";
		batchBar.style.paddingTop = "0";
		const bodyWrap = h("div", "brmk-body");
		const table = h("table");
		const thead = h("thead");
		const headRow = document.createElement("tr");
		const thCheck = document.createElement("th");
		thCheck.style.width = "28px";
		const checkAll = h("input");
		checkAll.type = "checkbox";
		checkAll.className = "brmk-check-all";
		thCheck.appendChild(checkAll);
		headRow.appendChild(thCheck);
		for (const label of [
			"用户",
			"mid",
			"备注名",
			"标签",
			"正文",
			"场景",
			"更新时间",
			"操作"
		]) {
			const th = h("th", "", label);
			headRow.appendChild(th);
		}
		thead.appendChild(headRow);
		const tbody = h("tbody");
		table.append(thead, tbody);
		bodyWrap.appendChild(table);
		const empty = h("div", "brmk-empty");
		empty.style.display = "none";
		bodyWrap.appendChild(empty);
		const pager = h("div", "brmk-pager");
		listView.append(toolbar, batchBar, bodyWrap, pager);
		const settingsView = h("div", "brmk-settings");
		settingsView.style.display = "none";
		const subHost = h("div");
		subHost.style.display = "none";
		subHost.style.position = "absolute";
		subHost.style.inset = "0";
		panel.append(head, tabs, stats, warn, listView, settingsView, subHost);
		root.appendChild(panel);
		return {
			root,
			panel,
			countBadge,
			search,
			stats,
			warn,
			tabs,
			listView,
			settingsView,
			toolbar,
			tagSelect,
			sceneSelect,
			noteSelect,
			sortSelect,
			dirBtn,
			batchBar,
			bodyWrap,
			tbody,
			empty,
			pager,
			subHost
		};
	}
	function isManagerOpen() {
		return !!refs;
	}
	function openManager(tab = "list") {
		if (refs) {
			state.tab = tab;
			renderAll();
			return;
		}
		const r = buildShell();
		refs = r;
		state.tab = tab;
		state.page = 1;
		state.selected.clear();
		document.body.appendChild(r.root);
		applyPalette();
		bind(r);
		renderAll();
		prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		unbindBus = on("data-changed", () => {
			if (!refs) return;
			if (state.tab === "settings") renderAll();
			else renderAll();
		});
		const unbindTheme = on("theme-changed", () => applyPalette());
		const prevUnbind = unbindBus;
		unbindBus = () => {
			prevUnbind?.();
			unbindTheme();
		};
		window.setTimeout(() => r.search.focus(), 30);
	}
	function closeManager() {
		if (!refs) return;
		const r = refs;
		refs = null;
		hideSub();
		r.root.remove();
		document.body.style.overflow = prevOverflow;
		unbindBus?.();
		unbindBus = null;
		if (keyHandler) {
			document.removeEventListener("keydown", keyHandler);
			keyHandler = null;
		}
		state.selected.clear();
	}
	function toggleManager() {
		if (refs) closeManager();
		else openManager();
	}
	TAG_PRESET_COLORS.length;
	var fab = null;
	function mountFab() {
		if (fab && fab.isConnected) return;
		const el = document.createElement("button");
		el.id = "brmk-fab";
		el.type = "button";
		el.title = "BiliRemark 备注管理（Alt+R）";
		el.setAttribute("aria-label", "打开备注管理");
		el.appendChild(icon("pencil", 16));
		const label = document.createElement("span");
		label.className = "brmk-fab-label";
		label.textContent = "备注";
		el.appendChild(label);
		el.addEventListener("click", () => toggleManager());
		document.body.appendChild(el);
		fab = el;
	}
	var root = null;
	var rescan = null;
	function setDoctorRescan(fn) {
		rescan = fn;
	}
	function buildReport() {
		const lines = [];
		const theme = getTheme();
		const stats = store.stats();
		lines.push(`URL: ${location.href}`);
		lines.push(`页面类型: ${document.title}`);
		lines.push(`主题: dark=${theme.dark} evolved=${theme.evolved} color=${theme.color}`);
		lines.push(`存储: ${stats.count} 条 / ${formatBytes(stats.bytes)}`);
		lines.push(`已注入徽标: ${badgeCount()}`);
		for (const diag of getDiagnostics()) {
			lines.push(`--- ${diag.label} (${diag.scene}) ---`);
			lines.push(`mid 命中: ${diag.midResolved} / 注入: ${diag.injected}`);
			for (const s of diag.selectors) lines.push(`  ${s.selector} => ${s.hits}`);
			for (const note of diag.notes) lines.push(`  ! ${note}`);
		}
		return lines.join("\n");
	}
	function openDoctor() {
		closeDoctor();
		const el = h("div");
		el.id = "brmk-doctor";
		const head = h("h4");
		head.appendChild(h("span", "", "选择器体检"));
		const closeBtn = h("button", "brmk-ed-close", "✕");
		closeBtn.type = "button";
		closeBtn.addEventListener("click", () => closeDoctor());
		head.appendChild(closeBtn);
		el.appendChild(head);
		const info = h("div");
		const theme = getTheme();
		const stats = store.stats();
		const row = (label, value) => {
			const r = h("div", "brmk-doc-row");
			r.appendChild(h("span", "", label));
			r.appendChild(h("b", "", value));
			info.appendChild(r);
		};
		row("主题", `${theme.dark ? "深色" : "浅色"} / ${theme.evolved ? "跟随 Evolved" : "默认 B 站粉"}`);
		row("主题色", theme.color);
		row("备注条数", String(stats.count));
		row("估算占用", formatBytes(stats.bytes));
		row("已注入徽标", String(badgeCount()));
		el.appendChild(info);
		const diags = getDiagnostics();
		if (!diags.length) el.appendChild(h("div", "brmk-doc-row", "当前页面没有启用的场景适配器"));
		for (const diag of diags) el.appendChild(h("div", "brmk-doc-row", `${diag.label}：mid ${diag.midResolved} / 注入 ${diag.injected}`));
		const pre = h("pre", "", buildReport());
		el.appendChild(pre);
		const actions = h("div");
		actions.style.display = "flex";
		actions.style.gap = "6px";
		actions.style.marginTop = "8px";
		const again = h("button", "brmk-btn", "重新扫描");
		again.type = "button";
		again.addEventListener("click", () => {
			rescan?.();
			closeDoctor();
			openDoctor();
		});
		const copy = h("button", "brmk-btn", "复制诊断");
		copy.type = "button";
		copy.addEventListener("click", () => {
			try {
				if (typeof GM_setClipboard === "function") GM_setClipboard(buildReport(), "text");
				else navigator.clipboard?.writeText(buildReport());
				toast("诊断信息已复制");
			} catch {
				toast("复制失败");
			}
		});
		actions.append(again, copy);
		el.appendChild(actions);
		document.body.appendChild(el);
		root = el;
	}
	function closeDoctor() {
		root?.remove();
		root = null;
	}
	function isDoctorOpen() {
		return !!root;
	}
	function doctorEnabled() {
		return getSettings().advanced.debug;
	}
	var VERSION = "1.6.2";
	var APP_NS = "__biliRemark__";
	var observer = null;
	var scanTimer = null;
	var patrolTimer = null;
	var urlTimer = null;
	var themeCleanup = null;
	var lastUrl = location.href;
	var started = false;
	var OWN_SELECTOR = "#brmk-manager, #brmk-editor, #brmk-toast, #brmk-doctor, #brmk-fab, #brmk-space-card, #brmk-layer, .brmk-badge, .brmk-pencil, .brmk-card-badge-row, #brmk-style";
	function isOwnNode(node) {
		if (!node) return false;
		const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		if (!el) return false;
		try {
			return !!el.closest(OWN_SELECTOR);
		} catch {
			return false;
		}
	}
	function mutationsAreOurs(records) {
		for (const record of records) {
			const added = Array.from(record.addedNodes);
			const removed = Array.from(record.removedNodes);
			if ((added.length || removed.length) && added.every(isOwnNode) && removed.every(isOwnNode)) continue;
			if (!isOwnNode(record.target)) return false;
			for (const node of added) if (!isOwnNode(node)) return false;
			for (const node of removed) if (!isOwnNode(node)) return false;
		}
		return true;
	}
	function scheduleScan(delay) {
		if (scanTimer !== null) window.clearTimeout(scanTimer);
		const wait = delay ?? getSettings().advanced.observerDebounceMs;
		scanTimer = window.setTimeout(() => {
			scanTimer = null;
			scanNow();
		}, wait);
	}
	function clearInjected() {
		clearAll();
	}
	function scanNow() {
		guard("scan", () => {
			const settings = getSettings();
			if (!settings.enabled) {
				cancelCommentBatch();
				clearInjected();
				clearSpaceAside();
				clearCardInline();
				return;
			}
			pruneBadges();
			if (isVideoPage()) {
				if (settings.scenes.videoUp) scanVideoUp();
				else clearVideoUpPencils();
			} else clearVideoUpPencils();
			if (isSpacePage()) {
				if (settings.scenes.space) scanSpaceAside();
				else clearSpaceAside();
			} else clearSpaceAside();
			if (hasCommentHost()) {
				if (settings.scenes.comment) scanComments();
				else clearCommentPencils();
			}
			if (isDynamicPage()) {
				if (settings.scenes.dynamic) scanDynamic();
				else clearDynamicPencils();
			}
			if (hasCardHost()) {
				if (settings.scenes.card) scanCards();
				else clearCardPencils();
			}
			if (isImPage()) {
				if (settings.scenes.message) scanIm();
				else clearImPencils();
			}
			if (isRelationPage()) {
				if (settings.scenes.relation) scanRelation();
				else clearRelationPencils();
			}
			log("扫描完成，徽标数", badgeCount());
		}, void 0);
	}
	function startObserver() {
		if (observer || !document.body) return;
		observer = new MutationObserver((records) => {
			if (!records.length) return;
			if (mutationsAreOurs(records)) return;
			scheduleScan();
		});
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		patrolTimer = window.setInterval(() => {
			if (document.hidden) return;
			scanNow();
		}, 3e3);
	}
	function stopObserver() {
		observer?.disconnect();
		observer = null;
		if (patrolTimer !== null) {
			window.clearInterval(patrolTimer);
			patrolTimer = null;
		}
	}
	function onRouteChange() {
		log("路由变化", location.href);
		cancelCommentBatch();
		clearInjected();
		if (!isSpacePage()) clearSpaceAside();
		closeDoctor();
		scheduleScan(300);
	}
	function watchRoute() {
		const check = () => {
			if (document.hidden) return;
			if (location.href !== lastUrl) {
				lastUrl = location.href;
				onRouteChange();
			}
		};
		window.addEventListener("popstate", check);
		window.addEventListener("hashchange", check);
		try {
			const origPush = history.pushState;
			const origReplace = history.replaceState;
			history.pushState = function(...args) {
				const ret = origPush.apply(this, args);
				window.setTimeout(check, 0);
				return ret;
			};
			history.replaceState = function(...args) {
				const ret = origReplace.apply(this, args);
				window.setTimeout(check, 0);
				return ret;
			};
		} catch (err) {
			warn("包装 history 失败，改用轮询兜底", err);
		}
		urlTimer = window.setInterval(check, 1e3);
	}
	function parseHotkey(spec) {
		const parts = spec.split("+").map((p) => p.trim().toLowerCase());
		const key = parts.pop() ?? "r";
		return {
			ctrl: parts.includes("ctrl") || parts.includes("control"),
			alt: parts.includes("alt"),
			shift: parts.includes("shift"),
			meta: parts.includes("meta") || parts.includes("cmd"),
			key
		};
	}
	function matchesHotkey(ev, spec) {
		if (ev.ctrlKey !== spec.ctrl || ev.altKey !== spec.alt || ev.shiftKey !== spec.shift || ev.metaKey !== spec.meta) return false;
		const key = ev.key.toLowerCase();
		if (spec.key.length === 1) return key === spec.key;
		return key === spec.key || ev.code.toLowerCase() === spec.key;
	}
	function bindHotkey() {
		document.addEventListener("keydown", (ev) => {
			const target = ev.target;
			if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
			if (matchesHotkey(ev, parseHotkey(getSettings().editor.hotkey))) {
				ev.preventDefault();
				ev.stopPropagation();
				toggleManager();
			}
		});
	}
	function registerMenus() {
		const safe = (fn) => () => guard("menu", fn, void 0);
		try {
			GM_registerMenuCommand("打开备注管理器", safe(() => openManager()));
			GM_registerMenuCommand("选择器体检", safe(() => openDoctor()));
			GM_registerMenuCommand("暂停 / 恢复备注显示", safe(() => {
				updateSettings((s) => {
					s.enabled = !s.enabled;
				});
				toast(getSettings().enabled ? "备注显示已恢复" : "备注显示已暂停（数据保留）");
				scanNow();
			}));
			GM_registerMenuCommand("导出备注 JSON", safe(() => {
				downloadText(`bili-remark-${stampForFile()}.json`, store.exportJSON(), "application/json");
				updateSettings((s) => {
					s.backup.lastExportAt = Date.now();
				});
				toast("已导出 JSON");
			}));
		} catch (err) {
			warn("注册菜单命令失败", err);
		}
	}
	function bindStorageSync() {
		try {
			GM_addValueChangeListener(STORAGE.data, (_name, _old, next, remote) => {
				if (!remote) return;
				store.replaceFromRemote(next);
				scanNow();
			});
			GM_addValueChangeListener(STORAGE.settings, (_name, _old, next, remote) => {
				if (!remote) return;
				reloadSettings(next);
				installStyles(refreshTheme());
				scanNow();
			});
		} catch (err) {
			warn("跨标签页同步不可用", err);
		}
	}
	function boot() {
		if (started) return;
		started = true;
		store.load();
		initFaceBackfill();
		refreshTheme();
		installStyles();
		themeCleanup = watchTheme(() => {
			installStyles(refreshTheme());
			emit("theme-changed");
			log("主题已更新");
		});
		mountFab();
		registerMenus();
		bindStorageSync();
		bindHotkey();
		setDoctorRescan(() => scanNow());
		on("data-changed", () => scanNow());
		on("settings-changed", () => {
			installStyles(refreshTheme());
			scanNow();
		});
		on("request-manager", () => openManager());
		on("request-doctor", () => openDoctor());
		if (doctorEnabled()) openDoctor();
		watchRoute();
		startObserver();
		scheduleScan(200);
		window.addEventListener("pagehide", () => {
			store.flush();
			stopObserver();
			themeCleanup?.();
			if (urlTimer !== null) window.clearInterval(urlTimer);
			if (scanTimer !== null) window.clearTimeout(scanTimer);
		});
		window[APP_NS] = {
			version: VERSION,
			openManager: () => openManager(),
			doctor: () => openDoctor(),
			rescan: () => scanNow(),
			toggle: () => toggleManager(),
			status: () => ({
				enabled: getSettings().enabled,
				badges: badgeCount(),
				managerOpen: isManagerOpen(),
				doctorOpen: isDoctorOpen()
			})
		};
		log(`v${VERSION} 已启动，脚本管理器：${typeof GM_info !== "undefined" ? GM_info.scriptHandler : "unknown"}`);
	}
	function main() {
		try {
			if (window.top !== window.self) return;
			if (!document.body) {
				document.addEventListener("DOMContentLoaded", main, { once: true });
				return;
			}
			boot();
		} catch (err) {
			warn("启动失败", err);
		}
	}
	main();
})();
