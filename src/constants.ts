// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

export const HEADERS = {
  ENCODED_CODE: 'encoded-Code',
  AUTHORIZATION: 'Authorization',
} as const

/** Browser-like User-Agent to bypass Azure Application Gateway WAF bot protection. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const ERROR_MESSAGE = {
  INTERNAL_SERVER_ERROR: 'Internal Server Error',
  RESOURCE_NOT_FOUND: 'Resource not found',
  AUTHENTICATION_FAILED: 'Authentication Failed',
  UNAUTHORIZED: 'Unauthorized. Please check your credentials.',
  FORBIDDEN: "Forbidden. You don't have permission to access this resource.",
  ACCESS_DENIED: 'Access Denied',
} as const

export const ERROR_CODES = {
  MISSING_ENCODED_CODE: 'MISSING_ENCODED_CODE',
  MISSING_ACCESS_TOKEN: 'MISSING_ACCESS_TOKEN',
} as const
