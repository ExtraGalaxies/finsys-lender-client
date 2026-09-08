// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

export class LenderApiError extends Error {
  readonly statusCode?: number
  readonly responseData?: unknown
  readonly isAuthError: boolean
  readonly isNetworkError: boolean

  readonly cause?: unknown

  constructor(
    message: string,
    options?: {
      statusCode?: number
      responseData?: unknown
      isAuthError?: boolean
      isNetworkError?: boolean
      cause?: unknown
    }
  ) {
    super(message)
    this.name = 'LenderApiError'
    this.statusCode = options?.statusCode
    this.responseData = options?.responseData
    this.isAuthError = options?.isAuthError ?? false
    this.isNetworkError = options?.isNetworkError ?? false
    this.cause = options?.cause
  }
}

/**
 * The upstream error code carried by a refusal — `'VALIDATION_ERROR'`,
 * `'UNAUTHORIZED_ACCESS'`, … — or `undefined` when the body carries none.
 *
 * READ IT THROUGH HERE RATHER THAN OFF `responseData`. finsys-api's global
 * handler serialises every `AppError` as
 *
 *     { err: { code: <errorCode>, desc: <message> } }
 *
 * so the code is at `responseData.err.code` and NOT at `responseData.code`.
 * The nesting is easy to get wrong and wrong is silent — `responseData.code`
 * is `undefined` for every refusal the server can produce, so a consumer
 * branching on it never takes the branch and never learns why. This helper
 * exists so the path is written once.
 *
 * Deliberately no fallback to a top-level `code`: accepting a shape the server
 * does not emit would make the next wrong fixture pass.
 */
export function lenderErrorCode(error: unknown): string | undefined {
  const data = error instanceof LenderApiError ? error.responseData : undefined
  if (typeof data !== 'object' || data === null) return undefined
  const envelope = (data as { err?: unknown }).err
  if (typeof envelope !== 'object' || envelope === null) return undefined
  const code = (envelope as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
