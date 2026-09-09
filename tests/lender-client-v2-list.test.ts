// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  LenderClient,
  LenderApiError,
  lenderErrorCode,
  LenderEndpoint,
  type SubjectApplicationListItem,
  type SubjectApplicationListOptions,
  type SubjectLabel,
} from '../src/index.js'

/**
 * SYS-3615 — HTTP-level coverage for `listApplicationsV2`.
 *
 * Same harness as `lender-client-v2.test.ts`: a real `http.createServer` on
 * port 0 with `endpointOverrides` pointed at it, because the assertions that
 * matter here are about the BYTES that leave this process — a cursor passed
 * back unchanged, and no default the caller did not ask for.
 *
 * THE CURSOR ASSERTIONS ARE THE POINT. SYS-3611 records that spelling a
 * cursor from a JS `Date` was wrong twice over: `toISOString()` renders UTC
 * against a wall-clock `DATETIME` (eight hours early under
 * `Asia/Kuala_Lumpur`) and a `Date` is millisecond-precision against a
 * `datetime(6)`. Both silently skip rows, and no harness in this estate runs
 * outside UTC, so the client-side half is pinned here: the cursor is an
 * OPAQUE STRING and this SDK must move it verbatim in both directions.
 *
 * The two cursors below are deliberately chosen so that a JSON round-trip is
 * DETECTABLE: `CURSOR_JSON_SPACED` re-serialises to different bytes (the
 * spaces are dropped), and `CURSOR_OPAQUE` is not JSON at all.
 */

/** base64url of `{"value": "2026-08-21 15:04:05.531247", "ihsId": 42, ...}` — spaced on purpose. */
const CURSOR_JSON_SPACED = Buffer.from(
  '{"value": "2026-08-21 15:04:05.531247", "ihsId": 42, "sortBy": "createdAt", "sort": "DESC"}',
  'utf8',
).toString('base64url')

/** Not JSON, not base64, not a date. A cursor's encoding is not this SDK's business. */
const CURSOR_OPAQUE = 'opaque.cursor.v1~not-json'

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => handler(req, res))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
  })
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function loginOk(res: http.ServerResponse): void {
  sendJson(res, 200, { token: 'test-token', expires_in: 3600 })
}

function makeClient(
  port: number,
  overrides: Partial<Record<LenderEndpoint, string>> = {},
): LenderClient {
  return new LenderClient({
    environment: 'staging',
    credentials: { clientId: 'test-client', clientSecret: 'test-secret' },
    endpointOverrides: {
      [LenderEndpoint.LOGIN]: `http://127.0.0.1:${port}/login`,
      [LenderEndpoint.APPLICATION_LIST_V2]: `http://127.0.0.1:${port}/v2/applications`,
      ...overrides,
    },
  })
}

/** One page, with every key the server always emits. */
function pageBody(nextCursor: string | null, size: number): unknown {
  return {
    data: {
      list: [
        {
          ihsId: 42,
          status: 'New',
          statusDescription: null,
          programId: 7,
          programName: 'Program Seven',
          borrowerAgentId: 404,
          borrowerAgentName: null,
          totalFinancing: 125000.5,
          jurisdiction: null,
          createdAt: '2026-08-21T07:04:05.531Z',
          updatedAt: '2026-08-21T07:04:05.531Z',
          labels: { 'subject.companyName': { value: 'Acme Sdn Bhd', source: 'legacy:ihs.companyName' } },
          labelsResolvedAt: '2026-08-21T07:04:06.000Z',
        },
      ],
      pagination: { nextCursor, size },
    },
  }
}

async function assertRejectsWith400(promise: Promise<unknown>, context: string): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  assert.ok(
    caught instanceof LenderApiError,
    `${context}: expected a LenderApiError, got ${String(caught)}`,
  )
  assert.equal((caught as LenderApiError).statusCode, 400, `${context}: expected statusCode 400`)
}

// --- The cursor moves verbatim, both directions ---

test('the cursor is sent to the server byte-identical — never parsed, decoded or re-serialised', async () => {
  const seenCursors: Array<string | null> = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    const query = new URL(req.url ?? '', 'http://127.0.0.1').searchParams
    seenCursors.push(query.get('cursor'))
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await client.listApplicationsV2({ cursor: CURSOR_JSON_SPACED })
    await client.listApplicationsV2({ cursor: CURSOR_OPAQUE })

    assert.equal(
      seenCursors[0],
      CURSOR_JSON_SPACED,
      'a JSON round-trip would drop the spaces and change these bytes',
    )
    assert.equal(
      seenCursors[1],
      CURSOR_OPAQUE,
      'an opaque cursor must survive unchanged — its encoding is not this SDK\'s business',
    )
  } finally {
    await close()
  }
})

