import { defineConfig } from 'vitest/config'
import atscript from 'unplugin-atscript/vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// Vitest needs the same `.as` transform that rolldown uses in builds.
// Without the plugin, any test that imports a file that transitively
// pulls in `src/models/*.as` (e.g. IndexService -> document.as) blows up
// at parse time. Existing tests sidestep this by importing only leaf
// services that don't touch atscript models; tests that exercise
// MigrationService / IndexService need the real transform.
//
// `define` mirrors rolldown's build-time __VERSION__ substitution so code that
// references __VERSION__ (setup.controller, version handler) runs in tests.
export default defineConfig({
  plugins: [atscript({ strict: true })],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
})
