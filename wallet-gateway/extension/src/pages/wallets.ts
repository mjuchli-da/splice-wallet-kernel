// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { css, html, LitElement } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { Wallet } from '@canton-network/core-wallet-store'
import { createUserClient } from './rpc-client'
import { stateManager } from './state-manager'
import './index'

@customElement('ext-wallets')
export class WalletsPage extends LitElement {
    @state() accessor wallets: Wallet[] | undefined = undefined
    @state() accessor loading = false
    @state() accessor showCreateCard = false

    @query('#party-id-hint') accessor _partyHintInput: HTMLInputElement | null =
        null
    @query('#signing-provider-id')
    accessor _signingProviderSelect: HTMLSelectElement | null = null
    @query('#primary') accessor _primaryCheckbox: HTMLInputElement | null = null

    static styles = css`
        :host {
            display: block;
            max-width: 900px;
            margin: 0 auto;
        }
        .header {
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .card-list {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1rem;
            margin: 1rem 0;
        }
        .form-card,
        .wallet-card {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        form {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        label {
            font-weight: 500;
            margin-bottom: 0.2rem;
        }
        .form-control {
            padding: 0.5rem;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 1rem;
        }
        .inline {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .btn {
            padding: 0.4rem 0.8rem;
            font-size: 1rem;
            border-radius: 4px;
            border: 1px solid #ccc;
            background: #f5f5f5;
            cursor: pointer;
            transition: background 0.2s;
        }
        .btn:hover:not(:disabled) {
            background: #e2e6ea;
        }
        .btn:disabled {
            opacity: 0.75;
            cursor: not-allowed;
        }
        .wallet-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #0052cc;
            word-break: break-all;
        }
        .wallet-meta {
            font-size: 0.95rem;
            color: #555;
            word-break: break-all;
        }
        .wallet-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.5rem;
        }
        .badge-success {
            color: #009900;
        }
        .badge-error {
            color: #cc0000;
        }
        .sync-btn {
            margin-left: 1rem;
            padding: 0.3rem 0.7rem;
            font-size: 0.85rem;
            border-radius: 4px;
            border: 1px solid #1a73e8;
            background: #e8f0fe;
            color: #1a73e8;
            cursor: pointer;
        }
        .sync-btn:hover {
            background: #d2e3fc;
        }
    `

    async connectedCallback(): Promise<void> {
        super.connectedCallback()
        await this.updateWallets()
    }

    private async updateWallets() {
        const userClient = createUserClient(stateManager.accessToken.get())
        try {
            const wallets = await userClient.request('listWallets', {})
            this.wallets = wallets || []
        } catch (e) {
            console.error('Failed to load wallets:', e)
            this.wallets = []
        }
    }

    private async handleSync() {
        this.loading = true
        try {
            const userClient = createUserClient(stateManager.accessToken.get())
            await userClient.request('syncWallets')
            await this.updateWallets()
        } catch (e) {
            console.error('Sync failed:', e)
        }
        this.loading = false
    }

    private async _setPrimary(wallet: Wallet) {
        const userClient = createUserClient(stateManager.accessToken.get())
        await userClient.request('setPrimaryWallet', {
            partyId: wallet.partyId,
        })
        await this.updateWallets()
    }

    private _copyPartyId(partyId: string) {
        navigator.clipboard.writeText(partyId)
    }

    private async _onCreateWalletSubmit(e: Event) {
        e.preventDefault()
        this.loading = true

        const partyHint = this._partyHintInput?.value || ''
        const primary = this._primaryCheckbox?.checked || false
        const signingProviderId = this._signingProviderSelect?.value || ''

        try {
            const userClient = createUserClient(stateManager.accessToken.get())
            await userClient.request('createWallet', {
                primary,
                partyHint,
                signingProviderId,
            })
        } catch (e) {
            console.error('Create wallet failed:', e)
        }

        this.loading = false
        if (this._partyHintInput) {
            this._partyHintInput.value = ''
        }
        await this.updateWallets()
    }

    protected render() {
        return html`
            <div class="header">
                <h1>
                    Wallets
                    <button
                        class="sync-btn"
                        ?disabled=${this.loading}
                        @click=${this.handleSync}
                    >
                        ${this.loading ? 'Syncing...' : 'Sync'}
                    </button>
                </h1>
                <button
                    class="btn"
                    @click=${() => (this.showCreateCard = !this.showCreateCard)}
                >
                    ${this.showCreateCard ? 'Close' : 'Create New'}
                </button>
            </div>

            ${this.wallets === undefined ? html`<p>Loading wallets...</p>` : ''}
            ${this.showCreateCard
                ? html`
                      <div class="card-list">
                          <div class="form-card">
                              <form @submit=${this._onCreateWalletSubmit}>
                                  <label for="party-id-hint"
                                      >Party ID Hint:</label
                                  >
                                  <input
                                      ?disabled=${this.loading}
                                      class="form-control"
                                      id="party-id-hint"
                                      type="text"
                                      placeholder="Enter party ID hint"
                                      required
                                  />
                                  <label for="signing-provider-id"
                                      >Signing Provider:</label
                                  >
                                  <select
                                      class="form-control"
                                      id="signing-provider-id"
                                  >
                                      <option value="participant">
                                          participant
                                      </option>
                                      <option value="wallet_kernel">
                                          wallet_kernel
                                      </option>
                                  </select>
                                  <div class="inline">
                                      <label for="primary"
                                          >Set as primary:</label
                                      >
                                      <input id="primary" type="checkbox" />
                                  </div>
                                  <button
                                      class="btn"
                                      ?disabled=${this.loading}
                                      type="submit"
                                  >
                                      Create
                                  </button>
                              </form>
                          </div>
                      </div>
                  `
                : ''}

            <div class="card-list">
                ${this.wallets?.map(
                    (wallet) => html`
                        <div class="wallet-card">
                            <div class="wallet-title">
                                ${wallet.hint || wallet.partyId}
                                ${wallet.primary
                                    ? html`<span class="badge-success"
                                          >(Primary)</span
                                      >`
                                    : ''}
                                ${wallet.disabled
                                    ? html`<span class="badge-error"
                                          >(Disabled)</span
                                      >`
                                    : ''}
                            </div>
                            <div class="wallet-meta">
                                <strong>Party ID:</strong>
                                ${wallet.partyId}<br />
                                <strong>Network:</strong>
                                ${wallet.networkId}<br />
                                <strong>Signing Provider:</strong>
                                ${wallet.signingProviderId}<br />
                                <strong>Status:</strong> ${wallet.status}
                                ${wallet.reason
                                    ? html`<br /><strong>Reason:</strong>
                                          ${wallet.reason}`
                                    : ''}
                            </div>
                            <div class="wallet-actions">
                                <button
                                    class="btn"
                                    ?disabled=${wallet.disabled}
                                    @click=${() => this._setPrimary(wallet)}
                                >
                                    Set Primary
                                </button>
                                <button
                                    class="btn"
                                    @click=${() =>
                                        this._copyPartyId(wallet.partyId)}
                                >
                                    Copy Party ID
                                </button>
                            </div>
                        </div>
                    `
                )}
            </div>
        `
    }
}