test('nextCursor comes back verbatim and the next page sends exactly those bytes', async () => {
  const seenCursors: Array<string | null> = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    const query = new URL(req.url ?? '', 'http://127.0.0.1').searchParams
    seenCursors.push(query.get('cursor'))
    sendJson(res, 200, pageBody(seenCursors.length === 1 ? CURSOR_JSON_SPACED : null, 50))
  })
  try {
    const client = makeClient(port)
    const first = await client.listApplicationsV2()
    assert.equal(
      first.pagination.nextCursor,
      CURSOR_JSON_SPACED,
      'the cursor the server issued must reach the caller unchanged',
    )

    const second = await client.listApplicationsV2({ cursor: first.pagination.nextCursor! })
    assert.equal(second.pagination.nextCursor, null, 'a null nextCursor means the last page')

    assert.equal(seenCursors[0], null, 'the first call sends no cursor')
    assert.equal(seenCursors[1], CURSOR_JSON_SPACED, 'the round trip must be byte-identical')
  } finally {
    await close()
  }
})

// --- No default the caller did not ask for ---

test('listApplicationsV2() with no options sends a bare path — no size, no sort, no page', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await client.listApplicationsV2()
    assert.equal(
      requests[0],
      '/v2/applications',
      'v1 always sends size=20; v2 must send nothing the caller did not ask for — ' +
        'the server owns the default (50) and the clamp (max 200)',
    )
  } finally {
    await close()
  }
})

test('size is passed through unclamped — the server owns the 200 ceiling and the <=0 rule', async () => {
  const seen: Array<string | null> = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    seen.push(new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('size'))
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await client.listApplicationsV2({ size: 500 })
    await client.listApplicationsV2({ size: 0 })
    assert.deepEqual(seen, ['500', '0'], 'no client-side clamp and no client-side reinterpretation')
  } finally {
    await close()
  }
})

// --- v2 vocabulary: label ids, not v1 column names ---

test('filters and sorts name label ids — never v1 vocabulary', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, pageBody(null, 25))
  })
  try {
    const client = makeClient(port)
    await client.listApplicationsV2({
      size: 25,
      sortBy: 'subject.companyName',
      sort: 'ASC',
      labels: { 'subject.companyName': 'Acme', 'subject.personName': 'Tan' },
      status: ['New', 'In Review'],
      programId: 7,
      borrowerAgentId: 9,
      minTotalFinancing: 1000,
      maxTotalFinancing: 250000,
      updatedAfter: 1755763445,
    })

    const query = new URL(requests[0]!, 'http://127.0.0.1').searchParams
    assert.equal(query.get('sortBy'), 'subject.companyName')
    assert.equal(query.get('sort'), 'ASC')
    assert.equal(query.get('subject.companyName'), 'Acme')
    assert.equal(query.get('subject.personName'), 'Tan')
    assert.deepEqual(query.getAll('status'), ['New', 'In Review'], 'status repeats, never joins')
    assert.equal(query.get('programId'), '7')
    assert.equal(query.get('borrowerAgentId'), '9')
    assert.equal(query.get('minTotalFinancing'), '1000')
    assert.equal(query.get('maxTotalFinancing'), '250000')
    assert.equal(query.get('updatedAfter'), '1755763445')

    for (const v1Name of ['searchCompanyName', 'companyName', 'fullName', 'page']) {
      assert.equal(query.get(v1Name), null, `v1 vocabulary must not appear on a v2 request: ${v1Name}`)
    }
  } finally {
    await close()
  }
})

// --- Absence, not null ---

test('an unauthorised or unproduced label is ABSENT from labels — not null', async () => {
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    const page = await client.listApplicationsV2()
    const item = page.list[0]!

    assert.equal(item.labels['subject.companyName']?.value, 'Acme Sdn Bhd')
    assert.equal(item.labels['subject.companyName']?.source, 'legacy:ihs.companyName')
    assert.equal(
      Object.prototype.hasOwnProperty.call(item.labels, 'subject.personName'),
      false,
      'the key must be ABSENT — a null would let a consumer tell "gated" from "no source"',
    )
    assert.equal(item.labels['subject.personName'], undefined)

    // The nullable record fields are null, and present.
    assert.equal(item.jurisdiction, null)
    assert.ok(
      Object.prototype.hasOwnProperty.call(item, 'jurisdiction'),
      'jurisdiction is always present, null included',
    )
    assert.equal(item.borrowerAgentId, 404)
    assert.equal(item.borrowerAgentName, null, 'a dangling agent reference is reported, not hidden')
  } finally {
    await close()
  }
})

