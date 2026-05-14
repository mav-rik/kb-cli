/// <reference types="node" />
import { defineConfig } from 'rolldown'
import atscript from 'unplugin-atscript/rolldown'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

export default defineConfig({
    input: 'src/main.ts',
    output: {
        format: 'esm',
        dir: 'dist',
        entryFileNames: 'main.js',
    },
    transform: {
        define: {
            __VERSION__: JSON.stringify(pkg.version),
        },
    },
    plugins: [atscript({ strict: true })],
    external: [
        '@moostjs/event-cli',
        '@moostjs/event-http',
        'moost',
        'better-sqlite3',
        'gray-matter',
        /^@atscript\//,
        '@huggingface/transformers',
        'sqlite-vec',
        /^node:/,
    ],
})
