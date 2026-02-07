// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory implementation of the wallet Store interface for the browser extension.
 * Mirrors the behavior of @canton-network/core-wallet-store-inmemory's StoreInternal
 * but without pino or LedgerClient dependencies.
 */

import {
    Store,
    Wallet,
    PartyId,
    Session,
    WalletFilter,
    CurrentNetworkWalletFilter,
    Transaction,
    UpdateWallet,
} from '@canton-network/core-wallet-store'
import { Network } from '@canton-network/core-wallet-store'
import { Idp } from '@canton-network/core-wallet-auth'
import {
    AuthContext,
    UserId,
    AuthAware,
    assertConnected,
} from '@canton-network/core-wallet-auth'

interface UserStorage {
    wallets: Array<Wallet>
    transactions: Map<string, Transaction>
    session: Session | undefined
}

export interface WalletStoreConfig {
    idps: Array<Idp>
    networks: Array<Network>
}

type Memory = Map<UserId, UserStorage>

export class WalletStore implements Store, AuthAware<WalletStore> {
    private systemStorage: WalletStoreConfig
    private userStorage: Memory
    authContext: AuthContext | undefined

    constructor(
        config: WalletStoreConfig,
        authContext?: AuthContext,
        userStorage?: Memory
    ) {
        this.systemStorage = config
        this.authContext = authContext
        this.userStorage = userStorage || new Map()
    }

    withAuthContext(context?: AuthContext): WalletStore {
        return new WalletStore(this.systemStorage, context, this.userStorage)
    }

    private static createStorage(): UserStorage {
        return {
            wallets: [],
            transactions: new Map<string, Transaction>(),
            session: undefined,
        }
    }

    private assertConnected(): UserId {
        return assertConnected(this.authContext).userId
    }

    private getStorage(): UserStorage {
        const userId = this.assertConnected()
        if (!this.userStorage.has(userId)) {
            this.userStorage.set(userId, WalletStore.createStorage())
        }
        return this.userStorage.get(userId)!
    }

    private updateStorage(storage: UserStorage): void {
        const userId = this.assertConnected()
        this.userStorage.set(userId, storage)
    }

    // Wallet methods

