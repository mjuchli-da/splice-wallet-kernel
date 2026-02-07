// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * RPC transport that uses browser extension messaging (Browser.runtime.sendMessage)
 * to communicate with the background script for User API calls.
 */

import Browser from 'webextension-polyfill'
import { v4 as uuidv4 } from 'uuid'
import type {
    RequestPayload,
    ResponsePayload,
} from '@canton-network/core-types'
import type { RpcTransport } from '@canton-network/core-rpc-transport'

export const USER_API_REQUEST = 'USER_API_REQUEST'

export interface UserApiMessage {
    type: typeof USER_API_REQUEST
    request: {
        jsonrpc: '2.0'
        id: string
        method: string
        params?: unknown[] | Record<string, unknown>
    }
    accessToken?: string
}

export class ExtensionTransport implements RpcTransport {
    constructor(private accessToken?: string) {}

    async submit(payload: RequestPayload): Promise<ResponsePayload> {
        const message: UserApiMessage = {
            type: USER_API_REQUEST,
            request: {
                jsonrpc: '2.0',
                id: uuidv4(),
                method: payload.method,
                params: payload.params,
            },
            accessToken: this.accessToken,
        }

        try {
            const response = await Browser.runtime.sendMessage(message)

            if (response && typeof response === 'object') {
                if ('error' in response) {
                    return { error: response.error }
                }
                if ('result' in response) {
                    return { result: response.result }
                }
            }

            return { result: response }
        } catch (error) {
            return {
                error: {
                    code: -32603,
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Internal error',
                },
            }
        }
    }
}
