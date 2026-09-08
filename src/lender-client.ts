// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

import axios, { type AxiosInstance, type AxiosError } from 'axios'
import axiosRetry from 'axios-retry'
import FormData from 'form-data'
import { readFile } from 'node:fs/promises'
import { HEADERS, DEFAULT_USER_AGENT } from './constants.js'
import { LenderApiError } from './errors.js'
import { BASE_URLS, ENDPOINT_PATHS } from './environments.js'
import {
  LenderEndpoint,
  type LenderClientConfig,
  type LenderEnvironment,
  type CachedToken,
  type Application,
  type CanonicalView,
  type CanonicalViewOptions,
  type ApplicationRecord,
  type ApplicationListFilter,
  type ApplicationListResult,
  type SubjectApplicationListOptions,
  type SubjectApplicationListPage,
  type StatusUpdateRequest,
  type StatusUpdateResult,
  type DocumentArchive,
  type FileDownload,
  type UploadableFile,
  type UploadResult,
  type Program,
  type ConsentEvent,
  type ConsentDefinition,
  type ExtractionJobStatus,
  type UpdateChannel,
  type UpdateFeedSas,
} from './types.js'

export class LenderClient {
  private readonly config: LenderClientConfig
  private cachedToken: CachedToken | null = null
  /** Deduplicates concurrent login() calls to prevent token refresh races. */
  private pendingLogin: Promise<string> | null = null
  /** Validate IDs used in URL path construction to prevent path injection. */
  private static readonly SAFE_ID_PATTERN = /^[\w-]+$/

  constructor(config: LenderClientConfig) {
    this.config = config
  }

  // --- URL Resolution ---

  /**
   * Resolve the full URL for a given endpoint.
   * Uses endpointOverrides if provided, otherwise derives from environment base URL.
   */
  private resolveUrl(endpoint: LenderEndpoint, suffix?: string): string {
    const override = this.config.endpointOverrides?.[endpoint]
    if (override) {
      // A caller-supplied override ending in '/' would otherwise produce a
      // double slash once the id suffix is appended (`/v2/ihs//42`).
      const normalized = override.replace(/\/+$/, '')
      return suffix ? `${normalized}/${suffix}` : normalized
    }
    const base = BASE_URLS[this.config.environment]
    const path = ENDPOINT_PATHS[endpoint]
    const url = `${base}${path}`
    return suffix ? `${url}/${suffix}` : url
  }

  // --- Authentication ---

  async login(): Promise<void> {
    const now = Date.now()

    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > now) {
      return
    }

    if (this.pendingLogin) {
      await this.pendingLogin
      return
    }

