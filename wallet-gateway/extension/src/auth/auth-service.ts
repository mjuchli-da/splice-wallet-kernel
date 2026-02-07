// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Simplified auth service for the browser extension.
 * Decodes JWT tokens to extract user information.
 * Supports self-signed tokens (no remote verification needed).
 */

import type { AuthContext, AuthService } from '@canton-network/core-wallet-auth'
import { decodeJwt } from 'jose'

export const extensionAuthService = (): AuthService => ({
    verifyToken: async (
        accessToken?: string
    ): Promise<AuthContext | undefined> => {
        if (!accessToken) {
            return undefined
        }

        // Strip Bearer prefix if present
        const jwt = accessToken.startsWith('Bearer ')
            ? accessToken.split(' ')[1]
            : accessToken

        try {
            const decoded = decodeJwt(jwt)

            if (!decoded.sub) {
                console.warn('JWT does not contain a subject')
                return undefined
            }

            if (!decoded.iss) {
                console.warn('JWT does not contain an issuer')
                return undefined
            }

            return { userId: decoded.sub, accessToken: jwt }
        } catch (error) {
            console.warn('Failed to decode JWT token:', error)
            return undefined
        }
    },
})

/**
 * Extract AuthContext from a raw access token string.
 */
export function authContextFromToken(
    accessToken: string
): AuthContext | undefined {
    try {
        const decoded = decodeJwt(accessToken)
        if (!decoded.sub) return undefined
        return { userId: decoded.sub, accessToken }
    } catch {
        return undefined
    }
}
