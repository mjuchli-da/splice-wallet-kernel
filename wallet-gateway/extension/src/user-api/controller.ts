// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * User API controller for the browser extension.
 * Handles wallet management, network/IDP configuration,
 * session management, signing, and transaction execution.
 * Adapted from the remote wallet gateway's user controller.
 */

import buildController from './rpc-gen/index.js'
import {
    AddNetworkParams,
    RemoveNetworkParams,
    ExecuteParams,
    SignParams,
    AddSessionParams,
    AddSessionResult,
    ListSessionsResult,
    SetPrimaryWalletParams,
    SyncWalletsResult,
    IsWalletSyncNeededResult,
    AddIdpParams,
    RemoveIdpParams,
    CreateWalletParams,
    GetTransactionResult,
    GetTransactionParams,
    Null,
    ListTransactionsResult,
} from './rpc-gen/typings.js'
import { Store, Transaction, Wallet } from '@canton-network/core-wallet-store'
import { Network } from '@canton-network/core-wallet-store'
import {
    assertConnected,
    AuthContext,
    authSchema,
    idpSchema,
} from '@canton-network/core-wallet-auth'
import {
    SigningDriverInterface,
    SigningProvider,
} from '@canton-network/core-signing-lib'
import type { Logger } from '../lib/logger'

type AvailableSigningDrivers = Partial<
    Record<SigningProvider, SigningDriverInterface>
>

