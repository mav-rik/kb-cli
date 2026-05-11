import { defineConfig } from 'rolldown'
import atscript from 'unplugin-atscript/rolldown'

export default defineConfig({
    input: 'src/main.ts',
    output: {
        format: 'esm',
        dir: 'dist',
        entryFileNames: 'main.js',
    },
    plugins: [atscript({ strict: true })],
    external: [
        '@moostjs/event-cli',
        'moost',
        'better-sqlite3',
        'gray-matter',
        '@atscript/core',
        '@atscript/typescript',
        '@atscript/db',
        '@atscript/db-sqlite',
        '@huggingface/transformers',
        'sqlite-vec',
        /^node:/,
    ],
})
