import { describe, it, expect } from 'vitest'
import { isAllowedDuringMigration, MIGRATION_ALLOWLIST } from '../src/migration-gate.js'

function argv(...rest: string[]): string[] {
  return ['node', 'bin.js', ...rest]
}

describe('isAllowedDuringMigration', () => {
  it('allows bare `kb` (no command — help is printed by the dispatcher)', () => {
    expect(isAllowedDuringMigration(argv())).toBe(true)
  })

  it('allows every command in MIGRATION_ALLOWLIST', () => {
    for (const cmd of MIGRATION_ALLOWLIST) {
      expect(isAllowedDuringMigration(argv(cmd))).toBe(true)
    }
  })

  it('allows config subcommands (gate matches just the first slot)', () => {
    expect(isAllowedDuringMigration(argv('config', 'get', 'embeddingModel'))).toBe(true)
    expect(isAllowedDuringMigration(argv('config', 'set', 'embeddingModel', 'x'))).toBe(true)
    expect(isAllowedDuringMigration(argv('config', 'list'))).toBe(true)
  })

  it('blocks data commands that depend on a current schema', () => {
    for (const cmd of [
      'search',
      'read',
      'get',
      'add',
      'update',
      'delete',
      'rename',
      'list',
      'categories',
      'related',
      'lint',
      'reindex',
      'toc',
      'schema',
      'log',
      'remote',
      'serve',
      'wiki',
      'setup',
      'skill',
    ]) {
      expect(isAllowedDuringMigration(argv(cmd)), `${cmd} should be blocked`).toBe(false)
    }
  })

  it('blocks unknown commands too — fail-closed', () => {
    expect(isAllowedDuringMigration(argv('not-a-real-command'))).toBe(false)
  })

  it('treats short and long help/version flags identically', () => {
    expect(isAllowedDuringMigration(argv('-h'))).toBe(true)
    expect(isAllowedDuringMigration(argv('--help'))).toBe(true)
    expect(isAllowedDuringMigration(argv('-v'))).toBe(true)
    expect(isAllowedDuringMigration(argv('--version'))).toBe(true)
  })
})