// --- Error mapping ---

test('a 400 VALIDATION_ERROR surfaces as a LenderApiError carrying the code', async () => {
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    // The shape finsys-api's global handler ACTUALLY emits, for every
    // AppError — `{err:{code, desc}}`, not `{code, message}`.
    sendJson(res, 400, {
      err: {
        code: 'VALIDATION_ERROR',
        desc: 'filter subject.personName is not available to this reader',
      },
    })
  })
  try {
    const client = makeClient(port)
    let caught: unknown
    try {
      await client.listApplicationsV2({ labels: { 'subject.personName': 'Tan' } })
    } catch (err) {
      caught = err
    }
    assert.ok(caught instanceof LenderApiError)
    const error = caught as LenderApiError
    assert.equal(error.statusCode, 400)
    assert.equal(error.isAuthError, false)

    // The code lives at `err.code`. `responseData.code` is undefined for every
    // refusal this server can produce, so a consumer branching on it would
    // never take the branch — silently.
    assert.equal(lenderErrorCode(error), 'VALIDATION_ERROR')
    assert.equal(
      (error.responseData as { err?: { code?: string } }).err?.code,
      'VALIDATION_ERROR',
      'the raw path is `err.code`, and the docs must say so',
    )
    assert.equal(
      (error.responseData as { code?: string }).code,
      undefined,
      'the flat `code` this test used to assert does not exist on the wire',
    )
  } finally {
    await close()
  }
})

test('lenderErrorCode reads err.code only — a flat `code` is not the server\'s shape', () => {
  assert.equal(
    lenderErrorCode(new LenderApiError('x', { responseData: { err: { code: 'VALIDATION_ERROR' } } })),
    'VALIDATION_ERROR',
  )
  assert.equal(
    lenderErrorCode(new LenderApiError('x', { responseData: { code: 'VALIDATION_ERROR' } })),
    undefined,
    'no fallback to a top-level code: accepting a shape the server does not emit ' +
      'is what would let the next wrong fixture pass',
  )
  // Every way a body can fail to carry a code, without throwing.
  assert.equal(lenderErrorCode(new LenderApiError('x')), undefined)
  assert.equal(lenderErrorCode(new LenderApiError('x', { responseData: null })), undefined)
  assert.equal(lenderErrorCode(new LenderApiError('x', { responseData: 'Bad Gateway' })), undefined)
  assert.equal(lenderErrorCode(new LenderApiError('x', { responseData: { err: null } })), undefined)
  assert.equal(lenderErrorCode(new LenderApiError('x', { responseData: { err: { code: 7 } } })), undefined)
  assert.equal(lenderErrorCode(new Error('not a LenderApiError')), undefined)
  assert.equal(lenderErrorCode(undefined), undefined)
})

/**
 * The re-login path, driven from the status the REAL server sends.
 *
 * `authorizeLender()` (finsys-api `customMiddlewares/passportAuth.ts`) answers
 * an expired or unverifiable Bearer token with **403**
 * `{err:{code:'UNAUTHORIZED_ACCESS'}}`, not 401 — it returns the same
 * `AUTHORIZATION_ERRORS.UNAUTHORIZED_ACCESS` for `TokenExpiredError` as for
 * every other verify failure. A retry gated on 401 alone is therefore dead
 * code against production, and a fixture that sends 401 is a claim about a
 * server that does not exist.
 *
 * 401 is kept as a case because nothing upstream promises 403 forever, and
 * because the gateway in front of this API is free to answer 401 itself.
 */
function startAuthRetryServer(
  firstStatus: number,
  sequence: string[],
): Promise<{ port: number; close: () => Promise<void> }> {
  let getAttempt = 0
  return startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      sequence.push('LOGIN')
      return loginOk(res)
    }
    if (req.method === 'GET' && (req.url ?? '').startsWith('/v2/applications')) {
      getAttempt += 1
      if (getAttempt === 1) {
        sequence.push(`GET(${firstStatus})`)
        return sendJson(res, firstStatus, { err: { code: 'UNAUTHORIZED_ACCESS', desc: 'Unauthorized to access this request.' } })
      }
      sequence.push('GET(200)')
      return sendJson(res, 200, pageBody(null, 50))
    }
    sequence.push(`UNEXPECTED ${req.method} ${req.url}`)
    sendJson(res, 404, {})
  })
}

