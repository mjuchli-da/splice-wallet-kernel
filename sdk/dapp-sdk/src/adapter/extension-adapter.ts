// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    Provider,
    type EventListener,
} from '@canton-network/core-splice-provider'
import { DappSyncProvider } from '@canton-network/core-provider-dapp'
import type { RpcTypes as DappRpcTypes } from '@canton-network/core-wallet-dapp-rpc-client'
import { WalletEvent } from '@canton-network/core-types'
import type {
    ProviderAdapter,
    WalletInfo,
} from '@canton-network/core-wallet-discovery'
import type {
    ProviderId,
    ProviderType,
    ConnectResult,
    StatusEvent,
    TxChangedEvent,
} from '@canton-network/core-wallet-dapp-rpc-client'
import type { RequestArgs } from '@canton-network/core-types'

const BROWSER_PROVIDER_ID: ProviderId = 'browser'
const EXTENSION_DETECT_TIMEOUT_MS = 2000

/**
 * ProviderAdapter for any CIP-103 compliant wallet exposed as a browser extension.
 *
 * provider() returns a DappProvider which communicates via postMessage
 * and implements the full openrpc-dapp-api.json surface directly.
 */
export class ExtensionAdapter implements ProviderAdapter {
    readonly providerId: ProviderId = BROWSER_PROVIDER_ID
    readonly name = 'Browser Extension'
    readonly type: ProviderType = 'browser'
    readonly icon: string | undefined = undefined
    private providerInstance: ExtensionMappedProvider | undefined

    getInfo(): WalletInfo {
        return {
            providerId: this.providerId,
            name: this.name,
            type: this.type,
            description: 'Connect via the Splice Wallet browser extension',
        }
    }

    async detect(): Promise<boolean> {
        if (window.canton) return true

        return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler)
                resolve(false)
            }, EXTENSION_DETECT_TIMEOUT_MS)

            const handler = (event: MessageEvent) => {
                if (event.data?.type === WalletEvent.SPLICE_WALLET_EXT_ACK) {
                    clearTimeout(timeout)
                    window.removeEventListener('message', handler)
                    resolve(true)
                }
            }

            window.addEventListener('message', handler)
            window.postMessage(
                { type: WalletEvent.SPLICE_WALLET_EXT_READY },
                '*'
            )
        })
    }

    provider(): Provider<DappRpcTypes> {
        const baseProvider = new DappSyncProvider()
        const provider = new ExtensionMappedProvider(baseProvider)
        this.providerInstance = provider
        return provider
    }

    teardown(): void {
        this.providerInstance?.teardown()
        this.providerInstance = undefined
    }

    async restore(): Promise<Provider<DappRpcTypes> | null> {
        if (!window.canton) return null

        try {
            const provider = new ExtensionMappedProvider(new DappSyncProvider())
            const status = await provider.request({ method: 'status' })
            if (status.connection.isConnected) {
                return provider as Provider<DappRpcTypes>
            }
        } catch {
            // Restore failed
        }
        return null
    }
}

class ExtensionMappedProvider implements Provider<DappRpcTypes> {
    private pollInterval: number | null = null
    private lastStatus: StatusEvent | null = null
    private lastAccountsJson = '[]'

    constructor(private readonly baseProvider: DappSyncProvider) {}

    request<M extends keyof DappRpcTypes>(
        args: RequestArgs<DappRpcTypes, M>
    ): Promise<DappRpcTypes[M]['result']> {
        switch (args.method) {
            case 'connect':
                return this.connect() as Promise<DappRpcTypes[M]['result']>
            case 'disconnect':
                return this.disconnect() as Promise<DappRpcTypes[M]['result']>
            case 'prepareExecute':
                return this.prepareExecute(args.params) as Promise<
                    DappRpcTypes[M]['result']
                >
            case 'status':
                return this.baseProvider.request(args)
            case 'listAccounts':
                return this.baseProvider.request(args)
            case 'prepareExecuteAndWait':
                return this.baseProvider.request(args)
            case 'ledgerApi':
                return this.baseProvider.request(args)
            case 'getPrimaryAccount':
                return this.baseProvider.request(args)
            default:
                return this.baseProvider.request(args)
        }
    }

