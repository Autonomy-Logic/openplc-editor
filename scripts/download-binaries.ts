/**
 * Download external tool binaries (xml2st, strucpp) from GitHub Releases.
 *
 * Usage:
 *   ts-node scripts/download-binaries.ts [--platform <platform>] [--arch <arch>] [--force]
 *
 * Defaults to the current platform/arch. Use --force to re-download even if cached.
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolEntry {
  version: string
  repository: string
}

interface BinaryVersions {
  xml2st: ToolEntry
  strucpp: ToolEntry
}

interface CacheMetadata {
  xml2st: string
  platform: string
  arch: string
}

type Platform = 'darwin' | 'linux' | 'win32'
type Arch = 'x64' | 'arm64'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(__dirname, '..')
const VERSIONS_FILE = path.join(ROOT_DIR, 'binary-versions.json')
const RESOURCES_DIR = path.join(ROOT_DIR, 'resources')

function binDir(platform: Platform, arch: Arch): string {
  return path.join(RESOURCES_DIR, 'bin', platform, arch)
}

function cacheFile(platform: Platform, arch: Arch): string {
  return path.join(binDir(platform, arch), '.binary-metadata.json')
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { platform: Platform; arch: Arch; force: boolean; strucppOnly: boolean } {
  const args = process.argv.slice(2)
  let platform = process.platform as string
  let arch = process.arch as string
  let force = false
  // strucpp-only: install just the platform-independent strucpp package (its
  // libs/ + runtime headers are imported by the TS sources). Skips the xml2st
  // platform binary — used by the unit-test CI job, which runs `npm ci
  // --ignore-scripts` (so the postinstall never fetched strucpp) but doesn't
  // need the heavyweight platform binaries or a native rebuild.
  let strucppOnly = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) {
      platform = args[++i]
    } else if (args[i] === '--arch' && args[i + 1]) {
      arch = args[++i]
    } else if (args[i] === '--force') {
      force = true
    } else if (args[i] === '--strucpp-only') {
      strucppOnly = true
    }
  }

  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    console.error(`Unsupported platform: ${platform}`)
    process.exit(1)
  }
  if (!['x64', 'arm64'].includes(arch)) {
    console.error(`Unsupported architecture: ${arch}`)
    process.exit(1)
  }

  return { platform: platform as Platform, arch: arch as Arch, force, strucppOnly }
}

// ---------------------------------------------------------------------------
// Cache check
// ---------------------------------------------------------------------------

function getCachedMetadata(platform: Platform, arch: Arch): CacheMetadata | null {
  const file = cacheFile(platform, arch)
  if (!fs.existsSync(file)) return null

  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as CacheMetadata
  } catch {
    return null
  }
}

function needsXml2st(versions: BinaryVersions, cached: CacheMetadata | null, platform: Platform, arch: Arch): boolean {
  const dir = binDir(platform, arch)
  const isWindows = platform === 'win32'
  const isDarwin = platform === 'darwin'

  const xml2stPath = isDarwin
    ? path.join(dir, 'xml2st', 'xml2st')
    : path.join(dir, isWindows ? 'xml2st.exe' : 'xml2st')

  if (!fs.existsSync(xml2stPath)) return true
  if (!cached || cached.xml2st !== versions.xml2st.version) return true

  return false
}

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

function writeCache(versions: BinaryVersions, platform: Platform, arch: Arch): void {
  const data: CacheMetadata = {
    xml2st: versions.xml2st.version,
    platform,
    arch,
  }
  fs.mkdirSync(path.dirname(cacheFile(platform, arch)), { recursive: true })
  fs.writeFileSync(cacheFile(platform, arch), JSON.stringify(data, null, 2) + '\n')
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

function extractTarGz(archive: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  execSync(`tar xzf "${archive}" -C "${destDir}"`, { stdio: 'pipe' })
}

function extractZip(archive: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  execSync(`tar xf "${archive}" -C "${destDir}"`, { stdio: 'pipe' })
}

function rmrf(p: string): void {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true })
  }
}

function copyRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(srcPath)
      if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true })
      fs.symlinkSync(linkTarget, destPath)
    } else if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ---------------------------------------------------------------------------
// xml2st download and extraction
// ---------------------------------------------------------------------------

async function downloadXml2st(
  tool: ToolEntry,
  platform: Platform,
  arch: Arch,
  targetBinDir: string,
): Promise<void> {
  const isWindows = platform === 'win32'
  const isDarwin = platform === 'darwin'
  const ext = isWindows ? 'zip' : 'tar.gz'
  const url = `https://github.com/${tool.repository}/releases/download/${tool.version}/xml2st-${platform}-${arch}.${ext}`

  console.log(`  Downloading xml2st ${tool.version} for ${platform}-${arch}...`)
  const tmpDir = fs.mkdtempSync(path.join(RESOURCES_DIR, '.tmp-xml2st-'))

  try {
    const archivePath = path.join(tmpDir, `xml2st.${ext}`)
    await downloadToFile(url, archivePath)

    const extractDir = path.join(tmpDir, 'extracted')
    if (isWindows) {
      extractZip(archivePath, extractDir)
    } else {
      extractTarGz(archivePath, extractDir)
    }

    // Archive contains xml2st/ directory
    const extractedToolDir = path.join(extractDir, 'xml2st')

    if (isDarwin) {
      // macOS: xml2st is a directory with _internal/ — copy as-is
      const destDir = path.join(targetBinDir, 'xml2st')
      rmrf(destDir)
      copyRecursive(extractedToolDir, destDir)
      fs.chmodSync(path.join(destDir, 'xml2st'), 0o755)
    } else {
      // Linux/Windows: single executable
      const exeName = isWindows ? 'xml2st.exe' : 'xml2st'
      const srcFile = path.join(extractedToolDir, exeName)
      const destFile = path.join(targetBinDir, exeName)
      rmrf(destFile)
      // Also remove any leftover directory from a previous macOS-style install
      rmrf(path.join(targetBinDir, 'xml2st'))
      fs.copyFileSync(srcFile, destFile)
      if (!isWindows) {
        fs.chmodSync(destFile, 0o755)
      }
    }

    console.log(`  xml2st ${tool.version} installed.`)
  } finally {
    rmrf(tmpDir)
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { platform, arch, force, strucppOnly } = parseArgs()

  if (!fs.existsSync(VERSIONS_FILE)) {
    console.error(`binary-versions.json not found at ${VERSIONS_FILE}`)
    process.exit(1)
  }

  const versions: BinaryVersions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf-8'))

  console.log(`[download-binaries] platform=${platform} arch=${arch} force=${force} strucppOnly=${strucppOnly}`)

  // strucpp is platform-independent (its libs/ + runtime headers are imported
  // by the TS sources) — download it whenever it's missing or outdated.
  if (force || needsStrucpp(versions)) {
    await downloadStrucpp(versions.strucpp)
  } else {
    console.log(`  strucpp ${versions.strucpp.version} already installed, skipping.`)
  }

  // --strucpp-only stops here: the caller (e.g. the unit-test CI job) needs the
  // strucpp package but not the platform binary or the platform cache marker.
  if (strucppOnly) {
    console.log(`[download-binaries] strucpp-only: skipped xml2st platform binary.`)
    return
  }

  const targetBinDir = binDir(platform, arch)
  fs.mkdirSync(targetBinDir, { recursive: true })

  const cached = force ? null : getCachedMetadata(platform, arch)
  if (force || needsXml2st(versions, cached, platform, arch)) {
    await downloadXml2st(versions.xml2st, platform, arch, targetBinDir)
  } else {
    console.log(`  xml2st ${versions.xml2st.version} already installed, skipping.`)
  }

  writeCache(versions, platform, arch)
  console.log(`[download-binaries] Done.`)
}

main().catch((err) => {
  console.error('[download-binaries] Fatal error:', err)
  process.exit(1)
})
