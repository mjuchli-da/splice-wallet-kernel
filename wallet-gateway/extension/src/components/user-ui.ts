// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Popup UI component for the extension action button.
 * Shows connection status and quick navigation to the full wallet UI.
 */

import { html, LitElement, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import Browser from 'webextension-polyfill'

@customElement('user-ui')
export class UserUI extends LitElement {
    @state() accessor isConnected = false
    @state() accessor networkName = ''
    @state() accessor walletHint = ''

    static styles = css`
        :host {
            display: block;
            width: 320px;
            font-family:
                -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                sans-serif;
            color: #222;
        }

        .popup {
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .header {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid #eee;
        }

        .header h1 {
            font-size: 1rem;
            margin: 0;
            font-weight: 600;
        }

        .status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }

        .status-dot.connected {
            background: #4caf50;
        }

        .status-dot.disconnected {
            background: #f44336;
        }

        .info {
            font-size: 0.85rem;
            color: #666;
        }

        .actions {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        button {
            padding: 0.6rem;
            border-radius: 8px;
            border: 1px solid #ddd;
            cursor: pointer;
            font-size: 0.9rem;
            background: #f8f9fa;
            transition: background 0.2s;
            text-align: center;
        }

        button:hover {
            background: #e8f0fe;
        }

        button.primary {
            background: #1a73e8;
            color: white;
            border: none;
        }

        button.primary:hover {
            background: #1557b0;
        }

        button.danger {
            color: #d93025;
            border-color: #d93025;
        }

        button.danger:hover {
            background: #fce8e6;
        }
    `

    async connectedCallback() {
        super.connectedCallback()
        await this.checkStatus()
    }

    private async checkStatus() {
        try {
            // Check if we have a stored access token
            const result = await Browser.storage.local.get('activeAccessToken')
            this.isConnected = !!result.activeAccessToken

            if (this.isConnected) {
                // Try to get more info from the background
                const response = await Browser.runtime.sendMessage({
                    type: 'USER_API_REQUEST',
                    request: {
                        jsonrpc: '2.0',
                        id: crypto.randomUUID(),
                        method: 'listSessions',
                    },
                    accessToken: result.activeAccessToken,
                })

                if (response?.result?.sessions?.[0]) {
                    const session = response.result.sessions[0]
                    this.networkName = session.network?.name || 'Unknown'
                }

                // Get primary wallet
                const walletsResponse = await Browser.runtime.sendMessage({
                    type: 'USER_API_REQUEST',
                    request: {
                        jsonrpc: '2.0',
                        id: crypto.randomUUID(),
                        method: 'listWallets',
                        params: {},
                    },
                    accessToken: result.activeAccessToken,
                })

                if (walletsResponse?.result) {
                    const wallets = walletsResponse.result as Array<{
                        primary: boolean
                        hint?: string
                    }>
                    const primary = wallets.find((w) => w.primary)
                    this.walletHint = primary?.hint || ''
                }
            }
        } catch (e) {
            console.debug('Status check failed:', e)
        }
    }

    private openPage(page: string) {
        Browser.tabs.create({
            url: Browser.runtime.getURL(`pages/${page}`),
        })
        window.close()
    }

    protected render() {
        return html`
            <div class="popup">
                <div class="header">
                    <h1>Splice Wallet</h1>
                </div>

                <div class="status">
                    <span
                        class="status-dot ${this.isConnected
                            ? 'connected'
                            : 'disconnected'}"
                    ></span>
                    ${this.isConnected ? 'Connected' : 'Not Connected'}
                </div>

                ${this.isConnected
                    ? html`
                          <div class="info">
                              ${this.networkName
                                  ? html`<div>
                                        Network:
                                        <strong>${this.networkName}</strong>
                                    </div>`
                                  : ''}
                              ${this.walletHint
                                  ? html`<div>
                                        Wallet:
                                        <strong>${this.walletHint}</strong>
                                    </div>`
                                  : ''}
                          </div>
                      `
                    : ''}

                <div class="actions">
                    ${this.isConnected
                        ? html`
                              <button
                                  class="primary"
                                  @click=${() => this.openPage('wallets.html')}
                              >
                                  Open Wallet
                              </button>
                              <button
                                  @click=${() =>
                                      this.openPage('transactions.html')}
                              >
                                  Transactions
                              </button>
                              <button
                                  @click=${() => this.openPage('settings.html')}
                              >
                                  Settings
                              </button>
                          `
                        : html`
                              <button
                                  class="primary"
                                  @click=${() => this.openPage('login.html')}
                              >
                                  Connect Wallet
                              </button>
                              <button
                                  @click=${() => this.openPage('settings.html')}
                              >
                                  Settings
                              </button>
                          `}
                </div>
            </div>
        `
    }
}
