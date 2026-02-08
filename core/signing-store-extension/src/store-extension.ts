// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Browser extension storage implementation of the SigningDriverStore API.
 *
 * This store is single-tenant (one user per browser extension) and persists
 * all signing data (keys, transactions, configuration) to the browser
 * extension's `storage.local` API. Data survives popup closes, service worker
 * restarts, and browser restarts.
 *
 * The `userId` parameter on interface methods is accepted for API compliance
 * but is not used for data partitioning — all data lives in a single namespace.
 *
 * Usage:
 * ```ts
 * import Browser from 'webextension-polyfill'
 * const signingStore = new SigningStoreExtension(Browser.storage.local)
 * ```
 */

import type {
    SigningDriverStore,
    SigningKey,
    SigningTransaction,
    SigningDriverConfig,
    SigningDriverStatus,
} from '@canton-network/core-signing-lib'

// ─── Storage adapter interface ──────────────────────────────────────────────

/**
 * Minimal interface matching `browser.storage.local` from webextension-polyfill.
 * Accepting this interface allows the store to work with any compatible backend
 * (real browser storage, mocks for testing, etc.).
 */
export interface ExtensionStorageArea {
    get(keys?: string | string[] | null): Promise<Record<string, unknown>>
    set(items: Record<string, unknown>): Promise<void>
    remove(keys: string | string[]): Promise<void>
}

// ─── Storage keys ───────────────────────────────────────────────────────────

const STORAGE_KEY = {
    KEYS: 'splice_signing_keys',
    TRANSACTIONS: 'splice_signing_transactions',
    CONFIGS: 'splice_signing_configs',
} as const

// ─── Date serialization ────────────────────────────────────────────────────

/**
 * Browser storage serializes to JSON, so Date objects become strings.
 * We serialize/deserialize explicitly for type safety.
 */

interface SerializedSigningKey {
    id: string
    name: string
    publicKey: string
    privateKey?: string
    metadata?: Record<string, unknown>
    createdAt: string
    updatedAt: string
}

interface SerializedSigningTransaction {
    id: string
    hash: string
    signature?: string
    publicKey: string
    status: SigningDriverStatus
    metadata?: Record<string, unknown>
    createdAt: string
    updatedAt: string
    signedAt?: string
}

function serializeKey(key: SigningKey): SerializedSigningKey {
    const serialized: SerializedSigningKey = {
        id: key.id,
        name: key.name,
        publicKey: key.publicKey,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
    }
    if (key.privateKey !== undefined) {
        serialized.privateKey = key.privateKey
    }
    if (key.metadata !== undefined) {
        serialized.metadata = key.metadata
    }
    return serialized
}

function deserializeKey(raw: SerializedSigningKey): SigningKey {
    const key: SigningKey = {
        id: raw.id,
        name: raw.name,
        publicKey: raw.publicKey,
        createdAt: new Date(raw.createdAt),
        updatedAt: new Date(raw.updatedAt),
    }
    if (raw.privateKey !== undefined) {
        key.privateKey = raw.privateKey
    }
    if (raw.metadata !== undefined) {
        key.metadata = raw.metadata
    }
    return key
}

function serializeTransaction(
    tx: SigningTransaction
): SerializedSigningTransaction {
    const serialized: SerializedSigningTransaction = {
        id: tx.id,
        hash: tx.hash,
        publicKey: tx.publicKey,
        status: tx.status,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
    }
    if (tx.signature !== undefined) {
        serialized.signature = tx.signature
    }
    if (tx.metadata !== undefined) {
        serialized.metadata = tx.metadata
    }
    if (tx.signedAt) {
        serialized.signedAt = tx.signedAt.toISOString()
    }
    return serialized
}

function deserializeTransaction(
    raw: SerializedSigningTransaction
): SigningTransaction {
    const tx: SigningTransaction = {
        id: raw.id,
        hash: raw.hash,
        publicKey: raw.publicKey,
        status: raw.status,
        createdAt: new Date(raw.createdAt),
        updatedAt: new Date(raw.updatedAt),
    }
    if (raw.signature !== undefined) {
        tx.signature = raw.signature
    }
    if (raw.metadata !== undefined) {
        tx.metadata = raw.metadata
    }
    if (raw.signedAt) {
        tx.signedAt = new Date(raw.signedAt)
    }
    return tx
}

// ─── SigningStoreExtension ──────────────────────────────────────────────────

export class SigningStoreExtension implements SigningDriverStore {
    constructor(private storage: ExtensionStorageArea) {}

    // ─── Storage helpers ────────────────────────────────────────────────

    private async readKey<T>(key: string, defaultValue: T): Promise<T> {
        const result = await this.storage.get(key)
        return (result[key] as T) ?? defaultValue
    }

    private async writeKey<T>(key: string, value: T): Promise<void> {
        await this.storage.set({ [key]: value })
    }

    private async readKeyMap(): Promise<Map<string, SerializedSigningKey>> {
        const entries = await this.readKey<
            Array<[string, SerializedSigningKey]>
        >(STORAGE_KEY.KEYS, [])
        return new Map(entries)
    }

    private async writeKeyMap(
        map: Map<string, SerializedSigningKey>
    ): Promise<void> {
        await this.writeKey(STORAGE_KEY.KEYS, Array.from(map.entries()))
    }

    private async readTxMap(): Promise<
        Map<string, SerializedSigningTransaction>
    > {
        const entries = await this.readKey<
            Array<[string, SerializedSigningTransaction]>
        >(STORAGE_KEY.TRANSACTIONS, [])
        return new Map(entries)
    }

