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
  /** SYS-3615 — the v2 list. See SubjectApplicationListPage. */
  APPLICATION_LIST_V2 = 'application_list_v2',
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

/* ------------------------------------------------------------------ *
 * SYS-3615 — the v2 application list.
 *
 * `getApplicationList` (v1) and `listApplicationsV2` DO NOT MEAN THE SAME
 * THING, and the difference is not only the envelope:
 *
 *   v1 filters and sorts by naming FLAT COLUMNS on the application row
 *   (`fullName`, `companyName`), and pages by OFFSET.
 *   v2 names declared SUBJECT LABELS (`subject.companyName`), and pages by
 *   KEYSET cursor. There is deliberately no total and no page number.
 *
 * WHY THESE TYPES ARE NARROW, when `Application` above is not. `Application`
 * opens with `[key: string]: unknown` and types every field optional, so
 * `application.fullName` compiles and yields `undefined` whether or not the
 * server serves the field — a consumer's build cannot detect a shape change,
 * which is exactly the migration signal a consumer moving off v1 needs. The
 * v2 list item is therefore declared precisely: every field the endpoint
 * always emits is REQUIRED (null where the contract says nullable), no index
 * signature, and a field this SDK version does not know about is a type
 * error rather than a silent `undefined`. Adding one is an SDK release.
 * ------------------------------------------------------------------ */

/**
 * The subject labels this contract declares. A label is an ordered list of
 * sources resolved to one value; the id is what a filter and a sort name.
 *
 * Closed on purpose. A deployment that declares a new label is a contract
 * change that gets an SDK release — which is the migration signal. The runtime
 * payload still carries any extra keys; they are simply not typed here.
 */
export type SubjectLabelId = 'subject.companyName' | 'subject.personName'

/** Sort keys the endpoint publishes: label ids and record-plane fields only. */
export type SubjectApplicationSortKey =
  | 'ihsId'
  | 'createdAt'
  | 'updatedAt'
  | SubjectLabelId
  /**
   * SYS-3617 — the record-plane fields the list projects, now also sortable.
   *
   * NOTE THE SPELLING of the last one: v1 emits this field as `borrowerAgent`
   * and this endpoint sorts it as `borrowerAgentName`, matching what the v2
   * list projects. The v1 name is refused, not ignored.
   *
   * All three are nullable, and a null sorts as its own rank rather than
   * wherever the engine puts it, so paging covers a row with no program or no
   * agent exactly once.
   */
  | 'statusDescription'
  | 'programName'
  | 'borrowerAgentName'

export type SubjectSortDirection = 'ASC' | 'DESC'

/**
 * One resolved label. `source` is not decoration: a `legacy:`-prefixed source
 * names a flat column, and a consumer needs to know which of its values rest
 * on one without making a second call.
 */
export interface SubjectLabel {
  value: string
  source: string
}

/**
 * One row of the v2 list.
 *
 * `labels` models ABSENCE, never null: a label no declared source produced —
 * and equally one this caller is not authorised to see — is missing from the
 * object. The two are indistinguishable by design, so `Partial<Record<…>>` is
 * the honest type; a `SubjectLabel | null` would claim a distinction the wire
 * does not make.
 */
export interface SubjectApplicationListItem {
  ihsId: number
  status: string
  statusDescription: string | null
  programId: number | null
  programName: string | null
  borrowerAgentId: number | null
  /**
   * v1's list spells this `borrowerAgent` and reads the id off the joined
   * company row, so a missing company nulls BOTH fields. Here the id is read
   * off the application, so `{borrowerAgentId: 404, borrowerAgentName: null}`
   * is a reportable state: a dangling reference, not a hidden one.
   */
  borrowerAgentName: string | null
  totalFinancing: number | null
  /**
   * The jurisdiction this row's amounts are denominated in — read it before
   * rendering any money, because `totalFinancing` carries no currency.
   *
   * NULL MEANS MALAYSIA, not "unknown": the column is null on every row filed
   * before multi-jurisdiction support, and the server does not stamp one in.
   * Always present, null included.
   */
  jurisdiction: string | null
  /**
   * ISO 8601, MILLISECOND-truncated, and rendered from a ZONELESS column.
   *
   * The same Date→ISO hazard the cursor documentation above spells out, on a
   * field a consumer can actually read. Upstream selects the raw `DATETIME`
   * and the DataSource sets neither `dateStrings` nor `timezone`, so the
   * driver hands Express a JS `Date` and `res.json()` renders it with
   * `toISOString()`. Two things are lost in that step, both silently:
   *
   *   PRECISION. The column is `datetime(6)`; a `Date` is milliseconds. A
   *   stored `…:39.991297` reaches you as `…:39.991Z`. Roughly a quarter of
   *   rows measured carried sub-millisecond digits.
   *
   *   ZONE. `toISOString()` stamps a `Z` using the API PROCESS's timezone.
   *   The column stores no zone, so the `Z` is an assertion about where the
   *   server was configured, not a fact about the row.
   *
   * Neither is visible in test, because every harness in this estate runs UTC.
   *
   * DO NOT DERIVE `updatedAfter` FROM THIS VALUE. You would be closing a loop
   * across two clocks: this string is rendered in the API process's zone,
   * while `updatedAfter` is compared as `updatedAt > FROM_UNIXTIME(?)` in the
   * MySQL SESSION's zone against that same zoneless column. The watermark
   * lands off by the two zones' difference plus up to 999µs of truncation, and
   * the page that comes back — replaying rows, or skipping them — looks
   * entirely well formed. Carry a watermark you own instead.
   */
  createdAt: string
  /** ISO 8601. Same millisecond truncation and zone caveat as `createdAt` — read it there before using this to page. */
  updatedAt: string
  labels: Partial<Record<SubjectLabelId, SubjectLabel>>
  /**
   * When this subject's labels were last derived; null when they have not
   * been. The application is still returned, with no labels. NOT an input to
   * any resolution rule.
   */
  labelsResolvedAt: string | null
}

