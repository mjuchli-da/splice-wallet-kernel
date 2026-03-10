// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { createUserClient } from './rpc-client'
import { stateManager } from './state-manager'

import '@canton-network/core-wallet-ui-components'
import {
    IdpAddEvent,
    IdpCardDeleteEvent,
    NetworkCardDeleteEvent,
    NetworkEditSaveEvent,
} from '@canton-network/core-wallet-ui-components'

interface AuthInfo {
    method: string
    scope: string
    clientId: string
    clientSecret?: string
    issuer?: string
    audience: string
}

interface NetworkInfo {
    id: string
    name: string
    description: string
    synchronizerId?: string
    identityProviderId: string
    auth: AuthInfo
    adminAuth?: AuthInfo
    ledgerApi: string
}

interface SessionInfo {
    id: string
    network: NetworkInfo
    idp: IdpInfo
    accessToken: string
    status: string
    reason?: string
}

interface IdpInfo {
    id: string
    type: string
    issuer: string
    configUrl?: string
}

@customElement('ext-settings')
export class SettingsPage extends LitElement {
    static styles = css`
        :host {
            display: block;
            max-width: 900px;
            margin: 0 auto;
        }
    `

    @state() accessor networks: NetworkInfo[] = []
    @state() accessor sessions: SessionInfo[] = []
    @state() accessor idps: IdpInfo[] = []

    async connectedCallback(): Promise<void> {
        super.connectedCallback()
        await Promise.all([
            this.listNetworks(),
            this.listSessions(),
            this.listIdps(),
        ])
    }

    private async listNetworks() {
        const userClient = createUserClient(stateManager.accessToken.get())
        const response = await userClient.request({ method: 'listNetworks' })
        this.networks = response.networks as NetworkInfo[]
    }

    private async listSessions() {
        const userClient = createUserClient(stateManager.accessToken.get())
        const response = await userClient.request({ method: 'listSessions' })
        this.sessions = response.sessions as SessionInfo[]
    }

    private async listIdps() {
        const userClient = createUserClient(stateManager.accessToken.get())
        const response = await userClient.request({ method: 'listIdps' })
        this.idps = response.idps as IdpInfo[]
    }

    private handleNetworkSubmit = async (e: NetworkEditSaveEvent) => {
        e.preventDefault()

        const network: NetworkInfo = {
            id: e.network.id,
            name: e.network.name,
            description: e.network.description,
            identityProviderId: e.network.identityProviderId,
            ...(e.network.synchronizerId && {
                synchronizerId: e.network.synchronizerId as string,
            }),
            ledgerApi: e.network.ledgerApi.baseUrl,
            auth: e.network.auth,
            adminAuth: e.network.adminAuth || undefined,
        }

        try {
            const userClient = createUserClient(stateManager.accessToken.get())
            await userClient.request({
                method: 'addNetwork',
                params: { network },
            })
            await this.listNetworks()
        } catch (e) {
            console.error('Failed to save network:', e)
        }
    }

    private async handleNetworkDelete(e: NetworkCardDeleteEvent) {
        if (!confirm(`Delete network "${e.network.name}"?`)) return
        try {
            const userClient = createUserClient(stateManager.accessToken.get())
            await userClient.request({
                method: 'removeNetwork',
                params: {
                    networkName: e.network.id,
                },
            })
            await this.listNetworks()
        } catch (e) {
            console.error('Failed to delete network:', e)
        }
    }

    private handleIdpSubmit = async (ev: IdpAddEvent) => {
        try {
            const userClient = createUserClient(stateManager.accessToken.get())
            await userClient.request({
                method: 'addIdp',
                params: { idp: ev.idp },
            })
            await this.listIdps()
        } catch (e) {
            console.error('Failed to add IDP:', e)
        }
    }

    private handleIdpDelete = async (ev: IdpCardDeleteEvent) => {
        try {
            const userClient = createUserClient(stateManager.accessToken.get())
            await userClient.request({
                method: 'removeIdp',
                params: {
                    identityProviderId: ev.idp.id,
                },
            })
            await this.listIdps()
        } catch (e) {
            console.error('Failed to delete IDP:', e)
        }
    }

    protected render() {
        return html`
            <div>
                <h1>Settings (Extension)</h1>
            </div>
            <wg-sessions .sessions=${this.sessions}></wg-sessions>

            <wg-networks
                .networks=${this.networks}
                .activeSessions=${this.sessions}
                @network-edit-save=${this.handleNetworkSubmit}
                @delete=${this.handleNetworkDelete}
            ></wg-networks>
            <wg-idps
                .idps=${this.idps}
                .activeSessions=${this.sessions}
                @delete=${this.handleIdpDelete}
                @idp-add=${this.handleIdpSubmit}
            ></wg-idps>
        `
    }
}
