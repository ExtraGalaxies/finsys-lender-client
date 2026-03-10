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
