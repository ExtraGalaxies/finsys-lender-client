# @finsys/lender-client

Official typed API client for the FinSys Lender API, developed by [ExtraGalaxies](https://github.com/ExtraGalaxies), a subsidiary of [FinHero](https://finhero.asia). Built-in environment management and strongly typed interfaces.

## Installation

```bash
npm install @finsys/lender-client
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
| `isAuthenticated()` | `boolean` |
| `getEnvironment()` | `LenderEnvironment` |

## Data Handling

This package retrieves and transmits loan application data that may contain personally identifiable information (PII). Consumers are responsible for handling this data in compliance with applicable privacy regulations (e.g., PDPA, GDPR).

Credentials and tokens are held in memory only and are not persisted to disk or logs.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.
