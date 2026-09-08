// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

export { LenderClient } from './lender-client.js'
// SYS-3615: `lenderErrorCode` reads the upstream code from `err.code`, which is
// where finsys-api's global handler actually puts it — not `responseData.code`.
export { LenderApiError, lenderErrorCode } from './errors.js'
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
  type ExtractionJobStatus,
  type UpdateChannel,
  type UpdateFeedSas,
  // SYS-3334: declared since 2.5.0, exported by name for the first time here.
  // The five Canonical* types are @finsys/core's; this SDK re-exports them.
  type CanonicalFieldEnvelope,
  type CanonicalInstance,
  type CanonicalCategory,
  type CanonicalView,
  type CanonicalAddress,
  type ApplicationRecord,
  type CanonicalViewOptions,
  // SYS-3615: the v2 list. Typed precisely — no index signature — so a
  // consumer's build can detect a shape change. See types.ts.
  type SubjectLabelId,
  type SubjectLabel,
  type SubjectApplicationSortKey,
  type SubjectSortDirection,
  type SubjectApplicationListItem,
  type SubjectApplicationListPagination,
  type SubjectApplicationListPage,
  type SubjectApplicationListOptions,
} from './types.js'
export { resolveCanonicalValue, resolveCanonicalEnvelope } from './canonical.js'
