// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  LenderClient,
  LenderApiError,
  LenderEndpoint,
  type CanonicalViewOptions,
} from '../src/index.js'

/**
 * SYS-3415 sweep follow-up — HTTP-level coverage for the two v2 read methods.
 *
 * There is no HTTP mocking library in this package's dependency tree, so
 * these tests run a real `http.createServer` on port 0 and point
 * `endpointOverrides` at it. This is the only layer that can prove the exact
 * bytes that go out on the wire (query-string encoding, path joining) and the
 * request COUNT and ORDER (the 401-retry path) — assertions no amount of
 * reading `lender-client.ts` can settle on its own.
 *
 * Three defects found in a pre-release sweep of this candidate are pinned
 * here alongside the new-method coverage:
 *   1. `overlay` silently dropped for any value but `'mine'`.
 *   2. `include` ids joined then encoded, making a comma-bearing id
 *      indistinguishable from two separate ids on the wire.
 *   3. `resolveUrl` producing `//` when an `endpointOverrides` value ends in
 *      `/`.
 */

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    // Drain the request body before dispatching so the socket never hangs —
    // none of these tests care about the login POST body.
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
      [LenderEndpoint.CANONICAL_VIEW]: `http://127.0.0.1:${port}/v2/ihs`,
      [LenderEndpoint.APPLICATION_RECORD]: `http://127.0.0.1:${port}/applications`,
      ...overrides,
    },
  })
}

async function assertRejectsWith400(promise: Promise<unknown>, context: string): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (err) {
    caught = err
  }
  assert.ok(caught instanceof LenderApiError, `${context}: expected a LenderApiError, got ${String(caught)}`)
  assert.equal((caught as LenderApiError).statusCode, 400, `${context}: expected statusCode 400`)
}

// --- Item 1: overlay validation, zero HTTP calls ---

test('getCanonicalView rejects every overlay value but "mine" — locally, before any HTTP call', async () => {
  let hits = 0
  const { port, close } = await startServer((_req, res) => {
    hits += 1
    sendJson(res, 200, { data: {} })
  })
  try {
    const client = makeClient(port)
    const badOverlays: unknown[] = ['MINE', 'true', true, 1, 'yours', '']
    for (const overlay of badOverlays) {
      await assertRejectsWith400(
        client.getCanonicalView(7, { overlay } as unknown as CanonicalViewOptions),
        `overlay=${JSON.stringify(overlay)}`,
      )
    }
    assert.equal(hits, 0, `expected zero HTTP requests, the server saw ${hits}`)
  } finally {
    await close()
  }
})

test('overlay: "mine" and an omitted overlay are both accepted (not part of the rejection set)', async () => {
  const seen: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    seen.push(req.url ?? '')
    sendJson(res, 200, { data: { ihsId: 7, categories: {} } })
  })
  try {
    const client = makeClient(port)
    await client.getCanonicalView(7, { overlay: 'mine' })
    await client.getCanonicalView(7, {})
    assert.equal(seen[0], '/v2/ihs/7?overlay=mine')
    assert.equal(seen[1], '/v2/ihs/7')
  } finally {
    await close()
  }
})

// --- Item 4a: empty include, both call forms, zero HTTP calls ---

test('getCanonicalView(id, []) and getCanonicalView(id, {include: []}) both throw locally, zero requests', async () => {
  let hits = 0
  const { port, close } = await startServer((_req, res) => {
    hits += 1
    sendJson(res, 200, { data: {} })
  })
  try {
    const client = makeClient(port)
    await assertRejectsWith400(client.getCanonicalView(7, []), 'bare-array []')
    await assertRejectsWith400(client.getCanonicalView(7, { include: [] }), '{include: []}')
    assert.equal(hits, 0, `expected zero HTTP requests, the server saw ${hits}`)
  } finally {
    await close()
  }
})

// --- Item 2 + 4b: exact wire form for include + overlay ---

test('{include: ["a","b"], overlay: "mine"} produces the exact URL …/v2/ihs/7?include=a,b&overlay=mine', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, { data: { ihsId: 7, categories: {} } })
  })
  try {
    const client = makeClient(port)
    const view = await client.getCanonicalView(7, { include: ['a', 'b'], overlay: 'mine' })
    assert.equal((view as { ihsId: number }).ihsId, 7)
    assert.equal(requests.length, 1)
    assert.equal(requests[0], '/v2/ihs/7?include=a,b&overlay=mine')
  } finally {
    await close()
  }
})

