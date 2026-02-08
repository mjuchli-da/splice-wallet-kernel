// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Browser extension storage implementation of the Store API.
 *
 * This store is single-tenant (one user per browser extension) and persists
 * all data to the browser extension's `storage.local` API. Data survives
 * popup closes, service worker restarts, and browser restarts.
 *
 * Usage:
 * ```ts
 * import Browser from 'webextension-polyfill'
 * const store = new ExtensionStore(Browser.storage.local)
 * await store.initialize({ networks: [...], idps: [...] })
 * ```
 */

import {
    AuthContext,
    AuthAware,
    assertConnected,
    Idp,
} from '@canton-network/core-wallet-auth'
import {
    Store,
    Wallet,
    PartyId,
    Session,
    WalletFilter,
    CurrentNetworkWalletFilter,
    Transaction,
    UpdateWallet,
    Network,
} from '@canton-network/core-wallet-store'

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
    WALLETS: 'splice_wallets',
    SESSION: 'splice_session',
    NETWORKS: 'splice_networks',
    IDPS: 'splice_idps',
    TRANSACTIONS: 'splice_transactions',
} as const

// ─── Serialized transaction type ────────────────────────────────────────────

/**
 * Transactions contain Date fields which are serialized to ISO strings
 * when stored in browser.storage.local (JSON serialization).
 */
interface SerializedTransaction {
    status: Transaction['status']
    commandId: string
    preparedTransaction: string
    preparedTransactionHash: string
    payload?: unknown
    origin: string | null
    createdAt?: string
    signedAt?: string
}

function serializeTransaction(tx: Transaction): SerializedTransaction {
    const serialized: SerializedTransaction = {
        status: tx.status,
        commandId: tx.commandId,
        preparedTransaction: tx.preparedTransaction,
        preparedTransactionHash: tx.preparedTransactionHash,
        payload: tx.payload,
        origin: tx.origin,
    }
    if (tx.createdAt) {
        serialized.createdAt = tx.createdAt.toISOString()
    }
    if (tx.signedAt) {
        serialized.signedAt = tx.signedAt.toISOString()
    }
    return serialized
}

function deserializeTransaction(raw: SerializedTransaction): Transaction {
    const tx: Transaction = {
        status: raw.status,
        commandId: raw.commandId,
        preparedTransaction: raw.preparedTransaction,
        preparedTransactionHash: raw.preparedTransactionHash,
        payload: raw.payload,
        origin: raw.origin,
    }
    if (raw.createdAt) {
        tx.createdAt = new Date(raw.createdAt)
    }
    if (raw.signedAt) {
        tx.signedAt = new Date(raw.signedAt)
    }
    return tx
}

// ─── Default config ─────────────────────────────────────────────────────────

export interface ExtensionStoreDefaults {
    networks?: Array<Network>
    idps?: Array<Idp>
}

// ─── ExtensionStore ─────────────────────────────────────────────────────────

export class ExtensionStore implements Store, AuthAware<ExtensionStore> {
    authContext: AuthContext | undefined

    constructor(
        private storage: ExtensionStorageArea,
        authContext?: AuthContext
    ) {
        this.authContext = authContext
    }

    /**
     * Initialize the store with default networks and IDPs.
     * Only writes defaults for keys that don't already exist in storage,
     * preserving any data from previous sessions.
     */
    async initialize(defaults?: ExtensionStoreDefaults): Promise<void> {
        if (!defaults) return

        const existing = await this.storage.get([
            STORAGE_KEY.NETWORKS,
            STORAGE_KEY.IDPS,
        ])

        const updates: Record<string, unknown> = {}

        if (
            !existing[STORAGE_KEY.NETWORKS] &&
            defaults.networks &&
            defaults.networks.length > 0
        ) {
            updates[STORAGE_KEY.NETWORKS] = defaults.networks
        }

        if (
            !existing[STORAGE_KEY.IDPS] &&
            defaults.idps &&
            defaults.idps.length > 0
        ) {
            updates[STORAGE_KEY.IDPS] = defaults.idps
        }

        if (Object.keys(updates).length > 0) {
            await this.storage.set(updates)
        }
    }

    // ─── AuthAware ──────────────────────────────────────────────────────

    withAuthContext(context?: AuthContext): ExtensionStore {
        return new ExtensionStore(this.storage, context)
    }

    private assertConnected(): string {
        return assertConnected(this.authContext).userId
    }

    // ─── Storage helpers ────────────────────────────────────────────────

    private async readKey<T>(key: string, defaultValue: T): Promise<T> {
        const result = await this.storage.get(key)
        return (result[key] as T) ?? defaultValue
    }

