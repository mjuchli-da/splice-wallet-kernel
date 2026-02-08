# @canton-network/core-wallet-store-extension

Browser extension storage implementation of the Wallet Gateway **Store** API.

This package provides `ExtensionStore`, a fully compliant implementation of the
[`Store`](../wallet-store/src/Store.ts) interface that persists wallets, sessions,
networks, identity providers, and transactions to the browser extension's
`storage.local` API. Data survives popup closes, service worker restarts, and
browser restarts.

## Design

| Aspect            | Detail                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenancy**       | Single-tenant — the browser extension serves one user at a time. No per-user data partitioning.                                                                                                                                           |
| **Persistence**   | [`browser.storage.local`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local) (Manifest V3 compatible).                                                                                             |
| **AuthAware**     | Implements `AuthAware<ExtensionStore>`. `withAuthContext()` returns a new instance sharing the same underlying storage but with the given auth context. Auth context is used only for `assertConnected()` guards, not for data isolation. |
| **Date handling** | `Transaction.createdAt` / `signedAt` are serialized to ISO 8601 strings on write and deserialized back to `Date` objects on read.                                                                                                         |
| **Dependencies**  | `@canton-network/core-wallet-store` (interface + types) and `@canton-network/core-wallet-auth` (auth context). No Node.js, SQL, or other heavy dependencies.                                                                              |

### Storage keys

All data is stored under namespaced keys to prevent collisions with other
extension data:

| Key                   | Type                         | Description                        |
| --------------------- | ---------------------------- | ---------------------------------- |
| `splice_wallets`      | `Wallet[]`                   | All wallets across all networks    |
| `splice_session`      | `Session \| null`            | The active session (one at a time) |
| `splice_networks`     | `Network[]`                  | Configured Canton networks         |
| `splice_idps`         | `Idp[]`                      | Configured identity providers      |
| `splice_transactions` | `[commandId, Transaction][]` | Transaction history (Map entries)  |

## Installation

```bash
yarn add @canton-network/core-wallet-store-extension
```

## Usage

### Basic setup

```typescript
import Browser from 'webextension-polyfill'
import { ExtensionStore } from '@canton-network/core-wallet-store-extension'

// Create the store backed by browser.storage.local
const store = new ExtensionStore(Browser.storage.local)
```

### Initializing with defaults

On first launch you typically want to seed the store with pre-configured
networks and identity providers. `initialize()` only writes defaults for keys
that don't already exist in storage, preserving user modifications across
extension updates:

```typescript
await store.initialize({
    networks: [
        {
            id: 'canton:local-self-signed',
            name: 'Local (Self signed)',
            description: 'Local development network',
            identityProviderId: 'idp-self-signed',
            auth: { method: 'self_signed' /* ... */ },
            ledgerApi: { baseUrl: 'http://127.0.0.1:5003' },
        },
    ],
    idps: [
        {
            id: 'idp-self-signed',
            type: 'self_signed',
            issuer: 'unsafe-auth',
        },
    ],
})
```

### Using with auth context

The background service worker creates per-request store instances with the
caller's auth context:

```typescript
import { authContextFromToken } from './auth/auth-service'

const authContext = authContextFromToken(accessToken)
const authenticatedStore = store.withAuthContext(authContext)

// Methods that require authentication will now succeed
const wallets = await authenticatedStore.getWallets()
```

### Testing with a mock storage backend

The constructor accepts any object implementing the `ExtensionStorageArea`
interface, making it easy to test without a real browser:

```typescript
import { ExtensionStore } from '@canton-network/core-wallet-store-extension'

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

const store = new ExtensionStore(mockStorage)
```

## API

`ExtensionStore` implements the full
[`Store`](../wallet-store/src/Store.ts) interface:

## Building

```bash
yarn build
```

## License

Apache-2.0
