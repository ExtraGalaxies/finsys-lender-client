# @finsys/lender-client

Official typed API client for the FinSys Lender API, developed by [ExtraGalaxies](https://github.com/ExtraGalaxies), a subsidiary of [FinHero](https://finhero.asia). Built-in environment management and strongly typed interfaces.

## Installation

```bash
npm install @finsys/lender-client
```

## Prerequisites (contributors)

This package targets Node 24.16.0 and npm >= 12.0.1. After selecting the pinned Node version, upgrade npm to the required baseline:

```bash
nvm use              # picks up .nvmrc (24.16.0)
npm install -g npm@12.0.1
```

## Usage

```typescript
import { LenderClient } from '@finsys/lender-client'

const client = new LenderClient({
  environment: 'staging',
  credentials: {
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    subscriptionKey: 'your-subscription-key',
  },
})

await client.login()

// List applications
const result = await client.getApplicationList({ status: ['New'] })
console.log(result.applications)

// Get application details
const app = await client.getApplicationDetails(12345)

// Update status
await client.updateApplicationStatus(12345, {
  status: 'Approved',
  statusDescription: 'Application approved',
  approvedAmount: 50000,
})

// Download documents
const archive = await client.downloadAllDocuments(12345)
const file = await client.downloadFile(12345, 1)

// Upload document
await client.uploadDocument(12345, {
  path: '/path/to/file.pdf',
  name: 'document.pdf',
  mimeType: 'application/pdf',
})

// List programs
const programs = await client.getPrograms()

// Get a container-scoped update-feed SAS for the desktop auto-updater
const feed = await client.getUpdateFeedSas('signed')
// Compose per-file URLs: `${feed.containerUrl}/latest.yml?${feed.sasToken}`
```

## Environments

The client manages API URLs internally. Pass `'staging'` or `'production'` — no URL configuration needed.

```typescript
client.getEnvironment() // 'staging' | 'production'
client.isAuthenticated() // boolean
```

## Error Handling

All API errors throw `LenderApiError` with structured context:

```typescript
import { LenderApiError } from '@finsys/lender-client'

try {
  await client.getApplicationDetails(99999)
} catch (error) {
  if (error instanceof LenderApiError) {
    console.log(error.statusCode)    // 404
    console.log(error.isAuthError)   // false
    console.log(error.isNetworkError) // false
    console.log(error.responseData)  // raw API response
  }
}
```

## API

### `LenderClient`

| Method | Returns |
|---|---|
| `login()` | `Promise<void>` |
| `getApplicationList(filter?, page?, size?)` | `Promise<ApplicationListResult>` |
| `getApplicationDetails(ihsId)` | `Promise<Application>` |
| `updateApplicationStatus(id, request)` | `Promise<StatusUpdateResult>` |
| `downloadAllDocuments(ihsId)` | `Promise<DocumentArchive>` |
| `downloadFile(ihsId, documentId)` | `Promise<FileDownload>` |
| `uploadDocument(ihsId, file)` | `Promise<UploadResult>` |
| `getPrograms()` | `Promise<Program[]>` |
| `getCanonicalView(ihsId, include?)` | `Promise<CanonicalView>` — the v2 read: canonical facts, each in a provenance envelope. **Not** a drop-in for `getApplicationDetails`: v1 merges *your* pending edit overlay, v2 returns the attested fact. |
| `getApplicationRecord(ihsId)` | `Promise<ApplicationRecord>` — the application record (status, facility, parties) that v2 deliberately does not carry. A consumer migrating off v1 needs both. |
| `isAuthenticated()` | `boolean` |
| `getEnvironment()` | `LenderEnvironment` |

### Reading a canonical view

Resolve values with the shared resolver, never by hand — instance selection is
the part consumers get subtly different from each other, and a wrongly chosen
instance is a plausible value rather than an error.

| Function | Returns |
|---|---|
| `resolveCanonicalValue(view, address)` | `number \| boolean \| string \| undefined` |
| `resolveCanonicalEnvelope(view, address)` | `CanonicalFieldEnvelope \| undefined` — the value with its provenance |

```typescript
import type { CanonicalView, CanonicalAddress } from '@finsys/lender-client'
import { resolveCanonicalValue } from '@finsys/lender-client'

const view: CanonicalView = await client.getCanonicalView(ihsId)
const address: CanonicalAddress = { category: 'applicant-contact', field: 'contactValue', instanceKey: 'mobile' }
const mobile = resolveCanonicalValue(view, address)
```

The envelope types — `CanonicalView`, `CanonicalCategory`, `CanonicalInstance`,
`CanonicalFieldEnvelope`, `CanonicalAddress` — are declared in `@finsys/core`
and re-exported here; import them from either package. (2.5.0 declared them but
did not export the names; 2.6.0 is the first release in which they are
importable.)

## Data Handling

This package retrieves and transmits loan application data that may contain personally identifiable information (PII). Consumers are responsible for handling this data in compliance with applicable privacy regulations (e.g., PDPA, GDPR).

Credentials and tokens are held in memory only and are not persisted to disk or logs.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.
