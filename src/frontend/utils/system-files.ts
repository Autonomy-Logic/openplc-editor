/**
 * Files generated/managed by infrastructure that the end user shouldn't see
 * in the source-control UI (pending changes, commit details). Currently:
 *
 *   - git-data.tar.gz: legacy backup archive from before the flat-S3 migration.
 *     When an old project is opened, the migration removes it from S3, which
 *     surfaces as a "deleted" file in git status. Users wouldn't recognize it.
 */
const SYSTEM_FILE_PATTERNS: readonly RegExp[] = [/(^|\/)git-data\.tar\.gz$/]

export function isSystemFile(path: string): boolean {
  return SYSTEM_FILE_PATTERNS.some((re) => re.test(path))
}
