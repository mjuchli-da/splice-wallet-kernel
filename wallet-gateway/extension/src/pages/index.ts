// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Main app shell for the extension pages.
 * Provides the layout wrapper and auth redirect logic.
 */

import { html, LitElement, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { createUserClient, attemptRemoveSession } from './rpc-client'
import { stateManager } from './state-manager'
import { LOGIN_PAGE, DEFAULT_PAGE } from './constants'
import Browser from 'webextension-polyfill'

import '@canton-network/core-wallet-ui-components'

export const navigateTo = (page: string): void => {
    window.location.href = Browser.runtime.getURL(`pages/${page}`)
}

export const redirectToIntendedOrDefault = (): void => {
    const intendedPage = stateManager.intendedPage.get()
    stateManager.intendedPage.clear()
    if (intendedPage) {
        window.location.href = intendedPage
    } else {
        navigateTo(DEFAULT_PAGE)
    }
}

export const addUserSession = async (token: string, networkId: string) => {
    const authenticatedUserClient = createUserClient(token)
    const session = await authenticatedUserClient.request('addSession', {
        networkId,
    })
    return session
}

@customElement('ext-app')
export class ExtApp extends LitElement {
    static styles = css`
        :host {
            display: block;
            min-height: 100vh;
            font-family:
                -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                sans-serif;
            color: #222;
            background: #f8f9fa;
        }

        .app-header {
            background: #fff;
            border-bottom: 1px solid #e0e0e0;
            padding: 0.75rem 1.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .app-header h1 {
            font-size: 1.1rem;
            margin: 0;
            font-weight: 600;
            color: #333;
        }

        nav {
            display: flex;
            gap: 0.5rem;
            align-items: center;
        }

        nav a {
            text-decoration: none;
            color: #555;
            padding: 0.4rem 0.75rem;
            border-radius: 6px;
            font-size: 0.9rem;
            transition:
                background 0.2s,
                color 0.2s;
        }

        nav a:hover {
            background: #e8f0fe;
            color: #1a73e8;
        }

        nav a.active {
            background: #e8f0fe;
            color: #1a73e8;
            font-weight: 500;
        }

        .logout-btn {
            border: none;
            background: transparent;
            color: #d93025;
            cursor: pointer;
            padding: 0.4rem 0.75rem;
            border-radius: 6px;
            font-size: 0.9rem;
            transition: background 0.2s;
        }

        .logout-btn:hover {
            background: #fce8e6;
        }

        .content {
            padding: 1.5rem;
            max-width: 960px;
            margin: 0 auto;
        }
    `

    private getPageName(): string {
        const path = window.location.pathname
        const match = path.match(/\/pages\/(\w+)\.html/)
        return match ? match[1] : ''
    }

    private isActive(page: string): boolean {
        return this.getPageName() === page
    }

    private handleLogout = async () => {
        const accessToken = stateManager.accessToken.get()
        if (accessToken) {
            await attemptRemoveSession(accessToken)
        }
        stateManager.clearAuthState()
        navigateTo(LOGIN_PAGE)
    }

    protected render() {
        const isLoggedIn = !!stateManager.accessToken.get()

        return html`
            <div class="app-header">
                <h1>Splice Wallet</h1>
                ${isLoggedIn
                    ? html`
                          <nav>
                              <a
                                  href=${Browser.runtime.getURL(
                                      'pages/wallets.html'
                                  )}
                                  class=${this.isActive('wallets')
                                      ? 'active'
                                      : ''}
                                  >Wallets</a
                              >
                              <a
                                  href=${Browser.runtime.getURL(
                                      'pages/transactions.html'
                                  )}
                                  class=${this.isActive('transactions')
                                      ? 'active'
                                      : ''}
                                  >Transactions</a
                              >
                              <a
                                  href=${Browser.runtime.getURL(
                                      'pages/settings.html'
                                  )}
                                  class=${this.isActive('settings')
                                      ? 'active'
                                      : ''}
                                  >Settings</a
                              >
                              <button
                                  class="logout-btn"
                                  @click=${this.handleLogout}
                              >
                                  Logout
                              </button>
                          </nav>
                      `
                    : null}
            </div>
            <div class="content">
                <slot></slot>
            </div>
        `
    }
}
