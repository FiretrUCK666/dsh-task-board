import z from "schemastery";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
//#region src/host/settings-route.ts
/** Structural request failure (never a settings fault). */
const BAD_REQUEST = {
	ok: false,
	error: {
		code: "internal",
		message: "malformed request"
	}
};
/**
* Read a JSON request body into an unknown value; null when unparseable.
* @param req - the incoming request stream.
* @param maxBytes - size cap (beyond it the body is rejected as null). The
*   board routes raise it for whole-document commits; settings patches keep
*   the default.
* @returns the parsed body, or null.
*/
async function readJsonBody(req, maxBytes = 1 << 20) {
	const outcome = await readJsonBodyDetailed(req, maxBytes);
	return outcome.ok ? outcome.value : null;
}
/** A JSON body read that DISTINGUISHES why it failed — oversized (the caller
*  should answer 413) vs malformed/empty (400). The board's attachment bridge
*  needs the difference so a too-large picture is never reported as a broken
*  request. */
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
/** Extract the namespace view from a registered descriptor. */
function viewFromDescriptor(descriptor, writable) {
	return {
		available: true,
		value: descriptor.value,
		base: descriptor.base,
		user: descriptor.user,
		writable,
		revision: descriptor.revision
	};
}
/**
* Build the pure settings-route processor. The returned handler translates an
* HTTP request into a settings envelope without touching the server.
* @param deps - the describe/mutate service face.
* @param ns - the settings namespace this route serves.
* @returns an HTTP handler for GET and POST on the namespace route.
*/
function createSettingsHandler(deps, ns) {
	const describeNs = () => deps.describe().find((descriptor) => descriptor.ns === ns);
	return async (req, res) => {
		if (req.method === "GET") {
			const descriptor = describeNs();
			json$3(res, {
				ok: true,
				value: descriptor === void 0 ? { available: false } : viewFromDescriptor(descriptor, deps.writable)
			});
			return;
		}
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
			json$3(res, BAD_REQUEST, 415);
			return;
		}
		const payload = await readJsonBody(req);
		if (payload === null || typeof payload !== "object") {
			json$3(res, BAD_REQUEST);
			return;
		}
		const body = payload;
		if (!Array.isArray(body.ops)) {
			json$3(res, BAD_REQUEST);
			return;
		}
		const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : void 0;
		try {
			await deps.mutate(ns, body.ops, expectedRevision);
		} catch (error) {
			json$3(res, {
				ok: false,
				error: {
					code: "settings",
					message: error instanceof Error ? error.message : String(error)
				}
			});
			return;
		}
		const descriptor = describeNs();
		json$3(res, {
			ok: true,
			value: descriptor === void 0 ? { available: false } : viewFromDescriptor(descriptor, deps.writable)
		});
	};
}
/**
* Register the settings route for one namespace on the host web server, wiring
* the real host settings service into the pure handler.
* @param ctx - context carrying the webServer and settings services.
* @param ns - the settings namespace this route serves.
* @returns the route disposer, or a no-op when either service is absent.
*/
function registerSettingsRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	const settings = ctx.get("settings");
	if (webServer === void 0 || settings === void 0) return () => void 0;
	const handler = createSettingsHandler({
		describe: () => settings.describe({ redactSecrets: true }),
		mutate: (target, ops, expectedRevision) => settings.mutate(target, ops, expectedRevision),
		writable: settings.writable
	}, ns);
	return webServer.register({
		kind: "exact",
		path: `/api/${ns}/settings`,
		handler
	});
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
/** Mount the bridge on the host web surface (mirrors registerSettingsRoute). */
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
/** The larger of two optional read stamps (undefined = never seen). */
function maxSeen(a, b) {
	if (a === void 0) return b;
	if (b === void 0) return a;
	return a >= b ? a : b;
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
/** Structural equality of two documents (the "did anything move" test that
*  keeps a no-op commit from bumping the revision and storming replicas). */
function sameBoardDocs(a, b) {
	return JSON.stringify({
		t: a.tasks,
		c: a.cruise,
		p: a.schedulePresets,
		r: a.runPresets,
		x: a.tombstones
	}) === JSON.stringify({
		t: b.tasks,
		c: b.cruise,
		p: b.schedulePresets,
		r: b.runPresets,
		x: b.tombstones
	});
}
/**
* Apply one client commit to the authoritative document and return the new
* truth (the input is never mutated). The merge is the whole sync contract:
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
* - sections: replaced when the incoming write stamp is >= the stored one
*   (host order decides ties — the later commit wins, deterministically).
* - unchanged result → the same document object (no revision bump, no
*   persist, no broadcast).
*/
function applyCommit(doc, commit, now) {
	const byId = new Map(doc.tasks.map((task) => [task.id, task]));
	const tombstones = { ...doc.tombstones };
	const stamps = { ...doc.stamps };
	const result = new Map(byId);
	const claimed = new Set(commit.changed ?? []);
	for (const task of commit.tasks) {
		const incoming = normalizeIncomingTask(task);
		if (incoming === void 0) continue;
		const host = result.get(incoming.id);
		if (host === void 0) {
			const tomb = tombstones[incoming.id];
			if (tomb !== void 0 && incoming.updatedAt <= tomb.at) continue;
			delete tombstones[incoming.id];
			result.set(incoming.id, incoming);
			stamps[incoming.id] = now;
			continue;
		}
		let winner;
		if (claimed.has(incoming.id)) {
			if (authorshipKey(host) !== authorshipKey(incoming)) winner = incoming;
		} else if (incoming.updatedAt > host.updatedAt) winner = incoming;
		const merged = mergeReadState(winner ?? host, incoming);
		if (winner !== void 0) {
			result.set(incoming.id, merged);
			stamps[incoming.id] = now;
		} else if (merged !== host) result.set(incoming.id, merged);
	}
	for (const del of commit.deleted) {
		const host = result.get(del.id);
		if (host === void 0) continue;
		if (host.updatedAt > del.baseUpdatedAt) continue;
		const newest = Math.max(host.updatedAt, ...commit.tasks.filter((task) => task.id === del.id).map((task) => task.updatedAt), 0);
		result.delete(del.id);
		delete stamps[del.id];
		tombstones[del.id] = {
			at: newest + 1,
			seenAt: now
		};
	}
	for (const [id, tomb] of Object.entries(tombstones)) if (now - tomb.seenAt > 2592e6 && !result.has(id)) delete tombstones[id];
	for (const id of Object.keys(stamps)) if (!result.has(id)) delete stamps[id];
	const tasks = doc.tasks.filter((task) => result.has(task.id)).map((task) => result.get(task.id));
	const seen = new Set(doc.tasks.map((task) => task.id));
	for (const task of commit.tasks) {
		const merged = result.get(task.id);
		if (merged !== void 0 && !seen.has(task.id)) {
			tasks.push(merged);
			seen.add(task.id);
		}
	}
	const next = {
		revision: doc.revision + 1,
		tasks,
		cruise: mergeSection(doc.cruise, commit.cruise, normalizeCruiseValue, "cruise", now, commit.sectionClaims),
		schedulePresets: mergeSection(doc.schedulePresets, commit.schedulePresets, parsePresetsRaw, "schedulePresets", now, commit.sectionClaims),
		runPresets: mergeSection(doc.runPresets, commit.runPresets, normalizeRunPresetDocument, "runPresets", now, commit.sectionClaims),
		tombstones,
		stamps,
		bornAt: doc.bornAt
	};
	return sameBoardDocs(doc, next) ? doc : {
		...next,
		revision: doc.revision + 1
	};
}
/**
* Section merge. CLAIM protocol (a commit carrying `sectionClaims`): only a
* claimed section is taken — unconditionally, re-stamped with the host clock
* (client clocks never decide a section) — and an unclaimed section is
* SKIPPED, so the baseline copy every commit rides can never clobber a newer
* write. LEGACY (no `sectionClaims` field at all — a pre-claim client):
* plain LWW on the client stamp, exactly as before.
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
/** One incoming task row, normalized through the persisted-ledger grammar
*  (the host never trusts a replica's shape); undefined when unusable. */
function normalizeIncomingTask(task) {
	const [row] = parseLedger(JSON.stringify([task]));
	return row;
}
//#endregion
//#region src/host/board-service.ts
/**
* Board data service (host half): the ONE authoritative board document every
* browser replica syncs against, plus the two arbitrations multi-device
* correctness needs — the engine lease and the launch-command relay.
*
* The document persists through the platform storage hub's `json` backend
* (one human-readable file under the harness home's storage root, atomic
* whole-file rewrites, durable before ack). The hub is read structurally
* (`ctx.get('storage')`) exactly like every other host route reads its
* service: when the deployment composes no storage hub, or the medium fails
* to open, the service reports `available:false` and the browser half falls
* back to its localStorage mode — a degraded board, never a broken one.
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
/** Lease tuning: the client renews well inside the TTL; a dropped stream
*  shortens the holder's lease to the grace window. */
const LEASE_DEFAULT_TTL_MS = 2e4;
const LEASE_MIN_TTL_MS = 1e4;
const LEASE_MAX_TTL_MS = 6e4;
const LEASE_DISCONNECT_GRACE_MS = 5e3;
/**
* The host-side board truth: document + lease + relay. Every mutation runs
* on one serialized write lane (the storage domain's single-write-chain
* discipline), so commits from many replicas interleave in arrival order and
* the merge grammar resolves them.
*/
var BoardDataService = class {
	deps;
	doc = emptyBoardDoc(0);
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
	* Open the persistence unit and load the document. Failure to open or read
	* leaves the service unavailable (replicas fall back); a corrupt medium is
	* normalized, never fatal.
	*/
	async init() {
		if (this.started) return;
		this.started = true;
		if (this.deps.openUnit === void 0) {
			this.log("[dsh-task-board] board storage unavailable: no persistence opener wired");
			return;
		}
		try {
			const unit = await this.deps.openUnit();
			if (unit === void 0) {
				this.log("[dsh-task-board] board storage unavailable: no json backend on the storage hub");
				return;
			}
			this.unit = unit;
			const snapshot = await unit.loadAll();
			this.doc = normalizeBoardDoc(snapshot.global, this.now());
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
				await this.unit.setGlobal(next);
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
* the `json` backend's KV facet, and open the board unit. A missing hub or
* backend yields undefined (the service then reports unavailable — fallback
* mode, never a throw).
*/
function storageHubOpener(storage) {
	return async () => {
		const kv = (storage()?.backend?.get?.("json"))?.kv;
		if (kv?.open === void 0) return void 0;
		return kv.open({
			name: BOARD_UNIT_NAME,
			version: 1,
			tables: [],
			hasGlobal: true
		});
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
/** Write one JSON envelope response (same discipline as the settings route). */
function json$2(res, envelope, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(envelope));
}
/** Extract a commit from an untrusted body; undefined when unusable. The
*  merge grammar normalizes every row/section, so this only checks the
*  envelope shape (arrays/strings), never the data. */
function parseBoardCommit(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const row = body;
	if (typeof row.clientId !== "string" || row.clientId === "" || row.clientId.length > 64) return void 0;
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
	const deleted = Array.isArray(row.deleted) ? row.deleted.map((entry) => {
		if (typeof entry !== "object" || entry === null) return void 0;
		const del = entry;
		if (typeof del.id !== "string" || del.id === "") return void 0;
		const baseUpdatedAt = typeof del.baseUpdatedAt === "number" && Number.isFinite(del.baseUpdatedAt) ? del.baseUpdatedAt : 0;
		return {
			id: del.id,
			baseUpdatedAt
		};
	}).filter((entry) => entry !== void 0) : [];
	const changed = Array.isArray(row.changed) ? row.changed.filter((id) => typeof id === "string" && id !== "") : [];
	const sectionClaims = Array.isArray(row.sectionClaims) ? row.sectionClaims.filter((key) => key === "cruise" || key === "schedulePresets" || key === "runPresets") : void 0;
	return {
		clientId: row.clientId,
		tasks: Array.isArray(row.tasks) ? row.tasks : [],
		changed,
		sectionClaims,
		deleted,
		cruise: section(row.cruise),
		schedulePresets: section(row.schedulePresets),
		runPresets: section(row.runPresets)
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
		if (req.method === "GET" && tail === "") {
			const sinceParam = url.searchParams.get("since");
			const since = sinceParam === null ? NaN : Number(sinceParam);
			const doc = deps.doc();
			const clientId = url.searchParams.get("clientId") ?? void 0;
			deps.noteActivity(clientId);
			if (Number.isFinite(since) && since >= doc.revision) {
				json$2(res, {
					ok: true,
					value: {
						available: deps.available(),
						revision: doc.revision,
						unchanged: true
					}
				});
				return;
			}
			json$2(res, {
				ok: true,
				value: {
					available: deps.available(),
					revision: doc.revision,
					doc
				}
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
* @param ctx - context carrying the webServer and storage services.
* @param ns - the plugin namespace this route serves.
* @returns the disposer removing the route and closing the service.
*/
function registerBoardRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	const service = new BoardDataService({ openUnit: storageHubOpener(() => ctx.get("storage")) });
	service.ensureInit();
	const deps = {
		ready: () => service.ensureInit(),
		available: () => service.available,
		doc: () => service.getDoc(),
		commit: (commit) => service.commit(commit),
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
var version = "0.2.99";
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
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 200;
const inject = [
	"webServer",
	"systemPrompt",
	"settings"
];
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const TASK_BOARD_GUIDANCE = "本机已安装 dsh-task-board 独立插件（DSH Web GUI 的任务看板，可挂载到 web profile）：侧边栏「任务看板」入口。能力：多列看板管理任务；任务可真实执行（驱动 agent 会话）；任务支持 5 段 cron 定时执行（如 0 23 * * *）；看板数据（任务/巡航/预设）持久化在 DSH host 端（存储单元 dsh_task_board），任意设备任意浏览器打开同一部署看到的都是同一块板，改动经 SSE 实时同步；手机等窄屏为紧凑布局。限制：调度引擎同一时刻只由一个打开的 GUI 端持有（host 租约仲裁，多端同开不会双份执行），至少一个 GUI 标签页保持打开，否则定时/巡航/接续停摆、错过即跳过；执行消耗 API 额度。用户提到「任务看板 / 看板 / 定时任务」时即指本插件，请据此协作。";
/**
* Settings namespace of the board's announcement capability — the section the
* web settings surface edits, and the namespace the settings route serves.
* Spelled here rather than imported: the browser half spells the same value
* and must not depend on a Host package. The settings service validates the
* spelling when it registers (a lowercase hyphenated identifier).
*/
const TASK_BOARD_SETTINGS_NAMESPACE = "dsh-task-board";
const Config = z.object({
	announceToAgent: z.boolean().default(true),
	enabled: z.boolean().default(true)
});
/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = true;
/**
* Register the board's announcement section, gated on the composition entry's
* `announceToAgent` (and the live settings value once the web settings
* surface is served). The section is re-registered whenever the source
* changes, so a settings edit takes effect without a restart.
* @param ctx - the plugin context (systemPrompt injected).
* @param config - resolved plugin config (schema defaults applied by the loader).
*/
function apply(ctx, config) {
	let current = () => config ?? {};
	let disposeSection;
	const sync = () => {
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		if ((current().enabled ?? true) === false) return;
		if ((current().announceToAgent ?? DEFAULT_ANNOUNCE) === false) return;
		disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-task-board",
			order: SECTION_ORDER,
			text: TASK_BOARD_GUIDANCE
		});
	};
	ctx.settings.installSection(ctx, TASK_BOARD_SETTINGS_NAMESPACE, Config, config ?? {}, {
		setSource: (source) => {
			current = source;
		},
		onChange: sync
	});
	ctx.effect(() => registerSettingsRoute(ctx, "dsh-task-board"), "dsh-task-board: settings route");
	ctx.effect(() => registerPermissionRoute(ctx, "dsh-task-board"), "dsh-task-board: permissions route");
	ctx.effect(() => registerSessionStateRoute(ctx), "dsh-task-board: session-state route");
	ctx.effect(() => registerBoardRoute(ctx, "dsh-task-board"), "dsh-task-board: board route");
	ctx.effect(() => registerUpdateRoute(ctx, "dsh-task-board"), "dsh-task-board: update route");
	ctx.effect(() => registerClientReportRoute(ctx, "dsh-task-board"), "dsh-task-board: client report route");
	sync();
}
//#endregion
export { Config, TASK_BOARD_GUIDANCE, TASK_BOARD_SETTINGS_NAMESPACE, apply, inject };