    private async writeKey<T>(key: string, value: T): Promise<void> {
        await this.storage.set({ [key]: value })
    }

    // ─── Wallet methods ─────────────────────────────────────────────────

    async getAllWallets(filter: WalletFilter = {}): Promise<Array<Wallet>> {
        const wallets = await this.readKey<Array<Wallet>>(
            STORAGE_KEY.WALLETS,
            []
        )
        const { networkIds, signingProviderIds } = filter
        const networkIdSet = networkIds ? new Set(networkIds) : null
        const signingProviderIdSet = signingProviderIds
            ? new Set(signingProviderIds)
            : null

        return wallets.filter((wallet) => {
            const matchNetwork = networkIdSet
                ? networkIdSet.has(wallet.networkId)
                : true
            const matchSigning = signingProviderIdSet
                ? signingProviderIdSet.has(wallet.signingProviderId)
                : true
            return matchNetwork && matchSigning
        })
    }

    async getWallets(
        filter: CurrentNetworkWalletFilter = {}
    ): Promise<Array<Wallet>> {
        const network = await this.getCurrentNetwork()
        return this.getAllWallets({
            ...filter,
            networkIds: [network.id],
        })
    }

    async getPrimaryWallet(): Promise<Wallet | undefined> {
        const wallets = await this.getWallets()
        return wallets.find((w) => w.primary === true)
    }

    async setPrimaryWallet(partyId: PartyId): Promise<void> {
        const network = await this.getCurrentNetwork()
        const wallets = await this.readKey<Array<Wallet>>(
            STORAGE_KEY.WALLETS,
            []
        )

        const networkWallets = wallets.filter((w) => w.networkId === network.id)

        if (!networkWallets.some((w) => w.partyId === partyId)) {
            throw new Error(
                `Wallet with partyId "${partyId}" not found in network "${network.id}"`
            )
        }

        const updated = wallets.map((w) => {
            if (w.networkId === network.id) {
                return { ...w, primary: w.partyId === partyId }
            }
            return w
        })

        await this.writeKey(STORAGE_KEY.WALLETS, updated)
    }

    async addWallet(wallet: Wallet): Promise<void> {
        const wallets = await this.readKey<Array<Wallet>>(
            STORAGE_KEY.WALLETS,
            []
        )

        if (
            wallets.some(
                (w) =>
                    w.partyId === wallet.partyId &&
                    w.networkId === wallet.networkId
            )
        ) {
            throw new Error(
                `Wallet with partyId "${wallet.partyId}" already exists in network "${wallet.networkId}"`
            )
        }

        // Auto-primary: first wallet in a network becomes primary
        const networkWallets = wallets.filter(
            (w) => w.networkId === wallet.networkId
        )
        if (networkWallets.length === 0) {
            wallet = { ...wallet, primary: true }
        }

        // If the new wallet is primary, clear others in the same network
        let updated: Array<Wallet>
        if (wallet.primary) {
            updated = wallets.map((w) =>
                w.networkId === wallet.networkId ? { ...w, primary: false } : w
            )
        } else {
            updated = [...wallets]
        }

        updated.push(wallet)
        await this.writeKey(STORAGE_KEY.WALLETS, updated)
    }

    async updateWallet({
        status,
        partyId,
        networkId,
        externalTxId,
    }: UpdateWallet): Promise<void> {
        const targetNetworkId = networkId ?? (await this.getCurrentNetwork()).id
        const wallets = await this.readKey<Array<Wallet>>(
            STORAGE_KEY.WALLETS,
            []
        )

        const updated = wallets.map((wallet) =>
            wallet.partyId === partyId && wallet.networkId === targetNetworkId
                ? { ...wallet, status, externalTxId }
                : wallet
        )

        await this.writeKey(STORAGE_KEY.WALLETS, updated)
    }

    async removeWallet(partyId: PartyId): Promise<void> {
        const network = await this.getCurrentNetwork()
        const wallets = await this.readKey<Array<Wallet>>(
            STORAGE_KEY.WALLETS,
            []
        )

        const updated = wallets.filter(
            (w) => !(w.partyId === partyId && w.networkId === network.id)
        )

        await this.writeKey(STORAGE_KEY.WALLETS, updated)
    }

    // ─── Session methods ────────────────────────────────────────────────

    async getSession(): Promise<Session | undefined> {
        const session = await this.readKey<Session | null>(
            STORAGE_KEY.SESSION,
            null
        )
        return session ?? undefined
    }

    async setSession(session: Session): Promise<void> {
        await this.writeKey(STORAGE_KEY.SESSION, session)
    }

