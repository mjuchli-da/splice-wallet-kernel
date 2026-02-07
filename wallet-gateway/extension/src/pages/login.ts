// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { html, css, LitElement } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { createUserClient } from './rpc-client'
import { stateManager } from './state-manager'
import { redirectToIntendedOrDefault, addUserSession } from './navigation'
import {
    AuthTokenProviderSelfSigned,
    ClientCredentials,
} from '@canton-network/core-wallet-auth'
import Browser from 'webextension-polyfill'

declare const chrome: {
    identity?: {
        getRedirectURL?: () => string
        launchWebAuthFlow?: (
            details: { url: string; interactive: boolean },
            callback: (responseUrl: string) => void
        ) => void
    }
}

interface NetworkInfo {
    id: string
    name: string
    identityProviderId: string
    auth: {
        method: string
        clientId: string
        clientSecret?: string
        scope?: string
        audience?: string
        issuer?: string
    }
}

interface IdpInfo {
    id: string
    type: string
    issuer: string
    configUrl?: string
}

@customElement('ext-login')
export class LoginPage extends LitElement {
    @state() accessor networks: NetworkInfo[] = []
    @state() accessor idps: IdpInfo[] = []
    @state() accessor selectedNetwork: NetworkInfo | null = null
    @state() accessor selectedIdp: IdpInfo | null = null
    @state() accessor message: string | null = null
    @state() accessor messageType: 'error' | 'info' | null = null

    static styles = css`
        :host {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 1.5rem;
            box-sizing: border-box;
        }

        .card {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 16px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            padding: 1.5rem;
            width: 100%;
            max-width: 360px;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            text-align: center;
        }

        h1 {
            font-size: 1.25rem;
            margin: 0.25rem 0 0.5rem 0;
        }

        select,
        input[type='text'] {
            appearance: none;
            padding: 0.6rem 0.75rem;
            border-radius: 8px;
            border: 1px solid #ddd;
            background: #fff;
            font-size: 1rem;
            outline: none;
            width: 100%;
            box-sizing: border-box;
        }

        select:focus,
        input:focus {
            border-color: #4caf50;
        }

        button {
            padding: 0.7rem;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            background: #4caf50;
            color: white;
            font-weight: 600;
            font-size: 1rem;
            width: 100%;
        }

        button:hover {
            background: #43a047;
        }

        .message {
            font-size: 0.85rem;
            border-radius: 6px;
            padding: 0.5rem;
        }

        .message.error {
            color: #d32f2f;
            background: #fce4ec;
        }

        .message.info {
            color: #388e3c;
            background: #e8f5e9;
        }

        p {
            font-size: 0.85rem;
            opacity: 0.8;
            margin-top: 0.25rem;
        }
    `

    async connectedCallback() {
        super.connectedCallback()
        try {
            // Load networks and IDPs (these don't require auth)
            const userClient = createUserClient(stateManager.accessToken.get())
            const [networkRes, idpRes] = await Promise.all([
                userClient.request('listNetworks'),
                userClient.request('listIdps'),
            ])
            this.networks = networkRes.networks as NetworkInfo[]
            this.idps = idpRes.idps as IdpInfo[]
        } catch (e) {
            console.error('Failed to load networks/IDPs:', e)
        }
    }

    private handleChange(e: Event) {
        const index = parseInt((e.target as HTMLSelectElement).value)
        this.selectedNetwork = this.networks[index] ?? null
        this.selectedIdp =
            this.idps.find(
                (idp) => idp.id === this.selectedNetwork?.identityProviderId
            ) ?? null
        this.message = null
    }

    private async handleConnect() {
        this.message = null

        if (!this.selectedNetwork) {
            this.messageType = 'error'
            this.message = 'Please select a network before connecting.'
            return
        }

        const clientId =
            (this.renderRoot.querySelector('#client-id') as HTMLInputElement)
                ?.value || this.selectedNetwork.auth.clientId

        stateManager.networkId.set(this.selectedNetwork.id)

        const idp = this.idps.find(
            (idp) => idp.id === this.selectedNetwork?.identityProviderId
        )

        if (!idp) {
            this.messageType = 'error'
            this.message = 'Identity provider misconfigured for this network.'
            return
        }

        if (idp.type === 'self_signed') {
            try {
                await this.selfSign({
                    clientId: clientId,
                    clientSecret: this.selectedNetwork.auth.clientSecret || '',
                    scope: this.selectedNetwork.auth.scope,
                    audience: this.selectedNetwork.auth.audience,
                } as ClientCredentials)
                redirectToIntendedOrDefault()
            } catch (e) {
                this.messageType = 'error'
                this.message =
                    e instanceof Error ? e.message : 'Self-sign failed'
            }
        } else if (idp.type === 'oauth') {
            if (this.selectedNetwork.auth.method === 'authorization_code') {
                await this.handleOAuthLogin(idp)
            } else {
                this.messageType = 'error'
                this.message = 'This authentication method is not valid.'
            }
        } else {
            this.messageType = 'error'
            this.message = 'This authentication type is not supported yet.'
        }
    }

