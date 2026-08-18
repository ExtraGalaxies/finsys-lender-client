// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

// SYS-3334: the v2 envelope types are @finsys/core's; re-exported below.
import type {
  CanonicalFieldEnvelope,
  CanonicalInstance,
  CanonicalCategory,
  CanonicalView,
  CanonicalAddress,
} from '@finsys/core'

// --- Environment & Configuration ---

export type LenderEnvironment = 'staging' | 'production'

export enum LenderEndpoint {
  LOGIN = 'login',
  LIST = 'list',
  DETAILS = 'details',
  UPDATE = 'update',
  DOWNLOAD = 'download',
  UPLOAD = 'upload',
  PROGRAMS = 'programs',
  CONSENTS = 'consents',
  CONSENT_DEFINITIONS = 'consent_definitions',
  EXTRACTION_STATUS = 'extraction_status',
  /** SYS-3416 — the Phase 5 read pair. See CanonicalView / ApplicationRecord. */
  CANONICAL_VIEW = 'canonical_view',
  APPLICATION_RECORD = 'application_record',
  INSTALLER_LATEST = 'installer_latest',
  INSTALLER_DOWNLOAD_URL = 'installer_download_url',
  INSTALLER_UPDATE_FEED = 'installer_update_feed',
}

export interface LenderCredentials {
  clientId: string
  clientSecret: string
}

export interface LenderClientConfig {
  environment: LenderEnvironment
  credentials: LenderCredentials
  /** Optional per-endpoint full URL overrides */
  endpointOverrides?: Partial<Record<LenderEndpoint, string>>
  retryOptions?: RetryOptions
  tokenCacheOptions?: TokenCacheOptions
}

export interface RetryOptions {
  retries?: number
  retryDelay?: 'exponential' | 'linear' | number
}

export interface TokenCacheOptions {
  defaultExpiryHours?: number
}

export interface CachedToken {
  token: string
  expiresAt: number
}

// --- Request Types ---

export interface ApplicationListFilter {
  ihsId?: string
  fullName?: string
  companyName?: string
  minTotalFinancing?: string
  maxTotalFinancing?: string
  programId?: string
  borrowerAgentId?: string
  status?: string | string[]
}

export interface StatusUpdateRequest {
  status: string
  statusDescription?: string
  lenderName?: string
  installmentPlan?: string
  approvedAmount?: number
  monthlyInstallment?: number
  interestRate?: number
  disbursementDate?: string
}

export interface UploadableFile {
  path: string
  name: string
  mimeType?: string
}

// --- Response Types ---

/** Build channel from the client's build metadata: signed vs unsigned installer. */
export type UpdateChannel = 'signed' | 'unsigned'

export interface UpdateFeedSas {
  /** Container base URL (no trailing slash). Append /latest.yml, /<file>.blockmap, /<file>.exe. */
  containerUrl: string
  /** SAS query string WITHOUT a leading '?'. Append to each feed-file URL. */
  sasToken: string
  /** ISO-8601 SAS expiry. */
  expiresOn: string
}

export interface ApplicationListResult {
  applications: Application[]
  pagination: Pagination | null
}

export interface Pagination {
  page: number
  size: number
  total: number
  totalPages: number
}

/**
 * Loan application record.
 * Known fields are typed explicitly; dynamic form fields accessible via index signature.
 */
export interface Application {
  [key: string]: unknown

  // Identity
  ihsId?: number | string
  email?: string
  fullName?: string
  companyName?: string
  status?: string

  // Contact
  phoneNumber?: string
  mobilePhoneNo?: string
  officePhoneNo?: string

  // Financial
  totalFinancing?: number | string
  monthlyGrossIncome?: number | string
  approvedAmount?: number | string
  monthlyInstallment?: number | string
  interestRate?: number | string
  endOfYearCash?: number | string
  shortTermLiabilities?: number | string

  // Demographics
  age?: number | string
  noOfDependants?: number | string
  financingTenure?: number | string

