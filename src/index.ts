// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

export { LenderClient } from './lender-client.js'
export { LenderApiError } from './errors.js'
export { BASE_URLS, ENDPOINT_PATHS } from './environments.js'
export { HEADERS, ERROR_MESSAGE, ERROR_CODES } from './constants.js'

export {
  LenderEndpoint,
  type LenderEnvironment,
  type LenderCredentials,
  type LenderClientConfig,
  type CachedToken,
  type RetryOptions,
  type TokenCacheOptions,
  type ApplicationListFilter,
  type StatusUpdateRequest,
  type UploadableFile,
  type ApplicationListResult,
  type Pagination,
  type Application,
  type StatusUpdateResult,
  type DocumentArchive,
  type FileDownload,
  type UploadResult,
  type Program,
  type BorrowerAgent,
  type ConsentEvent,
  type ConsentDefinition,
  type ConsentDocument,
} from './types.js'
