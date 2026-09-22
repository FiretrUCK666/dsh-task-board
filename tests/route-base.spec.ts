/**
 * The browser route boundary (src/client/route-base.ts).
 *
 * The shell serves the GUI document with `<base href="./">`, so the browser
 * resolves a request URL against the deployment's mount root. Every client
 * route goes through `routeUrl`, which drops the leading slash: a
 * root-absolute path escapes a reverse-proxy subpath mount and lands on the
 * proxy, where the 404 is (by design) read as "host unreachable" and the board
 * silently keeps its localStorage mirror.
 *
 * The scan at the end is the gate — a reintroduced root-absolute route literal
 * anywhere under src/client fails the suite, with one allowance: the literal
 * spelled as the direct argument of `routeUrl`. The host half keeps its
 * absolute pathnames: `webServer.register` takes an absolute path there.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { routeUrl } from '../src/client/route-base.ts'

/** The plugin routes the client half addresses, spelled as the host registers them. */
const ROUTES = [
  '/api/dsh-task-board/board',
  '/api/dsh-task-board/board/lease',
  '/api/dsh-task-board/board/command',
  '/api/dsh-task-board/board/events',
  '/api/dsh-task-board/settings',
  '/api/dsh-task-board/permissions',
  '/api/dsh-task-board/client-report',
  '/api/dsh-task-board/update',
  '/api/dsh-task-board/session-state',
]

/** The two deployments that matter: served at the origin root, and behind a subpath. */
const ORIGIN_ROOT = 'http://127.0.0.1:3080/'
const SUBPATH_MOUNT = 'https://proxy.example.com/dsh/'

describe('routeUrl', () => {
  it('drops the leading slash so the browser resolves the route against the document base', () => {
    for (const route of ROUTES) {
      expect(routeUrl(route)).toBe(route.slice(1))
      expect(routeUrl(route).startsWith('/')).toBe(false)
    }
  })

  it('leaves an already document-relative path alone (idempotent)', () => {
    expect(routeUrl('api/dsh-task-board/board')).toBe('api/dsh-task-board/board')
    for (const route of ROUTES) expect(routeUrl(routeUrl(route))).toBe(routeUrl(route))
  })
})

describe('resolving a route in a real document', () => {
  it('an origin-root document resolves every route to the URL a root-absolute path would give', () => {
    for (const route of ROUTES) {
      const resolved = new URL(routeUrl(route), ORIGIN_ROOT).href
      expect(resolved).toBe(`${ORIGIN_ROOT}${route.slice(1)}`)
      // Byte-identical to resolving the route with its leading slash.
      expect(resolved).toBe(new URL(route, ORIGIN_ROOT).href)
    }
  })

  it('a subpath mount keeps every route inside the mount', () => {
    for (const route of ROUTES) {
      expect(new URL(routeUrl(route), SUBPATH_MOUNT).href).toBe(`${SUBPATH_MOUNT}${route.slice(1)}`)
    }
    // The falsifier: with its leading slash the same route resolves OUTSIDE the
    // mount, which is the request the proxy answers 404.
    expect(new URL(ROUTES[0]!, SUBPATH_MOUNT).href).toBe('https://proxy.example.com/api/dsh-task-board/board')
  })
})

/** Every TypeScript source file of the client half. */
function clientSourceFiles(): string[] {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
  return walk(fileURLToPath(new URL('../src/client', import.meta.url)))
}

/**
 * Blank out comments while keeping every line break, so indices into the
 * result still sit on their original line. Quotes are honoured, so a `//`
 * inside a string (a URL) is content, not a comment.
 */
function withoutComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]!
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n'
        i++
      }
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out += ch
      i++
      while (i < source.length) {
        const inner = source[i]!
        if (inner === '\\') {
          out += inner + (source[i + 1] ?? '')
          i += 2
          continue
        }
        out += inner
        i++
        if (inner === ch) break
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

/** 1-based line number of one index. */
function lineAt(code: string, index: number): number {
  return code.slice(0, index).split('\n').length
}

/** The source line starting at one index, trimmed short for a failure message. */
function snippetAt(code: string, index: number): string {
  const line = code.slice(index).split('\n')[0]!.trim()
  return line.length > 72 ? `${line.slice(0, 69)}...` : line
}

/** The client half's source, de-commented, keyed by repo-relative path. */
function clientCode(): Array<{ file: string; code: string }> {
  const root = fileURLToPath(new URL('..', import.meta.url))
  return clientSourceFiles().map(file => ({
    file: relative(root, file),
    code: withoutComments(readFileSync(file, 'utf8')),
  }))
}

/** A request URL that starts at the origin root — the form a subpath mount loses. */
const ROOT_ABSOLUTE_REQUEST = /\b(?:fetch|fetchImpl|boundedJson|Source|EventSource)\s*\(\s*[`'"]\//g

/** A route literal as the host registers it (leading slash). */
const ROOT_ABSOLUTE_ROUTE = /[`'"]\/api\//g

describe('the client half (source scan)', () => {
  it('never issues a root-absolute request URL', () => {
    const offenders: string[] = []
    for (const { file, code } of clientCode()) {
      for (const match of code.matchAll(ROOT_ABSOLUTE_REQUEST)) {
        offenders.push(`${file}:${lineAt(code, match.index)}: ${snippetAt(code, match.index)}`)
      }
    }
    expect(offenders, 'a root-absolute request URL leaves the deployment mount — wrap the path in routeUrl()').toEqual([])
  })

  it('routes every /api/... literal through routeUrl', () => {
    const offenders: string[] = []
    for (const { file, code } of clientCode()) {
      for (const match of code.matchAll(ROOT_ABSOLUTE_ROUTE)) {
        if (/routeUrl\(\s*$/.test(code.slice(0, match.index))) continue
        offenders.push(`${file}:${lineAt(code, match.index)}: ${snippetAt(code, match.index)}`)
      }
    }
    expect(offenders, 'every client route literal must go through the one boundary — wrap it in routeUrl()').toEqual([])
  })
})
