// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { css, html, LitElement, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { createUserClient } from './rpc-client'
import { stateManager } from './state-manager'
import { parsePreparedTransaction, PreparedTransactionParsed } from './decode'
import { navigateTo } from './navigation'

interface TransactionInfo {
    commandId: string
    status: string
    preparedTransaction: string
    preparedTransactionHash: string
    payload?: string
    origin?: string
    createdAt?: string
    signedAt?: string
}

@customElement('ext-transactions')
export class TransactionsPage extends LitElement {
    @state() accessor transactions: TransactionInfo[] = []
    @state() accessor parsedTransactions: Map<
        string,
        PreparedTransactionParsed
    > = new Map()

    static styles = css`
        :host {
            display: block;
            max-width: 900px;
            margin: 0 auto;
        }
        .header {
            margin-bottom: 1rem;
        }
        .card-list {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1rem;
            margin: 1rem 0;
        }
        .tx-card {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .tx-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #0052cc;
            word-break: break-all;
        }
        .tx-meta {
            font-size: 0.95rem;
            color: #555;
            word-break: break-all;
        }
        .tx-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.5rem;
        }
        .btn {
            padding: 0.4rem 0.8rem;
            font-size: 0.9rem;
            border-radius: 4px;
            border: 1px solid #ccc;
            background: #f5f5f5;
            cursor: pointer;
        }
        .btn:hover {
            background: #e2e6ea;
        }
        .status {
            color: #009900;
        }
    `

    connectedCallback(): void {
        super.connectedCallback()
        this.updateTransactions()
    }

    private async updateTransactions() {
        const userClient = createUserClient(stateManager.accessToken.get())
        try {
            const result = await userClient.request({
                method: 'listTransactions',
            })
            this.transactions = (result.transactions as TransactionInfo[]) || []
            for (const tx of this.transactions) {
                try {
                    this.parsedTransactions.set(
                        tx.commandId,
                        parsePreparedTransaction(tx.preparedTransaction)
                    )
                } catch {
                    // ignore parse errors
                }
            }
        } catch (e) {
            console.error('Failed to load transactions:', e)
        }
    }

    protected render() {
        return html`
            <div class="header">
                <h1>Transactions</h1>
            </div>

            ${this.transactions.length === 0
                ? html`<p>No transactions yet.</p>`
                : ''}

            <div class="card-list">
                ${this.transactions.map(
                    (tx) => html`
                        <div class="tx-card">
                            <div class="tx-title">${tx.commandId}</div>
                            <div class="tx-meta">
                                <strong>Status:</strong>
                                <span class="status">${tx.status}</span>
                                <br />
                                <strong>Template:</strong>
                                ${this.parsedTransactions.get(tx.commandId)
                                    ?.packageName ||
                                'N/A'}:${this.parsedTransactions.get(
                                    tx.commandId
                                )?.moduleName ||
                                'N/A'}:${this.parsedTransactions.get(
                                    tx.commandId
                                )?.entityName || 'N/A'}
                                ${tx.createdAt
                                    ? html`<br /><strong>Created:</strong>
                                          ${tx.createdAt}`
                                    : nothing}
                                ${tx.signedAt
                                    ? html`<br /><strong>Signed:</strong>
                                          ${tx.signedAt}`
                                    : nothing}
                                ${tx.origin
                                    ? html`<br /><strong>Origin:</strong>
                                          ${tx.origin}`
                                    : nothing}
                            </div>
                            <div class="tx-actions">
                                <button
                                    class="btn"
                                    @click=${() =>
                                        navigateTo('approve', {
                                            commandId: tx.commandId,
                                        })}
                                >
                                    Review
                                </button>
                            </div>
                        </div>
                    `
                )}
            </div>
        `
    }
}