test('an expired token — 403 upstream, not 401 — triggers exactly one re-login and one retry', async () => {
  const sequence: string[] = []
  const { port, close } = await startAuthRetryServer(403, sequence)
  try {
    const client = makeClient(port)
    const page = await client.listApplicationsV2()
    assert.equal(page.list[0]!.ihsId, 42)
    assert.deepEqual(
      sequence,
      ['LOGIN', 'GET(403)', 'LOGIN', 'GET(200)'],
      'authorizeLender answers an expired lender token with 403, so 403 must re-login',
    )
  } finally {
    await close()
  }
})

test('a 401 triggers exactly one re-login and one retry', async () => {
  const sequence: string[] = []
  const { port, close } = await startAuthRetryServer(401, sequence)
  try {
    const client = makeClient(port)
    const page = await client.listApplicationsV2()
    assert.equal(page.list[0]!.ihsId, 42)
    assert.deepEqual(sequence, ['LOGIN', 'GET(401)', 'LOGIN', 'GET(200)'])
  } finally {
    await close()
  }
})

test('a persistent auth refusal retries ONCE and then surfaces — it does not loop', async () => {
  const sequence: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      sequence.push('LOGIN')
      return loginOk(res)
    }
    sequence.push('GET(403)')
    sendJson(res, 403, { err: { code: 'UNAUTHORIZED_ACCESS', desc: 'Unauthorized to access this request.' } })
  })
  try {
    const client = makeClient(port)
    let caught: unknown
    try {
      await client.listApplicationsV2()
    } catch (err) {
      caught = err
    }
    assert.ok(caught instanceof LenderApiError)
    assert.equal((caught as LenderApiError).statusCode, 403)
    assert.deepEqual(
      sequence,
      ['LOGIN', 'GET(403)', 'LOGIN', 'GET(403)'],
      'a genuine permission refusal costs one wasted round trip, never an unbounded loop',
    )
  } finally {
    await close()
  }
})

// --- Local rejections, before any HTTP call ---

