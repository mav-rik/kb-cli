import { defineConfig } from '@atscript/core'
import ts from '@atscript/typescript'
import dbPlugin from '@atscript/db/plugin'

export default defineConfig({
  rootDir: 'src',
  plugins: [ts(), dbPlugin()],
  format: 'dts',
  db: {
    adapter: '@atscript/db-sqlite',
    connection: ':memory:',
  },
})
