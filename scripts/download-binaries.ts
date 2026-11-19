/**
 * Download external tools from GitHub Releases: STruC++ (into node_modules) and the HMI widget libraries
 * (openplc-hmi-widgets, into vendor/hmi-widgets/).
 *
 * Usage:
 *   ts-node scripts/download-binaries.ts [--force] [--strucpp-only | --hmi-widgets-only]
 *
 * Use --force to re-install even if the pinned version is already present. OPENPLC_HMI_WIDGETS_DIR set to a local
 * openplc-hmi-widgets build directory (its dist/) installs that build instead of the pinned release.
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import {
  setupWidgetsRelease,
  WIDGETS_OVERRIDE_ENV,
  WidgetsSetupError,
  type WidgetsSetupMechanisms,
  widgetsReleasePin,
} from '../src/backend/shared/hmi/lib/widgets-release-setup'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolEntry {
  version: string
  repository: string
}

interface BinaryVersions {
  strucpp: ToolEntry
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, '..')
const VERSIONS_FILE = path.join(ROOT_DIR, 'binary-versions.json')
const RESOURCES_DIR = path.join(ROOT_DIR, 'resources')
const HMI_WIDGETS_DIR = path.join(ROOT_DIR, 'vendor', 'hmi-widgets')

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { force: boolean; strucpp: boolean; hmiWidgets: boolean } {
  const args = process.argv.slice(2)
  return {
    force: args.includes('--force'),
    strucpp: !args.includes('--hmi-widgets-only'),
    hmiWidgets: !args.includes('--strucpp-only'),
  }
}

// ---------------------------------------------------------------------------
// Cache check
// ---------------------------------------------------------------------------

function needsStrucpp(versions: BinaryVersions): boolean {
  // strucpp is `npm install`-ed into `node_modules/`, so npm's own
  // `package.json` is the canonical source of truth for what's
  // installed.  Re-fetch only when the package isn't installed or
  // its version doesn't match the pin — no parallel metadata cache.
  const expected = versions.strucpp.version.replace(/^v/, '')
  const pkgJsonPath = path.join(ROOT_DIR, 'node_modules', 'strucpp', 'package.json')
  if (!fs.existsSync(pkgJsonPath)) return true
  try {
    const installed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    if (installed.version !== expected) return true
  } catch {
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

async function downloadToFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  fs.writeFileSync(dest, new Uint8Array(arrayBuffer))
}

function rmrf(p: string): void {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// strucpp download and extraction
// ---------------------------------------------------------------------------

async function downloadStrucpp(tool: ToolEntry): Promise<void> {
  // The npm tarball is platform-independent (pure TypeScript + C++ headers)
  const version = tool.version.replace(/^v/, '')
  const url = `https://github.com/${tool.repository}/releases/download/${tool.version}/strucpp-${version}.tgz`

  console.log(`  Downloading strucpp ${tool.version}...`)
  fs.mkdirSync(RESOURCES_DIR, { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(RESOURCES_DIR, '.tmp-strucpp-'))

  try {
    const tgzPath = path.join(tmpDir, 'strucpp.tgz')
    await downloadToFile(url, tgzPath)

    // Install into node_modules via npm.  In dev (`npm run dev`),
    // the compiler reads runtime headers from `node_modules/strucpp/
    // src/runtime/include/` and bundled `.stlib` archives from
    // `node_modules/strucpp/libs/` directly.  In packaged builds,
    // electron-builder's `extraResources` config copies those two
    // directories into `Resources/strucpp/` of the final app — see
    // `electron-builder.json` and the dev/packaged path branching
    // in `backend/editor/compiler/compiler-module.ts` and
    // `backend/editor/library-manager/library-manager-module.ts`.
    // We don't mirror the install into `release/app/node_modules`
    // because electron-builder walks `release/app/package.json`'s
    // dependency tree and prunes anything not listed there from the
    // asar, regardless of whether the files exist on disk.
    console.log(`  Installing strucpp ${tool.version} into node_modules...`)
    execSync(`npm install "${tgzPath}" --no-save`, {
      cwd: ROOT_DIR,
      stdio: 'pipe',
    })
    console.log(`  strucpp ${tool.version} installed.`)
  } finally {
    rmrf(tmpDir)
  }
}

// ---------------------------------------------------------------------------
// HMI widget libraries
// ---------------------------------------------------------------------------

function readIfExists(file: string): Promise<Uint8Array | null> {
  return Promise.resolve(fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null)
}

/** File and network mechanisms of the shared HMI widgets setup. */
const widgetsMechanisms: WidgetsSetupMechanisms = {
  async fetchAsset(url) {
    const response = await fetch(url, { redirect: 'follow' })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
    return new Uint8Array(await response.arrayBuffer())
  },
  readOverride: (dir, file) => readIfExists(path.join(dir, file)),
  readInstalled: (file) => readIfExists(path.join(HMI_WIDGETS_DIR, file)),
  writeInstalled(files) {
    fs.mkdirSync(path.dirname(HMI_WIDGETS_DIR), { recursive: true })
    const tmpDir = fs.mkdtempSync(path.join(path.dirname(HMI_WIDGETS_DIR), '.tmp-hmi-widgets-'))
    try {
      for (const [name, bytes] of files) fs.writeFileSync(path.join(tmpDir, name), bytes)
      rmrf(HMI_WIDGETS_DIR)
      fs.renameSync(tmpDir, HMI_WIDGETS_DIR)
      fs.chmodSync(HMI_WIDGETS_DIR, 0o755)
    } finally {
      rmrf(tmpDir)
    }
    return Promise.resolve()
  },
  log: (message) => console.log(`  ${message}`),
}

async function setupHmiWidgets(versions: unknown, force: boolean): Promise<void> {
  const pin = widgetsReleasePin(versions)
  const overrideDir = process.env[WIDGETS_OVERRIDE_ENV] ? path.resolve(process.env[WIDGETS_OVERRIDE_ENV]) : undefined
  const result = await setupWidgetsRelease(pin, { overrideDir, force }, widgetsMechanisms)
  const what = `HMI widgets ${result.release.version} (${result.release.archives.map((a) => a.name).join(', ')})`
  if (result.source === 'installed') console.log(`  ${what} already installed, skipping.`)
  else console.log(`  ${what} installed from ${result.source === 'override' ? overrideDir : 'the release'}.`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { force, strucpp, hmiWidgets } = parseArgs()

  if (!fs.existsSync(VERSIONS_FILE)) {
    console.error(`binary-versions.json not found at ${VERSIONS_FILE}`)
    process.exit(1)
  }

  const versions: BinaryVersions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf-8'))

  console.log(`[download-binaries] force=${force}`)

  // strucpp is platform-independent — installed into node_modules.
  if (strucpp) {
    if (force || needsStrucpp(versions)) {
      await downloadStrucpp(versions.strucpp)
    } else {
      console.log(`  strucpp ${versions.strucpp.version} already installed, skipping.`)
    }
  }

  if (hmiWidgets) await setupHmiWidgets(versions, force)

  console.log(`[download-binaries] Done.`)
}

main().catch((err) => {
  console.error('[download-binaries] Fatal error:', err instanceof WidgetsSetupError ? err.message : err)
  process.exit(1)
})
