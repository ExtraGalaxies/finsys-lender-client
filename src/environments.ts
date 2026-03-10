// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 ExtraGalaxies

import type { LenderEnvironment } from './types.js'

export interface EnvironmentConfig {
  baseUrl: string
  paths: {
    login: string
    list: string
    details: string
    update: string
    download: string
    programs: string
  }
}

const ENVIRONMENTS: Record<LenderEnvironment, EnvironmentConfig> = {
  staging: {
    baseUrl: 'https://api.finhero.asia/stage/buyerfuel/lender/v1',
    paths: {
      login: '/login',
      list: '/list',
      details: '',
      update: '/update',
      download: '/download',
      programs: '/programs',
    },
  },
  production: {
    baseUrl: 'https://api.finhero.asia/buyerfuel/lender/v1',
    paths: {
      login: '/login',
      list: '/list',
      details: '',
      update: '/update',
      download: '/download',
      programs: '/programs',
    },
  },
}

export function getEnvironmentConfig(environment: LenderEnvironment): EnvironmentConfig {
  return ENVIRONMENTS[environment]
}
