// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Dapp API controller for the browser extension.
 * Handles dapp-facing RPC methods: connect, disconnect, status,
 * ledgerApi, prepareExecute, listAccounts, getPrimaryAccount.
 * Adapted from the remote wallet gateway's dapp controller.
 */

import { assertConnected, AuthContext } from '@canton-network/core-wallet-auth'
import buildController from './rpc-gen'
import {
    LedgerApiParams,
    Network,
    PrepareExecuteParams,
    SignMessageResult,
    Wallet,
} from './rpc-gen/typings.js'
import { Store, Transaction } from '@canton-network/core-wallet-store'
import Browser from 'webextension-polyfill'
import type { Logger } from '../lib/logger'

const EXTENSION_ID = 'splice-wallet-extension'

export const dappController = (
    store: Store,
    logger: Logger,
    origin: string | null,
    context?: AuthContext
) => {
    return buildController({
        connect: async () => {
            if (!context || !(await store.getSession())) {
                const userUrl = Browser.runtime.getURL('pages/user.html#login')
                return {
                    isConnected: false,
                    isNetworkConnected: false,
                    networkReason: 'Unauthenticated',
                    userUrl,
                }
            }

            const network = await store.getCurrentNetwork()

            // Check network connectivity
            let isNetworkConnected = false
            let networkReason = 'Unknown'

            try {
                const res = await fetch(
                    `${network.ledgerApi.baseUrl}/v2/version`,
                    {
                        headers: {
                            Authorization: `Bearer ${context.accessToken}`,
                        },
                    }
                )
                isNetworkConnected = res.ok
                networkReason = res.ok ? 'OK' : `Network returned ${res.status}`
            } catch (e) {
                networkReason =
                    e instanceof Error ? e.message : 'Network unreachable'
            }

            return {
                isConnected: true,
                reason: 'OK',
                isNetworkConnected,
                networkReason,
            }
        },
        disconnect: async () => {
            if (context) {
                await store.removeSession()
            }
            return null
        },
        ledgerApi: async (params: LedgerApiParams) => {
            const network = await store.getCurrentNetwork()
            const accessToken = assertConnected(context).accessToken

            const url = `${network.ledgerApi.baseUrl}${params.resource}`
            const headers: Record<string, string> = {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            }

            let result: unknown
            switch (params.requestMethod) {
                case 'GET': {
                    const res = await fetch(url, { headers })
                    result = await res.json()
                    break
                }
                case 'POST': {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers,
                        body: params.body || undefined,
                    })
                    result = await res.json()
                    break
                }
                default:
                    throw new Error(
                        `Unsupported request method: ${params.requestMethod}`
                    )
            }
            return {
                response: JSON.stringify(result),
            }
        },
        prepareExecute: async (params: PrepareExecuteParams) => {
            const wallet = await store.getPrimaryWallet()
            const network = await store.getCurrentNetwork()

            if (context === undefined) {
                throw new Error('Unauthenticated context')
            }

            if (wallet === undefined) {
                throw new Error('No primary wallet found')
            }

            const userId = context.userId
            params.commandId = params.commandId || crypto.randomUUID()
            const commandId = params.commandId

            // Determine synchronizer ID
            let synchronizerId = network.synchronizerId
            if (!synchronizerId) {
                try {
                    const res = await fetch(
                        `${network.ledgerApi.baseUrl}/v2/state/synchronizer-id`,
                        {
                            headers: {
                                Authorization: `Bearer ${context.accessToken}`,
                            },
                        }
                    )
                    const data = await res.json()
                    synchronizerId = data.synchronizerId
                } catch {
                    synchronizerId = ''
                }
            }

            // Prepare submission via ledger API
            const prepareBody = {
                userId,
                actAs: params.actAs || [wallet.partyId],
                readAs: params.readAs || [],
                commandId,
                commands: params.commands,
                disclosedContracts: params.disclosedContracts || [],
                synchronizerId,
                packageIdSelectionPreference:
                    params.packageIdSelectionPreference || [],
            }

            const res = await fetch(
                `${network.ledgerApi.baseUrl}/v2/interactive-submission/prepare`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${context.accessToken}`,
                    },
                    body: JSON.stringify(prepareBody),
                }
            )
            const prepareResult = await res.json()

            const transaction: Transaction = {
                commandId,
                status: 'pending',
                preparedTransaction: prepareResult.preparedTransaction || '',
                preparedTransactionHash:
                    prepareResult.preparedTransactionHash || '',
                payload: params,
                origin: origin || null,
                createdAt: new Date(),
            }

            store.setTransaction(transaction)

            const approveUrl = Browser.runtime.getURL(
                `pages/user.html#approve?commandId=${commandId}`
            )
            return {
                userUrl: approveUrl,
            }
        },
        prepareExecuteAndWait: async () => {
            throw new Error(
                'prepareExecuteAndWait not yet implemented in extension'
            )
        },
        status: async () => {
            const userUrl = Browser.runtime.getURL('pages/user.html#login')

            if (!context || !(await store.getSession())) {
                return {
                    provider: {
                        id: EXTENSION_ID,
                        providerType: 'browser' as const,
                        url: Browser.runtime.getURL(''),
                        userUrl,
                    },
                    connection: {
                        isConnected: false,
                        reason: 'Unauthenticated',
                        isNetworkConnected: false,
                        networkReason: 'Unauthenticated',
                    },
                }
            }

            const session = await store.getSession()
            const network = await store.getCurrentNetwork()

            let isNetworkConnected = false
            let networkReason = 'Unknown'

            try {
                const res = await fetch(
                    `${network.ledgerApi.baseUrl}/v2/version`,
                    {
                        headers: {
                            Authorization: `Bearer ${context.accessToken}`,
                        },
                    }
                )
                isNetworkConnected = res.ok
                networkReason = res.ok ? 'OK' : `Network returned ${res.status}`
            } catch (e) {
                networkReason =
                    e instanceof Error ? e.message : 'Network unreachable'
            }

            return {
                provider: {
                    id: EXTENSION_ID,
                    providerType: 'browser' as const,
                    url: Browser.runtime.getURL(''),
                    userUrl,
                },
                connection: {
                    isConnected: true,
                    reason: 'OK',
                    isNetworkConnected,
                    networkReason,
                },
                network: {
                    networkId: network.id,
                    ledgerApi: network.ledgerApi.baseUrl,
                    accessToken: context.accessToken,
                },
                session: {
                    id: session?.id,
                    accessToken: context.accessToken,
                    userId: context.userId,
                },
                userUrl,
            }
        },
        connected: async () => {
            throw new Error('Only for events.')
        },
        onStatusChanged: async () => {
            throw new Error('Only for events.')
        },
        accountsChanged: async () => {
            throw new Error('Only for events.')
        },
        listAccounts: async () => {
            return await store.getWallets()
        },
        txChanged: async () => {
            throw new Error('Only for events.')
        },
        getActiveNetwork: function (): Promise<Network> {
            throw new Error('Function not implemented.')
        },
        signMessage: function (): Promise<SignMessageResult> {
            throw new Error('Function not implemented.')
        },
        getPrimaryAccount: async function (): Promise<Wallet> {
            const wallet = await store.getPrimaryWallet()
            if (!wallet) {
                throw new Error('No primary wallet found')
            }
            return wallet
        },
    })
}
