/* eslint-disable */
/**
 * Gate between a release build and the installed fleet (DOPE-486).
 *
 * Every OpenPLC Editor from 4.1.0 on embeds `app-update.yml` and runs
 * electron-updater, so the moment a GitHub release carries `latest-*.yml` it is
 * downloaded and installed by every macOS and Linux editor. Nothing about a
 * release can be taken back after that — electron-updater never downgrades —
 * so this script refuses to let anything through that the updater would
 * misread.
 *
 * Plain CommonJS on purpose: the release job runs it with `node` and only the
 * `yaml` package, without installing the whole repository.
 *
 * Usage:
 *   node scripts/verify-release-assets.js verify <dir> [--staging <1-100>]
 *     Checks every file in <dir> (the exact set about to be uploaded) and,
 *     with --staging, writes `stagingPercentage` into each latest-*.yml.
 *   node scripts/verify-release-assets.js stage <dir> --staging <1-100>
 *     Rewrites `stagingPercentage` in the latest-*.yml files in <dir>
 *     (downloaded from an existing release) without checking artifacts.
 *     100 removes the field: the release is then offered to everyone.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const YAML = require('yaml')

/**
 * The only files a release may carry. Anything else fails the release, so a
 * future glob cannot leak a file the fleet would act on — above all a Windows
 * `latest.yml`: Windows clients up to this change have no `publisherName` and
 * would install whatever it points to without checking a signature.
 */
const ALLOWED = [
  { pattern: /^latest-mac\.yml$/, kind: 'metadata' },
  { pattern: /^latest-linux\.yml$/, kind: 'metadata' },
  { pattern: /^latest-linux-arm64\.yml$/, kind: 'metadata' },
  { pattern: /^OpenPLC-Editor-[0-9A-Za-z.+-]+-(arm64|x64)\.zip$/, kind: 'update' },
  { pattern: /^OpenPLC-Editor-[0-9A-Za-z.+-]+-(arm64|x64)\.zip\.blockmap$/, kind: 'blockmap' },
  { pattern: /^OpenPLC-Editor\.AppImage$/, kind: 'update' },
  { pattern: /^OpenPLC-Editor-ARM64\.AppImage$/, kind: 'update' },
  { pattern: /^[^/]+\.dmg$/, kind: 'installer' },
  { pattern: /^[^/]+\.exe$/, kind: 'installer' },
]

const REQUIRED_METADATA = ['latest-mac.yml', 'latest-linux.yml']

/** Linux ARM64 is built best-effort (`if-no-files-found: warn`), so it may be missing, but only as a pair. */
const OPTIONAL_PAIRS = [{ metadata: 'latest-linux-arm64.yml', artifact: 'OpenPLC-Editor-ARM64.AppImage' }]

/**
 * Kept in step with `mapAssetToOS` in autonomy-website `src/hooks/useGitHubRelease.ts`,
 * which lists every matching asset as a download button. A second match for the
 * same OS would put two buttons on the page; a missing required one, none.
 */
function mapAssetToOS(fileName) {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('-arm64.exe') || lowerName.endsWith('-arm.exe')) return 'windows-arm'
  if (lowerName.endsWith('.exe')) return 'windows'
  if (lowerName.endsWith('-arm.dmg')) return 'mac-arm'
  if (lowerName.endsWith('.dmg')) return 'mac-intel'
  if (lowerName.includes('-arm64.appimage') || lowerName.includes('-arm.appimage')) return 'linux-arm'
  if (lowerName.endsWith('.appimage')) return 'linux'
  return null
}
const REQUIRED_DOWNLOADS = ['windows', 'mac-arm', 'mac-intel', 'linux']
const OPTIONAL_DOWNLOADS = ['windows-arm', 'linux-arm']

function sha512Base64(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
}

function parseStaging(args) {
  if (args.length === 0) return null
  // Anything else is refused, so a flag this script no longer has (or a typo)
  // fails the release instead of being skipped without a word.
  if (args.length !== 2 || args[0] !== '--staging') throw new Error(`unexpected arguments: ${args.join(' ')}`)
  const raw = args[1]
  // electron-updater reads the field with parseInt, so a fraction would be
  // silently truncated. Refuse it rather than publish a stage nobody asked for.
  if (!/^\d+$/.test(raw ?? '')) throw new Error(`--staging must be an integer from 1 to 100, got "${raw}"`)
  const value = Number(raw)
  if (value < 1 || value > 100) throw new Error(`--staging must be an integer from 1 to 100, got ${value}`)
  return value
}

function readMetadata(dir, name) {
  return YAML.parse(fs.readFileSync(path.join(dir, name), 'utf-8'))
}

function writeStaging(dir, name, staging) {
  const file = path.join(dir, name)
  const document = YAML.parseDocument(fs.readFileSync(file, 'utf-8'))
  if (staging === 100) document.delete('stagingPercentage')
  else document.set('stagingPercentage', staging)
  fs.writeFileSync(file, document.toString())
}

