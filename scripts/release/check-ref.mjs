#!/usr/bin/env node
import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { versionFromReleaseTag } from './lib/release-assets.mjs'

/**
 * The branch name a rebuild of `version` must run from: `feature/<PROJECT>-<number>-backport-v<version>`, whole.
 * @param {string} version
 * @returns {RegExp}
 */
function backportBranch(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^feature/[A-Z]+-[0-9]+-backport-v${escaped}$`)
}

runCli(() => {
  const { values, positionals } = parseCli({ release: { type: 'string' }, ref: { type: 'string' } }, ['release', 'ref'])
  if (positionals.length > 0) throw new CheckFailure(['usage: check-ref.mjs --release <tag> --ref <branch>'])
  const version = versionFromReleaseTag(values.release)
  if (!backportBranch(version).test(values.ref)) {
    throw new CheckFailure([
      `ref ${JSON.stringify(values.ref)} is not the backport branch of release ${values.release} (version ${version}):` +
        ` expected feature/<PROJECT>-<number>-backport-v${version}`,
    ])
  }
  console.log(version)
})
