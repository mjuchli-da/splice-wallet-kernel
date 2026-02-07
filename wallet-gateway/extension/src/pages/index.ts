// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Main app shell and router for the extension popup.
 * All screens render inside this single component.
 */

import { html, LitElement, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { attemptRemoveSession } from './rpc-client'
import { stateManager } from './state-manager'
import { navigateTo, type PageName, type NavigateEvent } from './navigation'

import '@canton-network/core-wallet-ui-components'

// Re-export navigation utilities so existing imports keep working
export {
    navigateTo,
    redirectToIntendedOrDefault,
    addUserSession,
} from './navigation'
export type { PageName, NavigateEvent } from './navigation'

// ─── Import all page components ─────────────────────────────────────────────

import './login'
import './wallets'
import './settings'
import './approve'
import './transactions'

// ─── App shell ──────────────────────────────────────────────────────────────

@customElement('ext-app')
export class ExtApp extends LitElement {
    @state() accessor currentPage: PageName = 'login'
    @state() accessor pageParams: Record<string, string> = {}

    static styles = css`
        :host {
            display: block;
            width: 400px;
            min-height: 500px;
            max-height: 600px;
            overflow-y: auto;
            font-family:
                -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                sans-serif;
            color: #222;
            background: #f8f9fa;
        }

        .app-header {
            background: #fff;
            border-bottom: 1px solid #e0e0e0;
            padding: 0.5rem 1rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .app-header h1 {
            font-size: 0.95rem;
            margin: 0;
            font-weight: 600;
            color: #333;
        }

        nav {
            display: flex;
            gap: 0.25rem;
            align-items: center;
        }

        nav button {
            text-decoration: none;
            color: #555;
            padding: 0.3rem 0.5rem;
            border-radius: 6px;
            font-size: 0.8rem;
            border: none;
            background: transparent;
            cursor: pointer;
            transition:
                background 0.2s,
                color 0.2s;
        }

        nav button:hover {
            background: #e8f0fe;
            color: #1a73e8;
        }

        nav button.active {
            background: #e8f0fe;
            color: #1a73e8;
            font-weight: 500;
        }

        .logout-btn {
            border: none;
            background: transparent;
            color: #d93025;
            cursor: pointer;
            padding: 0.3rem 0.5rem;
            border-radius: 6px;
            font-size: 0.8rem;
            transition: background 0.2s;
        }

        .logout-btn:hover {
            background: #fce8e6;
        }

        .content {
            padding: 1rem;
        }
    `

    connectedCallback(): void {
        super.connectedCallback()

        // Listen for navigation events
        document.addEventListener('ext-navigate', ((e: NavigateEvent) => {
            this.currentPage = e.detail.page
            this.pageParams = e.detail.params || {}
        }) as EventListener)

        // Check initial page from hash (for external opens like approve from DApp)
        if (!this._readHash()) {
            // Determine initial page based on auth state
            const hasToken = !!stateManager.accessToken.get()
            this.currentPage = hasToken ? 'wallets' : 'login'
        }
    }

    private _readHash(): boolean {
        const hash = window.location.hash.replace('#', '')
        if (!hash) return false

        const [page, queryString] = hash.split('?')
        const params: Record<string, string> = {}
        if (queryString) {
            new URLSearchParams(queryString).forEach((v, k) => {
                params[k] = v
            })
        }

        if (
            [
                'login',
                'wallets',
                'settings',
                'approve',
                'transactions',
            ].includes(page)
        ) {
            this.currentPage = page as PageName
            this.pageParams = params
            return true
        }
        return false
    }

    private handleLogout = async () => {
        const accessToken = stateManager.accessToken.get()
        if (accessToken) {
            await attemptRemoveSession(accessToken)
        }
        stateManager.clearAuthState()
        this.currentPage = 'login'
        this.pageParams = {}
    }

    protected render() {
        const isLoggedIn = !!stateManager.accessToken.get()
        const page = this.currentPage

        return html`
            <div class="app-header">
                <h1>Splice Wallet</h1>
                ${isLoggedIn
                    ? html`
                          <nav>
                              <button
                                  class=${page === 'wallets' ? 'active' : ''}
                                  @click=${() => navigateTo('wallets')}
                              >
                                  Wallets
                              </button>
                              <button
                                  class=${page === 'transactions'
                                      ? 'active'
                                      : ''}
                                  @click=${() => navigateTo('transactions')}
                              >
                                  Txns
                              </button>
                              <button
                                  class=${page === 'settings' ? 'active' : ''}
                                  @click=${() => navigateTo('settings')}
                              >
                                  Settings
                              </button>
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
            <div class="content">${this._renderPage()}</div>
        `
    }

    private _renderPage() {
        switch (this.currentPage) {
            case 'login':
                return html`<ext-login></ext-login>`
            case 'wallets':
                return html`<ext-wallets></ext-wallets>`
            case 'settings':
                return html`<ext-settings></ext-settings>`
            case 'approve':
                return html`<ext-approve
                    .commandId=${this.pageParams.commandId || ''}
                ></ext-approve>`
            case 'transactions':
                return html`<ext-transactions></ext-transactions>`
            default:
                return html`<ext-login></ext-login>`
        }
    }
}
