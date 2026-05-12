/**
 * Commands runnable without a clean schema. Everything else is blocked
 * by the migration gate when `MigrationService.detectNeeded()` is true.
 *
 * `version`, `help`, `config`, and `migrate` are intentionally cheap and
 * read-only-ish, so users can still inspect their environment and run
 * the migration itself. `wiki create` is excluded — fresh wikis must
 * wait for the schema to be current to avoid mixed-version state.
 */
export const MIGRATION_ALLOWLIST: ReadonlySet<string> = new Set([
  'migrate',
  'status',
  'version',
  '--version',
  '-v',
  'help',
  '--help',
  '-h',
  'config',
])

export function isAllowedDuringMigration(argv: string[]): boolean {
  // argv[0]=node, argv[1]=bin.js, argv[2]=command (moostjs pattern).
  const cmd = argv[2]
  if (!cmd) return true // bare `kb` prints help — allow
  return MIGRATION_ALLOWLIST.has(cmd)
}