    private async writeTxMap(
        map: Map<string, SerializedSigningTransaction>
    ): Promise<void> {
        await this.writeKey(STORAGE_KEY.TRANSACTIONS, Array.from(map.entries()))
    }

    private async readConfigMap(): Promise<Map<string, SigningDriverConfig>> {
        const entries = await this.readKey<
            Array<[string, SigningDriverConfig]>
        >(STORAGE_KEY.CONFIGS, [])
        return new Map(entries)
    }

    private async writeConfigMap(
        map: Map<string, SigningDriverConfig>
    ): Promise<void> {
        await this.writeKey(STORAGE_KEY.CONFIGS, Array.from(map.entries()))
    }

    // ─── Key management ─────────────────────────────────────────────────

    async getSigningKey(
        _userId: string,
        keyId: string
    ): Promise<SigningKey | undefined> {
        const keyMap = await this.readKeyMap()
        const raw = keyMap.get(keyId)
        return raw ? deserializeKey(raw) : undefined
    }

    async getSigningKeyByPublicKey(
        publicKey: string
    ): Promise<SigningKey | undefined> {
        const keyMap = await this.readKeyMap()
        for (const raw of keyMap.values()) {
            if (raw.publicKey === publicKey) {
                return deserializeKey(raw)
            }
        }
        return undefined
    }

    async getSigningKeyByName(
        _userId: string,
        name: string
    ): Promise<SigningKey | undefined> {
        const keyMap = await this.readKeyMap()
        for (const raw of keyMap.values()) {
            if (raw.name === name) {
                return deserializeKey(raw)
            }
        }
        return undefined
    }

    async setSigningKey(_userId: string, key: SigningKey): Promise<void> {
        const keyMap = await this.readKeyMap()
        keyMap.set(key.id, serializeKey(key))
        await this.writeKeyMap(keyMap)
    }

    async deleteSigningKey(_userId: string, keyId: string): Promise<void> {
        const keyMap = await this.readKeyMap()
        keyMap.delete(keyId)
        await this.writeKeyMap(keyMap)
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async listSigningKeys(_userId: string): Promise<SigningKey[]> {
        const keyMap = await this.readKeyMap()
        return Array.from(keyMap.values()).map(deserializeKey)
    }

    async setSigningKeys(_userId: string, keys: SigningKey[]): Promise<void> {
        const keyMap = await this.readKeyMap()
        for (const key of keys) {
            keyMap.set(key.id, serializeKey(key))
        }
        await this.writeKeyMap(keyMap)
    }

    // ─── Transaction management ─────────────────────────────────────────

    async getSigningTransaction(
        _userId: string,
        txId: string
    ): Promise<SigningTransaction | undefined> {
        const txMap = await this.readTxMap()
        const raw = txMap.get(txId)
        return raw ? deserializeTransaction(raw) : undefined
    }

    async setSigningTransaction(
        _userId: string,
        transaction: SigningTransaction
    ): Promise<void> {
        const txMap = await this.readTxMap()
        txMap.set(transaction.id, serializeTransaction(transaction))
        await this.writeTxMap(txMap)
    }

    async updateSigningTransactionStatus(
        _userId: string,
        txId: string,
        status: SigningDriverStatus
    ): Promise<void> {
        const txMap = await this.readTxMap()
        const raw = txMap.get(txId)
        if (raw) {
            raw.status = status
            raw.updatedAt = new Date().toISOString()
            if (status === 'signed') {
                raw.signedAt = new Date().toISOString()
            }
            await this.writeTxMap(txMap)
        }
    }

    async listSigningTransactions(
        _userId: string,
        limit?: number,
        before?: string
    ): Promise<SigningTransaction[]> {
        const txMap = await this.readTxMap()
        let txs = Array.from(txMap.values()).map(deserializeTransaction)

        // Sort by createdAt descending (newest first)
        txs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

        // Cursor-based pagination: return items created before the given ID's timestamp
        if (before) {
            const cursorTx = txMap.get(before)
            if (cursorTx) {
                const cursorDate = new Date(cursorTx.createdAt).getTime()
                txs = txs.filter((tx) => tx.createdAt.getTime() < cursorDate)
            }
        }

        return limit ? txs.slice(0, limit) : txs
    }

    async listSigningTransactionsByTxIdsAndPublicKeys(
        txIds: string[],
        publicKeys: string[]
    ): Promise<SigningTransaction[]> {
        const txIdSet = new Set(txIds)
        const publicKeySet = new Set(publicKeys)
        const txMap = await this.readTxMap()
        const result: SigningTransaction[] = []

        for (const raw of txMap.values()) {
            if (txIdSet.has(raw.id) || publicKeySet.has(raw.publicKey)) {
                result.push(deserializeTransaction(raw))
            }
        }
        return result
    }

    async setSigningTransactions(
        _userId: string,
        transactions: SigningTransaction[]
    ): Promise<void> {
        const txMap = await this.readTxMap()
        for (const tx of transactions) {
            txMap.set(tx.id, serializeTransaction(tx))
        }
        await this.writeTxMap(txMap)
    }

    // ─── Configuration management ───────────────────────────────────────

    async getSigningDriverConfiguration(
        _userId: string,
        driverId: string
    ): Promise<SigningDriverConfig | undefined> {
        const configMap = await this.readConfigMap()
        return configMap.get(driverId)
    }

    async setSigningDriverConfiguration(
        _userId: string,
        config: SigningDriverConfig
    ): Promise<void> {
        const configMap = await this.readConfigMap()
        configMap.set(config.driverId, config)
        await this.writeConfigMap(configMap)
    }
}