export interface SubjectApplicationListPagination {
  /**
   * OPAQUE. Pass it back verbatim as `cursor`; null means the last page.
   *
   * Its encoding is not part of the contract and this SDK never reads it.
   * SYS-3611 records what happens when something does: spelled from a JS
   * `Date`, `toISOString()` renders UTC against a wall-clock `DATETIME` — 8
   * hours early under `Asia/Kuala_Lumpur` — and millisecond precision loses a
   * `datetime(6)`'s microseconds. Both silently skip rows, which is
   * indistinguishable from a correct empty result.
   */
  nextCursor: string | null
  /** The page size the server actually applied (its default and clamp, not the client's). */
  size: number
}

export interface SubjectApplicationListPage {
  list: SubjectApplicationListItem[]
  pagination: SubjectApplicationListPagination
}

/**
 * Options for `listApplicationsV2`. Every one is optional and NOTHING is sent
 * that the caller did not ask for — the server owns the default page size
 * (50) and the ceiling (200), and a client-side default would be a second
 * copy of a policy that has to agree.
 */
export interface SubjectApplicationListOptions {
  /**
   * Rows per page. Sent verbatim: this SDK does not clamp and does not
   * reinterpret. The server reads `<= 0` as its default (50), NOT as v1's
   * "as many as possible" — a caller carrying v1's reading across gets a
   * page 10x smaller than it asked for, and that belongs in one place.
   */
  size?: number
  /**
   * A `nextCursor` from a previous page, passed back UNCHANGED. Do not
   * construct one, do not decode one, and never route one through a `Date`.
   *
   * A cursor is bound to the ordering that issued it: re-sending it with a
   * different `sortBy` or `sort` is a 400, not a re-sorted page. Change the
   * ordering by starting again with no cursor.
   */
  cursor?: string
  sortBy?: SubjectApplicationSortKey
  sort?: SubjectSortDirection
  /**
   * Substring match per label id. A filter naming a label this caller may not
   * see is a 400 carrying `VALIDATION_ERROR`, never silently ignored —
   * ignoring it would answer with a superset of what was asked for.
   *
   * Read the code with `lenderErrorCode(error)`. The body is
   * `{err:{code, desc}}`, so it is at `responseData.err.code`;
   * `responseData.code` is `undefined` for every refusal this server produces.
   *
   * An empty term is REFUSED locally rather than sent, for the same reason an
   * empty `cursor` is: the server drops an empty filter parameter, so a term
   * that arrived empty by accident comes back as a well-formed page over the
   * unfiltered superset.
   */
  labels?: Partial<Record<SubjectLabelId, string>>
  status?: string | readonly string[]
  /**
   * Return only the application with this id. EQUALITY, not a range —
   * `ihsId` is the keyset cursor's tiebreaker, so pinning it to one value
   * is compatible with every ordering while a range would interact with
   * the cursor comparison.
   *
   * Combined with other filters these are ANDed, so an id excluded by one
   * of them returns an EMPTY page rather than that application.
   */
  ihsId?: number
  programId?: number
  borrowerAgentId?: number
  minTotalFinancing?: number
  maxTotalFinancing?: number
  /** Unix SECONDS. Applications updated strictly after this instant. */
  updatedAfter?: number
}
