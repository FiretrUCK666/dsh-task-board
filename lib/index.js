import { $ as stringOf, Q as messageOf, b as deletedItemsOf, m as refOf, n as storageHubOpener, t as acquireBoardService } from "./board-service-D8BrDmzW.js";
import { n as surfaceManifest, t as markSurfaceActive } from "./surfaces-BuEee2Eb.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
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
/**
* Write one JSON envelope response.
*
* The ONE writer: a route that wants to answer does not get to decide how the
* answer is spelled, and a second writer would be a second dialect on one
* prefix.
* @param res - the response to write to.
* @param envelope - the envelope (see `core/http-envelope.ts`).
* @param status - the HTTP status; business refusals still answer 200.
*/
function json(res, envelope, status = 200) {
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
			json(res, {
				ok: false,
				error: {
					code: "permissions",
					message: error instanceof Error ? error.message : String(error)
				}
			});
			return;
		}
		json(res, {
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
/**
* HTTP handler: GET /api/dsh-task-board/session-state?sessionId=… → the shared
* envelope `{ ok: true, value: { plan?, goal?, subagents? } }`.
*
* THE ENVELOPE IS THE SHARED ONE. This route used to answer a FLAT envelope
* (`{ ok: true, plan?, goal? }`) — its own dialect on the same plugin — which
* meant a reader had to know which of the two shapes each route answers. Now
* it answers exactly what every other route answers, and the browser reads
* `value` like everywhere else.
*/
function createSessionStateHandler(faces, read = readSessionState) {
	return async (req, res) => {
		const sessionId = queryParamOf(req.url, "sessionId");
		if (sessionId === void 0 || sessionId === "") {
			res.writeHead(400);
			res.end();
			return;
		}
		json(res, {
			ok: true,
			value: await read(faces, sessionId)
		});
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
	const raw = record.ref;
	const rawRef = typeof raw === "string" || typeof raw === "number" ? Number(refOf(raw)) : void 0;
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
/** The longest caller id a body may carry.
*
*  The id is a key in the pending-command map and it travels to every replica
*  over the event stream, so an unbounded one turns a single request into
*  unbounded memory and an unbounded broadcast. The limit is part of the rule,
*  not a detail of one endpoint. */
const MAX_CLIENT_ID_LENGTH = 64;
/** The caller id every write body must carry. One rule, every route.
*
*  It is a rule about the CALLER, not about one endpoint: a commit, a lease
*  and a relayed command are three bodies and one caller. Two copies of one
*  rule are two answers to 「is this a caller」, and two answers disagree —
*  which is how one route comes to accept an id the others refuse. */
function clientIdOf(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const id = body.clientId;
	return typeof id === "string" && id !== "" && id.length <= MAX_CLIENT_ID_LENGTH ? id : void 0;
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
*  predates the flag never loses ground it would have kept).
*
*  The caller id is read by the SHARED rule, so the lease and the commit
*  refuse the same ids: a caller the board route accepts and the lease route
*  refuses is one caller the server half believes and half does not. */
function parseLeaseBody(body) {
	const clientId = clientIdOf(body);
	if (clientId === void 0) return void 0;
	const row = body;
	return {
		clientId,
		...typeof row.ttlMs === "number" && Number.isFinite(row.ttlMs) ? { ttlMs: row.ttlMs } : {},
		release: row.release === true,
		active: row.active !== false
	};
}
/** Parse the POST body of the command relay. The caller id comes from the
*  SHARED rule too, so a relayed command cannot carry an id the other two
*  routes would refuse. */
function parseCommandBody(body) {
	const clientId = clientIdOf(body);
	if (clientId === void 0) return void 0;
	const command = body.command;
	if (typeof command !== "object" || command === null) return { clientId };
	if (command.type !== "run" || typeof command.taskId !== "string" || command.taskId === "") return { clientId };
	const trigger = command.trigger === "schedule" || command.trigger === "chain" ? command.trigger : "manual";
	return {
		clientId,
		command: {
			type: "run",
			taskId: command.taskId,
			trigger,
			clientId
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
			json(res, MALFORMED, 400);
			return;
		}
		const tail = url.pathname.slice(base.length);
		await deps.ready();
		if (req.method === "GET" && tail === "/surfaces") {
			json(res, {
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
				json(res, {
					ok: true,
					value: documentGetView(deps, url, deps.doc())
				});
				return;
			}
			const view = documentGetView(deps, url, deps.itemsDoc());
			const includeDeleted = url.searchParams.get("includeDeleted") === "1";
			if (view.unchanged !== true && includeDeleted) {
				json(res, {
					ok: true,
					value: {
						...view,
						deleted: deletedItemsOf(deps.itemsDoc())
					}
				});
				return;
			}
			json(res, {
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
			json(res, MALFORMED, 415);
			return;
		}
		const payload = await readJsonBody(req, BOARD_BODY_LIMIT_BYTES);
		if (tail === "") {
			const commit = parseBoardCommit(payload);
			if (commit === void 0) {
				json(res, MALFORMED);
				return;
			}
			if (!deps.available()) {
				json(res, {
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
				json(res, {
					ok: true,
					value: {
						available: true,
						revision: doc.revision,
						doc
					}
				});
			} catch (error) {
				json(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: messageOf(error)
					}
				});
			}
			return;
		}
		if (tail === "/items") {
			const commit = parseItemsCommit(payload);
			if (commit === void 0) {
				json(res, MALFORMED);
				return;
			}
			if (!deps.available()) {
				json(res, {
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
				json(res, {
					ok: true,
					value: {
						available: true,
						revision: doc.revision,
						doc
					}
				});
			} catch (error) {
				json(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: messageOf(error)
					}
				});
			}
			return;
		}
		if (tail === "/items/restore") {
			const ask2 = parseItemAddressBody(payload, "restore");
			if (!ask2.ok) {
				json(res, {
					ok: false,
					error: {
						code: "invalid_argument",
						message: ask2.why
					}
				});
				return;
			}
			if (!deps.available()) {
				json(res, {
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
				json(res, {
					ok: true,
					value: {
						available: true,
						revision: deps.itemsDoc().revision,
						restored
					}
				});
			} catch (error) {
				json(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: messageOf(error)
					}
				});
			}
			return;
		}
		if (tail === "/items/purge") {
			const ask3 = parseItemAddressBody(payload, "purge");
			if (!ask3.ok) {
				json(res, {
					ok: false,
					error: {
						code: "invalid_argument",
						message: ask3.why
					}
				});
				return;
			}
			if (!deps.available()) {
				json(res, {
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
				json(res, {
					ok: true,
					value: {
						available: true,
						revision: deps.itemsDoc().revision,
						...outcome.kind === "purged" ? { erased: outcome.erased } : {},
						...outcome.kind === "notDeleted" ? { notDeleted: true } : {}
					}
				});
			} catch (error) {
				json(res, {
					ok: false,
					error: {
						code: "persist_failed",
						message: messageOf(error)
					}
				});
			}
			return;
		}
		if (tail === "/lease") {
			const parsed = parseLeaseBody(payload);
			if (parsed === void 0) {
				json(res, MALFORMED);
				return;
			}
			const lease = parsed.release ? deps.releaseLease(parsed.clientId) : deps.acquireLease(parsed.clientId, parsed.ttlMs, parsed.active);
			json(res, {
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
				json(res, MALFORMED);
				return;
			}
			const { queued } = deps.submitCommand(parsed.command);
			json(res, {
				ok: true,
				value: {
					available: deps.available(),
					revision: deps.doc().revision,
					command: { queued }
				}
			});
			return;
		}
		json(res, MALFORMED, 404);
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
* Classify one profile-manifest dependency spec. The three routes the plugin
* documents are what this reads, and nothing is guessed into them:
*
* - `link:` is local development: the code being run is a checkout, and the
*   update refreshes it in place.
* - a `github:`/`gitlab:`/`bitbucket:`/`gist:` spec, ANY `git+…` spec, or an
*   `http(s)://` URL is a SOURCE install: what was installed is a repository or
*   a tarball named by that spec, and re-adding that same spec is its update.
*   (A URL is not assumed to be GitHub — the plan re-adds the recorded spec, so
*   a private tarball URL updates from itself.)
* - anything else is a registry install, EXCEPT the specs that name a local
*   artifact (`file:`, `portal:`, `workspace:`) — those are not in the registry
*   and not a checkout either, so no route here can update them. They read as
*   `unknown` on purpose: the page then says it has no command for this install
*   instead of offering `@latest`, which would replace someone's local build
*   with the published one.
* @param spec - the raw `dependencies[name]` string, or undefined when unread.
* @returns the install mode (`unknown` when the spec is missing or unrouted).
*/
function classifyInstallSpec(spec) {
	if (spec === void 0 || spec === "") return "unknown";
	const s = spec.trim();
	if (s.startsWith("link:")) return "local";
	if (/^(?:github|gitlab|bitbucket|gist):/.test(s)) return "github";
	if (s.startsWith("git+") || s.startsWith("git@") || /\.git(?:#|$)/.test(s)) return "github";
	if (/^https?:/.test(s)) return "github";
	if (/^(?:file|portal|workspace):/.test(s)) return "unknown";
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
/**
* The steps a reader would run by hand for one package spec. The CLI always
* requires `--profile`, so a missing profile name yields no command rather than
* a line that cannot work.
*
* A packaged application's profile gets no command either, and the reason is
* narrower than "its CLI refuses that profile": the CLI has TWO shims. The one
* the npm package installs rejects this profile name outright
* (`profile "desktop" is managed exclusively by the Electron application`),
* while the application's own shim — the one its menu puts on PATH — is allowed
* through. A plan cannot see which `dsh` a reader has, so a line that works for
* one of them and fails for the other is not offered at all: the page names the
* route that always works (the application's own plugin page) instead.
* @param appManaged - whether a packaged application owns the profile.
* @param profile - the profile name.
* @param spec - the package spec to re-add.
* @returns the steps (empty when no terminal command applies).
*/
function terminalStepsFor(appManaged, profile, spec) {
	if (appManaged || profile === void 0 || profile === "") return [];
	return [{
		command: "dsh",
		args: [
			"plugin",
			"--profile",
			profile,
			"add",
			spec
		]
	}];
}
/**
* The spec to re-add when updating a SOURCE install, read from what the profile
* actually recorded.
*
* The profile's own declaration wins over the spec derived from the package's
* `repository` field: a fork, a mirror or a tarball URL is what that reader
* installed, and re-pointing the update at the canonical repository would swap
* their package for a different one under the same name. A `#fragment` is
* dropped — it names ONE commit, so re-adding it would reinstall precisely the
* code that is already there and call it an update.
* @param recorded - the profile manifest's spec string, when it was read.
* @returns the spec to re-add, or undefined when the recorded one is not a source spec.
*/
function sourceSpecOf(recorded) {
	if (recorded === void 0) return void 0;
	const withoutFragment = (recorded.split("#")[0] ?? "").trim();
	if (withoutFragment === "") return void 0;
	return classifyInstallSpec(withoutFragment) === "github" ? withoutFragment : void 0;
}
/**
* Build the update plan for the running copy. Local checkouts pull and rebuild
* in place; source installs re-add the spec the profile recorded (see
* {@link sourceSpecOf}); npm installs re-add the package at latest; an
* unreadable or unrouted mode gets no plan at all — guessing an install mode is
* how a reader is told to run a command that cannot work.
* @param input - the facts about the running copy.
* @returns the plan.
*/
function updatePlanFor(input) {
	const base = {
		mode: input.mode,
		...input.packageName !== "" ? { packageName: input.packageName } : {},
		...input.profile !== void 0 && input.profile !== "" ? { profile: input.profile } : {},
		appManaged: input.appManaged
	};
	if (input.mode === "local") return {
		...base,
		apply: "checkout",
		steps: [...input.checkoutSteps ?? [{
			command: "git",
			args: ["pull", "--ff-only"]
		}, {
			command: "pnpm",
			args: ["run", "build"]
		}]]
	};
	const spec = input.mode === "npm" ? `${input.packageName}@latest` : input.mode === "github" ? sourceSpecOf(input.recordedSpec) ?? input.githubSpec : void 0;
	if (spec === void 0) return {
		...base,
		apply: "none",
		steps: []
	};
	const applies = input.canInstall;
	return {
		...base,
		packageSpec: spec,
		apply: applies ? "package" : "none",
		...applies && input.reinstall === true ? { reinstall: true } : {},
		steps: terminalStepsFor(input.appManaged, input.profile, spec)
	};
}
/**
* The registries to ask when the host carries no installation service to ask
* instead. A degraded fallback on purpose: the profile's own registry plan is
* the authority (it knows mirrors, private sources and proxies), and this pair
* is the public default that any Node installation already reaches. Reading
* only the first of them is what made a mirror user's check fail outright.
*/
const PUBLIC_REGISTRIES = ["https://registry.npmjs.org/", "https://registry.npmmirror.com/"];
/**
* The packument URL for one package on one registry.
* @param registry - the registry base URL, with or without a trailing slash.
* @param packageName - the package name (a scope's slash is encoded).
* @returns the URL to fetch.
*/
function packumentUrl(registry, packageName) {
	return `${registry.endsWith("/") ? registry : `${registry}/`}${packageName.replace("/", "%2F")}`;
}
/**
* Read the published latest out of one registry's packument. A document that
* does not carry a `dist-tags.latest` string is not an answer, so it reads as
* undefined and the caller asks the next registry.
* @param body - the parsed packument.
* @returns the version and its publish instant, or undefined.
*/
function latestFromPackument(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const packument = body;
	const latest = packument["dist-tags"]?.latest;
	if (typeof latest !== "string" || latest === "") return void 0;
	const published = packument.time?.[latest];
	return {
		version: latest,
		...typeof published === "string" && published !== "" ? { publishedAt: published } : {}
	};
}
//#endregion
//#region src/host/update-apply.ts
/**
* Update application for the task-board plugin: the one place that changes an
* installed copy, and the only place that says how it went.
*
* The plugin never rewrites its own files by hand, and it never updates a
* profile by name. Two paths exist, and each one goes through the machinery
* that owns that copy:
*
* - a package install (npm / github) is handed to DSH's installation service,
*   which takes the profile's writer lock, runs the installation's own package
*   manager, restores the previous files when a run fails, and reports whether
*   the change applied live or needs a restart;
* - a `link:` checkout is refreshed where it lives — pull, then the checkout's
*   own build script — because no package manager owns those files.
*
* Every effect is injected (`installer`, `runner`, `readVersion`), so the
* decision logic is unit-tested without a process, a registry or a server.
* @module dsh-task-board/host/update-apply
*/
/** How long one update run may take before it is killed (milliseconds). */
const RUN_TIMEOUT_MS = 6e5;
/**
* Deadlines for the steps that are not the build. Reaching a remote needs a
* bound of its own: a pull that wants credentials must fail long before a
* compile does, and a person watching a dialog deserves the sooner answer.
*/
const STEP_TIMEOUT_MS = { git: 12e4 };
/** How much of a run's output is kept (and shipped to the page that asked). */
const OUTPUT_LIMIT = 4e3;
/**
* Keep the tail of one run's output: the last lines carry the failure, and a
* whole pnpm log is not something a dialog should hold.
* @param text - the accumulated output.
* @param limit - how many characters to keep.
* @returns the trimmed tail.
*/
function tailText(text, limit = OUTPUT_LIMIT) {
	const trimmed = text.trim();
	return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
}
/**
* Uninstall the running copy, the first half of a reinstall.
*
* Everything that can go wrong is folded into one answer here, because the
* service reports its refusals two different ways: an unremovable bundle comes
* back as a failure code in the record, while a package-manager run that exits
* nonzero is thrown as an error whose message is the run's own output.
* @param installer - the installation service.
* @param name - the package to uninstall.
* @returns the failure, or undefined when the removal went through.
*/
async function removeInstalled(installer, name) {
	const remove = installer.removeBundle?.bind(installer);
	if (remove === void 0) return {
		ok: false,
		error: "unavailable"
	};
	let record;
	try {
		record = await remove(name);
	} catch (error) {
		return {
			ok: false,
			error: "failed",
			output: tailText(`remove ${name}: ${messageOf(error)}`)
		};
	}
	const output = stringOf(record?.error?.diagnostic) ?? stringOf(record?.packageResult?.output);
	const code = record?.error?.code;
	const exit = record?.packageResult?.exitCode;
	if (code !== void 0 || record?.application === "failed" || typeof exit === "number" && exit !== 0) return {
		ok: false,
		error: "failed",
		output: tailText(`${code !== void 0 ? `remove: ${String(code)}` : `remove: exit ${String(exit ?? "none")}`}${output !== void 0 ? `\n${output}` : ""}`)
	};
}
/**
* Apply a package update through the installation service.
*
* A plan that says `reinstall` uninstalls first: that is the only order the
* service accepts on an HMR host, which refuses to install over a package that
* is already there so that the old version's plugin stops before its files are
* replaced. A plan without it installs straight over the running copy, which is
* what a host without HMR accepts and reports as `restart-required`.
* The version is read BEFORE the run as well as after it, because the one
* thing the installation service cannot tell us is whether anything changed:
* see {@link UpdateApplyOutcome}.
* @param plan - the plan whose package is reinstalled and whose spec re-added.
* @param installer - the installation service.
* @param readVersion - reads the version now on disk.
* @returns the result.
*/
async function applyPackage(plan, installer, readVersion) {
	if (installer === void 0) return {
		ok: false,
		error: "unavailable"
	};
	const spec = plan.packageSpec;
	if (spec === void 0) return {
		ok: false,
		error: "unsupported"
	};
	const name = plan.packageName;
	const before = readVersion();
	if (plan.reinstall === true) {
		if (name === void 0 || name === "") return {
			ok: false,
			error: "unsupported"
		};
		const refused = await removeInstalled(installer, name);
		if (refused !== void 0) return refused;
	}
	let record;
	try {
		record = await installer.installBundle(spec, { enabled: true });
	} catch (error) {
		return {
			ok: false,
			error: "failed",
			output: tailText(messageOf(error))
		};
	}
	const output = stringOf(record.packageResult?.output) ?? stringOf(record.error?.diagnostic);
	if (record.application === "failed") return {
		ok: false,
		error: "failed",
		...output !== void 0 ? { output: tailText(output) } : {}
	};
	if (record.application !== "applied" && record.application !== "restart-required") return {
		ok: false,
		error: "failed",
		output: tailText(`application: ${stringOf(record.application) ?? "(none)"}${output !== void 0 ? `\n${output}` : ""}`)
	};
	const version = readVersion() ?? stringOf(record.version);
	if (plan.mode === "npm" && before !== void 0 && before === version) return {
		ok: true,
		outcome: "unchanged",
		version: before
	};
	return {
		ok: true,
		outcome: record.application,
		...version !== void 0 ? { version } : {}
	};
}
/**
* Apply a checkout refresh: pull, then the checkout's own build.
* @param plan - the plan whose steps run in order.
* @param deps - the runner, the checkout facts and the version reader.
* @returns the result.
*/
async function applyCheckout(plan, deps) {
	const checkout = deps.checkout;
	if (checkout === void 0) return {
		ok: false,
		error: "unavailable"
	};
	if (checkout.dirty) return {
		ok: false,
		error: "dirty"
	};
	const timeoutMs = deps.timeoutMs ?? RUN_TIMEOUT_MS;
	for (const step of plan.steps) {
		const outcome = await deps.runner(step, {
			cwd: checkout.dir,
			shell: true,
			timeoutMs: STEP_TIMEOUT_MS[step.command] ?? timeoutMs
		});
		if (outcome.missing === true) return {
			ok: false,
			error: "tool-missing",
			output: tailText(`${step.command}: ${outcome.output}`)
		};
		if (outcome.timedOut === true) return {
			ok: false,
			error: "timeout",
			output: tailText(outcome.output)
		};
		if (outcome.code !== 0) return {
			ok: false,
			error: "failed",
			output: tailText(`${step.command}: exit ${outcome.code ?? "none"}\n${outcome.output}`)
		};
	}
	const version = deps.readVersion();
	return {
		ok: true,
		outcome: "rebuilt",
		...version !== void 0 ? { version } : {}
	};
}
/**
* Apply one update plan and report how it went.
* @param deps - the plan and the injected effects.
* @returns the result (`ok` is the only thing callers branch on).
*/
async function applyUpdate(deps) {
	if (deps.plan.apply === "package") return await applyPackage(deps.plan, deps.installer, deps.readVersion);
	if (deps.plan.apply === "checkout") return await applyCheckout(deps.plan, deps);
	return {
		ok: false,
		error: "unsupported"
	};
}
/**
* Run one step and collect its output.
*
* `shell` is on for checkout steps on purpose: on Windows the package-manager
* entry points are `.cmd` shims, which Node refuses to spawn directly. The
* command line is assembled from this plugin's own table plus the checkout's
* script name — never from user data — so there is no quoting surface to get
* wrong; the working directory travels as an option, not inside the line.
*
* The deadline kills the process this call started. A step that spawns its own
* children (a build tool) can outlive it; the caller still reports the timeout,
* so the run is never silently assumed to have finished.
* @param step - the command and its arguments.
* @param options - working directory, shell mode and deadline.
* @returns the outcome (a command that never started reports `missing`).
*/
function spawnStep(step, options) {
	return new Promise((resolve) => {
		let output = "";
		let timedOut = false;
		let settled = false;
		const child = spawn(step.command, step.args, {
			cwd: options.cwd,
			shell: options.shell,
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		const take = (chunk) => {
			output = tailText(output + chunk.toString());
		};
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, options.timeoutMs);
		const settle = (outcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(outcome);
		};
		child.on("error", (error) => {
			const detail = error.code === "ENOENT" ? "command not found" : error.message;
			settle({
				code: null,
				output: tailText(output === "" ? detail : `${detail}\n${output}`),
				...error.code === "ENOENT" ? { missing: true } : {}
			});
		});
		child.on("close", (code) => {
			settle({
				code,
				output: tailText(output),
				...timedOut ? { timedOut: true } : {}
			});
		});
	});
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
/** How much of a request body this route accepts (a diagnostic never eats the socket). */
const MAX_BODY_BYTES$1 = 32 * 1024;
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
		const body = await readJsonBody(req, MAX_BODY_BYTES$1);
		const report = body === null ? void 0 : normalizeClientReport(body, now());
		if (report === void 0) {
			json(res, {
				ok: true,
				value: { stored: false }
			});
			return;
		}
		recordClientReport(report);
		json(res, {
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
var version = "1.3.38";
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
/** This package's own directory, resolved from where this module is running. */
const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 单条 registry 请求的上限。它不是「多久没答就换下一个」——那是 `HEDGE_AFTER_MS`。 */
const REGISTRY_TIMEOUT_MS = 8e3;
/**
* **这个路由里每一段网络/子进程的预算，都必须明显小于浏览器的预算。**
*
* 浏览器那一侧读这个接口的上限是 `fetchUpdateSource` 的 15 秒
* （`src/client/update-source.ts`）。host 这一侧若把某一段也设成 15 秒，
* 那一段只要走满就等于让整次读取**必然超支**：浏览器先放弃，于是屏上出现
* 「检查失败，请重试」——而 host 其实还在正常地干活。
*
* 这正是那个故障的成因（读者报的「有时能成、有时失败」）：一个 checkout 的
* `git ls-remote` 打的是 **github.com**，而它原先的上限正是 15 秒。github 可达时
* 它 1.4 秒返回、一切正常；被墙时它走满 15 秒、正好压死浏览器那一侧。所以「忽好忽坏」
* 不是随机，是**取决于那一刻 github 通不通**。
*
* 定 6 秒的理由：它给一次正常读留足余量（实测可达的 `ls-remote` 约 1.4 秒），
* 又留出 9 秒给同一请求里其余的段（`rev-parse`、`status`、registry 对冲）走完并
* 把 JSON 送回去。**改大它之前先看客户端那个 15 秒**——两者的关系是约束，不是巧合。
*/
const CHECK_STAGE_BUDGET_MS = 6e3;
/** 一次 `git rev-parse` / `status` 这种纯本地子进程的上限（它们不碰网络）。 */
const GIT_LOCAL_TIMEOUT_MS = 3e3;
/**
* 第一个源领先多久之后，第二个源也起跑。
*
* 这个数字是「按次序」与「不等死」之间的那条线，两侧各有实测依据：
*
*   - 公共 registry 正常一次应答 0.5–1.0 秒（这台机器实测 npmjs 999ms、npmmirror
*     561ms）。窗口定在它之下，才可能在第一条**挂住**时真正省下时间。
*   - 定得太小（比如 100ms）会把「按次序」变成「事实上并发」，第一条本来一秒内就
*     会答，却已经多发了第二条请求——那既浪费又不尊重次序。
*
* 800ms 落在两个实测值的低端：充足常请求领先，又不至于让一次挂住拖到用户察觉。
*/
const HEDGE_AFTER_MS = 800;
/** The package directory one profile installs this package into. */
function installedDirIn(profileDir) {
	return path.join(profileDir, "node_modules", ...PACKAGE_NAME.split("/"));
}
/**
* Build the pure update route processor: GET reads the source view, POST
* applies the plan that view describes.
* @param deps - the view and the applier (real or fake).
* @returns an HTTP handler for the update route.
*/
function createUpdateHandler(deps) {
	return async (req, res) => {
		if (req.method === "GET") {
			let view;
			try {
				view = await deps.read();
			} catch (error) {
				json(res, {
					ok: false,
					error: {
						code: "update",
						message: messageOf(error)
					}
				});
				return;
			}
			json(res, {
				ok: true,
				value: view
			});
			return;
		}
		if (req.method === "POST") {
			let result;
			try {
				result = await deps.apply();
			} catch (error) {
				json(res, {
					ok: false,
					error: {
						code: "update",
						message: messageOf(error)
					}
				});
				return;
			}
			json(res, {
				ok: true,
				value: result
			});
			return;
		}
		res.writeHead(405);
		res.end();
	};
}
/** `realpath`, or the input unchanged when it cannot be resolved. */
function realOf(target) {
	try {
		return fs.realpathSync(target);
	} catch {
		return target;
	}
}
/**
* Whether a profile's installed location for this package resolves to
* somewhere ELSE.
*
* A symlink test cannot answer this: pnpm links every package it installs,
* including a plain registry install (into the profile's own `.pnpm` store),
* so "is a link" would read a normal install as a checkout. Containment does
* answer it — a package manager's store lives inside the profile, and a
* `link:` target does not.
* @param profileDir - the profile directory.
* @param selfDir - this package's own resolved directory.
* @returns true when the copy lives outside the profile that declares it.
*/
function resolvesOutside(profileDir, selfDir) {
	const profile = realOf(profileDir);
	const rel = path.relative(profile, selfDir);
	return rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel));
}
/**
* The profile whose installed location IS this running copy, found by walking
* up from where the code actually is. Only a real (non-linked) install is found
* this way: a linked copy lives in its checkout, and the link that points at it
* lives in a profile the checkout knows nothing about.
*
* The walk starts one level above the package root, so a checkout's own
* `node_modules` can never be mistaken for a profile holding it.
* @param selfDir - this package's own resolved directory.
* @returns the profile directory, or undefined when this is not a real install.
*/
function profileHolding(selfDir) {
	let current = selfDir;
	for (;;) {
		const parent = path.dirname(current);
		if (parent === current) return void 0;
		if (realOf(installedDirIn(parent)) === selfDir) return parent;
		current = parent;
	}
}
/**
* Read which profile is running. The copy's own LOCATION decides; the host's
* declaration corroborates it and supplies facts only the host knows (whether
* a packaged application owns the profile).
*
* The launcher's `DSH_PROFILE_DIR` is deliberately not consulted. It is
* exported into every model shell call rather than into this process, so
* reading it would let an ambient variable decide which copy is running — the
* same failure as naming a profile in code, with a less obvious cause.
* @param ctx - context carrying the host services.
* @param selfDir - where this copy's code actually is (the measured fact).
* @returns the profile directory, its name, the owner, and the evidence.
*/
function readProfile(ctx, selfDir) {
	const declared = ctx.get("profileContext");
	const declaredDir = typeof declared?.dir === "string" && declared.dir !== "" ? declared.dir : void 0;
	const declaredHoldsSelf = declaredDir !== void 0 && realOf(installedDirIn(declaredDir)) === selfDir;
	const dir = (declaredHoldsSelf ? declaredDir : profileHolding(selfDir)) ?? declaredDir;
	const declaredName = typeof declared?.name === "string" && declared.name !== "" ? declared.name : void 0;
	const name = (declaredHoldsSelf ? declaredName : void 0) ?? (dir !== void 0 ? path.basename(dir) : void 0);
	return {
		...dir !== void 0 ? { dir } : {},
		...name !== void 0 && name !== "" ? { profile: name } : {},
		appManaged: declared?.packageManager !== void 0,
		evidence: {
			linked: dir === void 0 || resolvesOutside(dir, selfDir),
			declared: declaredDir !== void 0,
			disagreement: declaredDir !== void 0 && !declaredHoldsSelf
		}
	};
}
/**
* Read this plugin's raw dependency spec from one profile manifest.
* @param dir - the profile directory.
* @returns the spec string, or undefined when the manifest is unreadable.
*/
function readProfileSpec(dir) {
	if (dir === void 0) return void 0;
	try {
		const spec = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).dependencies?.[PACKAGE_NAME];
		return typeof spec === "string" && spec !== "" ? spec : void 0;
	} catch {
		return;
	}
}
/**
* The version of this package as it exists on disk under `dir`: the installed
* copy inside a profile, or the manifest of a checkout. Read after an update to
* report what landed, rather than what an update claimed to do.
* @param dir - a profile directory or a checkout directory.
* @returns the version, or undefined when neither shape is readable.
*/
function installedVersionIn(dir) {
	if (dir === void 0) return void 0;
	const candidates = [path.join(dir, "node_modules", ...PACKAGE_NAME.split("/"), "package.json"), path.join(dir, "package.json")];
	for (const candidate of candidates) try {
		const manifest = JSON.parse(fs.readFileSync(candidate, "utf8"));
		if (typeof manifest.version === "string" && manifest.version !== "") return manifest.version;
	} catch {}
}
/**
* Run one read-only git command; `undefined` on any failure (git may be absent).
*
* **异步，不是 `execFileSync`。** 两条理由，都不是风格问题：
*
*   1. **同步子进程会阻塞整个 host 事件循环。** 一次 `ls-remote` 挂住 6 秒，这 6 秒里
*      同一个进程要伺候的每一条别的请求（看板文档、SSE、会话状态）都停着。
*   2. **同步让「总预算」变成一个算不出来的数。** `boundedByBudget` 包一个同步调用
*      没有意义：它先跑完，才轮到计时器。于是整段的墙钟时间是两段相加，而不是两者的
*      较大值——那正好是这一版要修掉的缺陷的形状。
* @param repoDir - the checkout directory.
* @param args - the git arguments.
* @param timeoutMs - the bound; a hung command is the same as an absent one.
* @returns the trimmed stdout, or `undefined`.
*/
function gitOut(repoDir, args, timeoutMs) {
	return new Promise((resolve) => {
		execFile("git", args, {
			cwd: repoDir,
			timeout: timeoutMs,
			killSignal: "SIGKILL"
		}, (error, stdout) => {
			if (error !== null) {
				resolve(void 0);
				return;
			}
			const text = stdout.toString().trim();
			resolve(text === "" ? void 0 : text);
		});
	});
}
/**
* Read the local checkout state without mutating it: HEAD plus worktree
* dirtiness locally, the remote tip through {@link remoteHeadOf}. Any failure
* degrades to undefined — an unreadable checkout is not an error, it just hides
* the git section.
* @param repoDir - the `link:` target directory.
* @param slug - the `Owner/Repo` the checkout tracks, when it is known.
* @returns the git status, or undefined when unreadable.
*/
async function readGitStatus(repoDir, slug) {
	const head = await gitOut(repoDir, ["rev-parse", "HEAD"], GIT_LOCAL_TIMEOUT_MS);
	if (head === void 0 || head === "") return void 0;
	const porcelain = await gitOut(repoDir, ["status", "--porcelain"], GIT_LOCAL_TIMEOUT_MS) ?? "";
	const tip = await remoteHeadOf(repoDir, slug);
	return {
		head,
		...tip !== void 0 ? {
			remoteHead: tip.head,
			remoteVia: tip.via
		} : {},
		dirty: porcelain !== ""
	};
}
/** A git object id: hex, and long enough to be one. */
const SHA_SHAPE = /^[0-9a-f]{7,64}$/i;
/**
* THE REMOTE'S TIP, asked over a host that actually answers.
*
* **`git ls-remote` is the LAST resort here, not the first.** It speaks the git
* wire protocol to `github.com`, and that is the one GitHub host that is
* routinely blocked or throttled on mainland connections — measured on the same
* machine, same minute: `api.github.com` 200 in 725ms, `github.com` timed out
* (`git ls-remote` itself burned 21.3s before failing), `raw.githubusercontent
* .com` SSL reset. A checkout whose only question reaches `github.com` is
* therefore told 「判断不了」 on every click, for a reason that has nothing to do
* with whether a new commit exists.
*
* So the tip is asked in order of what actually answers:
*
*   1. **`api.github.com`** — `/repos/<owner>/<repo>/commits?per_page=1` is the
*      remote's own answer, and it is a different host from `github.com`. It
*      names the commit AND its dates, so 「落后」 can be dated.
*   2. **`git ls-remote`** — the clone's own protocol path. Still the authority
*      on refs (a fork whose HEAD moved tells us exactly that), and the only
*      path for a remote that is not GitHub at all. It is bounded tightly
*      because a blocked `github.com` fails slowly.
*   3. Nothing. Absent `remoteHead` is what tells the screen 「判断不了」 — it is
*      never rounded to 「已同步」.
*
* The branch name is detected, never assumed: step 1 reads the repository's own
* `default_branch`, so a `master`/`trunk` checkout is read as itself.
*
* @param repoDir - the `link:` target directory.
* @param slug - the `Owner/Repo` this checkout tracks, when it is known.
* @returns the remote tip, or undefined when no source could answer.
*/
async function remoteHeadOf(repoDir, slug) {
	const branch = branchOfSymbolicRef(await gitOut(repoDir, ["symbolic-ref", "refs/remotes/origin/HEAD"], GIT_LOCAL_TIMEOUT_MS));
	const [api, listed] = await Promise.all([tipFromApi(slug), gitOut(repoDir, [
		"ls-remote",
		"--symref",
		"origin",
		"HEAD"
	], CHECK_STAGE_BUDGET_MS)]);
	if (api !== void 0) return api;
	const advertised = remoteHeadFromAdvertisement(listed);
	if (advertised !== void 0) return {
		head: advertised,
		via: "git"
	};
	if (branch === void 0) return void 0;
	const byBranch = shaOfListing(await gitOut(repoDir, [
		"ls-remote",
		"origin",
		`refs/heads/${branch}`
	], CHECK_STAGE_BUDGET_MS));
	return byBranch === void 0 ? void 0 : {
		head: byBranch,
		via: "git"
	};
}
/**
* THE REMOTE'S TIP OUT OF `api.github.com`, which is the host that answers.
*
* One request, `per_page=1` on the default branch: GitHub answers with the newest
* commit of that branch, its sha, and the repository's own `default_branch` is
* read from the same family of endpoints. The body is deliberately small — the
* whole point of this step is that it is a single JSON read over a host measured
* at 725ms, not a pack negotiation.
*
* An unauthenticated reader is rate-limited to 60 requests/hour, which is far
* more than a manual 「检查更新」 can spend, and a rate-limited answer is
* `undefined` — the same shape as an unreachable one, so the next step gets its
* turn rather than the click turning into an error.
*
* @param slug - the `Owner/Repo` this checkout tracks.
* @returns the tip, or undefined when this host could not say.
*/
async function tipFromApi(slug) {
	if (slug === void 0 || slug === "") return void 0;
	const document = await boundedJson(`https://api.github.com/repos/${slug}/commits?per_page=1`, CHECK_STAGE_BUDGET_MS, { accept: "application/vnd.github+json" });
	if (!Array.isArray(document) || document.length === 0) return void 0;
	const first = document[0];
	if (typeof first !== "object" || first === null) return void 0;
	const sha = first.sha;
	return typeof sha === "string" && SHA_SHAPE.test(sha) ? {
		head: sha,
		via: "api"
	} : void 0;
}
/**
* The sha out of `ls-remote --symref origin HEAD`.
*
* The listing is two lines: the ref HEAD points at, and the sha it points at.
* **A listing with no `refs/heads/` symref is not an answer** — the remote
* does not say what its default branch is, and the sha on its own would be the
* sha of whatever HEAD happens to be, which is not a branch tip.
* @param listing - the command's output.
* @returns the sha, or undefined when the remote said nothing usable.
*/
function remoteHeadFromAdvertisement(listing) {
	if (listing === void 0) return void 0;
	const lines = listing.split("\n").map((line) => line.trim()).filter((line) => line !== "");
	if (!lines.some((line) => line.startsWith("ref: refs/heads/"))) return void 0;
	for (const line of lines) {
		if (line.startsWith("ref: ")) continue;
		const digest = line.split(/\s/)[0];
		if (SHA_SHAPE.test(digest)) return digest;
	}
}
/**
* The branch name out of `symbolic-ref refs/remotes/origin/HEAD`.
* @param ref - the command's output.
* @returns the branch name, or undefined when the clone does not know one.
*/
function branchOfSymbolicRef(ref) {
	if (ref === void 0) return void 0;
	const at = /^refs\/remotes\/origin\/(.+)$/.exec(ref.trim());
	return at === null ? void 0 : at[1];
}
/**
* The sha out of `ls-remote origin refs/heads/<branch>`.
* @param listing - the command's output.
* @returns the sha, or undefined when the branch is not there.
*/
function shaOfListing(listing) {
	if (listing === void 0) return void 0;
	const digest = listing.trim().split(/\s/)[0];
	return SHA_SHAPE.test(digest) ? digest : void 0;
}
/**
* The package manager a checkout declares. Its own `packageManager` field wins;
* otherwise the lockfile it ships with decides, and a checkout with none of the
* markers is read as npm — the manager every Node installation already has.
* @param dir - the checkout directory.
* @returns the command name to run the build with.
*/
function declaredManager(dir) {
	let field;
	try {
		field = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).packageManager;
	} catch {
		field = void 0;
	}
	const named = typeof field === "string" ? field.match(/^(pnpm|npm|yarn|bun)@/)?.[1] : void 0;
	if (named !== void 0) return named;
	const has = (file) => fs.existsSync(path.join(dir, file));
	if (has("pnpm-lock.yaml") || has("pnpm-workspace.yaml")) return "pnpm";
	if (has("yarn.lock")) return "yarn";
	if (has("bun.lockb") || has("bun.lock")) return "bun";
	return "npm";
}
/**
* What refreshing a `link:` checkout runs: bring the working tree up to its
* remote without creating a merge commit, then rebuild the `lib/` the host
* loads. `--ff-only` is the point — a diverged checkout stops and says so
* instead of merging two histories under a running plugin.
* @param dir - the checkout directory.
* @returns the steps, in order.
*/
function checkoutStepsFor(dir) {
	return [{
		command: "git",
		args: ["pull", "--ff-only"]
	}, {
		command: declaredManager(dir),
		args: ["run", "build"]
	}];
}
/**
* Gather the facts every update surface needs, from THIS process. Nothing here
* assumes a profile name: the profile comes from where this copy runs, and the
* spec comes from that profile's own manifest.
* @param ctx - context carrying the host services.
* @param selfDir - where this copy's code actually is; the real location by
* default, and an explicit premise wherever a caller must state one.
* @returns the running copy's identity and plan.
*/
function runningCopyOf(ctx, selfDir = SELF_ROOT) {
	const profile = readProfile(ctx, selfDir);
	const spec = readProfileSpec(profile.dir);
	const linked = profile.evidence.linked;
	const mode = linked ? "local" : classifyInstallSpec(spec);
	const checkoutDir = linked ? selfDir : void 0;
	const facts = {
		mode,
		...profile.profile !== void 0 ? { profile: profile.profile } : {},
		appManaged: profile.appManaged,
		...checkoutDir !== void 0 ? {
			checkoutDir,
			checkoutSteps: checkoutStepsFor(checkoutDir)
		} : {},
		canInstall: ctx.get("pluginManager") !== void 0,
		reinstall: ctx.get("hmr") !== void 0
	};
	const plan = updatePlanFor({
		mode: facts.mode,
		packageName: PACKAGE_NAME,
		...GITHUB_SPEC !== void 0 ? { githubSpec: GITHUB_SPEC } : {},
		...spec !== void 0 ? { recordedSpec: spec } : {},
		...facts.profile !== void 0 ? { profile: facts.profile } : {},
		appManaged: facts.appManaged,
		canInstall: facts.canInstall,
		reinstall: facts.reinstall,
		...facts.checkoutSteps !== void 0 ? { checkoutSteps: facts.checkoutSteps } : {}
	});
	return {
		...profile.dir !== void 0 ? { dir: profile.dir } : {},
		...profile.profile !== void 0 ? { profile: profile.profile } : {},
		appManaged: profile.appManaged,
		...spec !== void 0 ? { spec } : {},
		mode,
		evidence: profile.evidence,
		...checkoutDir !== void 0 ? { checkoutDir } : {},
		plan
	};
}
/**
* The registries to ask for the plan an installation service reported.
*
* Pure, and separate from the service call that produces the plan, because the
* ORDER is the part with a rule in it: the profile's own plan first (it knows
* the mirrors, private sources, proxies and credentials this installation
* really uses), then the public pair.
*
* **The order is a priority, not a walk.** `registriesFor` splits this list into
* "the reader's own sources" and the rest, and asks ONLY the own sources when
* there are any: a user-configured mirror is the only source asked, because
* asking the public mirrors would tell them "this machine looks up this package".
* The public entries below are a fallback for a profile that configured nothing,
* not a second opinion for one that did. Reading this order as "a private source
* that misses falls through to the public one" is exactly the reading the privacy
* rule forbids — see `registriesFor`.
*
* @param plan - the service's plan, or undefined when it reported none.
* @returns the registry base URLs, in priority order, without repeats.
*/
function registryOrderOf(plan) {
	const ordered = [];
	const add = (value) => {
		if (typeof value === "string" && value !== "" && !ordered.includes(value)) ordered.push(value);
	};
	add(plan?.resolved);
	add(plan?.registry);
	if (Array.isArray(plan?.fallbackRegistries)) for (const item of plan.fallbackRegistries) add(item);
	for (const item of PUBLIC_REGISTRIES) add(item);
	return ordered;
}
/**
* 一个 registry 地址的**身份**：比较时只看这个，不看它写成什么样。
*
* 为什么要归一化再比：`PUBLIC_REGISTRIES` 里的两个值是常量（带结尾斜杠），而
* `order` 里的值来自宿主安装服务。两者**今天**恰好一字不差（DSH 的
* `normalizeRegistry` 会小写主机名并补上斜杠），但那是宿主的实现细节，不是契约。
* 一旦某个来源给出 `https://registry.npmjs.org`（少一个斜杠），精确比较就会把
* **公共源判成「用户自己的源」**——于是这次读取只问 npmjs、不问 npmmirror，
* 而镜像回退正是「墙内也能用」的全部理由。
*
* 所以判据是身份：小写、去结尾斜杠。这样写法的差异不再能改变「谁算公共源」。
* @param url - 一个 registry 地址。
* @returns 用于比较的规范形式。
*/
function registryIdentityOf(url) {
	return url.trim().toLowerCase().replace(/\/+$/, "");
}
/** 公共源的规范形式，算一次。 */
const PUBLIC_IDENTITIES = new Set(PUBLIC_REGISTRIES.map((one) => registryIdentityOf(one)));
/**
* The registries to ask for this host, from its installation service when it has
* one and from the public pair when it does not.
*
* 返回值分成两半，因为**两半的性质不同**：`own` 是这台机器自己配的源（镜像、内网
* registry），`order` 是完整的询问次序（`own` 之后接公共回退）。
*
* 为什么必须分开：`order` 永远至少有两个公共源，所以「数组长度」说明不了「用户有
* 没有配自己的源」。而这件事决定两件不同的事——配了自己的源就**只问它**（那是隐私
* 与正确性），没配才**并发问公共源**（那才是性能）。用一个数字同时表达两件事，
* 就会在某一头上错。
*
* @param ctx - context carrying the host services.
* @returns `own`（用户配置的源，可能为空）与 `order`（完整询问次序）。
*/
async function registriesFor(ctx) {
	const manager = ctx.get("pluginManager");
	let plan;
	try {
		plan = await manager?.registries?.();
	} catch {
		plan = void 0;
	}
	const order = registryOrderOf(plan);
	return {
		own: order.filter((url) => !PUBLIC_IDENTITIES.has(registryIdentityOf(url))),
		order
	};
}
/**
* **给一整段工作一个总额，而不是给它内部的每一步各定一个上限。**
*
* `boundedJson` 管的是「一次请求多久放弃」。它是必要的，但不够：几个各自合规的
* 上限加起来可以超出一次读取的总预算，而超出的那部分表现为**浏览器先放弃**——
* 屏上说「检查失败」，host 却还在正常地一段一段往下走。
*
* 所以有两种边界，各管一件事：
*
*   · `boundedJson(url, timeoutMs)` —— 一次请求的上限（这一段多久没答就当作没有）。
*   · `boundedByBudget(work, ms)`   —— 一件事的上限（整体多久没成就算了，用已有的收场）。
*
* 后者不 abort 那个 Promise（它与网络无关，可能是一串子进程），只是**不再等它**。
* 那是对的：读者要的是「这一次检查的答案」，不是那个后台操作必须被取消。它自己的
* 分段上限保证它不会永远挂着。
* @param work - 要等的那件事。
* @param ms - 等它多久。
* @returns 它的结果，或超时后的 `undefined`。
*/
function boundedByBudget(work, ms) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			resolve(void 0);
		}, ms);
		work.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, () => {
			clearTimeout(timer);
			resolve(void 0);
		});
	});
}
/**
* Read one JSON document with a hard bound; any failure reads as undefined.
*
* @param url - the document to read.
* @param timeoutMs - the bound; a hung endpoint is the same as an absent one.
* @param headers - extra request headers. GitHub's contents API answers with the
*   file body itself only when asked for `application/vnd.github.raw`; without
*   it the same URL returns a base64 envelope instead.
*/
async function boundedJson(url, timeoutMs, headers) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, timeoutMs);
	try {
		const response = await fetch(url, {
			headers: {
				accept: "application/json",
				...headers
			},
			signal: controller.signal
		});
		if (!response.ok) return void 0;
		return await response.json();
	} catch {
		return;
	} finally {
		clearTimeout(timer);
	}
}
/** The raw-content base for a `github:Owner/Repo` spec. */
function rawBaseOf(spec) {
	if (spec === void 0 || !spec.startsWith("github:")) return void 0;
	const slug = spec.slice(7);
	return slug === "" ? void 0 : `https://raw.githubusercontent.com/${slug}`;
}
/**
* The `Owner/Repo` this package is published from, for the endpoints that take
* a slug instead of a URL. Derived from the same `repository` fact the
* `github:` spec comes from, so the two can never disagree about which
* repository is being asked about.
* @returns the slug, or undefined when this package does not name a GitHub repo.
*/
function repositorySlug() {
	return GITHUB_SPEC !== void 0 && GITHUB_SPEC.startsWith("github:") ? GITHUB_SPEC.slice(7) || void 0 : void 0;
}
/**
* 按次序起跑、带领先窗口的**对冲请求**：第一个成功答案胜出。
*
* ── 为什么这不是 `Promise.race`，也不是 `for … await` ──────────────────────
*
* 这两种写法在这个项目里都真出现过，各自错在不同的地方：
*
*   `for … await`（串行）：第一条挂住要等满它的超时才试第二条。实测两个 registry
*     各自 0.5–1.0 秒可达，而接口要 2.3–4.0 秒——差额就是这段空等，而它每一天都
*     在被等。
*
*   `Promise.race`（无序并发）：「第一个完成的」不等于「第一个成功的」。连接被拒
*     往往比正常返回**更快**，于是明明有一条能答的来源，却被拒连的那条抢先，正确答案
*     被丢掉。那会把「有更新」说成「读不到」。
*
* 对冲请求的形状是：按次序起跑，给前一条 `hedgeMs` 的领先窗口；窗口内它答了就结束
* （次序被时间保证），窗口过后把下一条也发出去，之后第一个**成功**的胜出。
*
* ── 一条候选只许启动一次 ────────────────────────────────────────────────────
*
* 有**两条**路会把控制权推进到下一条：前一条**失败**时立刻推进（不等窗口——那 800ms
* 是给「慢」的源留的，不该被「坏」的源白占），以及窗口到点时放行。两条路都会到同一条
* 候选上，所以必须**在启动处去重**，而不是指望两条路互斥。
*
* 不去重的后果不是多一个请求，是**丢掉一个已经到手的答案**：重复的那条若先失败，而
* 原来那条还在飞，`finished >= candidates.length` 就把整次读取定成 `undefined`——
* 一个本来会作答的源被报成「读不到」，屏上就是「检查失败，请重试」。触发条件是「前
* 一条在窗口内失败」（连接被拒通常就是几十毫秒）加上「后一条慢或抖」。
*
* @param candidates - 候选，按优先级从高到低。
* @param hedgeMs - 领先窗口；超过它仍未答就放行下一条。
* @param timeoutMs - 单条的上限，由 `ask` 自己带。
* @returns 第一个可用答案；全部没有则 `undefined`。
*/
function hedgeFor(candidates, hedgeMs, timeoutMs) {
	return new Promise((resolve) => {
		let settled = false;
		let finished = 0;
		const timers = [];
		const launched = /* @__PURE__ */ new Set();
		const done = (value) => {
			if (settled) return;
			settled = true;
			for (const timer of timers) clearTimeout(timer);
			resolve(value);
		};
		if (candidates.length === 0) {
			done(void 0);
			return;
		}
		const launch = (index) => {
			if (settled || index >= candidates.length) return;
			if (launched.has(index)) return;
			launched.add(index);
			const candidate = candidates[index];
			const settleOne = () => {
				finished += 1;
				launch(index + 1);
				if (finished >= candidates.length) done(void 0);
			};
			boundedJson(packumentUrl(candidate, PACKAGE_NAME), timeoutMs).then((document) => {
				const answer = latestFromPackument(document);
				if (answer !== void 0) {
					done({
						...answer,
						registry: candidate,
						source: "registry"
					});
					return;
				}
				settleOne();
			}, () => {
				settleOne();
			});
			if (index + 1 < candidates.length) timers.push(setTimeout(() => {
				launch(index + 1);
			}, hedgeMs));
		};
		launch(0);
	});
}
/**
* The newest upstream for this copy, as this host can read it.
*
* A registry install asks the profile's own registries first and the public pair
* only when the profile configured none (see `registriesFor`); within one tier the
* candidates are **hedged**, not serial — the next one starts after
* `HEDGE_AFTER_MS`, and the first *successful* answer wins.
*
* A repository install reads the version the default branch declares. It does
* **not** read the commit that branch is on: this view answers "what version is
* upstream", and a commit SHA in the same field would be a different question
* wearing the same shape.
*
* A checkout is compared by its own git state instead (see
* {@link readGitStatus}), so it has nothing to read here.
*
* Anything unreadable is reported as absent. That is the whole contract: the
* page renders absence as "cannot tell", and a check that cannot tell must
* never be dressed up as "already newest".
* @param ctx - context carrying the host services.
* @param _copy - the running copy. Its mode no longer selects an answer path —
*   every install mode asks the same question ("what is published upstream?"),
*   so there is one transport ladder. The parameter stays because the callers
*   are other people's code (AGENTS.md 13); the ROUTE decides what to show.
* @returns the newest upstream, or undefined when it could not be read.
*/
async function readLatest(ctx, _copy) {
	/**
	* 同时问所有候选源，取第一个给出**可用答案**的。
	*
	* 为什么不是 `Promise.race`：`race` 等的是「第一个 settle 的」，而第一个完成的
	* 完全可能是**失败**——连接被拒往往比正常返回还快。要的是第一个**成功**，所以逐个
	* settle，成功即返回。
	*
	* 为什么不是串行的 `for`：串行时每一层都可能吃满自己的超时，最坏 8 秒 × N 层，而
	* 那些时间几乎全花在等一个注定不可用的地址上。实测：两个 registry 各自 0.5–1.0 秒
	* 可达，接口却要 2.3–4.0 秒——差的正是「等前一个失败」。
	*
	* 权威次序没有因此改变：并发的只是**查询**，取舍仍然按此前的判断（registry 优先于
	* 仓库文件这件事由 `readLatest` 的分层决定，不由这里的快慢决定）。
	*
	* @param probes - 候选项；`ask` 返回 `undefined` 表示这一源没有可用答案。
	* @returns 第一个可用答案；全部没有则 `undefined`。
	*/
	const raceFor = async (probes) => await new Promise((resolve) => {
		let pending = probes.length;
		if (pending === 0) {
			resolve(void 0);
			return;
		}
		for (const probe of probes) probe.ask().then((answer) => {
			if (answer !== void 0) {
				resolve(answer);
				return;
			}
			pending -= 1;
			if (pending === 0) resolve(void 0);
		}, () => {
			pending -= 1;
			if (pending === 0) resolve(void 0);
		});
	});
	const fromRegistries = async () => {
		const { own, order } = await registriesFor(ctx);
		const candidates = own.length > 0 ? own : order;
		if (candidates.length === 1) {
			const only = candidates[0];
			const answer = latestFromPackument(await boundedJson(packumentUrl(only, PACKAGE_NAME), REGISTRY_TIMEOUT_MS));
			return answer === void 0 ? void 0 : {
				...answer,
				registry: only,
				source: "registry"
			};
		}
		return await hedgeFor(candidates, HEDGE_AFTER_MS, REGISTRY_TIMEOUT_MS);
	};
	const fromRepository = async () => {
		const slug = GITHUB_SPEC !== void 0 && GITHUB_SPEC.startsWith("github:") ? GITHUB_SPEC.slice(7) : void 0;
		if (slug === void 0 || slug === "") return void 0;
		const base = rawBaseOf(GITHUB_SPEC);
		const versionOf = (document) => {
			const version = document?.version;
			return typeof version === "string" && version !== "" ? version : void 0;
		};
		const probes = [{ ask: async () => {
			const viaApi = await boundedJson(`https://api.github.com/repos/${slug}/contents/package.json`, REGISTRY_TIMEOUT_MS, { accept: "application/vnd.github.raw" });
			const version = versionOf(viaApi);
			return version === void 0 ? void 0 : {
				version,
				source: "repository"
			};
		} }];
		if (base !== void 0) probes.push({ ask: async () => {
			const manifest = await boundedJson(`${base}/HEAD/package.json`, REGISTRY_TIMEOUT_MS);
			const version = versionOf(manifest);
			return version === void 0 ? void 0 : {
				version,
				source: "repository"
			};
		} });
		return await raceFor(probes);
	};
	const published = await fromRegistries();
	if (published !== void 0) return published;
	return await fromRepository();
}
/**
* **一次读取的总上限。** 它小于浏览器的 15 秒预算，理由与 `CHECK_STAGE_BUDGET_MS`
* 同一件：浏览器先放弃，屏上就是「检查失败」，而 host 还在正常干活。
*
* 为什么需要「总额」而不是只把每一段压小：`readLatest` 内部是**有层次**的——registry
* 整体（最坏 800 + 8000 = 8.8 秒）答不上来才问仓库（最坏 8000 秒，两条探针并发）。
* 逐段看每一段都「小于 15 秒」，加起来却是 16.8 秒。**每一段都合规而整体超支**，正是
* 这类 bug 的形状：没有任何一个数字是错的，错的是它们的和，而和不写在任何一个地方。
*
* 所以这里量的是整次读取的时间，超了就带着已经读到的部分收场（`latest` 缺席），
* 界面据此说「读不到」——那比让浏览器先放弃、把整次检查画成失败要好。
*/
const CHECK_TOTAL_BUDGET_MS = 11e3;
/**
* Build the live view: the running copy's own location and manifest spec, the
* newest upstream this host can read for that mode, and the checkout state for
* a linked copy.
* @param ctx - context carrying the host services.
* @returns the update-source view.
*/
async function readLiveView(ctx) {
	const copy = runningCopyOf(ctx);
	const gitWork = copy.checkoutDir !== void 0 ? boundedByBudget(readGitStatus(copy.checkoutDir, repositorySlug()), CHECK_TOTAL_BUDGET_MS) : Promise.resolve(void 0);
	const latestWork = boundedByBudget(readLatest(ctx, copy), CHECK_TOTAL_BUDGET_MS);
	const [git, latest] = await Promise.all([gitWork, latestWork]);
	const clients = readClientReports();
	return {
		packageName: PACKAGE_NAME,
		version: PACKAGE_VERSION,
		...copy.spec !== void 0 ? { spec: copy.spec } : {},
		mode: copy.mode,
		...copy.profile !== void 0 ? { profile: copy.profile } : {},
		...copy.dir !== void 0 ? { dir: copy.dir } : {},
		appManaged: copy.appManaged,
		evidence: copy.evidence,
		...GITHUB_SPEC !== void 0 ? { githubSpec: GITHUB_SPEC } : {},
		plan: copy.plan,
		...latest !== void 0 ? { latest } : {},
		...git !== void 0 ? { git } : {},
		...clients.length > 0 ? { clients } : {}
	};
}
/**
* Apply the running copy's own plan. The request body is never read: the plan
* is re-derived here, so a page cannot ask this route to install anything the
* copy is not already declared to be.
*
* The version is read back from disk afterwards rather than taken from the
* answer: on an HMR host this update uninstalls the plugin that is serving this
* very request, so the answer may never arrive, and only the file on disk says
* what actually landed.
* @param ctx - context carrying the host services.
* @returns the apply result.
*/
async function applyRunningCopy(ctx) {
	const copy = runningCopyOf(ctx);
	const installer = ctx.get("pluginManager");
	const target = copy.plan.apply === "checkout" ? copy.checkoutDir : copy.dir;
	const status = copy.checkoutDir !== void 0 ? await readGitStatus(copy.checkoutDir) : void 0;
	return await applyUpdate({
		plan: copy.plan,
		...installer !== void 0 ? { installer } : {},
		runner: spawnStep,
		...copy.checkoutDir !== void 0 ? { checkout: {
			dir: copy.checkoutDir,
			dirty: status?.dirty === true
		} } : {},
		readVersion: () => installedVersionIn(target)
	});
}
/**
* Register the update route on the host web server: GET reads the view, POST
* applies the plan.
* @param ctx - context carrying the webServer service.
* @param ns - the plugin namespace (route path prefix).
* @returns the route disposer, or a no-op when the web server is absent.
*/
function registerUpdateRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	const handler = createUpdateHandler({
		read: () => readLiveView(ctx),
		apply: () => applyRunningCopy(ctx)
	});
	return webServer.register({
		kind: "exact",
		path: `/api/${ns}/update`,
		handler
	});
}
//#endregion
//#region src/host/attachment-route.ts
/** How much of a request body this route accepts (base64 expands by 4/3). */
const MAX_BODY_BYTES = 40 * 1024 * 1024;
/** How much of one stored attachment a read may return. */
const MAX_READ_BYTES = 32 * 1024 * 1024;
/** Read one JSON request body, answering the right status for each failure. */
async function readBody(req, res) {
	const outcome = await readJsonBodyDetailed(req, MAX_BODY_BYTES);
	if (outcome.ok) return outcome.value;
	const status = outcome.reason === "oversize" ? 413 : 400;
	json(res, {
		ok: false,
		error: {
			code: outcome.reason,
			message: outcome.reason
		}
	}, status);
}
/** Decode canonical base64 into bytes, or undefined when it is not base64. */
function bytesOf(data) {
	if (data === "" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return void 0;
	const bytes = Buffer.from(data, "base64");
	return bytes.length === 0 ? void 0 : new Uint8Array(bytes);
}
/** Base64 of raw bytes (canonical, no data-URL prefix). */
function base64Of(bytes) {
	return Buffer.from(bytes).toString("base64");
}
/**
* Admit one attachment: images through the store's image lane (which
* normalizes and verifies the raster), everything else byte-for-byte.
* @param store - the attachment store.
* @param input - the declared name, optional media type and base64 bytes.
* @returns the durable reference, or a stable refusal code.
*/
async function admit(store, input) {
	const bytes = bytesOf(input.data);
	if (bytes === void 0) return {
		ok: false,
		code: "bad-bytes",
		message: "the payload is not canonical base64"
	};
	if (input.mediaType !== void 0) {
		const limits = store.imageLimits;
		const allowed = limits?.mediaTypes;
		if (allowed !== void 0 && !allowed.includes(input.mediaType)) return {
			ok: false,
			code: "image-type",
			message: `the store does not accept ${input.mediaType}`
		};
		const maxImageBytes = limits?.maxImageBytes;
		if (maxImageBytes !== void 0 && bytes.length > maxImageBytes) return {
			ok: false,
			code: "oversize",
			message: `an image may be at most ${String(maxImageBytes)} bytes here`
		};
		try {
			const saved = await store.saveImage({
				data: bytes,
				mediaType: input.mediaType,
				name: input.name
			});
			return {
				ok: true,
				ref: {
					attachmentId: saved.attachmentId,
					name: typeof saved.name === "string" && saved.name !== "" ? saved.name : input.name,
					bytes: saved.bytes,
					mediaType: saved.mediaType,
					width: saved.width,
					height: saved.height
				}
			};
		} catch (error) {
			return {
				ok: false,
				code: "image-refused",
				message: messageOf(error)
			};
		}
	}
	try {
		const saved = await store.admitEncodedFile({
			data: input.data,
			name: input.name
		});
		return {
			ok: true,
			ref: {
				attachmentId: saved.attachmentId,
				name: saved.name,
				bytes: saved.bytes
			}
		};
	} catch (error) {
		return {
			ok: false,
			code: "file-refused",
			message: messageOf(error)
		};
	}
}
/**
* Read one stored attachment back as base64 (images) or exact bytes (files).
*
* The reference goes to the store WHOLE (see `core/attachment`): the store's
* image read verifies the bytes against the reference's own media type, byte
* length and intrinsic size, so a field this route failed to forward would make
* a perfectly good attachment unreadable — and the store would report it as
* corruption, which is a sentence about the STORE that the reader cannot act on.
*
* An image reference that carries no intrinsic size cannot be verified at all,
* and that is a fact about THIS record, not about the bytes: it is answered
* before the store is called, because every other answer it could get here would
* be a lie about corruption.
* @param store - the attachment store.
* @param ref - the reference a document holds.
* @returns the bytes as base64, or the reason it could not be read.
*/
async function readStored(store, ref) {
	try {
		if (ref.mediaType !== void 0) {
			if (typeof ref.width !== "number" || typeof ref.height !== "number") return {
				ok: false,
				code: "incomplete-ref",
				message: "这一份附件是旧版本上传的，缺它的尺寸信息——重新拖一次就能发"
			};
			const stored = await store.readImage(ref);
			return {
				ok: true,
				value: {
					name: ref.name,
					mediaType: stored.ref.mediaType,
					bytes: stored.data.length,
					data: base64Of(stored.data)
				}
			};
		}
		const chunks = [];
		let total = 0;
		for await (const chunk of store.readFileStream(ref)) {
			total += chunk.length;
			if (total > MAX_READ_BYTES) return {
				ok: false,
				code: "oversize",
				message: "the stored file is larger than this route returns"
			};
			chunks.push(chunk);
		}
		const joined = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
		return {
			ok: true,
			value: {
				name: ref.name,
				bytes: joined.length,
				data: joined.toString("base64")
			}
		};
	} catch (error) {
		return {
			ok: false,
			code: "unreadable",
			message: messageOf(error)
		};
	}
}
/**
* Whether a value names a stored attachment: the three fields every age of a
* reference has, and nothing more. This is the gate that says "this is a
* reference at all" — NOT a field table, and not a claim that the reference is
* complete. Which fields a read needs is decided where the read happens (the
* image lane checks its own size fields), so adding a requirement here would
* turn every lane-specific refusal into one shapeless "not a reference".
*/
function isRefLike(value) {
	if (typeof value !== "object" || value === null) return false;
	const ref = value;
	return stringOf(ref.attachmentId) !== void 0 && typeof ref.name === "string" && typeof ref.bytes === "number";
}
/**
* Build the pure attachment route processor (unit-testable with a fake store).
* @param deps - the store face.
* @returns an HTTP handler for the two attachment paths.
*/
function createAttachmentHandler(deps) {
	const missing = (res) => {
		json(res, {
			ok: false,
			error: {
				code: "no-store",
				message: "this host has no attachment store"
			}
		});
	};
	return async (req, res) => {
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		const reading = (req.url ?? "").includes("/attachments/read");
		const store = deps.store;
		if (store === void 0) {
			missing(res);
			return;
		}
		const body = await readBody(req, res);
		if (body === void 0) return;
		const row = body;
		if (reading) {
			const ref = row.ref;
			if (!isRefLike(ref)) {
				json(res, {
					ok: false,
					error: {
						code: "bad-ref",
						message: "a stored reference is required"
					}
				});
				return;
			}
			const outcome = await readStored(store, ref);
			json(res, outcome.ok ? {
				ok: true,
				value: outcome.value
			} : {
				ok: false,
				error: {
					code: outcome.code,
					message: outcome.message
				}
			});
			return;
		}
		const name = stringOf(row.name);
		const data = stringOf(row.data);
		if (name === void 0 || data === void 0) {
			json(res, {
				ok: false,
				error: {
					code: "bad-request",
					message: "a name and base64 bytes are required"
				}
			});
			return;
		}
		const outcome = await admit(store, {
			name,
			data,
			...stringOf(row.mediaType) !== void 0 ? { mediaType: row.mediaType } : {}
		});
		json(res, outcome.ok ? {
			ok: true,
			value: outcome.ref
		} : {
			ok: false,
			error: {
				code: outcome.code,
				message: outcome.message
			}
		});
	};
}
/**
* Register the attachment routes on the host web server.
* @param ctx - context carrying the webServer (and, when present, the store).
* @param ns - the plugin namespace (route path prefix).
* @returns the route disposers, or a no-op when the web server is absent.
*/
function registerAttachmentRoute(ctx, ns) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return () => void 0;
	const store = ctx.get("attachments");
	const handler = createAttachmentHandler(store === void 0 ? {} : { store });
	const disposers = [webServer.register({
		kind: "exact",
		path: `/api/${ns}/attachments`,
		handler
	}), webServer.register({
		kind: "exact",
		path: `/api/${ns}/attachments/read`,
		handler
	})];
	return () => {
		for (const dispose of disposers) dispose();
	};
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
	if (process.env.DSH_TASK_BOARD_DESIGN_PREVIEW === "1") markSurfaceActive("design");
	ctx.effect(() => registerPermissionRoute(ctx, "dsh-task-board"), "dsh-task-board: permissions route");
	ctx.effect(() => registerSessionStateRoute(ctx), "dsh-task-board: session-state route");
	ctx.effect(() => registerAttachmentRoute(ctx, "dsh-task-board"), "dsh-task-board: attachment route");
	ctx.effect(() => registerBoardRoute(ctx, "dsh-task-board"), "dsh-task-board: board route");
	ctx.effect(() => registerUpdateRoute(ctx, "dsh-task-board"), "dsh-task-board: update route");
	ctx.effect(() => registerClientReportRoute(ctx, "dsh-task-board"), "dsh-task-board: client report route");
}
//#endregion
export { apply, inject };
