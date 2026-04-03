// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

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
