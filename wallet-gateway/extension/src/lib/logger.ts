// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Browser-compatible logger that mirrors the pino Logger interface
 * used throughout the wallet-kernel codebase.
 */
export interface Logger {
    debug(obj: unknown, msg?: string): void
    debug(msg: string): void
    info(obj: unknown, msg?: string): void
    info(msg: string): void
    warn(obj: unknown, msg?: string): void
    warn(msg: string): void
    error(obj: unknown, msg?: string): void
    error(msg: string): void
    child(bindings: Record<string, unknown>): Logger
}

export function createLogger(component: string = 'extension'): Logger {
    const prefix = `[${component}]`

    const logger: Logger = {
        debug(objOrMsg: unknown, msg?: string) {
            if (msg) {
                console.debug(prefix, msg, objOrMsg)
            } else {
                console.debug(prefix, objOrMsg)
            }
        },
        info(objOrMsg: unknown, msg?: string) {
            if (msg) {
                console.info(prefix, msg, objOrMsg)
            } else {
                console.info(prefix, objOrMsg)
            }
        },
        warn(objOrMsg: unknown, msg?: string) {
            if (msg) {
                console.warn(prefix, msg, objOrMsg)
            } else {
                console.warn(prefix, objOrMsg)
            }
        },
        error(objOrMsg: unknown, msg?: string) {
            if (msg) {
                console.error(prefix, msg, objOrMsg)
            } else {
                console.error(prefix, objOrMsg)
            }
        },
        child(bindings: Record<string, unknown>): Logger {
            const childComponent = bindings.component
                ? `${component}:${bindings.component}`
                : component
            return createLogger(childComponent)
        },
    }

    return logger
}