export const userController = (
    store: Store,
    authContext: AuthContext | undefined,
    drivers: AvailableSigningDrivers,
    logger: Logger
) => {
    return buildController({
        addNetwork: async (params: AddNetworkParams) => {
            const { network } = params

            const ledgerApi = {
                baseUrl: network.ledgerApi ?? '',
            }

            const auth = authSchema.parse(network.auth)
            const adminAuth = network.adminAuth
                ? authSchema.parse(network.adminAuth)
                : undefined

            const newNetwork: Network = {
                name: network.name,
                id: network.id,
                description: network.description,
                synchronizerId: network.synchronizerId,
                identityProviderId: network.identityProviderId,
                auth,
                adminAuth,
                ledgerApi,
            }

            const existingNetworks = await store.listNetworks()
            if (existingNetworks.find((n) => n.id === newNetwork.id)) {
                await store.updateNetwork(newNetwork)
            } else {
                await store.addNetwork(newNetwork)
            }

            return null
        },
        removeNetwork: async (params: RemoveNetworkParams) => {
            await store.removeNetwork(params.networkName)
            return null
        },
        listNetworks: async () =>
            Promise.resolve({ networks: await store.listNetworks() }),
        addIdp: async (params: AddIdpParams) => {
            const validatedIdp = idpSchema.parse(params.idp)

            const existingIdps = await store.listIdps()
            if (existingIdps.find((n) => n.id === validatedIdp.id)) {
                await store.updateIdp(validatedIdp)
            } else {
                await store.addIdp(validatedIdp)
            }

            return null
        },
        removeIdp: async (params: RemoveIdpParams) => {
            await store.removeIdp(params.identityProviderId)
            return null
        },
        listIdps: async () => Promise.resolve({ idps: await store.listIdps() }),
        createWallet: async (params: CreateWalletParams) => {
            logger.info(
                `Creating wallet with params: ${JSON.stringify(params)}`
            )

            const { signingProviderId, primary, partyHint } = params

            const userId = assertConnected(authContext).userId
            const network = await store.getCurrentNetwork()

            if (network === undefined) {
                throw new Error('No network session found')
            }

            const driver =
                drivers[signingProviderId as SigningProvider]?.controller(
                    userId
                )

            let partyId = ''
            let publicKey = ''
            let namespace = ''
            const walletStatus = 'allocated'

            switch (signingProviderId) {
                case SigningProvider.PARTICIPANT: {
                    // For participant-managed keys, we just create a wallet entry
                    // The party should already exist or will be allocated externally
                    partyId = `${partyHint}::participant`
                    namespace = 'participant'
                    publicKey = 'participant'
                    break
                }
                case SigningProvider.WALLET_KERNEL: {
                    if (!driver) {
                        throw new Error(
                            `Signing provider ${signingProviderId} not supported`
                        )
                    }

                    const key = await driver.createKey({
                        name: partyHint,
                    })

                    if ('error' in key) {
                        throw new Error(
                            `Failed to create key: ${key.error_description}`
                        )
                    }

                    publicKey = key.publicKey
                    // Create a fingerprint-like namespace from the public key
                    namespace = publicKey.substring(0, 16)
                    partyId = `${partyHint}::${namespace}`
                    break
                }
                default:
                    throw new Error(
                        `Unsupported signing provider: ${signingProviderId}. The extension supports PARTICIPANT and WALLET_KERNEL.`
                    )
            }

            const wallet = {
                signingProviderId,
                networkId: network.id,
                status: walletStatus,
                primary: primary ?? false,
                publicKey,
                partyId,
                hint: partyHint,
                namespace,
            } as Wallet

            await store.addWallet(wallet)

            return { wallet }
        },
        setPrimaryWallet: async (params: SetPrimaryWalletParams) => {
            await store.setPrimaryWallet(params.partyId)
            return null
        },
        removeWallet: async () => Promise.resolve({}),
        listWallets: async (params: {
            filter?: { signingProviderIds?: string[] }
        }) => {
            return await store.getWallets(params.filter)
        },
        sign: async ({
            preparedTransaction,
            preparedTransactionHash,
            partyId,
            commandId,
        }: SignParams) => {
            const network = await store.getCurrentNetwork()
            if (network === undefined) {
                throw new Error('No network session found')
            }

            const wallets = await store.getWallets()
            const wallet = wallets.find((w) => w.partyId === partyId)

            if (wallet === undefined) {
                throw new Error('Wallet not found for partyId: ' + partyId)
            }

            const userId = assertConnected(authContext).userId
            const signingProvider = wallet.signingProviderId as SigningProvider
            const driver = drivers[signingProvider]?.controller(userId)

            switch (wallet.signingProviderId) {
                case SigningProvider.PARTICIPANT: {
                    return {
                        signature: 'none',
                        signedBy: wallet.namespace,
                        partyId,
                    }
                }
                case SigningProvider.WALLET_KERNEL: {
                    if (!driver) {
                        throw new Error('No driver found for WALLET_KERNEL')
                    }

                    const signature = await driver.signTransaction({
                        tx: preparedTransaction,
                        txHash: preparedTransactionHash,
                        keyIdentifier: {
                            publicKey: wallet.publicKey,
                        },
                    })

                    if (!signature.signature) {
                        throw new Error(
                            'Failed to sign transaction: ' +
                                JSON.stringify(signature)
                        )
                    }

                    const existingTx = await store.getTransaction(commandId)
                    const now = new Date()

                    const signedTx: Transaction = {
                        commandId,
                        status: 'signed',
                        preparedTransaction,
                        preparedTransactionHash,
                        origin: existingTx?.origin ?? null,
                        ...(existingTx?.createdAt && {
                            createdAt: existingTx.createdAt,
                        }),
                        signedAt: now,
                    }

                    store.setTransaction(signedTx)

                    return {
                        signature: signature.signature,
                        signedBy: wallet.namespace,
                        partyId: wallet.partyId,
                    }
                }
                default:
                    throw new Error(
                        `Unsupported signing provider: ${wallet.signingProviderId}`
                    )
            }
        },
        execute: async ({
            commandId,
            signature,
            signedBy,
            partyId,
        }: ExecuteParams) => {
            const wallet = await store.getPrimaryWallet()
            const network = await store.getCurrentNetwork()
            const transaction = await store.getTransaction(commandId)

            if (wallet === undefined) {
                throw new Error('No primary wallet found')
            }

            if (transaction === undefined) {
                throw new Error('No transaction found')
            }

            if (network === undefined) {
                throw new Error('No network session found')
            }

            const userId = assertConnected(authContext).userId

            switch (wallet.signingProviderId) {
                case SigningProvider.PARTICIPANT: {
                    // Submit via ledger API using fetch
                    try {
                        const res = await fetch(
                            `${network.ledgerApi.baseUrl}/v2/commands/submit-and-wait`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${authContext!.accessToken}`,
                                },
                                body: JSON.stringify({
                                    userId,
                                    ...(transaction.payload as object),
                                }),
                            }
                        )
                        const result = await res.json()

                        const executedTx: Transaction = {
                            commandId,
                            status: 'executed',
                            preparedTransaction:
                                transaction.preparedTransaction,
                            preparedTransactionHash:
                                transaction.preparedTransactionHash,
                            payload: result,
                            origin: transaction.origin ?? null,
                            ...(transaction.createdAt && {
                                createdAt: transaction.createdAt,
                            }),
                            ...(transaction.signedAt && {
                                signedAt: transaction.signedAt,
                            }),
                        }
                        store.setTransaction(executedTx)
                        return result
                    } catch (error) {
                        logger.error(error, 'Failed to submit transaction')
                        throw error
                    }
                }
                case SigningProvider.WALLET_KERNEL: {
                    const res = await fetch(
                        `${network.ledgerApi.baseUrl}/v2/interactive-submission/execute`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${authContext!.accessToken}`,
                            },
                            body: JSON.stringify({
                                userId,
                                preparedTransaction:
                                    transaction.preparedTransaction,
                                hashingSchemeVersion:
                                    'HASHING_SCHEME_VERSION_V2',
                                submissionId: commandId,
                                deduplicationPeriod: {
                                    Empty: {},
                                },
                                partySignatures: {
                                    signatures: [
                                        {
                                            party: partyId,
                                            signatures: [
                                                {
                                                    signature,
                                                    signedBy,
                                                    format: 'SIGNATURE_FORMAT_CONCAT',
                                                    signingAlgorithmSpec:
                                                        'SIGNING_ALGORITHM_SPEC_ED25519',
                                                },
                                            ],
                                        },
                                    ],
                                },
                            }),
                        }
                    )
                    const result = await res.json()

                    const executedTx: Transaction = {
                        commandId,
                        status: 'executed',
                        preparedTransaction: transaction.preparedTransaction,
                        preparedTransactionHash:
                            transaction.preparedTransactionHash,
                        payload: result,
                        origin: transaction.origin ?? null,
                        ...(transaction.createdAt && {
                            createdAt: transaction.createdAt,
                        }),
                        ...(transaction.signedAt && {
                            signedAt: transaction.signedAt,
                        }),
                    }

                    store.setTransaction(executedTx)
                    return result
                }
                default:
                    throw new Error(
                        `Unsupported signing provider: ${wallet.signingProviderId}`
                    )
            }
        },
        addSession: async function (
            params: AddSessionParams
        ): Promise<AddSessionResult> {
            try {
                const newSessionId = crypto.randomUUID()
                logger.info(
                    `Adding session with ID ${newSessionId} for network ${params.networkId}`
                )

                await store.setSession({
                    id: newSessionId,
                    network: params.networkId,
                    accessToken: authContext?.accessToken || '',
                })
                const network = await store.getCurrentNetwork()
                const idp = await store.getIdp(network.identityProviderId)
                const { accessToken } = authContext!

                // Check network connectivity
                let status = 'connected'
                let reason = 'OK'
                try {
                    const res = await fetch(
                        `${network.ledgerApi.baseUrl}/v2/version`,
                        {
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                            },
                        }
                    )
                    if (!res.ok) {
                        status = 'disconnected'
                        reason = `Network returned ${res.status}`
                    }
                } catch (e) {
                    status = 'disconnected'
                    reason =
                        e instanceof Error ? e.message : 'Network unreachable'
                }

                return {
                    id: newSessionId,
                    accessToken,
                    network: {
                        id: network.id,
                        name: network.name,
                        description: network.description || '',
                        identityProviderId: network.identityProviderId,
                        ledgerApi: network.ledgerApi.baseUrl,
                        auth: network.auth,
                    },
                    idp,
                    status:
                        status === 'connected' ? 'connected' : 'disconnected',
                    reason,
                }
            } catch (error) {
                logger.error(`Failed to add session: ${error}`)
                throw new Error(`Failed to add session: ${error}`)
            }
        },
        removeSession: async (): Promise<Null> => {
            logger.info('Removing session')
            await store.removeSession()
            return null
        },
        listSessions: async (): Promise<ListSessionsResult> => {
            const session = await store.getSession()
            if (!session) {
                return { sessions: [] }
            }

            const network = await store.getNetwork(session.network)
            const idp = await store.getIdp(network.identityProviderId)

            // Check network status
            let status = 'connected'
            let reason = 'OK'
            try {
                const res = await fetch(
                    `${network.ledgerApi.baseUrl}/v2/version`,
                    {
                        headers: {
                            Authorization: `Bearer ${authContext!.accessToken}`,
                        },
                    }
                )
                if (!res.ok) {
                    status = 'disconnected'
                    reason = `Network returned ${res.status}`
                }
            } catch (e) {
                status = 'disconnected'
                reason = e instanceof Error ? e.message : 'Network unreachable'
            }

            return {
                sessions: [
                    {
                        id: session.id,
                        network: {
                            id: network.id,
                            name: network.name,
                            description: network.description || '',
                            identityProviderId: network.identityProviderId,
                            ledgerApi: network.ledgerApi.baseUrl,
                            auth: network.auth,
                        },
                        idp,
                        accessToken: authContext!.accessToken,
                        status,
                        reason,
                    },
                ],
            }
        },
        syncWallets: async function (): Promise<SyncWalletsResult> {
            // Sync wallets from the ledger by fetching user rights
            const network = await store.getCurrentNetwork()
            const { userId } = assertConnected(authContext)

            try {
                const res = await fetch(
                    `${network.ledgerApi.baseUrl}/v2/users/${encodeURIComponent(userId)}/rights`,
                    {
                        headers: {
                            Authorization: `Bearer ${authContext!.accessToken}`,
                        },
                    }
                )

                if (!res.ok) {
                    throw new Error(
                        `Failed to fetch user rights: ${res.status}`
                    )
                }

                const rights = (await res.json()) as {
                    rights?: Array<{
                        kind: Record<string, { value: { party: string } }>
                    }>
                }
                const parties =
                    rights.rights
                        ?.filter((right) => 'CanActAs' in right.kind)
                        .map((right) => right.kind.CanActAs.value.party) || []

                const existingWallets = await store.getWallets()
                const existingPartyIds = new Set(
                    existingWallets.map((w) => w.partyId)
                )

                const added: Wallet[] = []
                for (const party of parties) {
                    if (!existingPartyIds.has(party)) {
                        const [hint, ns] = party.split('::')
                        const wallet: Wallet = {
                            primary: false,
                            partyId: party,
                            status: 'allocated',
                            hint,
                            publicKey: ns,
                            namespace: ns,
                            networkId: network.id,
                            signingProviderId: 'participant',
                        }
                        await store.addWallet(wallet)
                        added.push(wallet)
                    }
                }

                return { added, removed: [] }
            } catch (error) {
                logger.error(error, 'Failed to sync wallets')
                return { added: [], removed: [] }
            }
        },
        isWalletSyncNeeded: async (): Promise<IsWalletSyncNeededResult> => {
            // Simplified: always report sync as available
            return { walletSyncNeeded: true }
        },
        getTransaction: async (
            params: GetTransactionParams
        ): Promise<GetTransactionResult> => {
            const transaction = await store.getTransaction(params.commandId)
            if (!transaction) {
                throw new Error(
                    `Transaction not found with commandId: ${params.commandId}`
                )
            }
            return {
                commandId: transaction.commandId,
                status: transaction.status,
                preparedTransaction: transaction.preparedTransaction,
                preparedTransactionHash: transaction.preparedTransactionHash,
                payload: transaction.payload
                    ? JSON.stringify(transaction.payload)
                    : '',
                ...(transaction.origin !== null && {
                    origin: transaction.origin,
                }),
                ...(transaction.createdAt && {
                    createdAt: transaction.createdAt.toISOString(),
                }),
                ...(transaction.signedAt && {
                    signedAt: transaction.signedAt.toISOString(),
                }),
            }
        },
        listTransactions: async function (): Promise<ListTransactionsResult> {
            const transactions = await store.listTransactions()
            const txs = transactions.map((transaction) => ({
                commandId: transaction.commandId,
                status: transaction.status,
                preparedTransaction: transaction.preparedTransaction,
                preparedTransactionHash: transaction.preparedTransactionHash,
                payload: transaction.payload
                    ? JSON.stringify(transaction.payload)
                    : '',
                ...(transaction.origin !== null && {
                    origin: transaction.origin,
                }),
                ...(transaction.createdAt && {
                    createdAt: transaction.createdAt.toISOString(),
                }),
                ...(transaction.signedAt && {
                    signedAt: transaction.signedAt.toISOString(),
                }),
            }))
            return { transactions: txs }
        },
    })
}