    on<E>(event: string, listener: EventListener<E>): Provider<DappRpcTypes> {
        this.baseProvider.on(event, listener)
        return this
    }

    emit<E>(event: string, ...args: E[]): boolean {
        return this.baseProvider.emit(event, ...args)
    }

    removeListener<E>(
        event: string,
        listenerToRemove: EventListener<E>
    ): Provider<DappRpcTypes> {
        this.baseProvider.removeListener(event, listenerToRemove)
        return this
    }

    teardown(): void {
        this.stopPolling()
    }

    private async connect(): Promise<ConnectResult> {
        const result = await this.baseProvider.request({ method: 'connect' })
        this.openUserUrlIfPresent(result)
        this.startPolling()
        return result
    }

    private async disconnect(): Promise<null> {
        const result = await this.baseProvider.request({ method: 'disconnect' })
        this.stopPolling()
        return result
    }

    private async prepareExecute(
        params: DappRpcTypes['prepareExecute']['params']
    ): Promise<null> {
        const result = await this.baseProvider.request({
            method: 'prepareExecute',
            params,
        })
        this.openUserUrlIfPresent(result)
        const commandId = this.extractCommandId(result, params)
        if (commandId) {
            this.emit<TxChangedEvent>('txChanged', {
                status: 'pending',
                commandId,
            })
        }
        return null
    }

    private openUserUrlIfPresent(result: unknown): void {
        if (
            typeof result === 'object' &&
            result !== null &&
            'userUrl' in result &&
            typeof result.userUrl === 'string'
        ) {
            window.postMessage(
                {
                    type: WalletEvent.SPLICE_WALLET_EXT_OPEN,
                    url: result.userUrl,
                },
                '*'
            )
        }
    }

    private extractCommandId(
        result: unknown,
        params: DappRpcTypes['prepareExecute']['params']
    ): string | undefined {
        if (params?.commandId) {
            return params.commandId
        }
        if (
            typeof result === 'object' &&
            result !== null &&
            'userUrl' in result &&
            typeof result.userUrl === 'string'
        ) {
            try {
                const url = new URL(result.userUrl)
                if (url.hash) {
                    const hash = url.hash.startsWith('#')
                        ? url.hash.slice(1)
                        : url.hash
                    const [, query = ''] = hash.split('?')
                    const commandId = new URLSearchParams(query).get(
                        'commandId'
                    )
                    return commandId ?? undefined
                }
            } catch {
                return undefined
            }
        }
        return undefined
    }

    private startPolling(): void {
        if (this.pollInterval !== null) {
            return
        }
        this.poll().catch(() => {
            // best-effort; polling continues on interval
        })
        this.pollInterval = window.setInterval(() => {
            this.poll().catch(() => {
                // best-effort; keep polling
            })
        }, 1500)
    }

    private stopPolling(): void {
        if (this.pollInterval !== null) {
            window.clearInterval(this.pollInterval)
            this.pollInterval = null
        }
        this.lastStatus = null
        this.lastAccountsJson = '[]'
    }

    private async poll(): Promise<void> {
        const status = await this.baseProvider.request({ method: 'status' })
        const statusChanged =
            JSON.stringify(status) !== JSON.stringify(this.lastStatus)
        if (statusChanged) {
            this.lastStatus = status
            this.emit<StatusEvent>('statusChanged', status)
        }

        if (!status.connection.isConnected) {
            return
        }

        const accounts = await this.baseProvider.request({
            method: 'listAccounts',
        })
        const nextAccountsJson = JSON.stringify(accounts)
        if (nextAccountsJson !== this.lastAccountsJson) {
            this.lastAccountsJson = nextAccountsJson
            this.emit<typeof accounts>('accountsChanged', accounts)
        }
    }
}