test('an empty cursor and a bad sort direction are rejected locally, zero requests', async () => {
  let hits = 0
  const { port, close } = await startServer((_req, res) => {
    hits += 1
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await assertRejectsWith400(client.listApplicationsV2({ cursor: '' }), 'cursor=""')
    await assertRejectsWith400(
      client.listApplicationsV2({ sort: 'sideways' as unknown as 'ASC' }),
      'sort=sideways',
    )
    await assertRejectsWith400(
      client.listApplicationsV2({ size: Number.NaN }),
      'size=NaN',
    )
    assert.equal(hits, 0, `expected zero HTTP requests, the server saw ${hits}`)
  } finally {
    await close()
  }
})

/**
 * `updatedAfter` is Unix SECONDS, and the failure mode for milliseconds is
 * total silence. Measured against MySQL 8 in this estate:
 *
 *   FROM_UNIXTIME(1755763445)     -> 2025-08-21 08:04:05
 *   FROM_UNIXTIME(1755763445000)  -> NULL
 *   FROM_UNIXTIME(32536771199)    -> 3001-01-18 23:59:59   (the last accepted)
 *   FROM_UNIXTIME(32536771200)    -> NULL
 *   FROM_UNIXTIME(-1)             -> NULL
 *
 * The filter is `updatedAt > FROM_UNIXTIME(?)`, and `x > NULL` is NULL, which
 * excludes every row. So `Date.now()` — the single likeliest thing to reach a
 * `number` field named after a timestamp — buys a 200 carrying a well-formed
 * page of zero rows, indistinguishable from "nothing has changed". Same class
 * as the empty cursor, and refused for the same reason.
 */
test('updatedAfter in MILLISECONDS is refused locally — it would be a silent empty page', async () => {
  let hits = 0
  const { port, close } = await startServer((_req, res) => {
    hits += 1
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await assertRejectsWith400(
      client.listApplicationsV2({ updatedAfter: 1755763445000 }),
      'updatedAfter=Date.now()',
    )
    await assertRejectsWith400(
      client.listApplicationsV2({ updatedAfter: 32_536_771_200 }),
      'updatedAfter one second past the FROM_UNIXTIME ceiling',
    )
    await assertRejectsWith400(
      client.listApplicationsV2({ updatedAfter: -1 }),
      'updatedAfter negative — also NULL, also an empty page',
    )
    assert.equal(hits, 0, `expected zero HTTP requests, the server saw ${hits}`)
  } finally {
    await close()
  }
})

test('updatedAfter at the FROM_UNIXTIME boundary is SENT — the guard refuses only what MySQL nulls', async () => {
  const seen: Array<string | null> = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    seen.push(new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('updatedAfter'))
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await client.listApplicationsV2({ updatedAfter: 32_536_771_199 })
    await client.listApplicationsV2({ updatedAfter: 0 })
    assert.deepEqual(seen, ['32536771199', '0'], 'the last accepted second, and the epoch, both go out')
  } finally {
    await close()
  }
})

/**
 * The request-side twin of the empty-cursor refusal. In each case the caller
 * NAMED a filter and would have received the unfiltered superset:
 *
 *   `subject.companyName: ''` goes out as `subject.companyName=`, which the
 *   server drops as an empty term.
 *   `status: []` appends nothing at all, so the request carries no status
 *   filter — which is the one thing "filter by none of these" cannot mean.
 *
 * Both come back as a 200 and a plausible page. The server is faithful to
 * itself here, so this is a deliberate divergence: this SDK refuses rather
 * than answer a narrower question with a wider answer.
 */
test('an empty filter term and an empty status array are refused, not sent as the unfiltered superset', async () => {
  let hits = 0
  const { port, close } = await startServer((_req, res) => {
    hits += 1
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await assertRejectsWith400(
      client.listApplicationsV2({ labels: { 'subject.companyName': '' } }),
      'labels with an empty term',
    )
    await assertRejectsWith400(
      client.listApplicationsV2({ status: [] }),
      'status: []',
    )
    await assertRejectsWith400(
      client.listApplicationsV2({ status: '' }),
      "status: ''",
    )
    assert.equal(hits, 0, `expected zero HTTP requests, the server saw ${hits}`)
  } finally {
    await close()
  }
})

test('an omitted label term is still omitted — refusing empty must not refuse absent', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port)
    await client.listApplicationsV2({
      labels: { 'subject.companyName': 'Acme', 'subject.personName': undefined },
    })
    const query = new URL(requests[0]!, 'http://127.0.0.1').searchParams
    assert.equal(query.get('subject.companyName'), 'Acme')
    assert.equal(query.get('subject.personName'), null, 'an undefined term is absent, not empty')
  } finally {
    await close()
  }
})

/**
 * The response-side twin of the empty-cursor bug. `pagination: {}` is truthy,
 * so a guard that tests truthiness admits it and hands back
 * `{nextCursor: undefined, size: undefined}` under types that say
 * `string | null` and `number`. A consumer paging on `nextCursor !== null`
 * then loops forever, re-fetching page one. `getUpdateFeedSas` in this same
 * file already validates each field's type individually; this matches it.
 */
test('a pagination object of the wrong SHAPE fails loudly — truthiness is not a contract', async () => {
  const bodies: unknown[] = [
    { data: { list: [], pagination: {} } },
    { data: { list: [], pagination: { nextCursor: null } } },
    { data: { list: [], pagination: { size: 50 } } },
    { data: { list: [], pagination: { nextCursor: 7, size: 50 } } },
    { data: { list: [], pagination: { nextCursor: null, size: '50' } } },
  ]
  for (const body of bodies) {
    const { port, close } = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/login') return loginOk(res)
      sendJson(res, 200, body)
    })
    try {
      const client = makeClient(port)
      await assert.rejects(
        () => client.listApplicationsV2(),
        LenderApiError,
        `expected a refusal for ${JSON.stringify(body)}`,
      )
    } finally {
      await close()
    }
  }
})

test('a well-shaped empty page is accepted — the shape guard must not refuse a correct result', async () => {
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    sendJson(res, 200, { data: { list: [], pagination: { nextCursor: null, size: 50 } } })
  })
  try {
    const client = makeClient(port)
    const page = await client.listApplicationsV2()
    assert.deepEqual(page.list, [])
    assert.equal(page.pagination.nextCursor, null)
    assert.equal(page.pagination.size, 50)
  } finally {
    await close()
  }
})

test('a trailing slash on the APPLICATION_LIST_V2 override does not produce a double slash', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, pageBody(null, 50))
  })
  try {
    const client = makeClient(port, {
      [LenderEndpoint.APPLICATION_LIST_V2]: `http://127.0.0.1:${port}/v2/applications/`,
    })
    await client.listApplicationsV2({ size: 5 })
    assert.equal(requests[0], '/v2/applications?size=5')
  } finally {
    await close()
  }
})