    async removeSession(): Promise<void> {
        await this.storage.remove(STORAGE_KEY.SESSION)
    }

    // ─── IDP methods ────────────────────────────────────────────────────

    async getIdp(idpId: string): Promise<Idp> {
        this.assertConnected()
        const idps = await this.listIdps()
        const idp = idps.find((i) => i.id === idpId)
        if (!idp) {
            throw new Error(`IdP "${idpId}" not found`)
        }
        return idp
    }

    async listIdps(): Promise<Array<Idp>> {
        return this.readKey<Array<Idp>>(STORAGE_KEY.IDPS, [])
    }

    async addIdp(idp: Idp): Promise<void> {
        this.assertConnected()
        const idps = await this.listIdps()

        if (idps.find((i) => i.id === idp.id)) {
            throw new Error(`IdP "${idp.id}" already exists`)
        }

        await this.writeKey(STORAGE_KEY.IDPS, [...idps, idp])
    }

    async updateIdp(idp: Idp): Promise<void> {
        this.assertConnected()
        const idps = await this.listIdps()
        const index = idps.findIndex((i) => i.id === idp.id)
        if (index === -1) {
            throw new Error(`IdP "${idp.id}" not found`)
        }
        const updated = [...idps]
        updated[index] = idp
        await this.writeKey(STORAGE_KEY.IDPS, updated)
    }

    async removeIdp(idpId: string): Promise<void> {
        this.assertConnected()
        const idps = await this.listIdps()
        await this.writeKey(
            STORAGE_KEY.IDPS,
            idps.filter((i) => i.id !== idpId)
        )
    }

    // ─── Network methods ────────────────────────────────────────────────

    async getNetwork(networkId: string): Promise<Network> {
        const networks = await this.listNetworks()
        const network = networks.find((n) => n.id === networkId)
        if (!network) {
            throw new Error(`Network "${networkId}" not found`)
        }
        return network
    }

    async getCurrentNetwork(): Promise<Network> {
        const session = await this.getSession()
        if (!session) {
            throw new Error('No session found')
        }
        const networkId = session.network
        if (!networkId) {
            throw new Error('No current network set in session')
        }
        return this.getNetwork(networkId)
    }

    async listNetworks(): Promise<Array<Network>> {
        return this.readKey<Array<Network>>(STORAGE_KEY.NETWORKS, [])
    }

    async addNetwork(network: Network): Promise<void> {
        const networks = await this.listNetworks()
        if (networks.find((n) => n.id === network.id)) {
            throw new Error(`Network "${network.id}" already exists`)
        }
        await this.writeKey(STORAGE_KEY.NETWORKS, [...networks, network])
    }

    async updateNetwork(network: Network): Promise<void> {
        this.assertConnected()
        const networks = await this.listNetworks()
        const filtered = networks.filter((n) => n.id !== network.id)
        await this.writeKey(STORAGE_KEY.NETWORKS, [...filtered, network])
    }

    async removeNetwork(networkId: string): Promise<void> {
        this.assertConnected()
        const networks = await this.listNetworks()
        await this.writeKey(
            STORAGE_KEY.NETWORKS,
            networks.filter((n) => n.id !== networkId)
        )
    }

    // ─── Transaction methods ────────────────────────────────────────────

    async setTransaction(tx: Transaction): Promise<void> {
        this.assertConnected()
        const txMap = await this.readTransactionMap()
        txMap.set(tx.commandId, serializeTransaction(tx))
        await this.writeTransactionMap(txMap)
    }

    async getTransaction(commandId: string): Promise<Transaction | undefined> {
        this.assertConnected()
        const txMap = await this.readTransactionMap()
        const raw = txMap.get(commandId)
        return raw ? deserializeTransaction(raw) : undefined
    }

    async listTransactions(): Promise<Array<Transaction>> {
        this.assertConnected()
        const txMap = await this.readTransactionMap()
        return Array.from(txMap.values()).map(deserializeTransaction)
    }

    // ─── Transaction storage helpers ────────────────────────────────────

    /**
     * Transactions are stored as a JSON array of [commandId, SerializedTransaction]
     * entries. We convert to/from a Map for efficient lookups.
     */
    private async readTransactionMap(): Promise<
        Map<string, SerializedTransaction>
    > {
        const entries = await this.readKey<
            Array<[string, SerializedTransaction]>
        >(STORAGE_KEY.TRANSACTIONS, [])
        return new Map(entries)
    }

    private async writeTransactionMap(
        txMap: Map<string, SerializedTransaction>
    ): Promise<void> {
        await this.writeKey(
            STORAGE_KEY.TRANSACTIONS,
            Array.from(txMap.entries())
        )
    }
}