test('an id containing a comma is encoded before joining — distinguishable from two separate ids on the wire', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, { data: { ihsId: 7, categories: {} } })
  })
  try {
    // Two separate clients so each gets its own login and there is no
    // ambiguity about which GET belongs to which call.
    await makeClient(port).getCanonicalView(7, { include: ['a,b', 'c'] })
    await makeClient(port).getCanonicalView(7, { include: ['a', 'b', 'c'] })

    assert.equal(requests.length, 2)
    assert.equal(requests[0], '/v2/ihs/7?include=a%2Cb,c')
    assert.equal(requests[1], '/v2/ihs/7?include=a,b,c')
    assert.notEqual(requests[0], requests[1], 'the two id lists must not be byte-identical on the wire')
  } finally {
    await close()
  }
})

// --- Item 4c: bare-array form still works ---

test('a bare array is still accepted as include — 2.5.0/2.6.0 caller compatibility', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, { data: { ihsId: 7, categories: {} } })
  })
  try {
    const client = makeClient(port)
    await client.getCanonicalView(7, ['a', 'b'])
    assert.equal(requests[0], '/v2/ihs/7?include=a,b')
  } finally {
    await close()
  }
})

// --- Item 4d: getApplicationRecord ---

test('getApplicationRecord(7) resolves to …/applications/7', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, {
      data: {
        applicationId: 7,
        status: 'New',
        statusDescription: null,
        parties: {},
        facility: {},
        system: {},
        consents: [],
      },
    })
  })
  try {
    const client = makeClient(port)
    const record = await client.getApplicationRecord(7)
    assert.equal(record.applicationId, 7)
    assert.equal(requests[0], '/applications/7')
  } finally {
    await close()
  }
})

// --- Item 3: endpointOverrides with a trailing slash never produces '//' ---

test('a trailing slash on the CANONICAL_VIEW override does not produce a double slash', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, { data: { ihsId: 42, categories: {} } })
  })
  try {
    const client = makeClient(port, {
      [LenderEndpoint.CANONICAL_VIEW]: `http://127.0.0.1:${port}/v2/ihs/`,
    })
    await client.getCanonicalView(42)
    assert.equal(requests[0], '/v2/ihs/42')
  } finally {
    await close()
  }
})

test('a trailing slash on the APPLICATION_RECORD override does not produce a double slash', async () => {
  const requests: string[] = []
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') return loginOk(res)
    requests.push(req.url ?? '')
    sendJson(res, 200, {
      data: {
        applicationId: 42,
        status: null,
        statusDescription: null,
        parties: {},
        facility: {},
        system: {},
        consents: [],
      },
    })
  })
  try {
    const client = makeClient(port, {
      [LenderEndpoint.APPLICATION_RECORD]: `http://127.0.0.1:${port}/applications/`,
    })
    await client.getApplicationRecord(42)
    assert.equal(requests[0], '/applications/42')
  } finally {
    await close()
  }
})

// --- Item 4e: both v2 methods go through withAuth — one re-login, one retry on 401 ---

test('getCanonicalView: a 401 triggers exactly one re-login and one retry', async () => {
  const sequence: string[] = []
  let getAttempt = 0
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      sequence.push('LOGIN')
      return loginOk(res)
    }
    if (req.method === 'GET' && (req.url ?? '').startsWith('/v2/ihs/7')) {
      getAttempt += 1
      if (getAttempt === 1) {
        sequence.push('GET(401)')
        return sendJson(res, 401, { message: 'Unauthorized' })
      }
      sequence.push('GET(200)')
      return sendJson(res, 200, { data: { ihsId: 7, categories: {} } })
    }
    sequence.push(`UNEXPECTED ${req.method} ${req.url}`)
    sendJson(res, 404, {})
  })
  try {
    const client = makeClient(port)
    const view = await client.getCanonicalView(7)
    assert.equal((view as { ihsId: number }).ihsId, 7)
    assert.deepEqual(sequence, ['LOGIN', 'GET(401)', 'LOGIN', 'GET(200)'])
  } finally {
    await close()
  }
})

test('getApplicationRecord: a 401 triggers exactly one re-login and one retry', async () => {
  const sequence: string[] = []
  let getAttempt = 0
  const { port, close } = await startServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      sequence.push('LOGIN')
      return loginOk(res)
    }
    if (req.method === 'GET' && req.url === '/applications/7') {
      getAttempt += 1
      if (getAttempt === 1) {
        sequence.push('GET(401)')
        return sendJson(res, 401, { message: 'Unauthorized' })
      }
      sequence.push('GET(200)')
      return sendJson(res, 200, {
        data: {
          applicationId: 7,
          status: 'New',
          statusDescription: null,
          parties: {},
          facility: {},
          system: {},
          consents: [],
        },
      })
    }
    sequence.push(`UNEXPECTED ${req.method} ${req.url}`)
    sendJson(res, 404, {})
  })
  try {
    const client = makeClient(port)
    const record = await client.getApplicationRecord(7)
    assert.equal(record.applicationId, 7)
    assert.deepEqual(sequence, ['LOGIN', 'GET(401)', 'LOGIN', 'GET(200)'])
  } finally {
    await close()
  }
})
