// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

import type { LenderEnvironment } from './types.js'
import { LenderEndpoint } from './types.js'

export const BASE_URLS: Record<LenderEnvironment, string> = {
  staging: 'https://api.finhero.asia/stage/buyerfuel/lender/v1',
  production: 'https://api.finhero.asia/buyerfuel/lender/v1',
}

export const ENDPOINT_PATHS: Record<LenderEndpoint, string> = {
  [LenderEndpoint.LOGIN]: '/login',
  [LenderEndpoint.LIST]: '/list',
  [LenderEndpoint.DETAILS]: '',
  [LenderEndpoint.UPDATE]: '/update',
  [LenderEndpoint.DOWNLOAD]: '',
  [LenderEndpoint.UPLOAD]: '',
  [LenderEndpoint.PROGRAMS]: '/programs',
  [LenderEndpoint.CONSENTS]: '',
}
