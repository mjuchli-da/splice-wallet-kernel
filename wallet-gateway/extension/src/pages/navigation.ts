// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Navigation utilities for the extension popup.
 * Separated from the app shell to avoid circular dependencies.
 */

import { createUserClient } from './rpc-client'
import { stateManager } from './state-manager'
import { DEFAULT_PAGE } from './constants'

// ─── Page types ──────────────────────────────────────────────────────────────

export type PageName =
    | 'login'
    | 'wallets'
    | 'settings'
    | 'approve'
    | 'transactions'

export interface NavigateEvent extends CustomEvent {
    detail: {
        page: PageName
        params?: Record<string, string>
    }
}

// ─── Global navigation ──────────────────────────────────────────────────────

/** Navigate to a page within the popup. */
export const navigateTo = (
    page: PageName | string,
    params?: Record<string, string>
): void => {
    document.dispatchEvent(
        new CustomEvent('ext-navigate', {
            detail: { page: page as PageName, params },
            bubbles: true,
            composed: true,
        })
    )
}

/** After login, navigate to the intended page or default (wallets). */
export const redirectToIntendedOrDefault = (): void => {
    const intendedPage = stateManager.intendedPage.get()
    stateManager.intendedPage.clear()
    if (intendedPage) {
        navigateTo(intendedPage)
    } else {
        navigateTo(DEFAULT_PAGE as PageName)
    }
}

export const addUserSession = async (token: string, networkId: string) => {
    const authenticatedUserClient = createUserClient(token)
    const session = await authenticatedUserClient.request({
        method: 'addSession',
        params: {
            networkId,
        },
    })
    return session
}
