/**
 * Shared HTTP transport for this plugin's host routes: read a JSON request
 * body with a bounded size, and write one JSON envelope.
 *
 * Both live here because every route uses the same wire discipline — one
 * envelope shape, one size cap, one content type — so no route can drift into
 * its own dialect. The readers are split from the handlers that use them so the
 * response logic stays unit-testable without a live server.
 *
 * THE ENVELOPE ITSELF lives in `core/http-envelope.ts`: it is a protocol the
 * browser half reads too, so it cannot live in the host half. This module is
 * only the transport — how a body comes in, how an envelope goes out.
 * @module dsh-task-board/host/http-json
 */

import type { IncomingMessage } from 'node:http'
import type { RouteEnvelope } from '../core/http-envelope.ts'

/**
 * The part of a response the writer needs.
 *
 * Structural on purpose: the real `ServerResponse` satisfies it, and so does a
 * test double — so ONE writer serves every route without any of them having
 * to take the whole node type, and without a route growing its own dialect.
 */
export interface JsonResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/**
 * Read a JSON request body into an unknown value; null when unparseable.
 * @param req - the incoming request stream.
 * @param maxBytes - size cap (beyond it the body is rejected as null). The
 *   board routes raise it for whole-document commits.
 * @returns the parsed body, or null.
 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number = 1 << 20): Promise<unknown> {
  const outcome = await readJsonBodyDetailed(req, maxBytes)
  return outcome.ok ? outcome.value : null
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
export async function readJsonBodyDetailed(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: 'oversize' | 'malformed' | 'empty' }> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    chunks.push(buffer)
    total += buffer.length
    if (total > maxBytes) return { ok: false, reason: 'oversize' }
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return { ok: false, reason: 'empty' }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, reason: 'malformed' }
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
export function json(res: JsonResponse, envelope: RouteEnvelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}
