#!/usr/bin/env node
/**
 * github-release.mjs — create or update a GitHub Release with its notes read
 * from a UTF-8 file.
 *
 * Why this exists: the release notes are Chinese, and creating them through a
 * shell one-liner is where that text gets destroyed. PowerShell's
 * `Invoke-WebRequest -Body <string>` encodes the body with the request's
 * charset, so a `application/json` body without an explicit charset turns every
 * non-ASCII character into "?"; hand-escaping to \uXXXX instead makes
 * `ConvertTo-Json` escape the backslashes and store the escape sequences as
 * literal text. Both failure modes ship silently — the API returns 2xx and the
 * mangled text is only visible on the release page. Reading the whole body from
 * a UTF-8 file and posting the raw bytes avoids the question entirely.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> node scripts/github-release.mjs <tag> <notes-file> [--repo owner/name]
 *
 * The token needs `contents: write` on the repository. Notes are read as UTF-8
 * and sent as UTF-8. An existing release for the tag is updated in place, so
 * re-running after editing the notes is safe.
 */
import { readFileSync } from 'node:fs'

const [tag, notesPath, ...rest] = process.argv.slice(2)
if (!tag || !notesPath) {
  console.error('usage: GITHUB_TOKEN=<token> node scripts/github-release.mjs <tag> <notes-file> [--repo owner/name]')
  process.exit(2)
}

const repoFlag = rest.indexOf('--repo')
const repo = repoFlag >= 0 ? rest[repoFlag + 1] : undefined
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
  console.error('missing or malformed --repo owner/name')
  process.exit(2)
}

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('GITHUB_TOKEN is not set')
  process.exit(2)
}

const notes = readFileSync(notesPath, 'utf8').replace(/\r\n/g, '\n').trim()
if (notes === '') {
  console.error(`${notesPath} is empty`)
  process.exit(2)
}

const api = `https://api.github.com/repos/${repo}/releases`
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-task-board-release',
  'content-type': 'application/json; charset=utf-8',
}

/**
 * One release payload as UTF-8 BYTES. Serializing here is what keeps the notes
 * out of a shell's reach (see the header): both the create and the update path
 * send the same form, and neither one builds a body at the call site.
 */
function payload(fields) {
  return Buffer.from(JSON.stringify(fields), 'utf8')
}

/**
 * Send one request. A non-2xx throws, so callers can treat "absent" as a normal
 * outcome (looking up a release that does not exist yet is expected on a first
 * publish); genuinely unexpected failures still surface with the API's message.
 */
async function call(url, init) {
  const response = await fetch(url, { ...init, headers })
  const text = await response.text()
  if (!response.ok) {
    const error = new Error(`GitHub API ${String(response.status)} for ${init?.method ?? 'GET'} ${url}`)
    error.status = response.status
    error.body = text.slice(0, 600)
    throw error
  }
  return text === '' ? {} : JSON.parse(text)
}

/** Look up a release by tag, treating "not found" as undefined. */
async function findRelease(tag) {
  try {
    return await call(`${api}/tags/${encodeURIComponent(tag)}`, { method: 'GET' })
  } catch (error) {
    if (error.status === 404) return undefined
    throw error
  }
}

try {
  const existing = await findRelease(tag)
  if (existing !== undefined && existing.id !== undefined) {
    const updated = await call(`${api}/${String(existing.id)}`, { method: 'PATCH', body: payload({ body: notes }) })
    console.log(`updated release ${String(updated.name)} (${String(updated.html_url)})`)
  } else {
    const created = await call(api, { method: 'POST', body: payload({ tag_name: tag, name: tag, body: notes, draft: false, prerelease: false }) })
    console.log(`created release ${String(created.name)} (${String(created.html_url)})`)
  }

  // Read the notes back and prove they survived the round trip.
  const check = await findRelease(tag)
  if (check?.body !== notes) {
    console.error('round-trip mismatch: the stored notes differ from the file')
    console.error(`stored ${String(check?.body?.length)} chars, file ${String(notes.length)} chars`)
    process.exit(1)
  }
  console.log(`notes verified: ${String(notes.length)} characters round-tripped intact`)
} catch (error) {
  console.error(error.message)
  if (error.body !== undefined) console.error(error.body)
  process.exit(1)
}
