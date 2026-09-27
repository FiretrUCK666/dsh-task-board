import path, { join } from "node:path";
import { readFile, rename, stat } from "node:fs/promises";
import os, { homedir } from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
//#region src/host/http-json.ts
/**
* Read a JSON request body into an unknown value; null when unparseable.
* @param req - the incoming request stream.
* @param maxBytes - size cap (beyond it the body is rejected as null). The
*   board routes raise it for whole-document commits.
* @returns the parsed body, or null.
*/
async function readJsonBody(req, maxBytes = 1 << 20) {
	const outcome = await readJsonBodyDetailed(req, maxBytes);
	return outcome.ok ? outcome.value : null;
}
/**
* A JSON body read that DISTINGUISHES why it failed — oversized (the caller
* should answer 413) vs malformed/empty (400). The board's attachment bridge
* needs the difference so a too-large picture is never reported as a broken
* request.
* @param req - the incoming request stream.
* @param maxBytes - size cap in bytes.
* @returns the parsed value, or the reason it was refused.
*/
async function readJsonBodyDetailed(req, maxBytes) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		chunks.push(buffer);
		total += buffer.length;
		if (total > maxBytes) return {
			ok: false,
			reason: "oversize"
		};
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text === "") return {
		ok: false,
		reason: "empty"
	};
	try {
		return {
			ok: true,
			value: JSON.parse(text)
		};
	} catch {
		return {
			ok: false,
			reason: "malformed"
		};
	}
}
/** Write one JSON envelope response. */
function json$3(res, envelope, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(envelope));
}
//#endregion
//#region src/host/permission-route.ts
/**
* Build the pure permission-catalog route processor. The returned handler
* translates an HTTP GET into the catalog envelope without touching the
* server.
* @param deps - the catalog face (real or fake).
* @returns an HTTP handler for GET on the permission route.
*/
function createPermissionHandler(deps) {
	return async (req, res) => {
		if (req.method !== "GET") {
			res.writeHead(405);
			res.end();
			return;
		}
		let view;
		try {
			view = deps.read();
		} catch (error) {
			json$3(res, {
				ok: false,
				error: {
					code: "permissions",
					message: error instanceof Error ? error.message : String(error)
				}
			});
			return;
		}
		json$3(res, {
			ok: true,
			value: view ?? { available: false }
		});
	};
}
/**
* Register the permission-catalog route on the host web server, reading the
* native permission service on every request.
* @param ctx - context carrying the webServer service.
* @param ns - the plugin namespace (route path prefix).
* @returns the route disposer, or a no-op when the web server is absent.
*/
function registerPermissionRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	const handler = createPermissionHandler({ read: () => {
		const service = ctx.get("permissionPresets");
		if (service === void 0) return void 0;
		return {
			available: true,
			options: service.names.map((name) => {
				const option = service.optionOf(name);
				return {
					id: option.value,
					name: option.name,
					...option.description !== void 0 ? { description: option.description } : {}
				};
			})
		};
	} });
	return webServer.register({
		kind: "exact",
		path: `/api/${ns}/permissions`,
		handler
	});
}
//#endregion
//#region src/host/session-state-route.ts
function isStr(value) {
	return typeof value === "string" && value !== "";
}
/** Subagent finished words (native 'inactive' = finished; tolerate reshares). */
function subagentFinished(status) {
	return status === "inactive" || status === "finished" || status === "completed" || status === "done" || status === "settled";
}
/**
* Read the native plan/goal/subagent state of a session. Structural reads
* only: leaves that are not well-formed are dropped; a missing agent or
* throwing service produces no block at all.
*/
async function readSessionState(faces, sessionId) {
	const view = {};
	const agent = faces.agents !== void 0 ? faces.agents.get(sessionId) : faces.sessions?.get(sessionId);
	if (agent === void 0) return view;
	if (faces.planMode !== void 0) try {
		const plan = faces.planMode.get(agent);
		if (plan !== null && plan !== void 0) {
			const active = plan.active === true;
			const pending = plan.pending === true;
			if (active || pending) view.plan = {
				active,
				pending
			};
		}
	} catch {}
	if (faces.goals !== void 0) try {
		const goal = faces.goals.get(agent);
		if (goal !== null && goal !== void 0 && isStr(goal.objective) && goal.phase !== "complete") view.goal = {
			title: goal.objective,
			active: true
		};
	} catch {}
	if (faces.subagents !== void 0) try {
		const list = await faces.subagents.listChildren(sessionId);
		if (Array.isArray(list)) {
			const subagents = list.filter((row) => {
				const entry = row;
				return entry.kind === "child" && isStr(entry.label);
			}).map((row) => {
				const entry = row;
				return {
					title: entry.label,
					status: isStr(entry.activity) ? entry.activity : void 0
				};
			}).filter((item) => !subagentFinished(item.status));
			if (subagents.length > 0) view.subagents = subagents;
		}
	} catch {}
	return view;
}
/** Extract a query parameter out of a raw request URL (no URL dependency). */
function queryParamOf(rawUrl, key) {
	if (rawUrl === void 0) return void 0;
	const question = rawUrl.indexOf("?");
	if (question < 0) return void 0;
	for (const pair of rawUrl.slice(question + 1).split("&")) {
		const eq = pair.indexOf("=");
		const name = eq < 0 ? pair : pair.slice(0, eq);
		const value = eq < 0 ? "" : pair.slice(eq + 1);
		if (decodeURIComponent(name) === key) return decodeURIComponent(value);
	}
}
/** HTTP handler: GET /api/dsh-task-board/session-state?sessionId=… → { ok, plan?, goal? }. */
function createSessionStateHandler(faces, read = readSessionState) {
	return async (req, res) => {
		const sessionId = queryParamOf(req.url, "sessionId");
		if (sessionId === void 0 || sessionId === "") {
			res.writeHead(400);
			res.end();
			return;
		}
		const view = await read(faces, sessionId);
		res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({
			ok: true,
			...view
		}));
	};
}
/** Mount the bridge on the host web surface. */
function registerSessionStateRoute(ctx) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	const faces = {
		sessions: ctx.get("sessions"),
		agents: ctx.get("agents"),
		planMode: ctx.get("planMode"),
		goals: ctx.get("goals"),
		subagents: ctx.get("subagents")
	};
	return webServer.register({
		kind: "exact",
		path: "/api/dsh-task-board/session-state",
		handler: createSessionStateHandler(faces)
	});
}
/** The larger of two optional read stamps (undefined = never seen). A read
*  state only ever moves forward, so this join is the whole of it. */
function maxSeen(a, b) {
	if (a === void 0) return b;
	if (b === void 0) return a;
	return a >= b ? a : b;
}
/** Structural equality of a no-op predicate's inputs. */
function sameMergeState(a, b) {
	return JSON.stringify({
		r: a.rows,
		x: a.tombstones
	}) === JSON.stringify({
		r: b.rows,
		x: b.tombstones
	});
}
/**
* Apply one replica's row commit to the host's rows and return the merged
* state (the input is never mutated — both maps are copies).
*
* The contract, in the order it is applied:
*
* - put: a row the host lacks is inserted unless a tombstone outranks it (then
*   the delete stands) and its tombstone is cleared; a row the host has is
*   replaced when the replica CLAIMS it (content-equal claims are no-ops) or,
*   unclaimed, when the incoming copy is simply newer. Every acceptance is
*   stamped with the host clock.
* - read state joins onto whichever row won, including when none did.
* - delete: honored only when the host copy is not newer than the baseline the
*   delete was computed against; deleting an id the host never had is a no-op
*   and leaves any existing tombstone alone.
* - pruning: tombstones past their TTL (and the stamps of rows long gone).
*/
function applyRowCommit(state, incoming, claimed, deleted, ops, now) {
	const tombstones = { ...state.tombstones };
	const stamps = { ...state.stamps };
	const result = new Map(state.rows.map((row) => [row.id, row]));
	const sentAt = /* @__PURE__ */ new Map();
	for (const row of incoming) sentAt.set(row.id, Math.max(sentAt.get(row.id) ?? -Infinity, row.updatedAt));
	for (const raw of incoming) {
		const row = ops.normalize(raw);
		if (row === void 0) continue;
		const host = result.get(row.id);
		if (host === void 0) {
			const tomb = tombstones[row.id];
			if (tomb !== void 0 && row.updatedAt <= tomb.at) continue;
			delete tombstones[row.id];
			result.set(row.id, row);
			stamps[row.id] = now;
			continue;
		}
		let winner;
		if (claimed.has(row.id)) {
			if (ops.authorshipKey(host) !== ops.authorshipKey(row)) winner = row;
		} else if (row.updatedAt > host.updatedAt) winner = row;
		const merged = ops.mergeReadState(winner ?? host, row);
		if (winner !== void 0) {
			result.set(row.id, merged);
			stamps[row.id] = now;
		} else if (merged !== host) result.set(row.id, merged);
	}
	for (const del of deleted) {
		const host = result.get(del.id);
		if (host === void 0) continue;
		if (host.updatedAt > del.baseUpdatedAt) continue;
		const newest = Math.max(host.updatedAt, sentAt.get(del.id) ?? -Infinity, 0);
		result.delete(del.id);
		delete stamps[del.id];
		tombstones[del.id] = {
			at: newest + 1,
			seenAt: now
		};
	}
	for (const [id, tomb] of Object.entries(tombstones)) if (now - tomb.seenAt > 2592e6 && !result.has(id)) delete tombstones[id];
	for (const id of Object.keys(stamps)) if (!result.has(id)) delete stamps[id];
	return {
		rows: ops.sortRows(state.rows, incoming, result),
		tombstones,
		stamps
	};
}
/**
* Section merge. CLAIM protocol (a commit carrying `sectionClaims`): only a
* claimed section is taken — unconditionally, re-stamped with the host clock
* (client clocks never decide a section) — and an unclaimed section is
* SKIPPED, so the baseline copy every commit rides can never clobber a newer
* write. LEGACY (no `sectionClaims` field at all — a pre-claim client): plain
* LWW on the client stamp, ties by arrival, so the later commit wins
* deterministically.
*
* @param key - this document's name for the section. The claim list is keyed
*  by it, which is why the kernel takes a name and not a set of sections: which
*  sections exist is the document's business.
*/
function mergeSection(stored, incoming, clean, key, now, sectionClaims) {
	if (sectionClaims !== void 0) return sectionClaims.includes(key) ? {
		value: clean(incoming.value),
		at: now
	} : stored;
	const at = typeof incoming.at === "number" && Number.isFinite(incoming.at) ? incoming.at : 0;
	if (at < stored.at) return stored;
	return {
		value: clean(incoming.value),
		at
	};
}
//#endregion
//#region src/core/cruise.ts
/** One calendar day (cross-midnight normalization). */
const DAY_MS = 864e5;
/** Brand an unknown value as a valid window (persisted-state guard). */
function isCruiseWindow(value) {
	if (typeof value !== "object" || value === null) return false;
	const window = value;
	const startOk = window.startAt === void 0 || typeof window.startAt === "number" && Number.isFinite(window.startAt);
	const endOk = window.endAt === void 0 || typeof window.endAt === "number" && Number.isFinite(window.endAt);
	return startOk && endOk && (typeof window.startAt === "number" || typeof window.endAt === "number");
}
/**
* Normalize a window: a within-the-same-intent end earlier than the start is
* a cross-midnight window (22:00 → 02:00 is legal) — yield the end on the
* start's next day. An end more than a whole day BEFORE the start is NOT a
* cross-midnight window; it is a date mistake (windowRangeIssueOf returns
* 'end-too-early') and is left as-entered — the editor rejects it with a
* specific message instead of the stale rule silently surviving as a
* "everyday 22:00→01:00 of yesterday" artifact.
*/
function normalizeWindow(window) {
	const startAt = window.startAt;
	let endAt = window.endAt;
	if (startAt !== void 0 && endAt !== void 0 && endAt <= startAt && endAt > startAt - 864e5) endAt += DAY_MS;
	return {
		...startAt !== void 0 ? { startAt } : {},
		...endAt !== void 0 ? { endAt } : {}
	};
}
/**
* The sort key of one window: start-less (only-end = 立即开启) leads, then
* windows ascend by start; a tie on start ascends by end, an open end
* (stays on) last. The list order is derived — never a stored order.
*/
function windowSortKeyOf(window) {
	return {
		start: window.startAt ?? 0,
		end: window.endAt ?? Number.MAX_SAFE_INTEGER
	};
}
/** Sort windows: 立即开启 (start-less) first, then by start, then by end. */
function sortWindows(windows) {
	return [...windows].sort((a, b) => {
		const keyA = windowSortKeyOf(a);
		const keyB = windowSortKeyOf(b);
		return keyA.start - keyB.start || keyA.end - keyB.end;
	});
}
/** The six run-config keys a preset may carry (unknown keys are stripped). */
const CONFIG_KEYS = [
	"workspaceId",
	"provider",
	"model",
	"reasoningEffort",
	"agentPreset",
	"permission"
];
/** Structural row check: non-empty id/name strings + a clean config object. */
function isPresetShape$1(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	if (typeof row.id !== "string" || row.id === "") return false;
	if (typeof row.name !== "string" || row.name === "") return false;
	if (row.id === "deploy-default") return false;
	return typeof row.config === "object" && row.config !== null;
}
/** Keep only the known config keys with string values. */
function cleanConfig(value) {
	if (typeof value !== "object" || value === null) return {};
	const source = value;
	const cleaned = {};
	for (const key of CONFIG_KEYS) {
		const entry = source[key];
		if (typeof entry === "string") cleaned[key] = entry;
	}
	return cleaned;
}
/** Normalize a raw row list: valid custom presets only, duplicates dropped. */
function normalizeRunPresets(value) {
	if (!Array.isArray(value)) return [];
	const seen = /* @__PURE__ */ new Set();
	const rows = [];
	for (const entry of value) {
		if (!isPresetShape$1(entry)) continue;
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);
		rows.push({
			id: entry.id,
			name: entry.name,
			config: cleanConfig(entry.config)
		});
	}
	return rows;
}
/** Normalize a whole persisted document (corrupt → built-in only). */
function normalizeRunPresetDocument(value) {
	if (typeof value !== "object" || value === null) return { presets: [] };
	const row = value;
	const presets = normalizeRunPresets(row.presets);
	const defaultId = typeof row.defaultId === "string" && row.defaultId !== "" ? row.defaultId : void 0;
	return {
		presets,
		...defaultId !== void 0 ? { defaultId } : {}
	};
}
//#endregion
//#region src/core/schedule.ts
/** Inclusive ranges per field, in cron order. */
const FIELD_RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 7]
];
/**
* Parse a 5-field cron expression.
* @returns the match sets, or null when the expression is invalid.
*/
function parseCron(expr) {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	const sets = [];
	for (let index = 0; index < 5; index++) {
		const [min, max] = FIELD_RANGES[index];
		const set = /* @__PURE__ */ new Set();
		if (!parseField(fields[index], min, max, set)) return null;
		sets.push(set);
	}
	const weekdays = /* @__PURE__ */ new Set();
	for (const day of sets[4]) weekdays.add(day === 7 ? 0 : day);
	return {
		minutes: sets[0],
		hours: sets[1],
		days: sets[2],
		months: sets[3],
		weekdays,
		dayWildcard: fields[2] === "*",
		weekdayWildcard: fields[4] === "*"
	};
}
/** Whether the expression parses. */
function isValidCron(expr) {
	return parseCron(expr) !== null;
}
/** Parse one comma-list field into the match set. */
function parseField(field, min, max, out) {
	if (field === "*") {
		for (let value = min; value <= max; value++) out.add(value);
		return true;
	}
	for (const part of field.split(",")) {
		if (part === "") return false;
		const [range, stepRaw] = part.split("/");
		let low;
		let high;
		if (range === "*") {
			low = min;
			high = max;
		} else if (range.includes("-")) {
			const [a, b] = range.split("-");
			if (a === "" || b === "" || !isDigits(a) || !isDigits(b)) return false;
			low = Number(a);
			high = Number(b);
		} else if (isDigits(range)) {
			low = Number(range);
			high = Number(range);
		} else return false;
		if (low < min || high > max || low > high) return false;
		const step = stepRaw === void 0 ? 1 : isDigits(stepRaw) ? Number(stepRaw) : NaN;
		if (!Number.isInteger(step) || step < 1) return false;
		for (let value = low; value <= high; value += step) out.add(value);
	}
	return true;
}
function isDigits(value) {
	return /^\d+$/.test(value);
}
//#endregion
//#region src/core/tasks.ts
/** Brand an unknown string as a schedule mode. */
function isScheduleMode(value) {
	return value === "cron" || value === "chain";
}
/** All valid statuses (closed union guard). */
const ALL_STATUSES = [
	"backlog",
	"todo",
	"running",
	"review",
	"done"
];
/** Brand an unknown string as a status; undefined when it is not one. */
function isTaskStatus(value) {
	return typeof value === "string" && ALL_STATUSES.includes(value);
}
/** Whether a raw value is a storable prompt image (non-empty data + a media
*  type string). Deliberately LENIENT (no whitelist): storage walls must
*  never retroactively delete what an older version stored — the whitelist
*  gates new intake and the send layer, never the ledger. Crash-safety (no
*  undefined derefs downstream) is what storage guarantees. */
function isWellFormedImage(entry) {
	if (typeof entry !== "object" || entry === null) return false;
	const candidate = entry;
	return typeof candidate.data === "string" && candidate.data !== "" && typeof candidate.mediaType === "string" && candidate.mediaType !== "";
}
/** Whether a raw value is a storable file ref (non-empty receipt + name;
*  bytes only needs to be a number for display math — NaN displays ugly but
*  never crashes and never deletes). Same leniency law as images above. */
function isWellFormedFile(entry) {
	if (typeof entry !== "object" || entry === null) return false;
	const candidate = entry;
	return typeof candidate.receiptId === "string" && candidate.receiptId !== "" && typeof candidate.name === "string" && candidate.name !== "" && typeof candidate.bytes === "number";
}
/** Keep well-formed prompt images (a dirty element washes out, never the
*  row and never a downstream crash). */
function normalizePromptImages(raw) {
	if (!Array.isArray(raw)) return void 0;
	const kept = raw.filter(isWellFormedImage);
	return kept.length > 0 ? kept : void 0;
}
/** Keep well-formed file refs (same law as images). */
function normalizePromptFiles(raw) {
	if (!Array.isArray(raw)) return void 0;
	const kept = raw.filter(isWellFormedFile);
	return kept.length > 0 ? kept : void 0;
}
//#endregion
//#region src/core/automation.ts
/** Brand an unknown value as a valid rule (persisted-state guard). */
function isSessionRule(value) {
	if (typeof value !== "object" || value === null) return false;
	const rule = value;
	if (typeof rule.id !== "string" || rule.id === "") return false;
	if (typeof rule.sessionId !== "string" || rule.sessionId === "") return false;
	const usePrompt = rule.usePrompt === true;
	if (typeof rule.instruction !== "string" || rule.instruction === "" && !usePrompt) return false;
	if (rule.send !== "queue" && rule.send !== "steer") return false;
	if (typeof rule.enabled !== "boolean") return false;
	if ((rule.trigger === "on-complete" ? "on-complete" : "cron") === "on-complete") return rule.nextAt === void 0;
	if (typeof rule.cron !== "string" || rule.cron === "") return false;
	if (rule.enabled === false) return true;
	return typeof rule.nextAt === "number" && Number.isFinite(rule.nextAt);
}
/** Parse + validate a persisted rule list (invalid rows dropped; legacy rows
*  without a trigger normalize to cron, without usePrompt to custom text). */
function normalizeSessionRules(raw) {
	if (!Array.isArray(raw)) return void 0;
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const row of raw) {
		if (!isSessionRule(row) || seen.has(row.id)) continue;
		seen.add(row.id);
		const trigger = row.trigger === "on-complete" ? "on-complete" : "cron";
		out.push({
			id: row.id,
			sessionId: row.sessionId,
			instruction: row.instruction,
			...row.usePrompt === true ? { usePrompt: true } : {},
			trigger,
			...trigger === "cron" ? {
				cron: row.cron,
				nextAt: row.nextAt
			} : { cron: "" },
			send: row.send,
			enabled: row.enabled,
			...typeof row.lastAt === "number" ? { lastAt: row.lastAt } : {}
		});
	}
	return out.length > 0 ? out : void 0;
}
//#endregion
//#region src/core/store.ts
/**
* Task persistence: a small storage seam with a localStorage backend.
*
* The task-board client plugin runs in the browser, and dsh exposes no
* browser-writable file channel, so tasks persist in the browser's
* localStorage under a versioned key — the same persistence mechanism dsh's
* own client snapshot stores use (`createSnapshotStore` persist). Data
* survives page refreshes and dsh restarts (same origin), and survives
* plugin uninstall (the key is simply left in place).
*
* The seam keeps the backend swappable (e.g. an IndexedDB or a host-file
* channel later); tests run against the in-memory backend and a jsdom
* localStorage backend.
*/
/**
* Structural row check with the status left unvalidated (see {@link parseLedger}).
* The `schedule` field is deliberately NOT checked here: a malformed schedule
* never drops the task row — {@link normalizeSchedule} repairs or drops the
* schedule alone.
*/
function isTaskRecordShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	if (typeof record.id !== "string" || record.id === "") return false;
	if (typeof record.title !== "string") return false;
	if (typeof record.description !== "string") return false;
	if (typeof record.prompt !== "string") return false;
	if (typeof record.createdAt !== "number") return false;
	if (typeof record.updatedAt !== "number") return false;
	if (!Array.isArray(record.executions)) return false;
	for (const execution of record.executions) {
		if (typeof execution !== "object" || execution === null) return false;
		const entry = execution;
		if (typeof entry.id !== "string") return false;
		if (entry.sessionId !== void 0 && typeof entry.sessionId !== "string") return false;
		if (typeof entry.startedAt !== "number") return false;
		if (entry.endedAt !== void 0 && typeof entry.endedAt !== "number") return false;
		if (entry.result !== void 0 && entry.result !== "succeeded" && entry.result !== "failed" && entry.result !== "cancelled") return false;
		if (entry.error !== void 0 && typeof entry.error !== "string") return false;
	}
	return true;
}
/** Normalize an unknown persisted status back into the closed status union. */
function normalizeStatus(status) {
	if (isTaskStatus(status)) return status;
	if (status === "failed") return "review";
	return "todo";
}
/**
* Repair a persisted schedule rule: drop rules without a usable cron string
* (cron mode), coerce booleans/numbers, normalize the mode (legacy rules
* default to 'cron'), and leave `nextRunAt`/`lastTriggeredAt` undefined
* when missing (a fresh recompute or the next tick fixes them).
*/
function normalizeSchedule(schedule) {
	if (typeof schedule !== "object" || schedule === null) return void 0;
	const rule = schedule;
	const mode = isScheduleMode(rule.mode) ? rule.mode : "cron";
	if (typeof rule.cron !== "string") {
		if (mode !== "chain") return void 0;
	} else if (mode === "cron" && (rule.cron.trim() === "" || !isValidCron(rule.cron))) return;
	const maxRuns = rule.maxRuns;
	const runCount = rule.runCount;
	const missedToleranceMs = rule.missedToleranceMs;
	return {
		enabled: rule.enabled === true,
		mode,
		cron: typeof rule.cron === "string" ? rule.cron : "",
		nextRunAt: typeof rule.nextRunAt === "number" ? rule.nextRunAt : void 0,
		lastTriggeredAt: typeof rule.lastTriggeredAt === "number" ? rule.lastTriggeredAt : void 0,
		maxRuns: typeof maxRuns === "number" && Number.isInteger(maxRuns) && maxRuns > 0 ? maxRuns : void 0,
		runCount: typeof runCount === "number" && Number.isInteger(runCount) && runCount >= 0 ? runCount : 0,
		missedToleranceMs: typeof missedToleranceMs === "number" && Number.isFinite(missedToleranceMs) && missedToleranceMs > 0 ? Math.floor(missedToleranceMs) : void 0,
		primed: true
	};
}
/** Parse + validate a persisted ledger document; invalid rows are dropped. */
function parseLedger(raw) {
	if (raw === null) return [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error("[dsh-task-board] persisted task ledger is not valid JSON; starting empty", error);
		return [];
	}
	if (!Array.isArray(parsed)) {
		console.error("[dsh-task-board] persisted task ledger is not an array; starting empty");
		return [];
	}
	const tasks = [];
	for (const row of parsed) {
		if (!isTaskRecordShape(row)) {
			console.warn("[dsh-task-board] dropping invalid task row from persisted ledger", row);
			continue;
		}
		const task = {
			...row,
			status: normalizeStatus(row.status)
		};
		task.schedule = normalizeSchedule(row.schedule);
		delete task.refineSessionId;
		task.executions = task.executions.filter((round) => round.refine !== true);
		const rawOrder = row.order;
		task.order = typeof rawOrder === "number" && Number.isFinite(rawOrder) ? rawOrder : tasks.length;
		const rawViewed = row.viewedAt;
		task.viewedAt = typeof rawViewed === "number" ? rawViewed : task.executions.reduce((latest, round) => Math.max(latest, round.endedAt ?? round.startedAt), 0);
		task.executions = task.executions.map((round) => {
			if (round.viewedAt !== void 0) return round;
			return {
				...round,
				viewedAt: round.endedAt ?? round.startedAt
			};
		});
		const rawBind = row.bind;
		if (rawBind?.kind === "session" && typeof rawBind.sessionId === "string") task.bind = {
			kind: "session",
			sessionId: rawBind.sessionId
		};
		else if (rawBind?.kind === "workspace" && typeof rawBind.workspaceId === "string") task.bind = {
			kind: "workspace",
			workspaceId: rawBind.workspaceId
		};
		else delete task.bind;
		const rawBinds = row.binds;
		if (Array.isArray(rawBinds)) {
			const binds = rawBinds.map((entry) => {
				if (typeof entry !== "object" || entry === null) return void 0;
				const source = entry;
				if (source.kind === "session" && typeof source.sessionId === "string") return {
					kind: "session",
					sessionId: source.sessionId
				};
				if (source.kind === "workspace" && typeof source.workspaceId === "string") return {
					kind: "workspace",
					workspaceId: source.workspaceId
				};
			}).filter((entry) => entry !== void 0);
			if (binds.length > 0) task.binds = binds;
			else delete task.binds;
		} else delete task.binds;
		const rawHidden = row.hidden;
		const cleanIdArray = (value) => {
			if (!Array.isArray(value)) return void 0;
			const ids = value.filter((item) => typeof item === "string");
			return ids.length > 0 ? ids : void 0;
		};
		if (rawHidden !== null && typeof rawHidden === "object") {
			const executions = cleanIdArray(rawHidden.executions);
			const sessions = cleanIdArray(rawHidden.sessions);
			if (executions !== void 0 || sessions !== void 0) task.hidden = {
				...executions !== void 0 ? { executions } : {},
				...sessions !== void 0 ? { sessions } : {}
			};
		}
		if (task.hidden === void 0) delete task.hidden;
		const removedSessions = cleanIdArray(row.removedSessions);
		if (removedSessions !== void 0) task.removedSessions = removedSessions;
		else delete task.removedSessions;
		const sessionsOrder = cleanIdArray(row.sessionsOrder);
		if (sessionsOrder !== void 0) task.sessionsOrder = sessionsOrder;
		else delete task.sessionsOrder;
		delete task.tags;
		delete task.dueAt;
		delete task.priority;
		delete task.labels;
		const rawColor = row.color;
		if (typeof rawColor === "string" && rawColor !== "") task.color = rawColor;
		else delete task.color;
		const rawImages = row.promptImages;
		const images = normalizePromptImages(rawImages);
		if (images !== void 0) task.promptImages = images;
		else delete task.promptImages;
		const rawFiles = row.promptFiles;
		const files = normalizePromptFiles(rawFiles);
		if (files !== void 0) task.promptFiles = files;
		else delete task.promptFiles;
		const rawHistory = row.statusHistory;
		const birthAt = typeof task.createdAt === "number" && Number.isFinite(task.createdAt) && task.createdAt > 0 ? task.createdAt : task.updatedAt;
		if (Array.isArray(rawHistory)) {
			const history = rawHistory.filter((entry) => typeof entry === "object" && entry !== null && isTaskStatus(entry.status) && typeof entry.at === "number" && Number.isFinite(entry.at) && entry.at > 0).map((entry) => ({
				status: entry.status,
				at: entry.at
			})).sort((a, b) => a.at - b.at);
			if (history.length === 0) history.push({
				status: task.status,
				at: birthAt
			});
			const last = history[history.length - 1];
			if (last !== void 0 && last.status !== task.status) history.push({
				status: task.status,
				at: task.updatedAt
			});
			task.statusHistory = history;
		} else task.statusHistory = [{
			status: task.status,
			at: birthAt
		}];
		const rules = normalizeSessionRules(row.rules);
		if (rules !== void 0) task.rules = rules;
		else delete task.rules;
		tasks.push(task);
	}
	return tasks;
}
//#endregion
//#region src/core/presets.ts
/** Structural row check: an override must carry id/label/cron strings. */
function isPresetShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	return typeof row.id === "string" && row.id !== "" && typeof row.label === "string" && typeof row.cron === "string" && row.cron !== "";
}
/** Parse + validate the persisted override document; invalid rows are dropped. */
function parsePresets(raw) {
	if (raw === null) return [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error("[dsh-task-board] persisted schedule presets are not valid JSON; starting with defaults", error);
		return [];
	}
	if (!Array.isArray(parsed)) {
		console.error("[dsh-task-board] persisted schedule presets are not an array; starting with defaults");
		return [];
	}
	return parsed.filter(isPresetShape);
}
//#endregion
//#region src/core/board-doc.ts
/**
* The board document: the ONE host-owned truth every browser replica syncs
* against — the task ledger plus the board's shared state sections (cruise,
* schedule presets, run presets) — and the merge grammar that makes
* concurrent multi-device edits converge deterministically.
*
* Sync model (host = authority, browsers = optimistic replicas):
* - A client commits its whole local view: the full tasks array, the section
*   values, and the deletions it observed since its last synced baseline
*   (each delete carries the `updatedAt` the client saw, so the host can tell
*   a delete from a stale copy).
* - The host resolves record by record — last-writer-wins on the record's own
*   `updatedAt`, tombstones suppressing deletes that a stale replica would
*   otherwise resurrect — and section by section (LWW on the section write
*   stamp), then returns the authoritative document. Every replica converges
*   on that response, so drift is impossible without compare-and-swap.
* - `revision` is the host's monotonic change counter (the SSE resync signal
*   and the "did anything actually move" test), never a write gate.
*
* Clock-skew rule: record conflicts are resolved by AUTHORSHIP, not by
* clocks — a commit declares `changed` (the ids its own edits moved against
* the last synced baseline), the host accepts those unconditionally (its
* serial commit order decides, so a phone whose clock runs minutes behind
* still wins with its newest gesture), and every record the replica does NOT
* claim merges by `updatedAt` LWW (an untouched stale copy can never clobber
* a newer edit). Tombstones are stamped one millisecond above the newest
* `updatedAt` the host ever saw for that id, so a delete always beats the
* stale copies other replicas still hold, while a genuinely newer edit (a
* concurrent revive) still wins. `stamps` records the host wall time each
* row was last accepted (diagnostics / future pruning).
*
* Framework-free pure logic: host and client share this one grammar; tests
* drive it directly.
*/
/** The default cruise section value of a never-written board. */
const DEFAULT_CRUISE_VALUE = {
	enabled: false,
	limit: 5,
	schedule: []
};
/** Clamp one concurrency budget to the shared bounds (THE one clamp: writes
*  floor + clamp through this, reads normalize through this — never two
*  grammars). NaN falls to MIN (self-guarding:
*  no caller memory required — infinities clamp naturally to their end). */
function clampCruiseLimit(value) {
	if (Number.isNaN(value)) return 1;
	return Math.min(20, Math.max(1, Math.floor(value)));
}
/** A fresh empty document (host first boot; revision 0 marks "never committed"). */
function emptyBoardDoc(now) {
	return {
		revision: 0,
		tasks: [],
		cruise: {
			value: DEFAULT_CRUISE_VALUE,
			at: now
		},
		schedulePresets: {
			value: [],
			at: now
		},
		runPresets: {
			value: { presets: [] },
			at: now
		},
		tombstones: {},
		stamps: {},
		bornAt: now
	};
}
/** Normalize an unknown cruise value (the controller constructor's grammar,
*  shared so host and client judge persisted cruise state identically). */
function normalizeCruiseValue(value) {
	if (typeof value !== "object" || value === null) return { ...DEFAULT_CRUISE_VALUE };
	const row = value;
	const limit = clampCruiseLimit(typeof row.limit === "number" && Number.isFinite(row.limit) ? row.limit : DEFAULT_CRUISE_VALUE.limit);
	return {
		enabled: row.enabled === true,
		...row.manual === true || row.manual === false ? { manual: row.manual } : {},
		limit,
		schedule: Array.isArray(row.schedule) ? sortWindows(row.schedule.filter(isCruiseWindow).map(normalizeWindow)) : []
	};
}
/** Normalize an unknown section carrying a value + write stamp. */
function normalizeSection(value, at, fallback, clean) {
	if (typeof value !== "object" || value === null) return {
		value: fallback,
		at
	};
	const row = value;
	const stamp = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : at;
	return {
		value: clean(row.value),
		at: stamp
	};
}
/** Normalize an unknown persisted document (the medium's word is data, not
*  truth: every part degrades to its empty shape rather than failing the doc).
*  @param value - the raw medium/global value.
*  @param now - clock for the empty/fresh fallbacks (host passes its injected
*    clock so a first-boot document carries a deterministic birth time). */
function normalizeBoardDoc(value, now = Date.now()) {
	if (typeof value !== "object" || value === null) return emptyBoardDoc(now);
	const row = value;
	const revision = typeof row.revision === "number" && Number.isFinite(row.revision) && row.revision >= 0 ? Math.floor(row.revision) : 0;
	const bornAt = typeof row.bornAt === "number" && Number.isFinite(row.bornAt) ? row.bornAt : now;
	const tasks = Array.isArray(row.tasks) ? parseLedger(JSON.stringify(row.tasks)) : [];
	const tombstones = {};
	if (typeof row.tombstones === "object" && row.tombstones !== null) for (const [id, entry] of Object.entries(row.tombstones)) {
		if (typeof entry !== "object" || entry === null) continue;
		const t = entry;
		if (typeof t.at !== "number" || !Number.isFinite(t.at)) continue;
		tombstones[id] = {
			at: t.at,
			seenAt: typeof t.seenAt === "number" && Number.isFinite(t.seenAt) ? t.seenAt : bornAt
		};
	}
	const empty = emptyBoardDoc(bornAt);
	const stamps = {};
	if (typeof row.stamps === "object" && row.stamps !== null) {
		for (const [id, at] of Object.entries(row.stamps)) if (typeof at === "number" && Number.isFinite(at) && at >= 0) stamps[id] = at;
	}
	return {
		revision,
		tasks,
		cruise: normalizeSection(row.cruise, empty.cruise.at, DEFAULT_CRUISE_VALUE, normalizeCruiseValue),
		schedulePresets: normalizeSection(row.schedulePresets, empty.schedulePresets.at, [], parsePresetsRaw),
		runPresets: normalizeSection(row.runPresets, empty.runPresets.at, { presets: [] }, normalizeRunPresetDocument),
		tombstones,
		stamps,
		bornAt
	};
}
/** Presets arrive as a raw JSON array (the persisted shape); parsePresets
*  works on the JSON text, so round-trip through it for one grammar. */
function parsePresetsRaw(raw) {
	if (!Array.isArray(raw)) return [];
	return parsePresets(JSON.stringify(raw));
}
/** One row's authorship fingerprint: its JSON minus every read-state field. */
function authorshipKey(task) {
	const { viewedAt: _taskViewed, ...rest } = task;
	return JSON.stringify({
		...rest,
		executions: task.executions.map(({ viewedAt: _roundViewed, ...round }) => round)
	});
}
/**
* Fold the incoming row's READ STATE into the content winner: task.viewedAt
* and each execution's viewedAt move forward only (matched by round id; a
* round the winner lacks keeps whatever the winner has). Returns the same
* object when nothing moved (no churn, no broadcast).
*/
function mergeReadState(winner, incoming) {
	const viewedAt = maxSeen(winner.viewedAt, incoming.viewedAt);
	const rounds = winner.executions.map((round) => {
		const seen = incoming.executions.find((candidate) => candidate.id === round.id);
		const roundViewed = maxSeen(round.viewedAt, seen?.viewedAt);
		return roundViewed === round.viewedAt ? round : {
			...round,
			viewedAt: roundViewed
		};
	});
	const viewMoved = viewedAt !== winner.viewedAt;
	const roundsMoved = rounds.some((round, index) => round !== winner.executions[index]);
	if (!viewMoved && !roundsMoved) return winner;
	return {
		...winner,
		viewedAt,
		executions: rounds
	};
}
/** Where a row lands: host rows keep their slots, rows the host lacked append
*  (their `order` field carries the real column position). The array is the
*  document's own order, so this is where a second document's ordering lives. */
function sortBoardTasks(hostRows, incoming, resolved) {
	const tasks = hostRows.filter((task) => resolved.has(task.id)).map((task) => resolved.get(task.id));
	const seen = new Set(hostRows.map((task) => task.id));
	for (const task of incoming) {
		const merged = resolved.get(task.id);
		if (merged !== void 0 && !seen.has(task.id)) {
			tasks.push(merged);
			seen.add(task.id);
		}
	}
	return tasks;
}
/** The board's half of the grammar: the four answers only a task ledger can
*  give. Everything else the merge does is the kernel's. */
const TASK_ROW_OPS = {
	normalize: normalizeIncomingTask,
	authorshipKey,
	mergeReadState,
	sortRows: sortBoardTasks
};
/** Structural equality of two documents (the "did anything move" test that
*  keeps a no-op commit from bumping the revision and storming replicas).
*  Composed from the kernel's part plus this document's own sections — and it
*  is deliberately the BOARD's predicate, not a shared one: one predicate
*  shared across two documents reads one document's unchanged state as the
*  other's change. */
function sameBoardDocs(a, b) {
	return sameMergeState({
		rows: a.tasks,
		tombstones: a.tombstones
	}, {
		rows: b.tasks,
		tombstones: b.tombstones
	}) && JSON.stringify({
		c: a.cruise,
		p: a.schedulePresets,
		r: a.runPresets
	}) === JSON.stringify({
		c: b.cruise,
		p: b.schedulePresets,
		r: b.runPresets
	});
}
/**
* Apply one client commit to the authoritative document and return the new
* truth (the input is never mutated). This function is the BOARD's assembly of
* the sync contract: the rows go through the merge kernel with the four
* answers from {@link TASK_ROW_OPS}, the three sections through the kernel's
* section protocol. The laws themselves live in board-merge-core.ts.
*
* The shape of the whole contract, for anyone reading it here:
*
* - put: a record the host lacks is inserted unless a tombstone outranks it
*   (then the delete stands); a record the host has is replaced when the
*   replica CLAIMS it (in `changed` — the commit arrived after whatever the
*   host holds, host serialization decides, clocks are irrelevant; content-
*   equal claims are no-ops) or, unclaimed, when the incoming copy is simply
*   newer (`updatedAt` LWW, host wins ties). Every acceptance stamps the row
*   with the host clock.
* - delete: honored only when the host copy is not newer than the baseline
*   stamp the delete was computed against; the tombstone lands one ms above
*   the newest `updatedAt` ever seen for the id (skew-proof).
* - sections: a claimed section is taken unconditionally and re-stamped with
*   the host clock; an unclaimed one is skipped; a pre-claim client falls back
*   to LWW on its own stamp.
* - unchanged result → the same document object (no revision bump, no
*   persist, no broadcast).
*/
function applyCommit(doc, commit, now) {
	const merged = applyRowCommit({
		rows: doc.tasks,
		tombstones: doc.tombstones,
		stamps: doc.stamps
	}, commit.tasks, new Set(commit.changed ?? []), commit.deleted, TASK_ROW_OPS, now);
	const next = {
		revision: doc.revision + 1,
		tasks: merged.rows,
		cruise: mergeSection(doc.cruise, commit.cruise, normalizeCruiseValue, "cruise", now, commit.sectionClaims),
		schedulePresets: mergeSection(doc.schedulePresets, commit.schedulePresets, parsePresetsRaw, "schedulePresets", now, commit.sectionClaims),
		runPresets: mergeSection(doc.runPresets, commit.runPresets, normalizeRunPresetDocument, "runPresets", now, commit.sectionClaims),
		tombstones: merged.tombstones,
		stamps: merged.stamps,
		bornAt: doc.bornAt
	};
	return sameBoardDocs(doc, next) ? doc : next;
}
/** One incoming task row, normalized through the persisted-ledger grammar
*  (the host never trusts a replica's shape); undefined when unusable. */
function normalizeIncomingTask(task) {
	const [row] = parseLedger(JSON.stringify([task]));
	return row;
}
//#endregion
//#region src/core/item.ts
/** The closed status enum, in display order (进行中 is derived, never listed). */
const ITEM_STATUSES = [
	"open",
	"blocked",
	"done"
];
/** The four priority tiers, lowest first. */
const ITEM_PRIORITIES = [
	"low",
	"normal",
	"high",
	"urgent"
];
/**
* Structural check for a persisted row: what makes a row a ROW. Status and
* priority stay free (the normalizers below repair them), and so do the steps'
* own entries — those are repaired one by one in {@link normalizeSteps}.
*
* ONE DELIBERATE DIVERGENCE FROM THE LEDGER GRAMMAR. `parseLedger` drops a
* whole task when one of its execution rounds is malformed, and that is right
* there: a round is a fact about a run, and silently keeping the card without it
* would misreport its history. A checklist step is a line the person typed, and
* the blast radius is the other way round — dropping the whole item (body,
* notes, three dates) to fix one checkbox is the bug, not the repair. So the
* row is checked and the entries are repaired.
*/
function isItemRecordShape(value) {
	if (typeof value !== "object" || value === null) return false;
	const row = value;
	if (typeof row.id !== "string" || row.id === "") return false;
	if (typeof row.title !== "string") return false;
	if (typeof row.body !== "string") return false;
	if (typeof row.notes !== "string") return false;
	if (typeof row.createdAt !== "number") return false;
	if (typeof row.updatedAt !== "number") return false;
	if (row.taskId !== void 0 && typeof row.taskId !== "string") return false;
	if (!Array.isArray(row.steps)) return false;
	if (typeof row.origin !== "object" || row.origin === null) return false;
	const origin = row.origin;
	if (origin.source !== "human" && origin.source !== "ai" && origin.source !== "import") return false;
	if (typeof origin.at !== "number") return false;
	if (origin.sessionId !== void 0 && typeof origin.sessionId !== "string") return false;
	return true;
}
/** A finite timestamp, or undefined for every other shape (including NaN). */
function normalizeInstant(raw) {
	return typeof raw === "number" && Number.isFinite(raw) ? raw : void 0;
}
/** Tags: strings only, blanks dropped, order kept, duplicates folded. */
function normalizeTags(raw) {
	if (!Array.isArray(raw)) return [];
	const tags = [];
	for (const entry of raw) {
		if (typeof entry !== "string") continue;
		const tag = entry.trim();
		if (tag === "" || tags.includes(tag)) continue;
		tags.push(tag);
	}
	return tags;
}
/** Steps: an entry is kept when its id and text are readable, malformed ones
*  dropped, ids made unique. A `done` that is not a boolean reads as NOT done:
*  a wrongly-ticked box hides work that still exists, while a wrongly-unticked
*  one only shows work that is there. The text is the person's, so a corrupt
*  checkbox must never cost them the line. */
function normalizeSteps(raw) {
	if (!Array.isArray(raw)) return [];
	const steps = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const step = entry;
		if (typeof step.id !== "string" || step.id === "") continue;
		if (typeof step.text !== "string") continue;
		if (steps.some((existing) => existing.id === step.id)) continue;
		steps.push({
			id: step.id,
			text: step.text,
			done: step.done === true
		});
	}
	return steps;
}
/**
* Parse + repair a persisted checklist document; unusable rows are dropped.
* Mirrors the ledger's grammar deliberately (same failure behaviour, same
* console discipline, same "repair the field, never fail the row" law) so the
* two documents cannot drift into different standards for the same mistake.
*
* @param raw - the persisted JSON text.
* @param mintRef - the document's short-number counter. Required, not
*  defaulted: a row's number is the document's to hand out, and a silent
*  fallback that mints the same number twice would make two rows answer to
*  one name.
*/
function parseItems(raw, mintRef) {
	if (raw === null) return [];
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error("[dsh-task-board] persisted checklist is not valid JSON; starting empty", error);
		return [];
	}
	if (!Array.isArray(parsed)) {
		console.error("[dsh-task-board] persisted checklist is not an array; starting empty");
		return [];
	}
	const items = [];
	for (const row of parsed) {
		if (!isItemRecordShape(row)) {
			console.warn("[dsh-task-board] dropping invalid checklist row", row);
			continue;
		}
		const rawRef = row.ref;
		const ref = typeof rawRef === "number" && Number.isInteger(rawRef) && rawRef > 0 ? rawRef : mintRef();
		items.push({
			id: row.id,
			ref,
			title: row.title,
			body: row.body,
			notes: row.notes,
			steps: normalizeSteps(row.steps),
			status: ITEM_STATUSES.includes(row.status) ? row.status : "open",
			priority: ITEM_PRIORITIES.includes(row.priority) ? row.priority : "normal",
			tags: normalizeTags(row.tags),
			startsAfter: normalizeInstant(row.startsAfter),
			dueAt: normalizeInstant(row.dueAt),
			hardDueAt: normalizeInstant(row.hardDueAt),
			taskId: typeof row.taskId === "string" && row.taskId !== "" ? row.taskId : void 0,
			origin: {
				source: row.origin.source,
				at: row.origin.at,
				...row.origin.sessionId !== void 0 && row.origin.sessionId !== "" ? { sessionId: row.origin.sessionId } : {}
			},
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		});
	}
	return items;
}
//#endregion
//#region src/core/items-doc.ts
/**
* The items document — the SECOND synced document, and the first consumer of
* the merge kernel. It is a sibling of the board ledger, not a view over it:
* its own document, its own truth, its own tombstone space, its own no-op
* predicate, and its own short-number counter.
*
* Everything below is the board's grammar (board-merge-core.ts) with five
* answers supplied, and nothing more. That the KERNEL needed no change to
* carry a document this different is the point of having extracted it — and it
* is checked, not assumed: the board's own spec is unchanged, so the kernel's
* behaviour on the board is the same behaviour it had before this file existed.
*
* ── THE SHORT NUMBER (`ref`), the one invariant this document owns ──────────
*
* A replica creates items optimistically, so it mints a number long before the
* host has seen the row. Two replicas that have not seen each other mint the
* SAME number for two different items, and the kernel will happily accept both:
* rows merge by identity (`id`) and freshness (`updatedAt`), and `ref` is just
* a field inside a row. Uniqueness is therefore NOT a merge invariant — it is
* a DOCUMENT invariant, and this file is where it is enforced.
*
* THE LAW: the document is the only authority on a number, and every number
* entering it — from any replica, from any field repair, from a corrupt file —
* passes through ONE chokepoint, {@link assignItemRefs}, AFTER the merge:
*
*  - a number that is positive and NOT currently in use is KEPT. A replica's
*    optimistic guess is honoured, so the ordinary single-device case displays
*    the very number the device already showed, and nothing ever flickers.
*  - a number that is missing, malformed, or ALREADY TAKEN is replaced with the
*    smallest free number at or above the document's counter. Two racing
*    replicas therefore end up 13 and 14 — no duplicate, no gap, and the same
*    answer whoever arrives first, because the host's serial order is the
*    arbiter (the same law the board already uses for equal stamps).
*
* WHY THE HOST ARBITRATES RATHER THAN LEAVING NUMBERS TO CLIENTS. Two options
* were weighed. "Clients never mint" is collision-proof by construction, but
* the panel is offline-first with a debounced commit, so every new row would
* sit unnumbered until the round trip — and an unnumbered row cannot be
* referred to ("把第 3 条改了"), which is exactly the receipt PRD §4.2 calls the
* precondition for continuous conversation. Host-arbitrated minting keeps the
* number on screen from the first frame, and a re-mint only ever fires in a
* genuine two-device race — where somebody is wrong regardless. The only
* question that race leaves open is whether the wrongness is silent and
* permanent, or one hop and converged; this design is the second.
*
* WHAT THIS COSTS, STATED RATHER THAN DISCOVERED. A collision leaves no gap (13
* and 14, dense). A CLAIM that reintroduces a number another row now holds does:
* the number that row vacated is not reissued, so the list ends up with a hole
* where it used to be. That is the deliberate trade — a gap is invisible in a
* checklist, while the alternative (a number changing under a person who just
* read it out loud) is a lie told to their face. The kernel is what makes the
* vacated number unreachable: the claim is taken whole, number included, and by
* then the document no longer knows the row ever held it.
*
* WHY THE COUNTER IS STORED AND NOT DERIVED FROM THE ROWS. A derived counter
* (`max(refs) + 1`) would hand a DELETED item's number to the next item, and
* since checklist deletions are recoverable (they go through a tombstone), a
* later restore would put two `#60`s on the board — the same collision,
* arriving through the back door. So `nextRef` is document state. Which is why
* it is part of THIS document's no-op predicate (the board's `stamps` is
* deliberately not part of the board's): a commit that mints a number has
* changed the document, and a counter allowed to roll back on a no-op would
* re-mint a number that is in use.
*
* ── WHY THIS DOCUMENT HAS NO SECTIONS ───────────────────────────────────────
*
* The board carries three synced sections beside its rows; the checklist
* carries none, so an items commit has no `sectionClaims` and never calls the
* kernel's section protocol. That is a fact about this document, not a missing
* feature: adding a section later means giving it a claim protocol here, not
* widening the kernel.
*/
/** A fresh empty checklist (host first boot; revision 0 marks "never committed"). */
function emptyItemsDoc(now) {
	return {
		revision: 0,
		items: [],
		tombstones: {},
		stamps: {},
		nextRef: 1,
		bornAt: now
	};
}
/** The highest number any row actually carries (0 for an empty checklist). */
function highestRefOf(items) {
	let highest = 0;
	for (const item of items) if (item.ref > highest) highest = item.ref;
	return highest;
}
/**
* THE SHORT-NUMBER CHOKEPOINT. The only place a number is handed out, and the
* only place uniqueness is decided (see the module header for why this is a
* document invariant rather than a merge one).
*
* A number is kept when it is a positive integer nothing else in this document
* is using; otherwise the row is re-stamped with the smallest free number above
* every number the document already holds AND above `nextRef`. Both halves of
* that sentence matter: a replica's own free guess is often far ahead of the
* stored counter (a long-offline device mints 13 off a max of 12), so seeding
* the counter from the stored value alone would hand the next collision a
* number BELOW one already in use — and a list whose numbers run backwards is
* worse than a list with a gap in it.
*
* Runs AFTER the merge, so a row that lost the merge never consumes a number,
* and re-mints a row that arrived with a number somebody else already holds —
* which is also how a checklist that was already broken (a hand-edited file, two
* devices that raced before this law existed) heals on the next commit instead
* of staying broken.
*/
function assignItemRefs(items, nextRef) {
	const taken = /* @__PURE__ */ new Set();
	const numbered = [];
	let counter = Math.max(1, Math.trunc(nextRef), highestRefOf(items) + 1);
	for (const item of items) {
		if (Number.isInteger(item.ref) && item.ref > 0 && !taken.has(item.ref)) {
			taken.add(item.ref);
			numbered.push(item);
			continue;
		}
		while (taken.has(counter)) counter++;
		taken.add(counter);
		numbered.push(counter === item.ref ? item : {
			...item,
			ref: counter
		});
		counter++;
	}
	return {
		items: numbered,
		nextRef: counter
	};
}
/**
* One row's authorship fingerprint, and it deliberately EXCLUDES the short
* number. `ITEM_FIELDS` rules `ref` `derived` — the document's to hand out — so
* a claim must not be able to carry one, exactly as a claim must not be able to
* carry the board's read state. Without this, a replica whose copy predates a
* collision correction would claim the stale number back on every edit and the
* correction would never settle.
*
* The fields are listed one by one rather than spread, so the fingerprint
* cannot silently change meaning if a field is added to the row or the parse
* order is ever reordered.
*/
function itemAuthorshipKey(item) {
	return JSON.stringify({
		id: item.id,
		title: item.title,
		body: item.body,
		notes: item.notes,
		steps: item.steps,
		status: item.status,
		priority: item.priority,
		tags: item.tags,
		startsAfter: item.startsAfter,
		dueAt: item.dueAt,
		hardDueAt: item.hardDueAt,
		taskId: item.taskId,
		origin: item.origin,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt
	});
}
/** The number the sort reads for "when is this wanted" — unset rows sort last. */
const UNSET_DATE = Number.MAX_SAFE_INTEGER;
function wantedAt(item) {
	const dates = [
		item.startsAfter,
		item.dueAt,
		item.hardDueAt
	].filter((at) => at !== void 0);
	return dates.length === 0 ? UNSET_DATE : Math.min(...dates);
}
const STATUS_RANK = {
	open: 0,
	blocked: 1,
	done: 2
};
const PRIORITY_RANK = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3
};
/**
* The document's own order, and a PURE FUNCTION of the document — which the
* board cannot say of its own (a card's slot is a manual drag, so two devices
* can disagree about it and the host settles it by arrival). The checklist has
* no manual order (the new-field admission rule kept `order` out of the model),
* so its order is derived, so two replicas holding the same rows show the same
* list without ever syncing the order itself.
*
* Finished rows last, then urgency, then whichever of the three dates is
* nearest, then age, then the short number — which is unique, so the comparison
* is TOTAL and the result cannot depend on the order the rows arrived in.
*
* @param rows - the finished rows (numbers assigned, tombstones settled).
*/
function sortItems(rows) {
	return [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || wantedAt(a) - wantedAt(b) || a.createdAt - b.createdAt || a.ref - b.ref);
}
/** What the inbound grammar writes for a number it could not read. NOT a usable
*  number: the document's chokepoint mints the real one after the merge, so a
*  row that LOSES the merge never burns a number. */
const UNSET_REF = 0;
/** One incoming row through the checklist's own grammar. The host never trusts
*  a replica's shape, and {@link parseItems} is where that is said. */
function normalizeIncomingItem(item) {
	return parseItems(JSON.stringify([item]), () => UNSET_REF)[0];
}
/** The checklist's half of the grammar: the four answers only a checklist can
*  give. Everything else the merge does is the kernel's.
*
*  Exported so the answers themselves can be pinned, and one of them cannot be
*  pinned any other way: `mergeReadState` is the IDENTITY, and its entire
*  correctness is that it is invisible from outside (an equal copy would still
*  compare equal, so every document-level test would pass with the bug in
*  place). A guarantee nobody can reach is a guarantee nobody has checked. */
const ITEM_ROW_OPS = {
	normalize: normalizeIncomingItem,
	authorshipKey: itemAuthorshipKey,
	/**
	* THE IDENTITY, and that is the correct implementation rather than a missing
	* one. This document has no read state: `ITEM_FIELDS` carries no `viewedAt`,
	* because the checklist is scanned rather than watched and the board's unread
	* reminder has no business on a row that is not a run. A join of nothing with
	* nothing is the identity.
	*
	* It must return the winner OBJECT, not an equal copy: the kernel reads
	* `merged !== host` as "the read state moved", so a fresh-but-identical object
	* would make every untouched commit look like a change — a revision bump and a
	* broadcast on every keystroke's round trip, for nothing.
	*/
	mergeReadState: (winner) => winner,
	sortRows: (_hostRows, _incoming, resolved) => sortItems([...resolved.values()])
};
/** Structural equality of two checklists — the "did anything move" test that
*  keeps a no-op commit from bumping the revision and storming replicas.
*
*  This is the CHECKLIST's own predicate and must never be shared with the
*  board's. One predicate across two documents reads one document's unchanged
*  state as the other document's change, and the replica that believes it loses
*  its queue in silence. It is composed from the kernel's part, which IS shared,
*  plus this document's own state.
*/
function sameItemsDocs(a, b) {
	return sameMergeState({
		rows: a.items,
		tombstones: a.tombstones
	}, {
		rows: b.items,
		tombstones: b.tombstones
	}) && a.nextRef === b.nextRef;
}
/**
* Apply one replica's commit to the authoritative checklist and return the new
* truth (the input is never mutated). The order of the three steps is the
* design: merge, then hand out numbers, then order — so a number is only ever
* minted for a row that survived, and the order is a function of the finished
* document.
*
* The merge itself is the board's, unchanged: an unclaimed row merges by
* `updatedAt` (host wins ties), a claimed row is taken unconditionally, a
* tombstone outranks a stale copy, and a row whose content loses still has its
* read state joined — which for this document means the identity above.
*/
function applyItemsCommit(doc, commit, now) {
	const merged = applyRowCommit({
		rows: doc.items,
		tombstones: doc.tombstones,
		stamps: doc.stamps
	}, commit.items, new Set(commit.changed ?? []), commit.deleted, ITEM_ROW_OPS, now);
	const numbered = assignItemRefs(merged.rows, doc.nextRef);
	const next = {
		revision: doc.revision + 1,
		items: sortItems(numbered.items),
		tombstones: merged.tombstones,
		stamps: merged.stamps,
		nextRef: numbered.nextRef,
		bornAt: doc.bornAt
	};
	return sameItemsDocs(doc, next) ? doc : next;
}
/** Normalize an unknown persisted document: the medium's word is data, not
*  truth. Junk degrades to the empty shape, rows go through the checklist's own
*  grammar, and the short-number law runs here too — a file that was already
*  broken heals on load instead of waiting for the next commit. */
function normalizeItemsDoc(value, now = Date.now()) {
	if (typeof value !== "object" || value === null) return emptyItemsDoc(now);
	const row = value;
	const revision = typeof row.revision === "number" && Number.isFinite(row.revision) && row.revision >= 0 ? Math.floor(row.revision) : 0;
	const bornAt = typeof row.bornAt === "number" && Number.isFinite(row.bornAt) ? row.bornAt : now;
	const items = Array.isArray(row.items) ? parseItems(JSON.stringify(row.items), () => UNSET_REF) : [];
	const numbered = assignItemRefs(items, Math.max(highestRefOf(items) + 1, 1));
	const tombstones = {};
	if (typeof row.tombstones === "object" && row.tombstones !== null) for (const [id, entry] of Object.entries(row.tombstones)) {
		if (typeof entry !== "object" || entry === null) continue;
		const tomb = entry;
		if (typeof tomb.at !== "number" || !Number.isFinite(tomb.at)) continue;
		tombstones[id] = {
			at: tomb.at,
			seenAt: typeof tomb.seenAt === "number" && Number.isFinite(tomb.seenAt) ? tomb.seenAt : bornAt
		};
	}
	const stamps = {};
	if (typeof row.stamps === "object" && row.stamps !== null) {
		for (const [id, at] of Object.entries(row.stamps)) if (typeof at === "number" && Number.isFinite(at) && at >= 0) stamps[id] = at;
	}
	const storedNext = typeof row.nextRef === "number" && Number.isFinite(row.nextRef) ? Math.trunc(row.nextRef) : 0;
	return {
		revision,
		items: sortItems(numbered.items),
		tombstones,
		stamps,
		nextRef: Math.max(storedNext, numbered.nextRef, 1),
		bornAt
	};
}
//#endregion
//#region src/host/data-root.ts
/**
* The one place in this plugin that touches the medium outside the platform
* storage hub.
*
* Everything the board persists goes through `ctx.storage` (see
* board-service.ts): the hub owns the root directory, the unit naming rules,
* the atomic publish and the per-record layout, and this plugin has no business
* choosing any of that. What the hub CANNOT express is retiring the one file it
* no longer owns — the pre-layout whole-unit document, written before the unit
* moved to a per-record tree. That file is only reachable by path, and the hub
* exposes no path-shaped read.
*
* So this module owns exactly one job: move that file aside, once, under three
* guards, and never touch it otherwise. Moving (not deleting) is deliberate: the
* bytes stay on disk as the migration's own backup, and the renamed name no
* longer ends in `.json`, so neither the hub nor a later boot reads it again.
*
* Every path here is DISCOVERED, never hard-coded: the harness home comes from
* `$DSH_HOME` or `os.homedir()` at call time, and the unit name is a parameter.
* A deployment that relocates its home, or another machine entirely, resolves
* the same three lines without an edit.
*/
/**
* The harness home directory, resolved the way the host resolves it: an
* explicit `$DSH_HOME` wins, a blank one counts as unset, and the fallback is
* `.dsh` under the current user's home.
* @returns the absolute harness home path.
*/
function harnessHome() {
	const configured = process.env.DSH_HOME?.trim();
	return configured !== void 0 && configured !== "" ? configured : join(homedir(), ".dsh");
}
/**
* The directory the storage hub roots every unit in.
* @returns the absolute storage root path.
*/
function storagesRoot() {
	return join(harnessHome(), "storages");
}
/**
* The directory a per-record unit occupies under the storage root.
*
* This mirrors the backend's own layout rule; it is spelled out here only so
* the retirement guard can name the exact file a migrated document lands in.
* A unit that is still a single whole-unit FILE has no directory yet.
* @param unitName - the unit whose directory to locate.
* @returns the absolute unit directory path.
*/
function unitDirectoryPath(unitName) {
	return join(storagesRoot(), unitName);
}
/** A local-time `YYYYMMDD-HHmmss` suffix — readable, and unique per run. */
function retireStamp(now) {
	const d = new Date(now);
	const pad = (value) => String(value).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
/** Whether a path exists, without throwing on any of the ways it can fail. */
async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
/**
* Move a pre-layout whole-unit file aside, once.
*
* The three guards exist so this can never destroy data: the data must already
* exist at its new home, the file must really be the unit document we wrote
* (a stray file of the same name is left alone), and the destination must be
* free. Every failure returns a status and changes nothing on disk.
* @param options - which file, which version, where the data landed.
* @returns what happened, with the paths involved.
*/
async function retireLegacyUnitFile(options) {
	const legacyPath = join(storagesRoot(), `${options.unitName}.json`);
	const out = (status, retiredPath) => retiredPath === void 0 ? {
		status,
		legacyPath
	} : {
		status,
		legacyPath,
		retiredPath
	};
	if (!await exists(options.migratedPath)) {
		options.log(`[dsh-task-board] legacy unit file left in place: the migrated document is not at ${options.migratedPath}`);
		return out("target-missing");
	}
	if (!await exists(legacyPath)) return out("absent");
	let header;
	try {
		header = JSON.parse(await readFile(legacyPath, "utf8"));
	} catch (error) {
		options.log(`[dsh-task-board] legacy unit file is unreadable; left in place: ${legacyPath}`, error);
		return out("foreign");
	}
	if (header.unit?.name !== options.unitName || header.unit?.version !== options.legacyVersion) {
		options.log(`[dsh-task-board] legacy unit file is not this unit's document; left in place: ${legacyPath}`);
		return out("foreign");
	}
	const retiredPath = `${legacyPath}.migrated-${retireStamp(options.now)}`;
	if (await exists(retiredPath)) return out("taken");
	try {
		await rename(legacyPath, retiredPath);
	} catch (error) {
		options.log(`[dsh-task-board] legacy unit file could not be moved aside; left in place: ${legacyPath}`, error);
		return out("target-missing");
	}
	return out("retired", retiredPath);
}
//#endregion
//#region src/host/board-service.ts
/**
* Board data service (host half): the authoritative documents every browser
* replica syncs against — today the board and the checklist — plus the two
* arbitrations multi-device correctness needs: the engine lease and the
* launch-command relay.
*
* The documents persist through the platform storage hub's `json` backend.
* The unit is opened in the `per-record` layout, so everything this plugin
* owns lives in ONE directory under the harness home's storage root with one
* human-readable JSON document per data kind — today the board and the
* checklist, and any later data kind beside them without disturbing them. The
* hub owns the root, the naming rules and the atomic publish; this plugin only
* names its unit and its documents.
*
* ONE unit carries both documents and ONE service holds the single live handle
* that name allows — the backend gives a unit exactly one live handle, so
* "a service per document" is not a choice the medium permits. That is also
* what keeps every mutation to every document on one write lane.
*
* The hub is read structurally (`ctx.get('storage')`) exactly like
* every other host route reads its service: when the deployment composes no
* storage hub, or the medium fails to open, the service reports `available:false`
* and the browser half falls back to its localStorage mode — a degraded board,
* never a broken one.
*
* The engine lease: exactly one browser drives time-based automation
* (scheduler ticks, the dispatch pump, reconciliation, external-turn
* recording). Any board API call from the current holder renews the lease
* (background-tab timer throttling cannot starve a live holder), a dropped
* SSE connection shortens it to a grace window, and expiry lets any other
* replica take over within seconds.
*
* The command relay: a non-engine replica's user-initiated run travels to
* the engine (one pump = one concurrency budget = no double launches). With
* no live engine the request parks in a small deduped queue and replays when
* the next lease is granted.
*/
/** The unit identity stamped on the medium (name must be file-safe: the
* platform's UNIT_NAME_RE is `^[a-z][a-z0-9_]*$` — underscores, not hyphens). */
const BOARD_UNIT_NAME = "dsh_task_board";
/** The one declared table; every document this plugin owns is a record in it. */
const BOARD_UNIT_TABLE = "documents";
/** The document name holding the board truth. */
const BOARD_DOCUMENT = "board";
/** The document name holding the checklist truth — the second synced document,
*  a sibling of the board rather than a view over it (its own revision, its own
*  short-number counter). */
const ITEMS_DOCUMENT = "items";
/** The document name holding migration bookkeeping — the marker that lets a
*  boot know it must never go looking for the legacy file again. */
const META_DOCUMENT = "meta";
/** The document tree this build opens. In the `per-record` layout the unit
*  NAME is also its directory name, which is why this plugin's data root reads
*  `dsh_task_board` and can never be a hyphenated directory: UNIT_NAME_RE. */
const BOARD_UNIT_DESCRIPTOR = {
	name: BOARD_UNIT_NAME,
	version: 2,
	tables: [BOARD_UNIT_TABLE],
	hasGlobal: false,
	layout: "per-record"
};
/** The pre-tree whole-unit shape, opened only while migrating. */
const LEGACY_UNIT_DESCRIPTOR = {
	name: BOARD_UNIT_NAME,
	version: 1,
	tables: [],
	hasGlobal: true,
	layout: "single"
};
/** The records of the declared table, or an empty view when it holds none. */
function documentsOf(snapshot) {
	const table = snapshot.tables?.[BOARD_UNIT_TABLE];
	return typeof table === "object" && table !== null ? table : {};
}
/**
* Open the unit, migrating the pre-tree whole-unit file exactly once.
*
* The migration must SEQUENCE two opens of one unit name, because the backend
* gives a name exactly one live handle.
*
* THE QUESTION THIS ASKS IS "HAS THIS TREE EVER BEEN WRITTEN", NOT "IS THE
* MARKER THERE" and never "is THIS document there". Those are three different
* questions, and only the first one is about the unit: a tree holding any
* record at all is already in the per-record layout, so the pre-tree file is
* stale by definition and importing it over that tree would overwrite newer
* data. A question about one document in a table of many is a question the
* next document silently loses — which is exactly how a checklist could vanish
* on a boot whose tree was missing nothing but the marker, while its own
* `items.json` sat right there on disk. So: ANY record ends the probe, and the
* marker is a record like any other.
*
* Deleting the data root is therefore a real reset, and stays one: the tree
* comes back empty, and the probe has nothing to import because the migration
* that once read the old file moved it aside (see data-root.ts).
*
* The board document is written BEFORE the marker, so a crash mid-migration
* repeats a probe that is idempotent rather than skipping one that is not. The
* value handed back is re-read from the medium rather than assembled from what
* this function remembers writing, so a record it has no name for still comes
* back.
* @param openUnit - the hub opener.
* @param now - clock for the migration stamps.
* @param log - diagnostic sink.
* @param retire - the legacy-file retirement step; injected so the migration
*  is testable without a filesystem, and so the production path stays the only
*  caller of the real one.
* @returns the open unit and every document it holds, or undefined when no hub.
*/
async function openBoardUnit(openUnit, now, log, retire = retireLegacyUnitFile) {
	let unit = await openUnit(BOARD_UNIT_DESCRIPTOR);
	if (unit === void 0) return void 0;
	let documents = documentsOf(await unit.loadAll());
	if (Object.keys(documents).length > 0) return {
		unit,
		documents
	};
	await unit.close();
	const legacy = await openUnit(LEGACY_UNIT_DESCRIPTOR);
	let legacyBoard;
	try {
		legacyBoard = legacy === void 0 ? void 0 : (await legacy.loadAll()).global;
	} finally {
		await legacy?.close();
	}
	unit = await openUnit(BOARD_UNIT_DESCRIPTOR);
	if (unit === void 0) return void 0;
	const imported = legacyBoard !== void 0 && legacyBoard !== null;
	if (imported) await unit.putRecord(BOARD_UNIT_TABLE, BOARD_DOCUMENT, legacyBoard);
	await unit.putRecord(BOARD_UNIT_TABLE, META_DOCUMENT, {
		schemaVersion: 2,
		legacyImported: imported,
		legacyProbedAt: now
	});
	documents = documentsOf(await unit.loadAll());
	if (!imported) return {
		unit,
		documents
	};
	const retired = await retire({
		unitName: BOARD_UNIT_NAME,
		legacyVersion: 1,
		migratedPath: join(unitDirectoryPath(BOARD_UNIT_NAME), BOARD_UNIT_TABLE, `${BOARD_DOCUMENT}.json`),
		now,
		log
	});
	if (retired.status === "retired") log(`[dsh-task-board] layout migration: legacy unit document moved to ${retired.retiredPath}`);
	return {
		unit,
		documents,
		retired
	};
}
/** Lease tuning: the client renews well inside the TTL; a dropped stream
*  shortens the holder's lease to the grace window. */
const LEASE_DEFAULT_TTL_MS = 2e4;
const LEASE_MIN_TTL_MS = 1e4;
const LEASE_MAX_TTL_MS = 6e4;
const LEASE_DISCONNECT_GRACE_MS = 5e3;
/**
* The host-side truth: documents + lease + relay. Every mutation to every
* document runs on ONE serialized write lane (the storage domain's
* single-write-chain discipline — the unit serializes nothing and says so),
* so commits from many replicas interleave in arrival order and each
* document's merge grammar resolves them. One lane, not one per document: the
* two disciplines it buys are "the merge runs against the newest in-memory
* document" and "one write in flight at a time", and both are pinned by tests.
*
* THE LEASE AND THE RELAY ARE UNIT-LEVEL ARBITRATIONS, not board facts, and
* they ride in this class because of the one thing they cannot route around:
* the backend gives a unit exactly one live handle, so everything that
* arbitrates or moves data in this unit has to be reachable from the one
* object holding it. Concretely — one engine drives time-based automation over
* BOTH documents, and a command relayed from a non-engine replica is executed
* by whichever replica holds the seat, whoever wrote the row. Reading the
* lease as "the board's lease" is the mistake this paragraph exists to
* prevent: it is the seat for the unit, and its state never mentions a
* document.
*/
var DocumentService = class {
	deps;
	doc = emptyBoardDoc(0);
	items = emptyItemsDoc(0);
	unit;
	lease;
	/** Live SSE connections per clientId. An open stream is the holder's
	*  liveness proof: unlike client timers it survives background-tab timer
	*  throttling, so the engine lease never flaps while its stream is up. */
	streams = /* @__PURE__ */ new Map();
	pendingCommands = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	lane = Promise.resolve();
	started = false;
	initPromise;
	disposed = false;
	/** Whether the board API serves synced documents (false = replica fallback). */
	available = false;
	now;
	log;
	/** When THIS host process started serving the board (carried on every lease
	*  answer). The board's stale-host dialog shows it: "我明明重启了它还这么
	* 显示" has exactly two answers — this process really is the old one, or the
	*  address is talking to a different instance — and a real clock reading
	*  settles it on the spot instead of leaving the user to guess. */
	bootedAt;
	constructor(deps = {}) {
		this.deps = deps;
		this.now = deps.now ?? (() => Date.now());
		this.log = deps.log ?? ((message, error) => error === void 0 ? console.error(message) : console.error(message, error));
		this.bootedAt = this.now();
	}
	/**
	* Open the persistence unit and load every document it holds, running the
	* one-time layout migration when the data root has never been written.
	* Failure to open or read leaves the service unavailable (replicas fall
	* back); a corrupt medium is normalized per document, never fatal.
	*/
	async init() {
		if (this.started) return;
		this.started = true;
		if (this.deps.openUnit === void 0) {
			this.log("[dsh-task-board] board storage unavailable: no persistence opener wired");
			return;
		}
		try {
			const opened = await openBoardUnit(this.deps.openUnit, this.now(), this.log);
			if (opened === void 0) {
				this.log("[dsh-task-board] board storage unavailable: no json backend on the storage hub");
				return;
			}
			this.unit = opened.unit;
			this.doc = normalizeBoardDoc(opened.documents[BOARD_DOCUMENT], this.now());
			this.items = normalizeItemsDoc(opened.documents[ITEMS_DOCUMENT], this.now());
			this.available = true;
		} catch (error) {
			this.unit = void 0;
			this.available = false;
			this.log("[dsh-task-board] board storage open failed; replicas fall back to local mode", error);
		}
	}
	/**
	* The one-started gate every route call passes through: the storage hub is
	* resolved lazily (the opener reads `ctx.get('storage')` at call time), so
	* the first browser request — always after boot settlement — initializes
	* the unit, and every later call rides the settled result.
	*/
	ensureInit() {
		this.initPromise ??= this.init();
		return this.initPromise;
	}
	/** The current authoritative document (detached reads are the caller's job). */
	getDoc() {
		return this.doc;
	}
	/** The current authoritative checklist — the second document, with its own
	*  revision and its own short-number counter (detached reads are the
	*  caller's job). */
	getItemsDoc() {
		return this.items;
	}
	/**
	* Apply one replica commit through the merge grammar. The write lane
	* serializes commits; persistence completes before the response resolves
	* (durability before ack). A no-op commit never persists nor broadcasts.
	* @returns the authoritative document after the commit.
	*/
	commit(commit) {
		return this.enqueue(async () => {
			const next = applyCommit(this.doc, commit, this.now());
			if (next === this.doc) return this.doc;
			this.doc = next;
			if (this.unit !== void 0) try {
				await this.unit.putRecord(BOARD_UNIT_TABLE, BOARD_DOCUMENT, next);
			} catch (error) {
				this.log("[dsh-task-board] board document persist failed (memory keeps serving)", error);
			}
			this.broadcast({
				type: "commit",
				revision: next.revision,
				clientId: commit.clientId
			});
			return next;
		});
	}
	/**
	* Apply one replica commit to the CHECKLIST through its own merge grammar —
	* the same lane, the same durability-before-ack order, the same no-op rule,
	* and its own document file. A checklist change does not touch the board's
	* revision, the board's record, or the board's change frame: two documents,
	* two revisions, and one write lane.
	*
	* It broadcasts nothing, and that is the document's own fact rather than a
	* gap: an SSE frame says WHAT changed, and saying which document changed is
	* part of the frame's own shape (a board frame is about the board). No
	* replica watches the checklist yet, so there is nothing to wake.
	* @returns the authoritative checklist after the commit.
	*/
	commitItems(commit) {
		return this.enqueue(async () => {
			const next = applyItemsCommit(this.items, commit, this.now());
			if (next === this.items) return this.items;
			this.items = next;
			if (this.unit !== void 0) try {
				await this.unit.putRecord(BOARD_UNIT_TABLE, ITEMS_DOCUMENT, next);
			} catch (error) {
				this.log("[dsh-task-board] items document persist failed (memory keeps serving)", error);
			}
			return next;
		});
	}
	/**
	* Acquire or renew the engine lease. Liveness is the leaseState view (an
	* open SSE stream or any board API call keeps the holder alive); a free or
	* expired lease is granted to the caller.
	*
	* VISIBILITY PREEMPTION: every request carries `active` (the tab is
	* visible). A VISIBLE requester takes the seat from an INACTIVE holder —
	* the engine must sit where the user is looking, or native-turn recording
	* and dispatch stall on a frozen background tab (the "手机点开始没反应、
	* 电脑端才动" class). Two visible replicas never flip-flop: first-held
	* keeps the seat while it renews; an all-hidden fleet keeps the last holder
	* (scheduled automation survives nobody-looking).
	*/
	acquireLease(clientId, ttlMs, active = true) {
		const now = this.now();
		const ttl = clampLeaseTtl(ttlMs);
		const current = this.leaseState(now);
		if (current.held && current.holder !== clientId) {
			const holderLease = this.lease;
			const holderActive = holderLease !== void 0 && holderLease.clientId === current.holder ? holderLease.active : true;
			if (!(active && holderActive === false)) return {
				...current,
				held: false
			};
			this.lease = {
				clientId,
				expiresAt: now + ttl,
				ttl,
				active,
				lastTouchAt: now
			};
			this.broadcast({
				type: "lease",
				holder: clientId,
				expiresAt: this.lease.expiresAt
			});
			this.drainPendingCommands();
			return this.leaseState(this.now());
		}
		const renewing = current.held && current.holder === clientId;
		this.lease = {
			clientId,
			expiresAt: now + ttl,
			ttl,
			active,
			lastTouchAt: now
		};
		if (!renewing) this.broadcast({
			type: "lease",
			holder: clientId,
			expiresAt: this.lease.expiresAt
		});
		this.drainPendingCommands();
		return this.leaseState(this.now());
	}
	/** Voluntary release (page teardown): frees the seat immediately. */
	releaseLease(clientId) {
		if (this.lease?.clientId === clientId) {
			this.lease = void 0;
			this.broadcast({
				type: "lease",
				holder: void 0,
				expiresAt: void 0
			});
		}
		return this.leaseState(this.now());
	}
	/** Any API touch from the holder renews the lease for its granted TTL
	*  (throttle-proof: every commit/get/lease call refreshes the seat). */
	noteActivity(clientId) {
		if (clientId === void 0 || this.lease === void 0 || this.lease.clientId !== clientId) return;
		const now = this.now();
		this.lease = {
			...this.lease,
			expiresAt: now + this.lease.ttl,
			lastTouchAt: now
		};
	}
	/** An SSE connection dropped: retire its count; when the holder's last
	*  stream goes, shorten its lease to the grace window (a reload reopens the
	*  stream and keeps the seat; a closed tab yields it fast). */
	noteDisconnect(clientId) {
		if (clientId === void 0 || clientId === "") return;
		const live = (this.streams.get(clientId) ?? 0) - 1;
		if (live > 0) this.streams.set(clientId, live);
		else this.streams.delete(clientId);
		if (this.lease === void 0 || this.lease.clientId !== clientId) return;
		const graceUntil = this.now() + LEASE_DISCONNECT_GRACE_MS;
		if (this.lease.expiresAt > graceUntil) this.lease = {
			...this.lease,
			expiresAt: graceUntil
		};
	}
	/** The current lease state. A holder with a live SSE stream never expires
	*  (the stream is refreshed by the keep-alive writes; a dead one surfaces
	*  through noteDisconnect); an expired lease reads as free, holderless.
	*
	*  THE one construction site of a LeaseState: every lease answer the route
	*  can ever send (granted / renewing / rejected / released) is derived from
	*  this object, so no branch can ship a seat view that forgets `proto` or
	*  `bootedAt`. A missing `proto` read as "old host", which made the
	*  "服务端未重启" banner stand forever on every non-engine device — the
	*  rejected branch used to hand-build `{ held, holder, expiresAt }` and
	*  nothing else. */
	leaseState(now = this.now()) {
		if (this.lease === void 0) return {
			held: false,
			holder: void 0,
			expiresAt: void 0,
			proto: 2,
			bootedAt: this.bootedAt
		};
		if ((this.streams.get(this.lease.clientId) ?? 0) > 0 && this.lease.lastTouchAt + 8e4 > now) {
			if (this.lease.expiresAt < now + this.lease.ttl) this.lease = {
				...this.lease,
				expiresAt: now + this.lease.ttl
			};
			return {
				held: true,
				holder: this.lease.clientId,
				expiresAt: this.lease.expiresAt,
				proto: 2,
				bootedAt: this.bootedAt
			};
		}
		if (this.lease.expiresAt <= now) return {
			held: false,
			holder: void 0,
			expiresAt: void 0,
			proto: 2,
			bootedAt: this.bootedAt
		};
		return {
			held: true,
			holder: this.lease.clientId,
			expiresAt: this.lease.expiresAt,
			proto: 2,
			bootedAt: this.bootedAt
		};
	}
	/** An SSE connection for `clientId` opened (route layer, stream accepted). */
	noteStreamOpen(clientId) {
		if (clientId === void 0 || clientId === "") return;
		this.streams.set(clientId, (this.streams.get(clientId) ?? 0) + 1);
	}
	/**
	* Relay one user-initiated launch to the engine. With a live engine the
	* command broadcasts immediately; otherwise it parks (newest per task) and
	* replays when the next lease is granted.
	*/
	submitCommand(command) {
		const now = this.now();
		if (!this.leaseState(now).held) {
			this.parkCommand(command);
			return { queued: true };
		}
		this.broadcast({
			type: "command",
			command
		});
		return { queued: false };
	}
	/** Subscribe to board events (the SSE layer). @returns the disposer. */
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Drain the unit and stop serving. */
	async dispose() {
		this.disposed = true;
		this.listeners.clear();
		const unit = this.unit;
		this.unit = void 0;
		this.available = false;
		if (unit !== void 0) try {
			await unit.close();
		} catch (error) {
			this.log("[dsh-task-board] board storage close failed", error);
		}
	}
	parkCommand(command) {
		if (this.pendingCommands.size >= 20) {
			const oldest = this.pendingCommands.keys().next();
			if (!oldest.done) this.pendingCommands.delete(oldest.value);
		}
		this.pendingCommands.set(`${command.type}:${command.taskId}`, command);
	}
	drainPendingCommands() {
		if (this.pendingCommands.size === 0) return;
		const commands = [...this.pendingCommands.values()];
		this.pendingCommands.clear();
		for (const command of commands) this.broadcast({
			type: "command",
			command
		});
	}
	broadcast(event) {
		if (this.disposed) return;
		for (const listener of [...this.listeners]) try {
			listener(event);
		} catch (error) {
			this.log("[dsh-task-board] board event listener failed", error);
		}
	}
	enqueue(task) {
		const run = this.lane.then(task);
		this.lane = run.then(() => void 0, () => void 0);
		return run;
	}
};
/** Clamp the requested TTL into the safe band. */
function clampLeaseTtl(ttlMs) {
	if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) return LEASE_DEFAULT_TTL_MS;
	return Math.min(LEASE_MAX_TTL_MS, Math.max(LEASE_MIN_TTL_MS, Math.floor(ttlMs)));
}
/**
* Wire the service onto the platform storage hub: resolve `ctx.storage` at
* open time (boot settlement has passed by the first browser request), take
* the `json` backend's KV facet, and open the unit the descriptor names. A
* missing hub or backend yields undefined (the service then reports
* unavailable — fallback mode, never a throw).
*/
function storageHubOpener(storage) {
	return async (descriptor) => {
		const kv = (storage()?.backend?.get?.("json"))?.kv;
		if (kv?.open === void 0) return void 0;
		return kv.open(descriptor);
	};
}
//#endregion
//#region src/host/board-route.ts
/** The commit body size cap: the whole ledger travels per commit. */
const BOARD_BODY_LIMIT_BYTES = 8 << 20;
/** The SSE keep-alive cadence (below common proxy idle timeouts). */
const BOARD_SSE_KEEPALIVE_MS = 25e3;
/** The shared malformed-request failure (same shape as the settings route). */
const MALFORMED = {
	ok: false,
	error: {
		code: "internal",
		message: "malformed request"
	}
};
/** Write one JSON envelope response, for either document (same discipline as
*  the settings route): ONE writer, generic over the value it carries, so a
*  second document cannot grow a second response dialect. */
function json$2(res, envelope, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(envelope));
}
/** The caller id every commit body must carry. One rule, both documents. */
function clientIdOf(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const id = body.clientId;
	return typeof id === "string" && id !== "" && id.length <= 64 ? id : void 0;
}
/** The deletions a replica observed, with the stamp each was computed against.
*  Shared by both documents' parsers: a delete means the same thing to a task
*  ledger and to a checklist, and one rule cannot be right in one place and
*  wrong in the other. */
function parseDeletes(raw) {
	if (!Array.isArray(raw)) return [];
	return raw.map((entry) => {
		if (typeof entry !== "object" || entry === null) return void 0;
		const del = entry;
		if (typeof del.id !== "string" || del.id === "") return void 0;
		const baseUpdatedAt = typeof del.baseUpdatedAt === "number" && Number.isFinite(del.baseUpdatedAt) ? del.baseUpdatedAt : 0;
		return {
			id: del.id,
			baseUpdatedAt
		};
	}).filter((entry) => entry !== void 0);
}
/** Authorship claims: a plain id list (the grammar itself re-checks every
*  row; a claim can only vouch for content this replica carries anyway).
*  Shared by both documents' parsers, like {@link parseDeletes}. */
function parseChangedIds(raw) {
	return Array.isArray(raw) ? raw.filter((id) => typeof id === "string" && id !== "") : [];
}
/** Extract a commit from an untrusted body; undefined when unusable. The
*  merge grammar normalizes every row/section, so this only checks the
*  envelope shape (arrays/strings), never the data. */
function parseBoardCommit(body) {
	const clientId = clientIdOf(body);
	if (clientId === void 0) return void 0;
	const row = body;
	const section = (value) => {
		if (typeof value !== "object" || value === null) return {
			value: void 0,
			at: 0
		};
		const entry = value;
		const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0;
		return {
			value: entry.value,
			at
		};
	};
	const sectionClaims = Array.isArray(row.sectionClaims) ? row.sectionClaims.filter((key) => key === "cruise" || key === "schedulePresets" || key === "runPresets") : void 0;
	return {
		clientId,
		tasks: Array.isArray(row.tasks) ? row.tasks : [],
		changed: parseChangedIds(row.changed),
		sectionClaims,
		deleted: parseDeletes(row.deleted),
		cruise: section(row.cruise),
		schedulePresets: section(row.schedulePresets),
		runPresets: section(row.runPresets)
	};
}
/** Extract a checklist commit from an untrusted body; undefined when unusable.
*
*  This document has NO sections — the checklist carries none — so its commit
*  is rows + claims + deletions and nothing else. Lifting the board's three
*  section fields onto it would be inventing state the document does not have,
*  and the same envelope rule (clientId, claims, deletes) is what both parsers
*  share above. */
function parseItemsCommit(body) {
	const clientId = clientIdOf(body);
	if (clientId === void 0) return void 0;
	const row = body;
	return {
		clientId,
		items: Array.isArray(row.items) ? row.items : [],
		changed: parseChangedIds(row.changed),
		deleted: parseDeletes(row.deleted)
	};
}
/** Parse the POST body of the lease endpoint. `active` (the tab is visible)
*  drives the host's visibility preemption; absent = visible (a client that
*  predates the flag never loses ground it would have kept). */
function parseLeaseBody(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const row = body;
	if (typeof row.clientId !== "string" || row.clientId === "" || row.clientId.length > 64) return void 0;
	return {
		clientId: row.clientId,
		...typeof row.ttlMs === "number" && Number.isFinite(row.ttlMs) ? { ttlMs: row.ttlMs } : {},
		release: row.release === true,
		active: row.active !== false
	};
}
/** Parse the POST body of the command relay. */
function parseCommandBody(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const row = body;
	if (typeof row.clientId !== "string" || row.clientId === "") return void 0;
	const command = row.command;
	if (typeof command !== "object" || command === null) return { clientId: row.clientId };
	if (command.type !== "run" || typeof command.taskId !== "string" || command.taskId === "") return { clientId: row.clientId };
	const trigger = command.trigger === "schedule" || command.trigger === "chain" ? command.trigger : "manual";
	return {
		clientId: row.clientId,
		command: {
			type: "run",
			taskId: command.taskId,
			trigger,
			clientId: row.clientId
		}
	};
}
/** The revision a `?since=` probe claims to already hold, or NaN when the
*  param is absent.
*
*  `since` absent (Number(null) === 0 — the initial-fetch trap) vs a real
*  revision: only an explicit param may short-circuit a body. BOTH documents
*  read it through here, because "unchanged means unchanged" is one rule — a
*  replica that learned it twice would learn one of them wrong. */
function sinceOf(url) {
	const raw = url.searchParams.get("since");
	return raw === null ? NaN : Number(raw);
}
/** The view one document GET answers with: availability, that document's OWN
*  revision, the document itself, or the unchanged short-circuit.
*
*  ONE builder, both documents. A second copy of "is this probe already
*  covered?" would be a second answer to the same question, and the copy that
*  drifts is the one a replica trusts — so the probe that must not short-
*  circuit is the one that has to be right. */
function documentGetView(deps, url, doc) {
	const available = deps.available();
	const since = sinceOf(url);
	if (Number.isFinite(since) && since >= doc.revision) return {
		available,
		revision: doc.revision,
		unchanged: true
	};
	return {
		available,
		revision: doc.revision,
		doc
	};
}
/** The pure request processor (one prefix route, dispatched by path tail). */
function createBoardHandler(deps, base) {
	return async (req, res) => {
		let url;
		try {
			url = new URL(req.url ?? "/", "http://dsh.local");
		} catch {
			json$2(res, MALFORMED, 400);
			return;
		}
		const tail = url.pathname.slice(base.length);
		await deps.ready();
		if (req.method === "GET" && tail === "/events") {
			serveEvents(deps, url, res);
			return;
		}
		if (req.method === "GET" && (tail === "" || tail === "/items")) {
			deps.noteActivity(url.searchParams.get("clientId") ?? void 0);
			json$2(res, {
				ok: true,
				value: tail === "" ? documentGetView(deps, url, deps.doc()) : documentGetView(deps, url, deps.itemsDoc())
			});
			return;
		}
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
			json$2(res, MALFORMED, 415);
			return;
		}
		const payload = await readJsonBody(req, BOARD_BODY_LIMIT_BYTES);
		if (tail === "") {
			const commit = parseBoardCommit(payload);
			if (commit === void 0) {
				json$2(res, MALFORMED);
				return;
			}
			if (!deps.available()) {
				json$2(res, {
					ok: true,
					value: {
						available: false,
						revision: 0
					}
				});
				return;
			}
			deps.noteActivity(commit.clientId);
			const doc = await deps.commit(commit);
			json$2(res, {
				ok: true,
				value: {
					available: true,
					revision: doc.revision,
					doc
				}
			});
			return;
		}
		if (tail === "/items") {
			const commit = parseItemsCommit(payload);
			if (commit === void 0) {
				json$2(res, MALFORMED);
				return;
			}
			if (!deps.available()) {
				json$2(res, {
					ok: true,
					value: {
						available: false,
						revision: 0
					}
				});
				return;
			}
			deps.noteActivity(commit.clientId);
			const doc = await deps.commitItems(commit);
			json$2(res, {
				ok: true,
				value: {
					available: true,
					revision: doc.revision,
					doc
				}
			});
			return;
		}
		if (tail === "/lease") {
			const parsed = parseLeaseBody(payload);
			if (parsed === void 0) {
				json$2(res, MALFORMED);
				return;
			}
			const lease = parsed.release ? deps.releaseLease(parsed.clientId) : deps.acquireLease(parsed.clientId, parsed.ttlMs, parsed.active);
			json$2(res, {
				ok: true,
				value: {
					available: deps.available(),
					revision: deps.doc().revision,
					lease
				}
			});
			return;
		}
		if (tail === "/command") {
			const parsed = parseCommandBody(payload);
			if (parsed === void 0 || parsed.command === void 0) {
				json$2(res, MALFORMED);
				return;
			}
			const { queued } = deps.submitCommand(parsed.command);
			json$2(res, {
				ok: true,
				value: {
					available: deps.available(),
					revision: deps.doc().revision,
					command: { queued }
				}
			});
			return;
		}
		json$2(res, MALFORMED, 404);
	};
}
/** Serve one SSE connection: frames as `data: <json>`, keep-alive comments,
*  and a clean unsubscribe (plus the disconnect note) on close. */
function serveEvents(deps, url, res) {
	const clientId = url.searchParams.get("clientId") ?? void 0;
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"x-accel-buffering": "no"
	});
	res.write("retry: 3000\n\n");
	deps.noteStreamOpen(clientId);
	let open = true;
	const unsubscribe = deps.subscribe((event) => {
		if (!open) return;
		try {
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		} catch {
			open = false;
		}
	});
	const keepAlive = setInterval(() => {
		if (!open) return;
		try {
			res.write(":ka\n\n");
		} catch {
			open = false;
		}
	}, BOARD_SSE_KEEPALIVE_MS);
	deps.noteActivity(clientId);
	res.on("close", () => {
		open = false;
		clearInterval(keepAlive);
		unsubscribe();
		deps.noteDisconnect(clientId);
	});
}
/**
* Register the board route (prefix) and own the service lifecycle: open the
* persistence unit through the platform storage hub, serve once initialized,
* dispose the unit on unload.
*
* ONE service serves the prefix, and it holds BOTH documents — the board at
* the root tail, the checklist at `/items`. The lease and the command relay
* ride along because they arbitrate the unit (one engine drives every
* document), not the board: their answers are carried on the board's view
* because that is the tail every replica bootstraps from, not because they
* belong to the board's document.
* @param ctx - context carrying the webServer and storage services.
* @param ns - the plugin namespace this route serves.
* @returns the disposer removing the route and closing the service.
*/
function registerBoardRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	const service = new DocumentService({ openUnit: storageHubOpener(() => ctx.get("storage")) });
	service.ensureInit();
	const deps = {
		ready: () => service.ensureInit(),
		available: () => service.available,
		doc: () => service.getDoc(),
		commit: (commit) => service.commit(commit),
		itemsDoc: () => service.getItemsDoc(),
		commitItems: (commit) => service.commitItems(commit),
		acquireLease: (clientId, ttlMs, active) => service.acquireLease(clientId, ttlMs, active),
		releaseLease: (clientId) => service.releaseLease(clientId),
		noteActivity: (clientId) => service.noteActivity(clientId),
		noteStreamOpen: (clientId) => service.noteStreamOpen(clientId),
		noteDisconnect: (clientId) => service.noteDisconnect(clientId),
		submitCommand: (command) => service.submitCommand(command),
		subscribe: (listener) => service.subscribe(listener)
	};
	const path = `/api/${ns}/board`;
	const handler = createBoardHandler(deps, path);
	const disposeRoute = webServer.register({
		kind: "prefix",
		path,
		handler
	});
	return () => {
		disposeRoute();
		service.dispose();
	};
}
//#endregion
//#region src/core/update-check.ts
/**
* Classify one profile-manifest dependency spec. `link:` is local development;
* `github:` and tarball URLs are source installs (their update path is the
* GitHub re-add); anything else version-shaped is an npm install.
* @param spec - the raw `dependencies[name]` string, or undefined when unread.
* @returns the install mode (`unknown` when the spec is missing).
*/
function classifyInstallSpec(spec) {
	if (spec === void 0 || spec === "") return "unknown";
	if (spec.startsWith("link:")) return "local";
	if (spec.startsWith("github:")) return "github";
	if (spec.startsWith("https:") || spec.startsWith("http:")) return "github";
	return "npm";
}
/**
* Derive the `github:Owner/Repo` install spec from the package repository
* URL. The account is never repeated in code — it is read live from the
* manifest, so a fork or rename keeps working.
* @param url - the package.json `repository.url` value.
* @returns the `github:` spec, or undefined when the URL is not a GitHub one.
*/
function githubSpecOfRepositoryUrl(url) {
	const match = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
	if (match === null || match[1] === void 0) return void 0;
	return `github:${match[1]}`;
}
//#endregion
//#region src/host/client-report-route.ts
/** Keep the last N reports: enough for phone + desktop, bounded forever. */
const MAX_REPORTS = 8;
/** The in-memory ring (process-local, diagnostic only — never persisted). */
const reports = [];
/** Read the retained reports, newest first (a copy — callers never mutate). */
function readClientReports() {
	return reports.map((report) => ({ ...report }));
}
/** Shape-guard one box: finite, ordered numbers only. */
function boxOf(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const { top, bottom, height } = value;
	if (typeof top !== "number" || typeof bottom !== "number" || typeof height !== "number") return void 0;
	if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(height)) return void 0;
	return {
		top: Math.round(top * 10) / 10,
		bottom: Math.round(bottom * 10) / 10,
		height: Math.round(height * 10) / 10
	};
}
/**
* Normalize one posted body into a report. Anything unreadable is dropped
* (the route answers 200 with `stored:false` rather than erroring — a
* diagnostic must never become a failure surface).
* @param body - the parsed JSON body.
* @param now - the receipt instant.
* @returns the report, or undefined when the body carries no usable version.
*/
function normalizeClientReport(body, now) {
	if (typeof body !== "object" || body === null) return void 0;
	const raw = body;
	if (typeof raw.version !== "string" || raw.version === "") return void 0;
	const boxes = {};
	if (typeof raw.boxes === "object" && raw.boxes !== null) for (const [key, value] of Object.entries(raw.boxes)) {
		const box = boxOf(value);
		if (box !== void 0) boxes[key] = box;
	}
	const viewport = (() => {
		const v = raw.viewport;
		if (v === void 0 || typeof v.width !== "number" || typeof v.height !== "number") return void 0;
		if (!Number.isFinite(v.width) || !Number.isFinite(v.height)) return void 0;
		return {
			width: Math.round(v.width),
			height: Math.round(v.height)
		};
	})();
	return {
		version: raw.version,
		href: typeof raw.href === "string" ? raw.href.slice(0, 300) : "",
		...typeof raw.ua === "string" ? { ua: raw.ua.slice(0, 300) } : {},
		...viewport !== void 0 ? { viewport } : {},
		...typeof raw.dpr === "number" && Number.isFinite(raw.dpr) ? { dpr: Math.round(raw.dpr * 100) / 100 } : {},
		...Object.keys(boxes).length > 0 ? { boxes } : {},
		receivedAt: now
	};
}
/** Remember one report, newest first, bounded. */
function recordClientReport(report) {
	reports.unshift(report);
	if (reports.length > MAX_REPORTS) reports.length = MAX_REPORTS;
}
/** Write one JSON envelope (same discipline as every other host route). */
function json$1(res, payload, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
}
/** Read a bounded request body as text (a diagnostic never eats the socket). */
function readBody(req, limitBytes = 32 * 1024) {
	return new Promise((resolve) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limitBytes) {
				resolve("");
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", () => {
			resolve("");
		});
	});
}
/**
* Build the pure report-route processor (unit-testable without a server).
* @param now - clock seam.
* @returns the HTTP handler for POST on the client-report route.
*/
function createClientReportHandler(now = Date.now) {
	return async (req, res) => {
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		const text = await readBody(req);
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			json$1(res, {
				ok: true,
				value: { stored: false }
			});
			return;
		}
		const report = normalizeClientReport(body, now());
		if (report === void 0) {
			json$1(res, {
				ok: true,
				value: { stored: false }
			});
			return;
		}
		recordClientReport(report);
		json$1(res, {
			ok: true,
			value: { stored: true }
		});
	};
}
/**
* Register the client-report route on the host web server.
* @param ctx - context carrying the webServer service.
* @param ns - the plugin namespace (route path prefix).
* @returns the route disposer, or a no-op when the web server is absent.
*/
function registerClientReportRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	return webServer.register({
		kind: "exact",
		path: `/api/${ns}/client-report`,
		handler: createClientReportHandler()
	});
}
//#endregion
//#region package.json
var name = "@firetruck666/dsh-task-board";
var version = "0.2.155";
var repository = {
	"type": "git",
	"url": "git+https://github.com/FiretrUCK666/dsh-task-board.git"
};
//#endregion
//#region src/host/update-route.ts
/** Package identity, read live from the manifest (never repeated in code). */
const PACKAGE_NAME = name ?? "";
const PACKAGE_VERSION = version ?? "unknown";
const GITHUB_SPEC = githubSpecOfRepositoryUrl(repository?.url ?? "");
/** Write one JSON envelope response (same discipline as the settings route). */
function json(res, envelope, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(envelope));
}
/**
* Build the pure update-source route processor.
* @param deps - the view face (real or fake).
* @returns an HTTP handler for GET on the update route.
*/
function createUpdateHandler(deps) {
	return async (req, res) => {
		if (req.method !== "GET") {
			res.writeHead(405);
			res.end();
			return;
		}
		let view;
		try {
			view = deps.read();
		} catch (error) {
			json(res, {
				ok: false,
				error: {
					code: "update",
					message: error instanceof Error ? error.message : String(error)
				}
			});
			return;
		}
		json(res, {
			ok: true,
			value: view
		});
	};
}
/**
* Read this plugin's raw dependency spec from the web profile manifest.
* @returns the spec string, or undefined when the manifest is unreadable.
*/
function readProfileSpec() {
	try {
		const home = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
		const spec = JSON.parse(fs.readFileSync(path.join(home, "profiles", "web", "package.json"), "utf8")).dependencies?.[PACKAGE_NAME];
		return typeof spec === "string" ? spec : void 0;
	} catch {
		return;
	}
}
/** Run one read-only git command; undefined on any failure (git may be absent). */
function gitOut(repoDir, args, timeoutMs) {
	try {
		return execFileSync("git", args, {
			cwd: repoDir,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			],
			timeout: timeoutMs
		}).toString().trim();
	} catch {
		return;
	}
}
/**
* Read the local checkout state without mutating it: HEAD plus worktree
* dirtiness locally, the remote tip through `ls-remote` (no fetch, no local
* ref moves). Any failure degrades to undefined — an unreadable checkout is
* not an error, it just hides the git section.
* @param repoDir - the `link:` target directory.
* @returns the git status, or undefined when unreadable.
*/
function readGitStatus(repoDir) {
	const head = gitOut(repoDir, ["rev-parse", "HEAD"], 1e4);
	if (head === void 0 || head === "") return void 0;
	const porcelain = gitOut(repoDir, ["status", "--porcelain"], 1e4) ?? "";
	const remoteLine = gitOut(repoDir, [
		"ls-remote",
		"origin",
		"refs/heads/main"
	], 15e3);
	const remoteHead = remoteLine !== void 0 && remoteLine !== "" ? remoteLine.split(/\s/)[0] : void 0;
	return {
		head,
		...remoteHead !== void 0 && remoteHead !== "" ? { remoteHead } : {},
		dirty: porcelain !== ""
	};
}
/**
* Build the live view: manifest spec classified through the shared grammar,
* plus the checkout state for `link:` installs.
* @returns the update-source view.
*/
function readLiveView() {
	const spec = readProfileSpec();
	const mode = classifyInstallSpec(spec);
	let git;
	if (mode === "local" && spec !== void 0) git = readGitStatus(spec.slice(5));
	return {
		packageName: PACKAGE_NAME,
		version: PACKAGE_VERSION,
		...spec !== void 0 ? { spec } : {},
		mode,
		...GITHUB_SPEC !== void 0 ? { githubSpec: GITHUB_SPEC } : {},
		...git !== void 0 ? { git } : {},
		...(() => {
			const clients = readClientReports();
			return clients.length > 0 ? { clients } : {};
		})()
	};
}
/**
* Register the update-source route on the host web server.
* @param ctx - context carrying the webServer service.
* @param ns - the plugin namespace (route path prefix).
* @returns the route disposer, or a no-op when the web server is absent.
*/
function registerUpdateRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	const handler = createUpdateHandler({ read: readLiveView });
	return webServer.register({
		kind: "exact",
		path: `/api/${ns}/update`,
		handler
	});
}
//#endregion
//#region src/index.ts
const inject = ["webServer"];
/** Declared entry point: the board's host routes, one effect per route. */
function apply(ctx) {
	ctx.effect(() => registerPermissionRoute(ctx, "dsh-task-board"), "dsh-task-board: permissions route");
	ctx.effect(() => registerSessionStateRoute(ctx), "dsh-task-board: session-state route");
	ctx.effect(() => registerBoardRoute(ctx, "dsh-task-board"), "dsh-task-board: board route");
	ctx.effect(() => registerUpdateRoute(ctx, "dsh-task-board"), "dsh-task-board: update route");
	ctx.effect(() => registerClientReportRoute(ctx, "dsh-task-board"), "dsh-task-board: client report route");
}
//#endregion
export { apply, inject };
