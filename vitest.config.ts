import { defineConfig } from 'vitest/config'
import atscript from 'unplugin-atscript/vite'

// Vitest needs the same `.as` transform that rolldown uses in builds.
// Without the plugin, any test that imports a file that transitively
// pulls in `src/models/*.as` (e.g. IndexService -> document.as) blows up
// at parse time. Existing tests sidestep this by importing only leaf
// services that don't touch atscript models; tests that exercise
// MigrationService / IndexService need the real transform.
export default defineConfig({
  plugins: [atscript({ strict: true })],
})