    async getAllWallets(filter: WalletFilter = {}): Promise<Array<Wallet>> {
        const { networkIds, signingProviderIds } = filter
        const networkIdSet = networkIds ? new Set(networkIds) : null
        const signingProviderIdSet = signingProviderIds
            ? new Set(signingProviderIds)
            : null

        return this.getStorage().wallets.filter((wallet) => {
            const matchedNetworkIds = networkIdSet
                ? networkIdSet.has(wallet.networkId)
                : true
            const matchedSigningProviderIds = signingProviderIdSet
                ? signingProviderIdSet.has(wallet.signingProviderId)
                : true
            return matchedNetworkIds && matchedSigningProviderIds
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
        const storage = this.getStorage()
        const networkWallets = storage.wallets.filter(
            (w) => w.networkId === network.id
        )

        if (!networkWallets.some((w) => w.partyId === partyId)) {
            throw new Error(
                `Wallet with partyId "${partyId}" not found in network "${network.id}"`
            )
        }

        const wallets = storage.wallets.map((w) => {
            if (w.networkId === network.id) {
                if (w.partyId === partyId) {
                    w.primary = true
                } else {
                    w.primary = false
                }
            }
            return w
        })
        storage.wallets = wallets
        this.updateStorage(storage)
    }

    async addWallet(wallet: Wallet): Promise<void> {
        const storage = this.getStorage()
        if (
            storage.wallets.some(
                (w) =>
                    w.partyId === wallet.partyId &&
                    w.networkId === wallet.networkId
            )
        ) {
            throw new Error(
                `Wallet with partyId "${wallet.partyId}" already exists in network "${wallet.networkId}"`
            )
        }
        const networkWallets = await this.getAllWallets({
            networkIds: [wallet.networkId],
        })

        // If this is the first wallet in this network, set it as primary automatically
        if (networkWallets.length === 0) {
            wallet.primary = true
        }

        if (wallet.primary) {
            storage.wallets
                .filter((w) => w.networkId === wallet.networkId)
                .map((w) => (w.primary = false))
        }
        storage.wallets.push(wallet)
        this.updateStorage(storage)
    }

    async updateWallet({
        status,
        partyId,
        networkId,
        externalTxId,
    }: UpdateWallet): Promise<void> {
        const storage = this.getStorage()
        const targetNetworkId = networkId ?? (await this.getCurrentNetwork()).id

        const wallets = storage.wallets.map((wallet) =>
            wallet.partyId === partyId && wallet.networkId === targetNetworkId
                ? { ...wallet, status, externalTxId }
                : wallet
        )

        storage.wallets = wallets
        this.updateStorage(storage)
    }

    async removeWallet(partyId: PartyId): Promise<void> {
        const network = await this.getCurrentNetwork()
        const storage = this.getStorage()
        const wallets = storage.wallets.filter(
            (w) => !(w.partyId === partyId && w.networkId === network.id)
        )

        storage.wallets = wallets
        this.updateStorage(storage)
    }

    // Session methods
    async getSession(): Promise<Session | undefined> {
        return this.getStorage().session
    }

    async setSession(session: Session): Promise<void> {
        const storage = this.getStorage()
        storage.session = session
        this.updateStorage(storage)
    }

    async removeSession(): Promise<void> {
        const storage = this.getStorage()
        storage.session = undefined
        this.updateStorage(storage)
    }

    // IDP methods
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
        return this.systemStorage.idps
    }

    async addIdp(idp: Idp): Promise<void> {
        this.assertConnected()
        const existingIdp = await this.listIdps()

        if (existingIdp.find((i) => i.id === idp.id)) {
            throw new Error(`IdP "${idp.id}" already exists`)
        }

        this.systemStorage.idps.push(idp)
    }

    async updateIdp(idp: Idp): Promise<void> {
        this.assertConnected()
        const existingIdps = await this.listIdps()
        const index = existingIdps.findIndex((i) => i.id === idp.id)
        if (index === -1) {
            throw new Error(`IdP "${idp.id}" not found`)
        }
        this.systemStorage.idps[index] = idp
    }

    async removeIdp(idpId: string): Promise<void> {
        this.assertConnected()
        this.systemStorage.idps = this.systemStorage.idps.filter(
            (i) => i.id !== idpId
        )
    }

    // Network methods
    async getNetwork(networkId: string): Promise<Network> {
        const networks = await this.listNetworks()
        if (!networks) throw new Error('No networks available')

        const network = networks.find((n) => n.id === networkId)
        if (!network) throw new Error(`Network "${networkId}" not found`)
        return network
    }

    async getCurrentNetwork(): Promise<Network> {
        const session = this.getStorage().session
        if (!session) {
            throw new Error('No session found')
        }
        const networkId = session.network
        if (!networkId) {
            throw new Error('No current network set in session')
        }

        const networks = await this.listNetworks()
        const network = networks.find((n) => n.id === networkId)
        if (!network) {
            throw new Error(`Network "${networkId}" not found`)
        }
        return network
    }

    async listNetworks(): Promise<Array<Network>> {
        return this.systemStorage.networks
    }

    async updateNetwork(network: Network): Promise<void> {
        this.assertConnected()
        await this.removeNetwork(network.id)
        this.systemStorage.networks.push(network)
    }

    async addNetwork(network: Network): Promise<void> {
        const networkAlreadyExists = this.systemStorage.networks.find(
            (n) => n.id === network.id
        )
        if (networkAlreadyExists) {
            throw new Error(`Network ${network.id} already exists`)
        } else {
            this.systemStorage.networks.push(network)
        }
    }

    async removeNetwork(networkId: string): Promise<void> {
        this.assertConnected()
        this.systemStorage.networks = this.systemStorage.networks.filter(
            (n) => n.id !== networkId
        )
    }

    // Transaction methods
    async setTransaction(transaction: Transaction): Promise<void> {
        this.assertConnected()
        const storage = this.getStorage()

        storage.transactions.set(transaction.commandId, transaction)
        this.updateStorage(storage)
    }

    async getTransaction(commandId: string): Promise<Transaction | undefined> {
        this.assertConnected()
        const storage = this.getStorage()

        return storage.transactions.get(commandId)
    }

    async listTransactions(): Promise<Array<Transaction>> {
        this.assertConnected()
        const storage = this.getStorage()

        return Array.from(storage.transactions.values())
    }
}
