// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory implementation of the SigningDriverStore interface
 * for the browser extension. Stores signing keys and transactions
 * in memory (no persistence).
 */

import type {
    SigningDriverStore,
    SigningKey,
    SigningTransaction,
    SigningDriverConfig,
    SigningDriverStatus,
} from '@canton-network/core-signing-lib'

export class SigningStoreInMemory implements SigningDriverStore {
    // userId -> keyId -> SigningKey
    private keys: Map<string, Map<string, SigningKey>> = new Map()
    // userId -> txId -> SigningTransaction
    private transactions: Map<string, Map<string, SigningTransaction>> =
        new Map()
    // userId -> driverId -> SigningDriverConfig
    private configs: Map<string, Map<string, SigningDriverConfig>> = new Map()

    private getKeysForUser(userId: string): Map<string, SigningKey> {
        if (!this.keys.has(userId)) {
            this.keys.set(userId, new Map())
        }
        return this.keys.get(userId)!
    }

    private getTransactionsForUser(
        userId: string
    ): Map<string, SigningTransaction> {
        if (!this.transactions.has(userId)) {
            this.transactions.set(userId, new Map())
        }
        return this.transactions.get(userId)!
    }

    private getConfigsForUser(
        userId: string
    ): Map<string, SigningDriverConfig> {
        if (!this.configs.has(userId)) {
            this.configs.set(userId, new Map())
        }
        return this.configs.get(userId)!
    }

    // Key management
    async getSigningKey(
        userId: string,
        keyId: string
    ): Promise<SigningKey | undefined> {
        return this.getKeysForUser(userId).get(keyId)
    }

    async getSigningKeyByPublicKey(
        publicKey: string
    ): Promise<SigningKey | undefined> {
        for (const userKeys of this.keys.values()) {
            for (const key of userKeys.values()) {
                if (key.publicKey === publicKey) {
                    return key
                }
            }
        }
        return undefined
    }

    async getSigningKeyByName(
        userId: string,
        name: string
    ): Promise<SigningKey | undefined> {
        for (const key of this.getKeysForUser(userId).values()) {
            if (key.name === name) {
                return key
            }
        }
        return undefined
    }

    async setSigningKey(userId: string, key: SigningKey): Promise<void> {
        this.getKeysForUser(userId).set(key.id, key)
    }

    async deleteSigningKey(userId: string, keyId: string): Promise<void> {
        this.getKeysForUser(userId).delete(keyId)
    }

    async listSigningKeys(userId: string): Promise<SigningKey[]> {
        return Array.from(this.getKeysForUser(userId).values())
    }

    // Transaction management
    async getSigningTransaction(
        userId: string,
        txId: string
    ): Promise<SigningTransaction | undefined> {
        return this.getTransactionsForUser(userId).get(txId)
    }

    async setSigningTransaction(
        userId: string,
        transaction: SigningTransaction
    ): Promise<void> {
        this.getTransactionsForUser(userId).set(transaction.id, transaction)
    }

    async updateSigningTransactionStatus(
        userId: string,
        txId: string,
        status: SigningDriverStatus
    ): Promise<void> {
        const tx = this.getTransactionsForUser(userId).get(txId)
        if (tx) {
            tx.status = status
            tx.updatedAt = new Date()
        }
    }

    async listSigningTransactions(
        userId: string,
        limit?: number
    ): Promise<SigningTransaction[]> {
        const txs = Array.from(this.getTransactionsForUser(userId).values())
        return limit ? txs.slice(0, limit) : txs
    }

    async listSigningTransactionsByTxIdsAndPublicKeys(
        txIds: string[],
        publicKeys: string[]
    ): Promise<SigningTransaction[]> {
        const txIdSet = new Set(txIds)
        const publicKeySet = new Set(publicKeys)
        const result: SigningTransaction[] = []

        for (const userTxs of this.transactions.values()) {
            for (const tx of userTxs.values()) {
                if (txIdSet.has(tx.id) || publicKeySet.has(tx.publicKey)) {
                    result.push(tx)
                }
            }
        }
        return result
    }

    // Configuration management
    async getSigningDriverConfiguration(
        userId: string,
        driverId: string
    ): Promise<SigningDriverConfig | undefined> {
        return this.getConfigsForUser(userId).get(driverId)
    }

    async setSigningDriverConfiguration(
        userId: string,
        config: SigningDriverConfig
    ): Promise<void> {
        this.getConfigsForUser(userId).set(config.driverId, config)
    }

    // Batch operations
    async setSigningKeys(userId: string, keys: SigningKey[]): Promise<void> {
        for (const key of keys) {
            await this.setSigningKey(userId, key)
        }
    }

    async setSigningTransactions(
        userId: string,
        transactions: SigningTransaction[]
    ): Promise<void> {
        for (const tx of transactions) {
            await this.setSigningTransaction(userId, tx)
        }
    }
}