function verify(dir, staging) {
  const errors = []
  const files = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile())
  const present = new Set(files)

  const kinds = new Map()
  for (const name of files) {
    const rule = ALLOWED.find((candidate) => candidate.pattern.test(name))
    if (!rule) errors.push(`${name}: not an allowed release asset`)
    else kinds.set(name, rule.kind)
  }

  for (const name of REQUIRED_METADATA) {
    if (!present.has(name)) errors.push(`${name}: missing`)
  }
  for (const pair of OPTIONAL_PAIRS) {
    if (present.has(pair.metadata) !== present.has(pair.artifact)) {
      errors.push(`${pair.metadata} and ${pair.artifact} must be published together or not at all`)
    }
  }

  const referenced = new Set()
  const metadataNames = files.filter((name) => kinds.get(name) === 'metadata')
  for (const name of metadataNames) {
    let info
    try {
      info = readMetadata(dir, name)
    } catch (error) {
      errors.push(`${name}: not valid YAML (${error.message})`)
      continue
    }
    if (!info || !Array.isArray(info.files) || info.files.length === 0) {
      errors.push(`${name}: has no files entry`)
      continue
    }
    for (const entry of info.files) {
      const target = entry.url
      referenced.add(target)
      if (!present.has(target)) {
        errors.push(`${name}: references ${target}, which is not in the release`)
        continue
      }
      if (kinds.get(target) !== 'update') errors.push(`${name}: references ${target}, which is not an update artifact`)
      const actualSize = fs.statSync(path.join(dir, target)).size
      if (entry.size !== actualSize) errors.push(`${name}: size of ${target} is ${entry.size}, file is ${actualSize}`)
      if (entry.sha512 !== sha512Base64(path.join(dir, target)))
        errors.push(`${name}: sha512 of ${target} does not match`)
      if (target.endsWith('.zip') && !present.has(`${target}.blockmap`)) {
        errors.push(`${name}: ${target}.blockmap is missing (needed for differential downloads)`)
      }
    }
    if (info.path !== undefined && info.path !== info.files[0].url) {
      errors.push(`${name}: top-level path ${info.path} differs from files[0].url ${info.files[0].url}`)
    }
  }

  for (const name of files) {
    const kind = kinds.get(name)
    if (kind === 'update' && !referenced.has(name)) errors.push(`${name}: update artifact no metadata points to`)
    if (kind === 'blockmap' && !referenced.has(name.replace(/\.blockmap$/, ''))) {
      errors.push(`${name}: blockmap for an artifact no metadata points to`)
    }
  }

  const downloads = new Map()
  for (const name of files) {
    const os = mapAssetToOS(name)
    if (os) downloads.set(os, [...(downloads.get(os) ?? []), name])
  }
  for (const os of REQUIRED_DOWNLOADS) {
    const matches = downloads.get(os) ?? []
    if (matches.length !== 1)
      errors.push(`website download "${os}": expected 1 asset, found ${matches.length} (${matches.join(', ')})`)
  }
  for (const os of OPTIONAL_DOWNLOADS) {
    const matches = downloads.get(os) ?? []
    if (matches.length > 1)
      errors.push(`website download "${os}": expected at most 1 asset, found ${matches.join(', ')}`)
  }

  if (errors.length > 0) return errors

  if (staging !== null) for (const name of metadataNames) writeStaging(dir, name, staging)
  return []
}

function stage(dir, staging) {
  const errors = []
  const files = fs.readdirSync(dir)
  if (files.includes('latest.yml')) errors.push('latest.yml: Windows update metadata must never be published')
  const metadataNames = files.filter((name) => /^latest-(mac|linux|linux-arm64)\.yml$/.test(name))
  if (metadataNames.length === 0) errors.push(`no latest-*.yml in ${dir}`)
  if (errors.length > 0) return errors
  for (const name of metadataNames) writeStaging(dir, name, staging)
  return []
}

function main() {
  const [command, dir, ...rest] = process.argv.slice(2)
  if (!['verify', 'stage'].includes(command) || !dir) {
    console.error('usage: verify-release-assets.js <verify|stage> <dir> [--staging <1-100>]')
    process.exit(2)
  }

  let staging
  try {
    staging = parseStaging(rest)
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  if (command === 'stage' && staging === null) {
    console.error('stage requires --staging <1-100>')
    process.exit(2)
  }

  const errors = command === 'verify' ? verify(dir, staging) : stage(dir, staging)
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`)
    process.exit(1)
  }
  console.log(
    staging === null
      ? `${dir}: release assets verified`
      : `${dir}: ${command === 'verify' ? 'release assets verified, ' : ''}stagingPercentage set to ${staging}${staging === 100 ? ' (field removed)' : ''}`,
  )
}

main()