test('an envelope missing list/pagination fails loudly rather than reading as an empty page', async () => {
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    // A 200 that is not this endpoint's envelope — e.g. an endpointOverride
    // aimed at the wrong path. Defaulting to `[]` here would report "no
    // applications", which is what a correct empty page looks like.
    sendJson(res, 200, { data: { applications: [] } })
  })
  try {
    const client = makeClient(port)
    await assert.rejects(() => client.listApplicationsV2(), LenderApiError)
  } finally {
    await close()
  }
})

/* ------------------------------------------------------------------ *
 * Compile-time assertions — the migration signal `Application` destroys.
 *
 * `Application` opens with `[key: string]: unknown` and types every field
 * optional, so `application.fullName` compiles and yields `undefined` whether
 * or not the server serves it: a consumer's build can never detect a shape
 * change. The v2 list item is typed precisely instead, and these directives
 * are what pins that — widen the item with an index signature and `tsc`
 * fails with "Unused '@ts-expect-error' directive".
 * ------------------------------------------------------------------ */

const sampleItem: SubjectApplicationListItem = {
  ihsId: 42,
  status: 'New',
  statusDescription: null,
  programId: 7,
  programName: 'Program Seven',
  borrowerAgentId: 404,
  borrowerAgentName: null,
  totalFinancing: 125000.5,
  jurisdiction: null,
  createdAt: '2026-08-21T07:04:05.531Z',
  updatedAt: '2026-08-21T07:04:05.531Z',
  labels: {},
  labelsResolvedAt: null,
}

// @ts-expect-error — `fullName` is v1 vocabulary; a v2 item must not admit it.
void sampleItem.fullName

// @ts-expect-error — `borrowerAgent` is v1's spelling; v2 says `borrowerAgentName`.
void sampleItem.borrowerAgent

// @ts-expect-error — `ihsId` is REQUIRED: a partial item is not an item.
const _partialItem: SubjectApplicationListItem = { status: 'New' }
void _partialItem

// The OTHER half of the `Application` defect is that every field is optional,
// which makes `item.status` read as `string | undefined` whether or not the
// server serves it. An item must therefore be assignable to its own
// `Required<>` form: make any field optional and this stops compiling.
const _noFieldIsOptional: Required<SubjectApplicationListItem> = sampleItem
void _noFieldIsOptional

// A label lookup is `SubjectLabel | undefined`. Absence is in the type.
const _maybeLabel: SubjectLabel | undefined = sampleItem.labels['subject.companyName']
void _maybeLabel

// @ts-expect-error — the cursor is an opaque STRING; a Date is not a cursor.
const _dateCursor: SubjectApplicationListOptions = { cursor: new Date() }
void _dateCursor

// @ts-expect-error — v1 filter vocabulary does not exist on the v2 options.
const _v1Vocabulary: SubjectApplicationListOptions = { companyName: 'Acme' }
void _v1Vocabulary

// --- SYS-3618: filtering by application id ---

test('ihsId is sent as a query parameter, and only when supplied', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, pageBody(null, 1))
  })
  try {
    const client = makeClient(port)
    await client.listApplicationsV2({ ihsId: 42 })
    await client.listApplicationsV2({})

    const withId = new URL(requests[0]!, 'http://127.0.0.1').searchParams
    assert.equal(withId.get('ihsId'), '42')

    // The absence case is asserted deliberately. A dropped filter does not
    // fail on this endpoint -- it answers the caller's whole authorized
    // cohort, and the server writes a subject-access record for every row it
    // returns. An always-on parameter and a never-on one are indistinguishable
    // from the positive assertion alone.
    const withoutId = new URL(requests[1]!, 'http://127.0.0.1').searchParams
    assert.equal(withoutId.get('ihsId'), null)
  } finally {
    await close()
  }
})

test('a non-finite ihsId is refused locally rather than sent', async () => {
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    sendJson(res, 200, pageBody(null, 0))
  })
  try {
    const client = makeClient(port)
    await assert.rejects(
      () => client.listApplicationsV2({ ihsId: Number.NaN }),
      /ihsId must be a positive integer/
    )
    for (const bad of [0, -1, 1.5]) {
      await assert.rejects(
        () => client.listApplicationsV2({ ihsId: bad }),
        /ihsId must be a positive integer/,
        `ihsId=${bad} must be refused locally, not sent to return an empty page`
      )
    }
  } finally {
    await close()
  }
})
