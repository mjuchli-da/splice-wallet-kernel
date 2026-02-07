// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Browser-compatible signing driver for the extension.
 * Supports PARTICIPANT (no signing) and WALLET_KERNEL (Ed25519 via tweetnacl).
 */

import {
    buildController,
    PartyMode,
    SigningDriverInterface,
    SigningProvider,
    signTransactionHash,
    createKeyPair,
    SigningDriverStore,
    SigningTransaction,
    SigningKey,
} from '@canton-network/core-signing-lib'

import type {
    SignTransactionParams,
    SignTransactionResult,
    GetTransactionParams,
    GetTransactionResult,
    GetTransactionsResult,
    GetTransactionsParams,
    GetKeysResult,
    CreateKeyParams,
    CreateKeyResult,
    GetConfigurationResult,
    SetConfigurationResult,
    SubscribeTransactionsResult,
} from '@canton-network/core-signing-lib'

import type { AuthContext } from '@canton-network/core-wallet-auth'

export class BrowserInternalSigningDriver implements SigningDriverInterface {
    private store: SigningDriverStore

    public partyMode = PartyMode.EXTERNAL
    public signingProvider = SigningProvider.WALLET_KERNEL

    constructor(store: SigningDriverStore) {
        this.store = store
    }

    public controller = (_userId: AuthContext['userId'] | undefined) =>
        buildController({
            signTransaction: async (
                params: SignTransactionParams
            ): Promise<SignTransactionResult> => {
                if (!params.keyIdentifier.publicKey) {
                    return {
                        error: 'key_not_found',
                        error_description:
                            'The provided key identifier must include a publicKey.',
                    }
                }

                const key = await this.store.getSigningKeyByPublicKey(
                    params.keyIdentifier.publicKey
                )

                if (key?.privateKey && _userId) {
                    const txId = crypto.randomUUID()
                    const signature = signTransactionHash(
                        params.txHash,
                        key.privateKey
                    )

                    const now = new Date()
                    const internalTransaction: SigningTransaction = {
                        id: txId,
                        hash: params.txHash,
                        signature,
                        publicKey: params.keyIdentifier.publicKey,
                        createdAt: now,
                        status: 'signed',
                        updatedAt: now,
                        signedAt: now,
                    }

                    this.store.setSigningTransaction(
                        _userId,
                        internalTransaction
                    )

                    return {
                        txId,
                        status: 'signed',
                        signature,
                    } as SignTransactionResult
                } else {
                    if (!_userId) {
                        return {
                            error: 'userId_not_found',
                            error_description:
                                'User ID is required for all signing operations.',
                        }
                    }
                    return {
                        error: 'key_not_found',
                        error_description:
                            'The provided public key does not exist in the signing store.',
                    }
                }
            },

            getTransaction: async (
                params: GetTransactionParams
            ): Promise<GetTransactionResult> => {
                if (!_userId) {
                    return {
                        error: 'userId_not_found',
                        error_description:
                            'User ID is required for all signing operations.',
                    }
                }

                const storedTx = await this.store.getSigningTransaction(
                    _userId,
                    params.txId
                )
                if (storedTx) {
                    return {
                        txId: storedTx.id,
                        status: storedTx.status,
                        signature: storedTx.signature || '',
                        publicKey: storedTx.publicKey,
                    }
                }
                return {
                    error: 'transaction_not_found',
                    error_description:
                        'The requested transaction does not exist.',
                }
            },

            getTransactions: async (
                params: GetTransactionsParams
            ): Promise<GetTransactionsResult> => {
                if (!_userId) {
                    return {
                        error: 'userId_not_found',
                        error_description:
                            'User ID is required for all signing operations.',
                    }
                }

                if (params.publicKeys || params.txIds) {
                    const transactions =
                        await this.store.listSigningTransactionsByTxIdsAndPublicKeys(
                            params.txIds || [],
                            params.publicKeys || []
                        )

                    return {
                        transactions: transactions.map(
                            (tx: SigningTransaction) => ({
                                txId: tx.id,
                                status: 'signed',
                                signature: tx.signature || 'signed',
                                publicKey: tx.publicKey,
                            })
                        ),
                    }
                } else {
                    return {
                        error: 'bad_arguments',
                        error_description:
                            'either public key or txIds must be supplied',
                    }
                }
            },

            getKeys: async (): Promise<GetKeysResult> => {
                if (!_userId) {
                    return {
                        error: 'userId_not_found',
                        error_description:
                            'User ID is required for all signing operations.',
                    }
                }

                const keys = await this.store.listSigningKeys(_userId)
                return {
                    keys: keys.map((key) => ({
                        id: key.id,
                        name: key.name,
                        publicKey: key.publicKey,
                    })),
                }
            },

            createKey: async (
                params: CreateKeyParams
            ): Promise<CreateKeyResult> => {
                if (!_userId) {
                    return {
                        error: 'userId_not_found',
                        error_description:
                            'User ID is required for all signing operations.',
                    }
                }

                const { publicKey, privateKey } = createKeyPair()
                const id = crypto.randomUUID()

                const now = new Date()
                const internalKey: SigningKey = {
                    id,
                    name: params.name,
                    publicKey,
                    privateKey,
                    createdAt: now,
                    updatedAt: now,
                }

                await this.store.setSigningKey(_userId, internalKey)

                return {
                    id,
                    publicKey,
                    name: params.name,
                }
            },

            getConfiguration: async (): Promise<GetConfigurationResult> =>
                ({}) as GetConfigurationResult,
            setConfiguration: async (): Promise<SetConfigurationResult> =>
                ({}) as SetConfigurationResult,
            subscribeTransactions:
                async (): Promise<SubscribeTransactionsResult> =>
                    ({}) as SubscribeTransactionsResult,
        })
}
