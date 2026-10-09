import { a as handOver, b as deletedItemsOf, c as storageHubOpener, g as relatedSessionIdsOf, i as sessionRunningOf, s as acquireBoardService, v as planItemAsk } from "./session-state-C_vGsfGI.js";
import { n as surfaceManifest } from "./surfaces-F4JByhCB.js";
import path from "node:path";
import os from "node:os";
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
/**
* Parse the body of an operation on a DELETED row: EXACTLY ONE of the two
* names, and a caller id. One reader, both tails — the purge inherits the
* restore's addressing rules rather than re-deciding them, because a second
* reader of 「which row」 is a second answer to the same question and the two
* would be free to disagree about which caller may send which name.
*
* WHY TWO NAMES, AND WHY THEY ARE NOT INTERCHANGEABLE. A tombstone is stored
* under the row's uuid, so the identity is the address that always resolves —
* including for a row written seconds ago, which has NO short number yet
* (`ref === 0`, the document's own "not numbered" sentinel). That is the row an
* undo gesture has to be able to bring back, and it is the one a reader cannot
* name: they did not read a number, they pressed undo. The short number is the
* other name because it is the one a person and a model SAY OUT LOUD, and the
* model's `item.restore` / `item.purge` quote it back from a receipt they read a
* turn earlier.
*
* So each caller sends the name it actually holds, and a request carrying BOTH
* is refused rather than resolved by preference: a body with both keys is a
* caller that does not know which row it meant, and picking one for it would
* act on a row the caller did not ask for — a silent wrong answer about
* somebody's own words, which is worse than a refusal it can fix. A purge gets
* the same rule for a sharper reason: resolving the wrong tombstone would
* destroy words the caller never offered to destroy.
*
* @param body - the request body.
* @param what - the operation's own word, so a refusal names what was refused
*   instead of repeating the first tail's name. The RULES are shared; the
*   sentence is the caller's.
* @returns the address plus the caller id, or the refusal to answer with.
*/
function parseItemAddressBody(body, what) {
	if (typeof body !== "object" || body === null) return {
		ok: false,
		why: `${what} needs a JSON body`
	};
	const record = body;
	const rawRef = typeof record.ref === "string" ? Number(record.ref.replace("#", "").trim()) : record.ref;
	const ref = typeof rawRef === "number" && Number.isInteger(rawRef) && rawRef > 0 ? rawRef : void 0;
	const id = typeof record.id === "string" && record.id !== "" ? record.id : void 0;
	const clientId = clientIdOf(record);
	if (clientId === void 0) return {
		ok: false,
		why: `${what} needs a clientId`
	};
	if (id !== void 0 && ref !== void 0) return {
		ok: false,
		why: `${what} names one row: give id or ref, not both — a body with both does not know which row it meant`
	};
	if (id === void 0 && ref === void 0) return {
		ok: false,
		why: `${what} needs to be told which row: id or ref, and one of them`
	};
	return {
		ok: true,
		request: {
			of: id !== void 0 ? {
				kind: "id",
				id
			} : {
				kind: "ref",
				ref
			},
			clientId
		}
	};
}
/**
* Parse the ask body: the card is named, the row is named, and the row may be
* named TWICE because both names are required.
*
* That is the difference from {@link parseItemAddressBody}, which refuses a body
* carrying both `id` and `ref`: there, EITHER name is optional, so both present
* is two intents. Here `ref` is required — the model only ever holds a number —
* and the panel sends its `id` alongside it as a cross-check. So the body is not
* ambiguous, and refusing it would refuse every legitimate caller.
*
* @returns the request, or `undefined` for a body that does not parse.
*/
function parseAskBody(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const record = body;
	if (typeof record.taskId !== "string" || record.taskId === "") return void 0;
	if (typeof record.ref !== "number" || !Number.isFinite(record.ref)) return void 0;
	if (record.id !== void 0 && typeof record.id !== "string") return void 0;
	const hasId = typeof record.id === "string" && record.id !== "";
	return {
		taskId: record.taskId,
		ref: record.ref,
		...hasId ? { id: record.id } : {}
	};
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
*  circuit is the one that has to be right.
*
*  ONE FLAT SHAPE, not a union of "short-circuited" and "not". A caller that
*  wants to add something to the answer (the checklist's archive, say) then
*  has to narrow a union it does not own, and the natural way to narrow it is
*  the one that silently drops the addition. The wire form is unchanged either
*  way: an absent field and an `undefined` field serialise identically, so this
*  is a shape the TYPE has, not a shape the wire gained. */
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
		if (req.method === "GET" && tail === "/surfaces") {
			json$2(res, {
				ok: true,
				value: surfaceManifest()
			});
			return;
		}
		if (req.method === "GET" && tail === "/events") {
			serveEvents(deps, url, res);
			return;
		}
		if (req.method === "GET" && (tail === "" || tail === "/items")) {
			deps.noteActivity(url.searchParams.get("clientId") ?? void 0);
			if (tail === "") {
				json$2(res, {
					ok: true,
					value: documentGetView(deps, url, deps.doc())
				});
				return;
			}
			const view = documentGetView(deps, url, deps.itemsDoc());
			const includeDeleted = url.searchParams.get("includeDeleted") === "1";
			if (view.unchanged !== true && includeDeleted) {
				json$2(res, {
					ok: true,
					value: {
						...view,
						deleted: deletedItemsOf(deps.itemsDoc())
					}
				});
				return;
			}
			json$2(res, {
				ok: true,
				value: view
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
			try {
				const doc = await deps.commit(commit);
				json$2(res, {
					ok: true,
					value: {
						available: true,
						revision: doc.revision,
						doc
					}
				});
			} catch (error) {
				json$2(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			}
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
			try {
				const doc = await deps.commitItems(commit);
				json$2(res, {
					ok: true,
					value: {
						available: true,
						revision: doc.revision,
						doc
					}
				});
			} catch (error) {
				json$2(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			}
			return;
		}
		if (tail === "/items/restore") {
			const ask2 = parseItemAddressBody(payload, "restore");
			if (!ask2.ok) {
				json$2(res, {
					ok: false,
					error: {
						code: "invalid_argument",
						message: ask2.why
					}
				});
				return;
			}
			if (!deps.available()) {
				json$2(res, {
					ok: true,
					value: {
						available: false,
						revision: 0,
						restored: void 0
					}
				});
				return;
			}
			deps.noteActivity(ask2.request.clientId);
			try {
				const restored = await deps.restoreItem(ask2.request.of, ask2.request.clientId);
				json$2(res, {
					ok: true,
					value: {
						available: true,
						revision: deps.itemsDoc().revision,
						restored
					}
				});
			} catch (error) {
				json$2(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			}
			return;
		}
		if (tail === "/items/purge") {
			const ask3 = parseItemAddressBody(payload, "purge");
			if (!ask3.ok) {
				json$2(res, {
					ok: false,
					error: {
						code: "invalid_argument",
						message: ask3.why
					}
				});
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
			deps.noteActivity(ask3.request.clientId);
			try {
				const outcome = await deps.purgeItem(ask3.request.of, ask3.request.clientId);
				json$2(res, {
					ok: true,
					value: {
						available: true,
						revision: deps.itemsDoc().revision,
						...outcome.kind === "purged" ? { erased: outcome.erased } : {},
						...outcome.kind === "notDeleted" ? { notDeleted: true } : {}
					}
				});
			} catch (error) {
				json$2(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			}
			return;
		}
		if (tail === "/ask") {
			const ask = parseAskBody(payload);
			if (ask === void 0) {
				json$2(res, MALFORMED);
				return;
			}
			json$2(res, {
				ok: true,
				value: await deps.ask(ask)
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
* Hand one checklist item to the model of the session its card runs in.
*
* WHY THE CARD DECIDES THE TARGET. The panel is a main-stage page, so no
* conversation is on screen while it is open — there is no "current session" to
* send anything to. The card is what the item hangs off, and the card already
* knows its sessions, so the target is a fact the document already holds rather
* than a picker the reader has to answer.
*
* WHICH SESSION WHEN THERE ARE SEVERAL: one that is actually running. A card can
* hold several sessions, and "the one doing work right now" is the only choice
* that matches what the reader means by "ask the AI about this". When none is
* running the FIRST bound session is used, and the receipt names it either way —
* a hand-off that cannot be told apart afterwards is not a receipt.
*
* THE HAND-OFF ITSELF is `handOver` from the agent surface: one path into a
* model, shared with the two slash commands.
*
* **Exported so it can be tested without a storage hub.** This function decides
* WHICH CONVERSATION a person's text goes to, and it had no coverage at all: the
* route's `deps.ask` seam is replaced in every route test, so the production
* wiring at `registerBoardRoute` — which is the only place this body actually
* runs — was never executed. That is why a request naming card A with a row of
* card B survived: nothing had ever asked the function what it does with two
* names that disagree.
*
* @param ctx - the host context, read for `agents` at call time.
* @param service - the two-document face.
* @param request - the card and the row, as the parser accepted them.
* @returns the receipt naming the session, or a refusal code.
*/
async function handOneItemToItsCardSession(ctx, service, request) {
	if (!service.available) return {
		ok: false,
		why: "hostStorageMissing"
	};
	const item = (request.id !== void 0 && request.id !== "" ? service.getItemsDoc().items.find((entry) => entry.id === request.id) : void 0) ?? (request.ref > 0 ? service.getItemsDoc().items.find((entry) => entry.ref === request.ref) : void 0);
	if (item === void 0) return {
		ok: false,
		why: "noSuchItem"
	};
	const card = service.getDoc().tasks.find((task) => task.id === request.taskId);
	const agents = ctx.get("agents");
	const verdict = planItemAsk({
		item,
		card,
		sessions: card === void 0 ? [] : relatedSessionIdsOf(card),
		isRunning: (sessionId) => sessionRunningOf({ agents: () => ctx.get("agents") }, sessionId).value === true,
		hasAgent: (sessionId) => agents !== void 0 && agents.get(sessionId) !== void 0
	});
	if (!verdict.ok) return {
		ok: false,
		why: verdict.why === "noCard" ? "noSuchTask" : verdict.why
	};
	const followup = agents?.get(verdict.sessionId)?.followup;
	if (followup === void 0) return {
		ok: false,
		why: "noLiveAgent"
	};
	const result = handOver({ followup }, verdict.text);
	return result.kind === "success" ? {
		ok: true,
		sessionId: verdict.sessionId,
		said: verdict.text
	} : {
		ok: false,
		why: result.text
	};
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
	const { service, release } = acquireBoardService(storageHubOpener(() => ctx.get("storage")));
	const deps = {
		ready: () => service.ensureInit(),
		available: () => service.available,
		doc: () => service.getDoc(),
		commit: (commit) => service.commit(commit),
		itemsDoc: () => service.getItemsDoc(),
		commitItems: (commit) => service.commitItems(commit),
		restoreItem: (of, clientId) => service.restoreItem(of, clientId),
		purgeItem: (of, clientId) => service.purgeItem(of, clientId),
		acquireLease: (clientId, ttlMs, active) => service.acquireLease(clientId, ttlMs, active),
		releaseLease: (clientId) => service.releaseLease(clientId),
		noteActivity: (clientId) => service.noteActivity(clientId),
		noteStreamOpen: (clientId) => service.noteStreamOpen(clientId),
		noteDisconnect: (clientId) => service.noteDisconnect(clientId),
		submitCommand: (command) => service.submitCommand(command),
		ask: (request) => handOneItemToItsCardSession(ctx, service, request),
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
		release();
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
var version = "0.9.14";
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
/**
* Only `webServer`. The model's whole surface (three tools, two slash commands,
* one prompt section) moved to its own row — `host-agent.ts` — so the plugin
* page can switch it off in one click, and switching it off means the loader
* never evaluates it rather than a runtime check that could be forgotten.
*/
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
