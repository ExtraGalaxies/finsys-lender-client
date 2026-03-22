// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

import axios, { type AxiosInstance, type AxiosError } from 'axios'
import axiosRetry from 'axios-retry'
import { readFile } from 'node:fs/promises'
import { HEADERS } from './constants.js'
import { LenderApiError } from './errors.js'
import { getEnvironmentConfig, type EnvironmentConfig } from './environments.js'
import type {
  LenderClientConfig,
  LenderEnvironment,
  Application,
  ApplicationListFilter,
  ApplicationListResult,
  StatusUpdateRequest,
  StatusUpdateResult,
  DocumentArchive,
  FileDownload,
  UploadableFile,
  UploadResult,
  Program,
  ConsentEvent,
} from './types.js'

export class LenderClient {
  private readonly config: LenderClientConfig
  private readonly envConfig: EnvironmentConfig
  private cachedToken: string | null = null
  private tokenExpiry: number | undefined = undefined

  constructor(config: LenderClientConfig) {
    this.config = config
    this.envConfig = getEnvironmentConfig(config.environment)
  }

  // --- Public API ---

  async login(): Promise<void> {
    const url = `${this.envConfig.baseUrl}${this.envConfig.paths.login}`
    const headers = this.getLoginHeaders()

    try {
      const client = this.createRetryClient()
      const response = await client.post(url, {}, { headers })

      const token: string | undefined = response.data?.token
      const tokenExpiredDate: string | undefined = response.data?.tokenExpiredDate

      if (!token) {
        throw new LenderApiError('Login failed - no access token received', {
          isAuthError: true,
        })
      }

      this.cachedToken = token

      if (tokenExpiredDate) {
        const expiryTimestamp = new Date(tokenExpiredDate).getTime()
        this.tokenExpiry = Number.isNaN(expiryTimestamp)
          ? this.defaultExpiry()
          : expiryTimestamp
      } else {
        this.tokenExpiry = this.defaultExpiry()
      }
    } catch (error) {
      if (error instanceof LenderApiError) throw error
      throw this.wrapError(error, 'POST', url)
    }
  }

  async getApplicationList(
    filter?: ApplicationListFilter,
    page?: number,
    size: number = 20
  ): Promise<ApplicationListResult> {
    const url = this.buildListUrl(size, page, filter)
    const headers = await this.authHeaders()

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
  }

  async getApplicationDetails(ihsId: string | number): Promise<Application> {
    const url = `${this.envConfig.baseUrl}${this.envConfig.paths.details}/${ihsId}`
    const headers = await this.authHeaders()

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
  }

  async updateApplicationStatus(
    applicationId: string | number,
    request: StatusUpdateRequest
  ): Promise<StatusUpdateResult> {
    const url = `${this.envConfig.baseUrl}${this.envConfig.paths.update}/${applicationId}`
    const headers = await this.authHeaders()

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
  }

  async downloadAllDocuments(ihsId: string | number): Promise<DocumentArchive> {
    const url = `${this.envConfig.baseUrl}${this.envConfig.paths.details}/${ihsId}${this.envConfig.paths.download}`
    const headers = await this.authHeaders()

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
  }

  async downloadFile(
    ihsId: string | number,
    documentId: string | number
  ): Promise<FileDownload> {
    const url = `${this.envConfig.baseUrl}${this.envConfig.paths.details}/${ihsId}${this.envConfig.paths.download}/file/${documentId}`
    const headers = await this.authHeaders()

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
  }

  async uploadDocument(
    ihsId: string | number,
    file: UploadableFile
  ): Promise<UploadResult> {
    const url = `${this.envConfig.baseUrl}${this.envConfig.paths.details}/${ihsId}/upload`
    const headers = await this.authHeaders()

    try {
      const fileBuffer = await readFile(file.path)

      // Use form-data package for multipart
      const FormDataModule = await import('form-data')
      const FormData = FormDataModule.default
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
  }

  async getConsentsByIhsId(ihsId: string | number): Promise<ConsentEvent[]> {
    const url = `${this.envConfig.baseUrl}/${ihsId}/consents`
    const headers = await this.authHeaders()

    try {
      const client = this.createRetryClient()
      const response = await client.get(url, { headers })
      return (response.data?.data ?? []) as ConsentEvent[]
    } catch (error) {
      throw this.wrapError(error, 'GET', url)
    }
  }

  async getPrograms(): Promise<Program[]> {
    const url = `${this.envConfig.baseUrl}${this.envConfig.paths.programs}`
    const headers = await this.authHeaders()

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
  }

  isAuthenticated(): boolean {
    return !!(this.cachedToken && this.tokenExpiry && Date.now() <= this.tokenExpiry)
  }

  getEnvironment(): LenderEnvironment {
    return this.config.environment
  }

  // --- Internals ---

  private async getValidToken(): Promise<string> {
    if (this.isAuthenticated()) {
      return this.cachedToken!
    }
    await this.login()
    return this.cachedToken!
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getValidToken()
    return {
      [HEADERS.AUTHORIZATION]: `Bearer ${token}`,
      [HEADERS.SUBSCRIPTION_KEY]: this.config.credentials.subscriptionKey,
    }
  }

  private getLoginHeaders(): Record<string, string> {
    const encoded = Buffer.from(
      `${this.config.credentials.clientId}|${this.config.credentials.clientSecret}`
    ).toString('base64')

    return {
      [HEADERS.ENCODED_CODE]: encoded,
      [HEADERS.SUBSCRIPTION_KEY]: this.config.credentials.subscriptionKey,
    }
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
    const base = `${this.envConfig.baseUrl}${this.envConfig.paths.list}`
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
