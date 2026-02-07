// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { html, css, LitElement, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { createUserClient } from './rpc-client'
import { stateManager } from './state-manager'
import { parsePreparedTransaction, PreparedTransactionParsed } from './decode'
import './index'

@customElement('ext-approve')
export class ApprovePage extends LitElement {
    @state() accessor loading = false
    @state() accessor commandId = ''
    @state() accessor partyId = ''
    @state() accessor txHash = ''
    @state() accessor tx = ''
    @state() accessor txParsed: PreparedTransactionParsed | null = null
    @state() accessor status = ''
    @state() accessor message: string | null = null
    @state() accessor messageType: 'info' | 'error' | null = null
    @state() accessor createdAt: string | null = null
    @state() accessor signedAt: string | null = null
    @state() accessor origin: string | null = null

    static styles = css`
        :host {
            display: block;
            max-width: 900px;
            margin: 0 auto;
        }

        .card {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 16px;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            word-break: break-word;
            margin-top: 1rem;
        }

        h1 {
            font-size: 1.25rem;
            margin: 0;
        }
        h2 {
            font-size: 1rem;
            margin: 0.5rem 0 0.25rem 0;
        }
        h3 {
            font-size: 0.875rem;
            margin: 0.25rem 0;
        }
        p {
            font-size: 0.85rem;
            margin: 0.25rem 0;
            word-break: break-word;
        }

        .tx-box {
            background: #f5f5f5;
            border-radius: 8px;
            padding: 0.5rem;
            max-height: 150px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 0.8rem;
            word-break: break-all;
        }

        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .copy-btn {
            background: transparent;
            border: 1px solid #ddd;
            padding: 0.25rem 0.5rem;
            font-size: 0.75rem;
            cursor: pointer;
            border-radius: 4px;
        }

        .copy-btn:hover {
            background: #4caf50;
            color: white;
            border-color: #4caf50;
        }

        button.approve-btn {
            padding: 0.75rem;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            background: #4caf50;
            color: white;
            font-weight: 600;
            font-size: 1rem;
        }

        button.approve-btn:hover {
            background: #43a047;
        }
        button[disabled] {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .message {
            padding: 0.5rem;
            border-radius: 6px;
            font-size: 0.875rem;
        }
        .message.info {
            background: #e8f5e9;
            color: #388e3c;
        }
        .message.error {
            background: #fce4ec;
            color: #d32f2f;
        }
    `

    connectedCallback(): void {
        super.connectedCallback()
        const url = new URL(window.location.href)
        this.commandId = url.searchParams.get('commandId') || ''
        this.updateState()
    }

    private async updateState() {
        const userClient = createUserClient(stateManager.accessToken.get())

        try {
            const result = await userClient.request('getTransaction', {
                commandId: this.commandId,
            })
            this.txHash = result.preparedTransactionHash
            this.tx = result.preparedTransaction
            this.status = result.status
            this.createdAt = result.createdAt || null
            this.signedAt = result.signedAt || null
            this.origin = result.origin || null
            try {
                this.txParsed = parsePreparedTransaction(this.tx)
            } catch {
                this.txParsed = null
            }
        } catch (e) {
            console.error('Failed to load transaction:', e)
        }

        try {
            const wallets = await userClient.request('listWallets', {})
            this.partyId =
                wallets.find((w) => w.primary === true)?.partyId || ''
        } catch (e) {
            console.error('Failed to load wallets:', e)
        }
    }

    private async handleExecute() {
        this.loading = true
        this.message = 'Executing transaction...'
        this.messageType = 'info'

        try {
            const userClient = createUserClient(stateManager.accessToken.get())

            const { signature, signedBy } = await userClient.request('sign', {
                commandId: this.commandId,
                partyId: this.partyId,
                preparedTransactionHash: this.txHash,
                preparedTransaction: this.tx,
            })

            await userClient.request('execute', {
                signature,
                signedBy,
                commandId: this.commandId,
                partyId: this.partyId,
            })

            this.message = 'Transaction executed successfully'
            this.messageType = 'info'
            this.status = 'executed'

            if (window.opener) {
                setTimeout(() => window.close(), 1000)
            }
        } catch (err) {
            console.error(err)
            this.message =
                err instanceof Error
                    ? err.message
                    : 'Error executing transaction'
            this.messageType = 'error'
        } finally {
            this.loading = false
        }
    }

    protected render() {
        return html`
            <div class="card">
                <h1>Pending Transaction Request</h1>

                <h2>Transaction Details</h2>

                <h3>Command Id</h3>
                <p>${this.commandId}</p>

                <h3>Status</h3>
                <p>${this.status}</p>

                ${this.createdAt
                    ? html`<h3>Created At</h3>
                          <p>${this.createdAt}</p>`
                    : nothing}
                ${this.signedAt
                    ? html`<h3>Signed At</h3>
                          <p>${this.signedAt}</p>`
                    : nothing}
                ${this.origin
                    ? html`<h3>Origin</h3>
                          <p>${this.origin}</p>`
                    : nothing}

                <h3>Template</h3>
                <p>
                    ${this.txParsed?.packageName || 'N/A'}:${this.txParsed
                        ?.moduleName || 'N/A'}:${this.txParsed?.entityName ||
                    'N/A'}
                </p>

                <h3>Signatories</h3>
                <ul>
                    ${this.txParsed?.signatories?.map(
                        (s) => html`<li>${s}</li>`
                    ) || html`<li>N/A</li>`}
                </ul>

                <h3>Stakeholders</h3>
                <ul>
                    ${this.txParsed?.stakeholders?.map(
                        (s) => html`<li>${s}</li>`
                    ) || html`<li>N/A</li>`}
                </ul>

                <h3>Transaction Hash</h3>
                <p>${this.txHash}</p>

                <div class="section-header">
                    <h3>Base64 Transaction</h3>
                    <button
                        class="copy-btn"
                        @click=${() => this._copy(this.tx)}
                    >
                        Copy
                    </button>
                </div>
                <div class="tx-box">${this.tx}</div>

                <div class="section-header">
                    <h3>Decoded Transaction</h3>
                    <button
                        class="copy-btn"
                        @click=${() =>
                            this._copy(this.txParsed?.jsonString || '')}
                    >
                        Copy
                    </button>
                </div>
                <div class="tx-box">${this.txParsed?.jsonString || 'N/A'}</div>

                ${this.status === 'executed'
                    ? nothing
                    : html`
                          <button
                              class="approve-btn"
                              ?disabled=${this.loading}
                              @click=${this.handleExecute}
                          >
                              ${this.loading ? 'Processing...' : 'Approve'}
                          </button>
                      `}
                ${this.message
                    ? html`<div class="message ${this.messageType}">
                          ${this.message}
                      </div>`
                    : null}
            </div>
        `
    }

    private _copy(text: string) {
        navigator.clipboard.writeText(text)
    }
}
