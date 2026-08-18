// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

import type { LenderEnvironment } from './types.js'
import { LenderEndpoint } from './types.js'

export const BASE_URLS: Record<LenderEnvironment, string> = {
  staging: 'https://finsys-api-stage.finhero.asia/lender',
  production: 'https://finsys-api.finhero.asia/lender',
}

export const ENDPOINT_PATHS: Record<LenderEndpoint, string> = {
  [LenderEndpoint.LOGIN]: '/login',
  [LenderEndpoint.LIST]: '/ihs/list',
  [LenderEndpoint.DETAILS]: '/ihs',
  [LenderEndpoint.UPDATE]: '/ihs/update',
  [LenderEndpoint.DOWNLOAD]: '/ihs',
  [LenderEndpoint.UPLOAD]: '/ihs',
  [LenderEndpoint.PROGRAMS]: '/program',
  [LenderEndpoint.CONSENTS]: '/ihs',
  [LenderEndpoint.CONSENT_DEFINITIONS]: '/consent-definitions',
  [LenderEndpoint.EXTRACTION_STATUS]: '/ihs',
  // SYS-3416: both are two-segment so neither can be shadowed by '/ihs/:id'.
  [LenderEndpoint.CANONICAL_VIEW]: '/v2/ihs',
  [LenderEndpoint.APPLICATION_RECORD]: '/applications',
  [LenderEndpoint.INSTALLER_LATEST]: '/installer/latest',
  [LenderEndpoint.INSTALLER_DOWNLOAD_URL]: '/installer/download-url',
  [LenderEndpoint.INSTALLER_UPDATE_FEED]: '/installer/update-feed',
}
