# @canton-network/core-signing-store-extension

Browser extension storage implementation of the **SigningDriverStore** API.

This package provides `SigningStoreExtension`, a fully compliant implementation
of the [`SigningDriverStore`](../signing-lib/src/SigningDriverStore.ts) interface
that persists signing keys, signing transactions, and driver configuration to
the browser extension's `storage.local` API. Data survives popup closes, service
worker restarts, and browser restarts.

## Design

| Aspect                 | Detail                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenancy**            | Single-tenant — the browser extension serves one user at a time. The `userId` parameter on interface methods is accepted for API compliance but ignored for data partitioning.      |
| **Persistence**        | [`browser.storage.local`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local) (Manifest V3 compatible).                                       |
| **Date handling**      | `SigningKey.createdAt/updatedAt` and `SigningTransaction.createdAt/updatedAt/signedAt` are serialized to ISO 8601 strings on write and deserialized back to `Date` objects on read. |
| **Status transitions** | `updateSigningTransactionStatus()` automatically sets `signedAt` when the status transitions to `'signed'`, matching the SQL store behavior.                                        |
| **Dependencies**       | `@canton-network/core-signing-lib` (interface + types). No Node.js, SQL, or other heavy dependencies.                                                                               |

### Storage keys

All data is stored under namespaced keys to prevent collisions with other
extension data:

| Key                           | Type                                | Description                               |
| ----------------------------- | ----------------------------------- | ----------------------------------------- |
| `splice_signing_keys`         | `[keyId, SigningKey][]`             | Signing key pairs (Map entries)           |
| `splice_signing_transactions` | `[txId, SigningTransaction][]`      | Signing transaction records (Map entries) |
| `splice_signing_configs`      | `[driverId, SigningDriverConfig][]` | Per-driver configuration (Map entries)    |

## Installation

```bash
yarn add @canton-network/core-signing-store-extension
```

## Usage

### Basic setup

```typescript
import Browser from 'webextension-polyfill'
import { SigningStoreExtension } from '@canton-network/core-signing-store-extension'

// Create the store backed by browser.storage.local
const signingStore = new SigningStoreExtension(Browser.storage.local)
```

### Using with a signing driver

The signing store is typically consumed by a signing driver that manages
cryptographic key material and transaction signing:

```typescript
import { BrowserInternalSigningDriver } from './signing/driver'

const signingStore = new SigningStoreExtension(Browser.storage.local)
const signingDriver = new BrowserInternalSigningDriver(signingStore)

// The driver uses the store to persist keys and track transactions
const controller = signingDriver.controller(userId)
const key = await controller.createKey({ name: 'my-key' })
```

### Testing with a mock storage backend

The constructor accepts any object implementing the `ExtensionStorageArea`
interface, making it easy to test without a real browser:

```typescript
import { SigningStoreExtension } from '@canton-network/core-signing-store-extension'

// Simple in-memory mock
const mockStorage = {
    data: {} as Record<string, unknown>,
    async get(keys?: string | string[] | null) {
        if (!keys) return { ...this.data }
        const arr = typeof keys === 'string' ? [keys] : keys
        const result: Record<string, unknown> = {}
        for (const k of arr) result[k] = this.data[k]
        return result
    },
    async set(items: Record<string, unknown>) {
        Object.assign(this.data, items)
    },
    async remove(keys: string | string[]) {
        const arr = typeof keys === 'string' ? [keys] : keys
        for (const k of arr) delete this.data[k]
    },
}

const signingStore = new SigningStoreExtension(mockStorage)
```

## API

`SigningStoreExtension` implements the full
[`SigningDriverStore`](../signing-lib/src/SigningDriverStore.ts) interface:

## Comparison with other store implementations

|                  | `signing-store-sql`                   | `signing-store-extension`       |
| ---------------- | ------------------------------------- | ------------------------------- |
| **Backend**      | SQLite / PostgreSQL via Kysely        | `browser.storage.local`         |
| **Tenancy**      | Multi-tenant (user isolation via SQL) | Single-tenant (userId ignored)  |
| **Migrations**   | Umzug-based schema migrations         | No schema — JSON serialization  |
| **Environment**  | Node.js server                        | Browser extension (Manifest V3) |
| **Dependencies** | Kysely, better-sqlite3, pg, umzug     | None (only core-signing-lib)    |

## Building

```bash
yarn build
```

## License

Apache-2.0