  // Temporal
  createdAt?: string
  updatedAt?: string
  dateJoined?: string
  lengthOfServiceYear?: number | string
  lengthOfServiceMonth?: number | string
  incorporatedDate?: string
  disbursementDate?: string

  // References
  programId?: number | string
  programIds?: (number | string)[]
  borrowerAgentId?: number | string
  facilityType?: string
}

export interface StatusUpdateResult {
  ihsId: number
  status: string
  lastUpdatedDateTime: string
  [key: string]: unknown
}

export interface DocumentArchive {
  data: Buffer
  contentType: string
}

export interface FileDownload {
  data: Buffer
  contentType: string
  fileName: string
}

export interface UploadResult {
  url: string
  sequence: number
}

export interface Program {
  id: number
  name: string
  borrowerAgents: BorrowerAgent[]
}

export interface BorrowerAgent {
  id: number
  name: string
}

export interface ConsentDocument {
  id: number
  name: string
  type: string
  displayName?: string
  url?: string
  fileId?: string
  createdAt: string
}

export interface ConsentDefinition {
  id: number
  description: string
  createdAt: string
  documents: ConsentDocument[]
}

export interface ConsentEvent {
  id: number
  ihsId: number
  consentDefinitionId: number
  consentGiven: boolean
  ipAddress?: string
  createdAt: string
  consentDefinition: ConsentDefinition | null
}

export interface ExtractionJobStatus {
  fileId: number
  fileType: string
  fileIndex: number
  fileName: string | null
  status: string
  errorMessage: string | null
  attemptCount: number
  startedAt: string | null
  completedAt: string | null
}

/**
 * SYS-3416 — the Phase 5 read pair.
 *
 * `getApplicationDetails` (v1) and `getCanonicalView` (v2) DO NOT MEAN THE SAME
 * THING, and swapping one for the other is not a refactor:
 *
 *   v1 merges THIS LENDER'S pending edit overlay before returning, so a value
 *   is the lender's current working value.
 *   v2 returns the ATTESTED FACT — what a named adapter run observed.
 *
 * Both are defensible inputs to a decision. Switching between them silently is
 * not, and nothing in either payload signals which you hold.
 */

/*
 * SYS-3334: the five envelope types are OWNED BY @finsys/core and re-exported
 * here. They describe the wire shape of a published API, and every consumer
 * needs them — finhub through its own gateway, a bureau portal later — not
 * only external lenders holding this SDK. Two declarations of one wire shape,
 * drifting apart with nothing comparing them, is this estate's signature
 * defect; so the shape is declared once, in the package that already owns the
 * category registry and the field catalogue, and this SDK re-exports it.
 *
 * Note what 2.5.0 shipped: it DECLARED these interfaces in this file and never
 * exported them from the index — `import type { CanonicalView } from
 * '@finsys/lender-client'` was TS2305. A 2.5.0 consumer held a CanonicalView
 * only as the unnamed return type of `getCanonicalView()`. 2.6.0 is the first
 * release in which the names are importable; `tests/canonical-types-compat.
 * test.ts` proves, both ways, that what such a consumer held is assignable to
 * and from what core now declares.
 */
export type {
  CanonicalFieldEnvelope,
  CanonicalInstance,
  CanonicalCategory,
  CanonicalView,
  CanonicalAddress,
}

/**
 * SYS-3415 (2.7.0): options for `getCanonicalView`. `overlay: 'mine'` projects
 * the calling lender's own staged edits; see the method's doc.
 */
export interface CanonicalViewOptions {
  include?: readonly string[]
  overlay?: 'mine'
}

/** The application record — what v2 deliberately does not carry. */
export interface ApplicationRecord {
  applicationId: number
  status: string | null
  statusDescription: string | null
  parties: Record<string, unknown>
  facility: Record<string, unknown>
  system: Record<string, unknown>
  consents: Array<{
    eventId: number | null
    definitionId: number | null
    version: number | null
    granted: boolean | null
    capturedAt: string | null
  }>
}
