// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import * as esbuild from 'esbuild'

const config: esbuild.BuildOptions = {
    entryPoints: [
        // Background service worker
        'src/background.ts',
        // Content script (injected into web pages)
        'src/content-script.ts',
        // Popup component
        'src/components/user-ui.ts',
        // Page entry points
        'src/pages/login.ts',
        'src/pages/wallets.ts',
        'src/pages/settings.ts',
        'src/pages/approve.ts',
        'src/pages/transactions.ts',
    ],
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    splitting: false,
    sourcemap: true,
    target: ['chrome100', 'firefox100'],
    define: {
        // Polyfill for node:crypto.randomUUID used by some packages
        'process.env.NODE_ENV': '"production"',
    },
    plugins: [
        {
            name: 'rebuild-notify',
            setup(build: esbuild.PluginBuild) {
                build.onEnd((result) => {
                    console.log(`built with ${result.errors.length} errors`)
                })
            },
        },
    ],
}

const run = async () => {
    if (process.env.WATCH === '1') {
        const ctx = await esbuild.context(config)
        console.log('Watching for changes...')
        await ctx.watch()
    } else {
        await esbuild.build(config)
    }
}

run()