    this.pendingLogin = this.performLogin(now)
    try {
      await this.pendingLogin
    } finally {
      this.pendingLogin = null
    }
  }

  private async performLogin(now: number): Promise<string> {
    const { clientId, clientSecret } = this.config.credentials
    if (!clientId || !clientSecret) {
      throw new LenderApiError('Client credentials (clientId and clientSecret) are required', {
        isAuthError: true,
      })
    }

    const url = this.resolveUrl(LenderEndpoint.LOGIN)
    const encoded = Buffer.from(`${clientId}|${clientSecret}`).toString('base64')

    try {
      const client = this.createRetryClient()
      const response = await client.post(url, {}, {
        headers: {
          'Cache-Control': 'no-cache',
          [HEADERS.ENCODED_CODE]: encoded,
        },
        timeout: 15_000,
      })

      const token: string | undefined = response.data?.token
      if (!token) {
        throw new LenderApiError('Login failed - no access token received', {
          isAuthError: true,
        })
      }

      const tokenExpiredDate: string | undefined = response.data?.tokenExpiredDate
      const expiresIn = response.data?.expires_in || response.data?.expiresIn
      let expiresAt: number

      if (expiresIn) {
        expiresAt = now + expiresIn * 1000
      } else if (tokenExpiredDate) {
        const expiryTimestamp = new Date(tokenExpiredDate).getTime()
        expiresAt = Number.isNaN(expiryTimestamp) ? this.defaultExpiry() : expiryTimestamp
      } else {
        expiresAt = this.defaultExpiry()
      }

      this.cachedToken = { token, expiresAt }
      return token
    } catch (error) {
      if (error instanceof LenderApiError) throw error
      throw this.wrapError(error, 'POST', url)
    }
  }

  invalidateToken(): void {
    this.cachedToken = null
  }

  isAuthenticated(): boolean {
    return !!(this.cachedToken && this.cachedToken.expiresAt - 30_000 > Date.now())
  }

  getEnvironment(): LenderEnvironment {
    return this.config.environment
  }

  // --- Request Helpers ---

  private async getValidToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > Date.now()) {
      return this.cachedToken.token
    }
    await this.login()
    return this.cachedToken!.token
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getValidToken()
    return {
      [HEADERS.AUTHORIZATION]: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'User-Agent': DEFAULT_USER_AGENT,
    }
  }

  /**
   * Execute an authenticated request, re-logging in ONCE on an auth refusal.
   *
   * THE REFUSAL IS A 403, NOT A 401, and that is why this gates on
   * `isAuthError`. finsys-api's `authorizeLender()` answers an expired or
   * unverifiable Bearer token with `403 {err:{code:'UNAUTHORIZED_ACCESS'}}` —
   * `TokenExpiredError` takes the same branch as every other verify failure.
   * A guard spelled `statusCode === 401` is dead code against the real server,
   * and only a fixture that sends 401 can make it look alive.
   *
   * That matters because the expiry cache is the ONLY thing standing between a
   * stale token and a permanent hard-failure loop, and it is built on a string
   * this API was never designed to have parsed: the login response carries no
   * `expires_in`, only `tokenExpiredDate` as a zoneless 12-hour
   * `YYYY-MM-DD hh:mm:ss A`, which `new Date(...)` reads in the CLIENT's
   * timezone. Wherever that parse lands later than the true expiry — a zone
   * difference, or clock skew past the 30s margin, with no `clockTolerance`
   * given to `jwt.verify` upstream — the client believes its token is live and
   * every call fails with no way back. This SDK ships inside a desktop app, on
   * user-controlled clocks.
   *
   * `isAuthError` is `401 || 403`, computed once in `wrapError`; this guard
   * tracks that definition rather than restating it.
   *
   * EXACTLY ONE RETRY, and widening it is bounded and one-sided. A genuine
   * permission refusal (a lender reaching for a program it may not see) also
   * answers 403, so it now costs one wasted login and one wasted request
   * before surfacing the same error. Failing to retry an expired token costs
   * every subsequent call until the process restarts.
   */
  private async withAuth<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    const headers = await this.authHeaders()

    try {
      return await fn(headers)
    } catch (error) {
      if (error instanceof LenderApiError && error.isAuthError) {
        this.invalidateToken()
        const retryHeaders = await this.authHeaders()
        return fn(retryHeaders)
      }
      throw error
    }
  }

  // --- Public API ---

  async getApplicationList(
    filter?: ApplicationListFilter,
    page?: number,
    size: number = 20
  ): Promise<ApplicationListResult> {
    return this.withAuth(async (headers) => {
      const url = this.buildListUrl(size, page, filter)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })

        return {
          applications: response.data?.data?.list ?? [],
          pagination: response.data?.data?.pagination ?? null,
        }
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  /**
   * SYS-3416 — the canonical (v2) read: facts, each carrying its provenance.
   *
   * NOT a drop-in replacement for getApplicationDetails. That one merges THIS
   * LENDER'S pending edit overlay before returning, so its values are the
   * lender's current working values; these are the attested facts. Both are
   * defensible inputs to a decision; switching between them silently is not.
   *
   * The response is scoped to ONE application — see CanonicalView.
   *
   * @param options `include`: category ids to narrow to — omitted returns every
   *   category the deployment's registry declares; an unknown id is rejected
   *   by the server with 400 rather than silently dropped, so a typo fails
   *   loudly. `overlay: 'mine'` (SYS-3415, 2.7.0): project THIS lender's own
   *   staged, uncommitted field edits onto the view — the thing v1 did for
   *   you and v2 does only when asked. An overlaid field carries the staged
   *   value as `value`, `origin: 'manual'`, and the attested value as
   *   `originalValue`; the view carries `overlay: {lenderId, applied, …}` so
   *   the payload SAYS which projection you hold. Without it, the view is
   *   facts-only and identical for every lender. A bare array is still
   *   accepted as `include`, for 2.5.0/2.6.0 callers. An `overlay` value
   *   other than `'mine'` (a typo, a stringified boolean, anything a
   *   non-TS caller might pass) is rejected locally with a 400
   *   `LenderApiError` before any HTTP call — silently dropping it would
   *   send the request with no overlay param at all, and the caller would
   *   believe they held their staged edits when they held facts-only.
   */
  async getCanonicalView(
    ihsId: string | number,
    options?: readonly string[] | CanonicalViewOptions,
  ): Promise<CanonicalView> {
    const id = this.validateId(ihsId)
    const opts: CanonicalViewOptions = Array.isArray(options)
      ? { include: options as readonly string[] }
      : ((options as CanonicalViewOptions | undefined) ?? {})
    const include = opts.include
    // An EMPTY include is a caller bug the server rejects; sending it would
    // be indistinguishable from omitting it here, so refuse it locally
    // rather than turning it into "give me everything". Checked before any
    // HTTP call — including before login — so a bad call never reaches the
    // network at all.
    if (include && include.length === 0) {
      throw new LenderApiError('include was supplied but names no category', { statusCode: 400 })
    }
    // overlay must be exactly 'mine' when supplied. Anything else would
    // otherwise be silently dropped by the `=== 'mine'` check below, sending
    // the request with no overlay param and leaving the caller believing
    // they hold their staged edits. Same locally-before-HTTP precedent as
    // the include check above.
    if (opts.overlay !== undefined && opts.overlay !== 'mine') {
      throw new LenderApiError('overlay must be "mine" when supplied', { statusCode: 400 })
    }
    return this.withAuth(async (headers) => {
      const base = this.resolveUrl(LenderEndpoint.CANONICAL_VIEW, id)
      const params: string[] = []
      // Each id is encoded BEFORE joining, so a reserved character in an id
      // (`&`, `#`, `%`, space) cannot corrupt the query string. This is a
      // property of the RAW request line only: the server percent-decodes the
      // value before splitting on `,`, so a comma-bearing id would still read
      // as two ids there. Category ids are kebab-case registry slugs and never
      // contain a comma, so nothing depends on that case.
      if (include?.length) params.push(`include=${include.map(encodeURIComponent).join(',')}`)
      if (opts.overlay === 'mine') params.push('overlay=mine')
      const url = params.length ? `${base}?${params.join('&')}` : base

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })
        if (!response.data?.data) {
          throw new LenderApiError(`Canonical view for ${ihsId} not found`, { statusCode: 404 })
        }
        return response.data.data as CanonicalView
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  /**
   * SYS-3416 — the application record: the facility request, parties, workflow
   * state and consent references. What the canonical view deliberately omits.
   *
   * A consumer migrating off v1 needs BOTH this and getCanonicalView; neither
   * alone carries what the flat detail read did.
   */
  async getApplicationRecord(ihsId: string | number): Promise<ApplicationRecord> {
    const id = this.validateId(ihsId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.APPLICATION_RECORD, id)
      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })
        if (!response.data?.data) {
          throw new LenderApiError(`Application record ${ihsId} not found`, { statusCode: 404 })
        }
        return response.data.data as ApplicationRecord
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  /**
   * SYS-3615 — the v2 application list: keyset-paged, filtered and sorted by
   * declared SUBJECT LABEL rather than by a flat column on the application row.
   *
   * NOT a drop-in replacement for getApplicationList, and not a reshaping of
   * it — v1 is frozen and keeps its own path, its own vocabulary and its own
   * method here. Three differences a migrating consumer has to decide about:
   *
   *   VOCABULARY. Filters and sorts name label ids (`subject.companyName`),
   *   never `companyName` / `fullName`. A label is an ordered list of sources
   *   resolved to one value, and every label on the wire carries the `source`
   *   that won — a `legacy:` prefix names a flat column.
   *
   *   PAGINATION IS KEYSET. Pass `pagination.nextCursor` back as `cursor`;
   *   `null` means the last page. There is no `page` and no total, on
   *   purpose: offset paging over a live table returns rows twice and skips
   *   others, which is the duplicate-row behaviour v1 callers work around.
   *
   *   ABSENCE. A label no declared source produced — and equally one this
   *   caller is not authorised to see — is MISSING from `labels`, never null.
   *   A filter or sort naming a label this caller may not see is a 400
   *   carrying `VALIDATION_ERROR`, never silently dropped. Read that code with
   *   `lenderErrorCode(error)`: the body is `{err:{code, desc}}`, so it sits at
   *   `responseData.err.code` — `responseData.code` is `undefined` for every
   *   refusal this server produces, and a consumer branching on it silently
   *   never branches.
   *
   * THE CURSOR IS OPAQUE AND MOVES VERBATIM. This method never parses,
   * decodes, re-encodes or otherwise touches it, in either direction.
   * SYS-3611 records why: a cursor spelled from a JS `Date` renders UTC via
   * `toISOString()` against a wall-clock `DATETIME` — eight hours early under
   * `Asia/Kuala_Lumpur` — and loses a `datetime(6)`'s microseconds to
   * millisecond precision. Both silently skip rows, and every harness in this
   * estate runs in UTC, so neither is visible in test.
   *
   * NOTHING IS SENT THAT THE CALLER DID NOT ASK FOR. The server owns the
   * default page size (50) and the ceiling (200); `size` is passed through
   * unclamped and uninterpreted so that policy lives in one place. Note the
   * server reads `size <= 0` as its default, NOT as v1's "as many as
   * possible".
   *
   * Options with an unusable value are rejected locally, before any HTTP call
   * — an empty `cursor`, a `sort` that is neither ASC nor DESC, a non-finite
   * number. Each would otherwise go out as a dropped or garbage parameter and
   * come back as a plausible page: an empty cursor in particular would return
   * page ONE to a caller that believes it is paging forward.
   */
  async listApplicationsV2(
    options?: SubjectApplicationListOptions,
  ): Promise<SubjectApplicationListPage> {
    const opts = options ?? {}

    // Same locally-before-HTTP precedent getCanonicalView sets for an empty
    // `include` and a mistyped `overlay`: refuse here rather than send a
    // request whose answer would look correct.
    if (opts.cursor !== undefined && opts.cursor === '') {
      throw new LenderApiError(
        'cursor was supplied but is empty — pass a nextCursor verbatim, or omit it to start a new page',
        { statusCode: 400 },
      )
    }
    if (opts.sort !== undefined) {
      // Case-insensitive because the server is: it uppercases before
      // comparing, so rejecting 'asc' here would refuse a call that works.
      const direction = String(opts.sort).toUpperCase()
      if (direction !== 'ASC' && direction !== 'DESC') {
        throw new LenderApiError(`sort must be 'ASC' or 'DESC', got ${String(opts.sort)}`, {
          statusCode: 400,
        })
      }
    }

    const params = new URLSearchParams()
    const setNumber = (name: string, value: number | undefined): void => {
      if (value === undefined) return
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new LenderApiError(`${name} must be a finite number, got ${String(value)}`, {
          statusCode: 400,
        })
      }
      params.set(name, String(value))
    }

    // Passed through unclamped and unrounded — see the note above.
    setNumber('size', opts.size)
    // VERBATIM, and this line is the whole of the client's cursor handling.
    if (opts.cursor !== undefined) params.set('cursor', opts.cursor)
    if (opts.sortBy !== undefined) params.set('sortBy', opts.sortBy)
    if (opts.sort !== undefined) params.set('sort', opts.sort)
    if (opts.labels) {
      for (const [labelId, term] of Object.entries(opts.labels)) {
        if (term === undefined) continue
        // An empty term is the empty cursor again, on the request side: the
        // server DROPS an empty filter parameter, so a term that arrived empty
        // by accident comes back as a well-formed page over the unfiltered
        // superset. Omit the key to not filter; do not name it and pass ''.
        if (term === '') {
          throw new LenderApiError(
            `labels['${labelId}'] was supplied but is empty — the server drops an empty term and ` +
              'would answer with the UNFILTERED superset; omit the key to not filter on it',
            { statusCode: 400 },
          )
        }
        params.set(labelId, term)
      }
    }
    if (opts.status !== undefined) {
      // Repeated, never joined: the server reads `status` as a repeatable
      // parameter, and a comma-joined value would filter for one status
      // whose name happens to contain a comma.
      const statuses = Array.isArray(opts.status) ? opts.status : [opts.status as string]
      // Same reason as the empty label term. `[]` appends nothing, so the
      // request carries no status filter at all — which is the one thing
      // "filter to none of these" cannot mean.
      if (statuses.length === 0) {
        throw new LenderApiError(
          'status was supplied but is empty — an empty list sends no filter at all and would ' +
            'answer with EVERY status; omit `status` to not filter on it',
          { statusCode: 400 },
        )
      }
      for (const status of statuses) {
        if (status === '') {
          throw new LenderApiError(
            'status contains an empty value — the server drops it, and the page would come back ' +
              'over the unfiltered superset',
            { statusCode: 400 },
          )
        }
        params.append('status', status)
      }
    }
    setNumber('ihsId', opts.ihsId)
    setNumber('programId', opts.programId)
    setNumber('borrowerAgentId', opts.borrowerAgentId)
    setNumber('minTotalFinancing', opts.minTotalFinancing)
    setNumber('maxTotalFinancing', opts.maxTotalFinancing)
    // SECONDS, and out-of-range is a SILENT empty page rather than an error.
    // The server filters with `updatedAt > FROM_UNIXTIME(?)`, and measured
    // against MySQL 8 here: FROM_UNIXTIME(1755763445000) is NULL, so is
    // FROM_UNIXTIME(32536771200), and so is FROM_UNIXTIME(-1) — while
    // FROM_UNIXTIME(32536771199) is the last accepted second. `x > NULL` is
    // NULL, which excludes every row, so the caller gets a 200 carrying a
    // well-formed page of nothing, indistinguishable from "nothing changed".
    // `Date.now()` is the single likeliest value to reach a `number` field
    // named after a timestamp, so it is refused by name.
    if (opts.updatedAfter !== undefined && Number.isFinite(opts.updatedAfter)) {
      const MAX_FROM_UNIXTIME_SECONDS = 32_536_771_199
      if (opts.updatedAfter < 0 || opts.updatedAfter > MAX_FROM_UNIXTIME_SECONDS) {
        throw new LenderApiError(
          `updatedAfter must be Unix SECONDS in [0, ${MAX_FROM_UNIXTIME_SECONDS}], got ` +
            `${opts.updatedAfter} — milliseconds (Date.now()) are out of range for MySQL's ` +
            'FROM_UNIXTIME, which yields NULL and returns a well-formed EMPTY page rather than ' +
            'an error. Use Math.floor(Date.now() / 1000).',
          { statusCode: 400 },
        )
      }
    }
    setNumber('updatedAfter', opts.updatedAfter)

    return this.withAuth(async (headers) => {
      const base = this.resolveUrl(LenderEndpoint.APPLICATION_LIST_V2)
      const query = params.toString()
      const url = query ? `${base}?${query}` : base

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })

        const page = response.data?.data
        // A 200 that is not this endpoint's envelope is reported, not
        // defaulted to an empty page: `{list: [], …}` is what a CORRECT empty
        // result looks like, so degrading to it here would make a
        // misconfigured endpointOverride indistinguishable from a lender with
        // no applications. Same posture (and same status code) as the sibling
        // v2 reads, which treat a missing `data` as a 404.
        //
        // THE PAGINATION CHECK IS PER-FIELD AND TYPED, not a truthiness test,
        // because `pagination: {}` is truthy and would hand back
        // `{nextCursor: undefined, size: undefined}` under types promising
        // `string | null` and `number`. That is the empty cursor again, from
        // the response side: a consumer looping while `nextCursor !== null`
        // would page forever, re-fetching page one. `getUpdateFeedSas` below
        // validates each field individually for the same reason.
        const pagination: unknown = page?.pagination
        const nextCursor = (pagination as { nextCursor?: unknown } | undefined)?.nextCursor
        const size = (pagination as { size?: unknown } | undefined)?.size
        if (
          !page ||
          !Array.isArray(page.list) ||
          typeof pagination !== 'object' ||
          pagination === null ||
          !(typeof nextCursor === 'string' || nextCursor === null) ||
          typeof size !== 'number'
        ) {
          throw new LenderApiError('No application list page returned from API', {
            statusCode: 404,
          })
        }
        return page as SubjectApplicationListPage
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  async getApplicationDetails(ihsId: string | number): Promise<Application> {
    const id = this.validateId(ihsId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.DETAILS, id)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })

        if (!response.data?.data) {
          throw new LenderApiError(`Application ${ihsId} not found`, { statusCode: 404 })
        }

        return response.data.data as Application
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  async updateApplicationStatus(
    applicationId: string | number,
    request: StatusUpdateRequest
  ): Promise<StatusUpdateResult> {
    const id = this.validateId(applicationId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.UPDATE, id)

      try {
        const client = this.createRetryClient()
        const response = await client.patch(url, request, { headers })

        if (!response.data) {
          throw new LenderApiError(`Failed to update application ${applicationId}`, {
            statusCode: 400,
          })
        }

        return response.data as StatusUpdateResult
      } catch (error) {
        throw this.wrapError(error, 'PATCH', url)
      }
    })
  }

  async downloadAllDocuments(ihsId: string | number): Promise<DocumentArchive> {
    const id = this.validateId(ihsId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.DOWNLOAD, `${id}/download`)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, {
          headers,
          responseType: 'arraybuffer',
          timeout: 120_000,
          maxContentLength: 100 * 1024 * 1024,
          maxBodyLength: 100 * 1024 * 1024,
        })

        if (!response.data) {
          throw new LenderApiError('No document archive received from server')
        }

        return {
          data: Buffer.from(response.data),
          contentType: (response.headers['content-type'] as string) || 'application/zip',
        }
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  async downloadFile(
    ihsId: string | number,
    documentId: string | number
  ): Promise<FileDownload> {
    const id = this.validateId(ihsId)
    const docId = this.validateId(documentId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.DOWNLOAD, `${id}/download/file/${docId}`)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, {
          headers,
          responseType: 'arraybuffer',
          timeout: 60_000,
          maxContentLength: 50 * 1024 * 1024,
        })

        if (!response.data) {
          throw new LenderApiError('No file data received from server')
        }

        const contentType =
          (response.headers['content-type'] as string) || 'application/octet-stream'
        const contentDisposition = response.headers['content-disposition'] as string | undefined
        let fileName = String(documentId)

        if (contentDisposition) {
          const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition)
          if (matches?.[1]) {
            fileName = matches[1].replace(/['"]/g, '')
          }
        }

        return {
          data: Buffer.from(response.data),
          contentType,
          fileName,
        }
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  async uploadDocument(
    ihsId: string | number,
    file: UploadableFile
  ): Promise<UploadResult> {
    const id = this.validateId(ihsId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.UPLOAD, `${id}/upload`)

      try {
        const fileBuffer = await readFile(file.path)
        const formData = new FormData()
        formData.append('file', fileBuffer, {
          filename: file.name,
          contentType: file.mimeType || 'application/octet-stream',
        })

        const client = this.createRetryClient()
        const response = await client.post(url, formData, {
          headers: {
            ...headers,
            ...formData.getHeaders(),
          },
          timeout: 60_000,
          maxContentLength: 10 * 1024 * 1024,
          maxBodyLength: 10 * 1024 * 1024,
        })

        if (!response.data?.data) {
          throw new LenderApiError('No upload result received from server')
        }

        return response.data.data as UploadResult
      } catch (error) {
        throw this.wrapError(error, 'POST', url)
      }
    })
  }

  async getConsentsByIhsId(ihsId: string | number): Promise<ConsentEvent[]> {
    const id = this.validateId(ihsId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.CONSENTS, `${id}/consents`)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })
        return (response.data?.data ?? []) as ConsentEvent[]
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  async getPrograms(): Promise<Program[]> {
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.PROGRAMS)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })

        if (!response.data?.data) {
          throw new LenderApiError('No program data returned from API', { statusCode: 404 })
        }

        return response.data.data as Program[]
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  async getConsentDefinitions(): Promise<ConsentDefinition[]> {
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.CONSENT_DEFINITIONS)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })
        return (response.data?.data ?? []) as ConsentDefinition[]
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  async getExtractionStatus(ihsId: string | number): Promise<ExtractionJobStatus[]> {
    const id = this.validateId(ihsId)
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.EXTRACTION_STATUS, `${id}/extraction-status`)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })
        return (response.data?.data?.documents ?? []) as ExtractionJobStatus[]
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  /** Returns the latest FinSys installer version string, e.g. "1.0.2446". */
  async getLatestInstallerVersion(): Promise<string> {
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.INSTALLER_LATEST)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })

        const version = response.data?.data?.version
        if (typeof version !== 'string' || version.trim() === '') {
          throw new LenderApiError('No installer version returned from API', { statusCode: 404 })
        }
        return version
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  /**
   * @deprecated SYS-2797 — superseded by getUpdateFeedSas (container-scoped feed SAS
   * for electron-updater). Retained until callers migrate.
   * Returns a fresh 24h read-only SAS download URL for the latest installer.
   */
  async getInstallerDownloadUrl(): Promise<string> {
    return this.withAuth(async (headers) => {
      const url = this.resolveUrl(LenderEndpoint.INSTALLER_DOWNLOAD_URL)

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })

        const downloadUrl = response.data?.data?.url
        if (typeof downloadUrl !== 'string' || downloadUrl.trim() === '') {
          throw new LenderApiError('No installer download URL returned from API', {
            statusCode: 404,
          })
        }
        return downloadUrl
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  /**
   * Returns a container-scoped, read-only SAS (~2h) for the given build channel's
   * update feed, so the desktop auto-updater can fetch latest.yml + .blockmap +
   * installer with one token. Supersedes getInstallerDownloadUrl.
   */
  async getUpdateFeedSas(channel: UpdateChannel): Promise<UpdateFeedSas> {
    if (channel !== 'signed' && channel !== 'unsigned') {
      throw new LenderApiError(
        `Invalid channel: ${channel}. Must be 'signed' or 'unsigned'`,
        { statusCode: 400 }
      )
    }
    return this.withAuth(async (headers) => {
      const base = this.resolveUrl(LenderEndpoint.INSTALLER_UPDATE_FEED)
      const url = `${base}?channel=${encodeURIComponent(channel)}`

      try {
        const client = this.createRetryClient()
        const response = await client.get(url, { headers })

        const feed = response.data?.data as UpdateFeedSas | undefined
        if (
          !feed ||
          typeof feed.containerUrl !== 'string' ||
          feed.containerUrl.trim() === '' ||
          typeof feed.sasToken !== 'string' ||
          feed.sasToken.trim() === '' ||
          typeof feed.expiresOn !== 'string' ||
          feed.expiresOn.trim() === ''
        ) {
          throw new LenderApiError('No update-feed SAS returned from API', {
            statusCode: 404,
          })
        }
        return feed
      } catch (error) {
        throw this.wrapError(error, 'GET', url)
      }
    })
  }

  // --- Internals ---

  private validateId(id: string | number): string {
    const str = String(id)
    if (!str || !LenderClient.SAFE_ID_PATTERN.test(str)) {
      throw new LenderApiError(`Invalid ID format: ${str}`, { statusCode: 400 })
    }
    return str
  }

  private createRetryClient(): AxiosInstance {
    const client = axios.create()
    const opts = this.config.retryOptions ?? {}

    axiosRetry(client, {
      retries: opts.retries ?? 3,
      retryDelay: this.resolveRetryDelay(opts.retryDelay),
      retryCondition: (error: AxiosError): boolean =>
        axiosRetry.isNetworkOrIdempotentRequestError(error) ||
        (error.response?.status !== undefined && error.response.status >= 500),
      onRetry: (_retryCount, _error, _requestConfig) => {
        // Intentionally silent — consumers can monitor retries via axios interceptors
      },
    })

    return client
  }

  private resolveRetryDelay(
    delay?: 'exponential' | 'linear' | number
  ): (retryNumber: number) => number {
    if (typeof delay === 'number') return () => delay
    if (delay === 'linear') return (n: number) => n * 1000
    return axiosRetry.exponentialDelay
  }

  private defaultExpiry(): number {
    const hours = this.config.tokenCacheOptions?.defaultExpiryHours ?? 1
    return Date.now() + hours * 60 * 60 * 1000
  }

  private buildListUrl(size: number, page?: number, filter?: ApplicationListFilter): string {
    const base = this.resolveUrl(LenderEndpoint.LIST)
    const params = new URLSearchParams()

    if (page !== undefined) params.set('page', String(page))
    params.set('size', String(size))

    if (filter) {
      if (filter.ihsId) params.set('ihsId', filter.ihsId.trim())
      if (filter.fullName) params.set('fullName', filter.fullName.trim())
      if (filter.companyName) params.set('companyName', filter.companyName.trim())
      if (filter.minTotalFinancing) params.set('minTotalFinancing', filter.minTotalFinancing.trim())
      if (filter.maxTotalFinancing) params.set('maxTotalFinancing', filter.maxTotalFinancing.trim())
      if (filter.programId) params.set('programId', filter.programId.trim())
      if (filter.borrowerAgentId) params.set('borrowerAgentId', filter.borrowerAgentId.trim())

      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
        for (const s of statuses) {
          if (s?.trim()) params.append('status', s.trim())
        }
      }
    }

    return `${base}?${params.toString()}`
  }

  private wrapError(error: unknown, method: string, url: string): LenderApiError {
    if (error instanceof LenderApiError) return error

    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const data = error.response?.data

      const isAuth = status === 401 || status === 403
      const isNetwork = !error.response && !!error.code

      let message: string
      if (status && error.response?.statusText) {
        message = `${method} ${url} failed with ${status} ${error.response.statusText}`
        if (data) message += `: ${typeof data === 'string' ? data : JSON.stringify(data)}`
      } else if (error.code) {
        message = `${method} ${url} failed with ${error.code}: ${error.message}`
      } else {
        message = `${method} ${url} failed: ${error.message}`
      }

      return new LenderApiError(message, {
        statusCode: status,
        responseData: data,
        isAuthError: isAuth,
        isNetworkError: isNetwork,
        cause: error,
      })
    }

    return new LenderApiError(
      `${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}
