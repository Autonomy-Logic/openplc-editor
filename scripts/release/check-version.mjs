#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CheckFailure, parseCli, runCli } from './lib/cli.mjs'
import { versionFromReleaseTag } from './lib/release-assets.mjs'

/** The `APP_VERSION` declaration of the shared version constant. */
const APP_VERSION = /export const APP_VERSION\s*(?::\s*string\s*)?=\s*(['"])([^'"]*)\1/

const APP_VERSION_FILE = join('src', 'frontend', 'data', 'constants', 'app-version.ts')
const PACKAGE_FILE = join('release', 'app', 'package.json')

runCli(() => {
  const { values } = parseCli({ release: { type: 'string' }, tree: { type: 'string' } }, ['release', 'tree'])
  const version = versionFromReleaseTag(values.release)

  const appVersion = APP_VERSION.exec(readFileSync(join(values.tree, APP_VERSION_FILE), 'utf8'))?.[2]
  const packageVersion = JSON.parse(readFileSync(join(values.tree, PACKAGE_FILE), 'utf8')).version

  const problems = []
  if (appVersion !== version) {
    problems.push(
      `APP_VERSION in ${APP_VERSION_FILE} is ${appVersion ?? 'missing'}, release ${values.release} is ${version}`,
    )
  }
  if (packageVersion !== version) {
    problems.push(
      `version in ${PACKAGE_FILE} is ${packageVersion ?? 'missing'}, release ${values.release} is ${version}`,
    )
  }
  if (problems.length > 0) throw new CheckFailure(problems)
  console.log(version)
})
