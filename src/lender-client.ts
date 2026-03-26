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
  type ApplicationListFilter,
  type ApplicationListResult,
  type StatusUpdateRequest,
  type StatusUpdateResult,
  type DocumentArchive,
  type FileDownload,
  type UploadableFile,
  type UploadResult,
  type Program,
  type ConsentEvent,
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
      return suffix ? `${override}/${suffix}` : override
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
   * Execute an authenticated request with automatic 401 retry.
   */
  private async withAuth<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    const headers = await this.authHeaders()

    try {
      return await fn(headers)
    } catch (error) {
      if (error instanceof LenderApiError && error.statusCode === 401) {
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
