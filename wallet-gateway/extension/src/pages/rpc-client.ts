// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * RPC client for extension pages to communicate with the background script.
 * Uses ExtensionTransport instead of HTTP transport.
 */

import UserApiClient from '@canton-network/core-wallet-user-rpc-client'
import { ExtensionTransport } from '../lib/extension-transport'
import { stateManager } from './state-manager'
import { LOGIN_PAGE } from './constants'
import Browser from 'webextension-polyfill'

export const createUserClient = (token?: string): UserApiClient => {
    return new UserApiClient(new ExtensionTransport(token))
}

export const attemptRemoveSession = async (
    accessToken: string
): Promise<void> => {
    try {
        const userApiClient = new UserApiClient(
            new ExtensionTransport(accessToken)
        )
        await userApiClient.request('removeSession')
    } catch (error) {
        console.debug('Failed to remove session:', error)
    }
}

export const handleAutoLogout = async (): Promise<void> => {
    const accessToken = stateManager.accessToken.get()
    if (accessToken) {
        await attemptRemoveSession(accessToken)
    }
    stateManager.clearAuthState()
    window.location.href = Browser.runtime.getURL(`pages/${LOGIN_PAGE}`)
}
