// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Background service worker for the Splice Wallet Gateway browser extension.
 *
 * Responsibilities:
 * - Initializes and manages the persistent extension store and signing store
 * - Handles dapp API requests (from content script → dapps)
 * - Handles user API requests (from extension pages)
 * - Routes messages and maintains auth context
 */

import Browser from 'webextension-polyfill'
import {
    isSpliceMessage,
    ResponsePayload,
    SpliceMessage,
    WalletEvent,
} from '@canton-network/core-types'
import { rpcErrors } from '@canton-network/core-rpc-errors'
import { SigningProvider } from '@canton-network/core-signing-lib'
import { ExtensionStore } from '@canton-network/core-wallet-store-extension'

import { SigningStoreExtension } from '@canton-network/core-signing-store-extension'
import { BrowserInternalSigningDriver } from './signing/driver'
import { authContextFromToken } from './auth/auth-service'
import { dappController } from './dapp-api/controller'
import { userController } from './user-api/controller'
import { Methods as DappMethods } from './dapp-api/rpc-gen'
import { Methods as UserMethods } from './user-api/rpc-gen/index.js'
import { createLogger } from './lib/logger'
import {
    USER_API_REQUEST,
    type UserApiMessage,
} from './lib/extension-transport'
import { defaultConfig } from './config/defaults'

const logger = createLogger('background')

// ─── Store Initialization ───────────────────────────────────────────────────

const walletStore = new ExtensionStore(Browser.storage.local)

// Initialize with default networks/IDPs (only writes if storage is empty)
walletStore.initialize(defaultConfig).catch((e) => {
    logger.error(`Failed to initialize store defaults: ${e}`)
})

const signingStore = new SigningStoreExtension(Browser.storage.local)

const signingDriver = new BrowserInternalSigningDriver(signingStore)

const drivers = {
    [SigningProvider.PARTICIPANT]: {
        partyMode: 'internal' as const,
        signingProvider: SigningProvider.PARTICIPANT,
        controller: () => ({}) as Record<string, never>,
    },
    [SigningProvider.WALLET_KERNEL]: signingDriver,
}

// ─── JSON-RPC Response Helper ───────────────────────────────────────────────

function jsonRpcResponse(
    id: string | number | null,
    payload: ResponsePayload
): SpliceMessage {
    return {
        response: {
            jsonrpc: '2.0',
            id,
            ...payload,
        },
        type: WalletEvent.SPLICE_WALLET_RESPONSE,
    }
}

// ─── Dapp API Handler ───────────────────────────────────────────────────────

async function handleDappRpcRequest(
    message: SpliceMessage & { type: typeof WalletEvent.SPLICE_WALLET_REQUEST }
): Promise<SpliceMessage> {
    const { request } = message
    const id = request.id || null
    const method = request.method as keyof DappMethods

    // For dapp API, we rely on an active session. Check if we have stored auth context.
    let authContext = undefined
    const storedToken = await getActiveAccessToken()
    if (storedToken) {
        authContext = authContextFromToken(storedToken)
    }

    const store = authContext
        ? walletStore.withAuthContext(authContext)
        : walletStore

    const controller = dappController(store, logger, null, authContext)

    const methodFn = controller[method]

    if (!methodFn) {
        return jsonRpcResponse(id, {
            error: rpcErrors.methodNotFound({
                message: `Method ${method} not found`,
            }),
        })
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (methodFn as any)(request.params)
        return jsonRpcResponse(id, { result })
    } catch (error) {
        return jsonRpcResponse(id, {
            error: rpcErrors.internal({
                message: error instanceof Error ? error.message : String(error),
            }),
        })
    }
}

// ─── User API Handler ───────────────────────────────────────────────────────

async function handleUserApiRequest(
    message: UserApiMessage
): Promise<ResponsePayload> {
    const { request, accessToken } = message
    const method = request.method as keyof UserMethods

    const authContext = accessToken
        ? authContextFromToken(accessToken)
        : undefined

    const store = authContext
        ? walletStore.withAuthContext(authContext)
        : walletStore

    const controller = userController(store, authContext, drivers, logger)

    const methodFn = controller[method]

    if (!methodFn) {
        return {
            error: {
                code: -32601,
                message: `Method ${method} not found`,
            },
        }
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (methodFn as any)(request.params)
        return { result }
    } catch (error) {
        logger.error(`${method} error: ${error}`)
        return {
            error: {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
            },
        }
    }
}

// ─── Active Token Storage ───────────────────────────────────────────────────

// Store the active access token so the dapp API can use it
let activeAccessToken: string | undefined

async function getActiveAccessToken(): Promise<string | undefined> {
    // Try to get from browser storage first
    try {
        const result = await Browser.storage.local.get('activeAccessToken')
        return result.activeAccessToken || activeAccessToken
    } catch {
        return activeAccessToken
    }
}

async function setActiveAccessToken(token: string | undefined): Promise<void> {
    activeAccessToken = token
    try {
        if (token) {
            await Browser.storage.local.set({ activeAccessToken: token })
        } else {
            await Browser.storage.local.remove('activeAccessToken')
        }
    } catch {
        // Storage not available, just use in-memory
    }
}

// ─── Message Listener ───────────────────────────────────────────────────────

Browser.runtime.onMessage.addListener((message) => {
    logger.debug('Received message in background script')

    // Handle User API requests from extension pages
    if (
        message &&
        typeof message === 'object' &&
        message.type === USER_API_REQUEST
    ) {
        const userMsg = message as UserApiMessage

        // Track the access token for dapp API use
        if (userMsg.accessToken) {
            setActiveAccessToken(userMsg.accessToken)
        }

        // If the method is removeSession, clear the stored token
        if (userMsg.request.method === 'removeSession') {
            setActiveAccessToken(undefined)
        }

        return handleUserApiRequest(userMsg)
    }

    // Handle Dapp API requests from content script
    if (isSpliceMessage(message)) {
        if (message.type === WalletEvent.SPLICE_WALLET_REQUEST) {
            return handleDappRpcRequest(
                message as SpliceMessage & {
                    type: typeof WalletEvent.SPLICE_WALLET_REQUEST
                }
            )
        }

        if (message.type === WalletEvent.SPLICE_WALLET_EXT_OPEN) {
            const targetUrl = (message as SpliceMessage & { url: string }).url

            // Open wallet UI in a popup window. If popup creation fails
            // (browser restrictions/permissions), fall back to a normal tab.
            return Browser.windows
                .create({
                    url: targetUrl,
                    type: 'popup',
                    width: 400,
                    height: 600,
                })
                .then(() => null)
                .catch(async (error) => {
                    logger.error(
                        `Failed to open popup window, falling back to tab: ${error}`
                    )
                    await Browser.tabs.create({ url: targetUrl })
                    return null
                })
        }

        return Promise.resolve(null)
    }

    return Promise.resolve(null)
})

logger.info('Splice Wallet Gateway extension background script initialized')
