// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Transaction decoding utilities for displaying prepared transactions.
 * Simplified version that works in the browser without the full tx-visualizer.
 */

export interface PreparedTransactionParsed {
    jsonString: string
    signatories?: string[]
    stakeholders?: string[]
    packageName?: string
    moduleName?: string
    entityName?: string
}

/**
 * Attempt to decode a base64 prepared transaction to a human-readable format.
 * Falls back to displaying the raw base64 if decoding fails.
 */
export function parsePreparedTransaction(
    txBase64: string
): PreparedTransactionParsed {
    try {
        // Try to decode the base64 string
        const decoded = atob(txBase64)

        // Try to parse as JSON (some formats may encode JSON)
        try {
            const obj = JSON.parse(decoded)
            const jsonString = JSON.stringify(obj, null, 2)
            const result: PreparedTransactionParsed = { jsonString }

            // Extract fields from the parsed object
            deepSearch(obj, result)
            return result
        } catch {
            // Not JSON - return as-is with limited info
            return {
                jsonString: `(Binary transaction data, ${txBase64.length} chars base64)`,
            }
        }
    } catch {
        return {
            jsonString: `(Unable to decode transaction, ${txBase64.length} chars)`,
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepSearch(value: any, result: PreparedTransactionParsed) {
    if (value === null || typeof value !== 'object') return

    if (typeof value.packageName === 'string') {
        result.packageName = value.packageName
    }
    if (Array.isArray(value.signatories)) {
        result.signatories = value.signatories
    }
    if (Array.isArray(value.stakeholders)) {
        result.stakeholders = value.stakeholders
    }
    if (value.templateId?.moduleName) {
        result.moduleName = value.templateId.moduleName
    }
    if (value.templateId?.entityName) {
        result.entityName = value.templateId.entityName
    }
    for (const key of Object.keys(value)) {
        deepSearch(value[key], result)
    }
}