    private async selfSign(credentials: ClientCredentials) {
        const access_token = await AuthTokenProviderSelfSigned.fetchToken(
            console,
            credentials,
            'unsafe-auth',
            3600
        )

        const payload = JSON.parse(atob(access_token.split('.')[1]))
        stateManager.expirationDate.set(
            new Date(payload.exp * 1000).toISOString()
        )
        stateManager.accessToken.set(access_token)

        const networkId = stateManager.networkId.get() || ''
        await addUserSession(access_token, networkId)
    }

    private async handleOAuthLogin(idp: IdpInfo) {
        if (!idp.configUrl) {
            this.messageType = 'error'
            this.message = 'OAuth IDP missing config URL.'
            return
        }

        this.messageType = 'info'
        this.message = `Redirecting to ${this.selectedNetwork!.name}...`

        try {
            const configRes = await fetch(idp.configUrl)
            const config = await configRes.json()

            // Use chrome.identity.launchWebAuthFlow for extensions
            const redirectUrl =
                chrome?.identity?.getRedirectURL?.() ||
                Browser.runtime.getURL('pages/callback.html')

            const params = new URLSearchParams({
                response_type: 'code',
                client_id: this.selectedNetwork!.auth.clientId || '',
                redirect_uri: redirectUrl,
                nonce: crypto.randomUUID(),
                scope: this.selectedNetwork!.auth.scope || '',
                audience: this.selectedNetwork!.auth.audience || '',
                state: btoa(
                    JSON.stringify({
                        configUrl: idp.configUrl,
                        clientId: this.selectedNetwork!.auth.clientId,
                        audience: this.selectedNetwork!.auth.audience,
                    })
                ),
            })

            const authUrl = `${config.authorization_endpoint}?${params.toString()}`

            // Try extension OAuth flow first
            if (chrome?.identity?.launchWebAuthFlow) {
                chrome.identity.launchWebAuthFlow(
                    { url: authUrl, interactive: true },
                    async (responseUrl: string) => {
                        if (responseUrl) {
                            await this.handleOAuthCallback(responseUrl)
                        }
                    }
                )
            } else {
                // Fallback: open in a new tab
                window.location.href = authUrl
            }
        } catch (e) {
            this.messageType = 'error'
            this.message = e instanceof Error ? e.message : 'OAuth flow failed'
        }
    }

    private async handleOAuthCallback(responseUrl: string) {
        const url = new URL(responseUrl)
        const code = url.searchParams.get('code')
        const encodedState = url.searchParams.get('state')

        if (code && encodedState) {
            const state = JSON.parse(atob(encodedState))
            const fetchConfig = await fetch(state.configUrl)
            const config = await fetchConfig.json()

            const redirectUrl =
                chrome?.identity?.getRedirectURL?.() ||
                Browser.runtime.getURL('pages/callback.html')

            const res = await fetch(config.token_endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: redirectUrl,
                    client_id: state.clientId,
                    audience: state.audience || '',
                }),
            })

            const tokenResponse = await res.json()

            if (tokenResponse.access_token) {
                const payload = JSON.parse(
                    atob(tokenResponse.access_token.split('.')[1])
                )
                stateManager.expirationDate.set(
                    new Date(payload.exp * 1000).toISOString()
                )
                stateManager.accessToken.set(tokenResponse.access_token)
                await addUserSession(
                    tokenResponse.access_token,
                    stateManager.networkId.get() || ''
                )
                redirectToIntendedOrDefault()
            }
        }
    }

    protected render() {
        return html`
            <div class="card">
                <h1>Sign in to Canton Network</h1>

                <select id="network" @change=${this.handleChange}>
                    <option value="">Select Network</option>
                    ${this.networks.map(
                        (net, index) =>
                            html`<option
                                value=${index}
                                ?disabled=${net.auth.method ===
                                'client_credentials'}
                            >
                                ${net.name}
                            </option>`
                    )}
                </select>

                ${this.selectedIdp?.type === 'self_signed'
                    ? html`
                          <input
                              type="text"
                              title="client id"
                              id="client-id"
                              .value=${this.selectedNetwork?.auth.clientId ||
                              ''}
                          />
                      `
                    : null}
                <button @click=${this.handleConnect}>Connect</button>

                ${this.message
                    ? html`<div class="message ${this.messageType}">
                          ${this.message}
                      </div>`
                    : html`<p>
                          ${this.selectedNetwork
                              ? `Selected: ${this.selectedNetwork.name}`
                              : `Please choose a network`}
                      </p>`}
            </div>
        `
    }
}
