/**
 * Download external tool binaries (xml2st, matiec) from GitHub Releases.
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
  matiec: ToolEntry
}

interface CacheMetadata {
  xml2st: string
  matiec: string
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
const MATIEC_LIB_DIR = path.join(RESOURCES_DIR, 'sources', 'MatIEC', 'lib')

function binDir(platform: Platform, arch: Arch): string {
  return path.join(RESOURCES_DIR, 'bin', platform, arch)
}

function cacheFile(platform: Platform, arch: Arch): string {
  return path.join(binDir(platform, arch), '.binary-metadata.json')
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { platform: Platform; arch: Arch; force: boolean } {
  const args = process.argv.slice(2)
  let platform = process.platform as string
  let arch = process.arch as string
  let force = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) {
      platform = args[++i]
    } else if (args[i] === '--arch' && args[i + 1]) {
      arch = args[++i]
    } else if (args[i] === '--force') {
      force = true
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

  return { platform: platform as Platform, arch: arch as Arch, force }
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

function needsMatiec(versions: BinaryVersions, cached: CacheMetadata | null, platform: Platform, arch: Arch): boolean {
  const dir = binDir(platform, arch)
  const isWindows = platform === 'win32'

  const iec2cPath = path.join(dir, isWindows ? 'iec2c.exe' : 'iec2c')

  if (!fs.existsSync(iec2cPath)) return true
  if (!cached || cached.matiec !== versions.matiec.version) return true

  return false
}

function writeCache(versions: BinaryVersions, platform: Platform, arch: Arch): void {
  const data: CacheMetadata = {
    xml2st: versions.xml2st.version,
    matiec: versions.matiec.version,
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
// matiec download and extraction
// ---------------------------------------------------------------------------

async function downloadMatiec(
  tool: ToolEntry,
  platform: Platform,
  arch: Arch,
  targetBinDir: string,
): Promise<void> {
  const isWindows = platform === 'win32'
  const ext = isWindows ? 'zip' : 'tar.gz'
  const url = `https://github.com/${tool.repository}/releases/download/${tool.version}/matiec-${platform}-${arch}.${ext}`

  console.log(`  Downloading matiec ${tool.version} for ${platform}-${arch}...`)
  const tmpDir = fs.mkdtempSync(path.join(RESOURCES_DIR, '.tmp-matiec-'))

  try {
    const archivePath = path.join(tmpDir, `matiec.${ext}`)
    await downloadToFile(url, archivePath)

    const extractDir = path.join(tmpDir, 'extracted')
    if (isWindows) {
      extractZip(archivePath, extractDir)
    } else {
      extractTarGz(archivePath, extractDir)
    }

    const extractedToolDir = path.join(extractDir, 'matiec')

    // Copy iec2c binary
    const iec2cName = isWindows ? 'iec2c.exe' : 'iec2c'
    const iec2cSrc = path.join(extractedToolDir, iec2cName)
    const iec2cDest = path.join(targetBinDir, iec2cName)
    fs.copyFileSync(iec2cSrc, iec2cDest)
    if (!isWindows) {
      fs.chmodSync(iec2cDest, 0o755)
    }

    // Copy iec2iec binary if present
    const iec2iecName = isWindows ? 'iec2iec.exe' : 'iec2iec'
    const iec2iecSrc = path.join(extractedToolDir, iec2iecName)
    if (fs.existsSync(iec2iecSrc)) {
      const iec2iecDest = path.join(targetBinDir, iec2iecName)
      fs.copyFileSync(iec2iecSrc, iec2iecDest)
      if (!isWindows) {
        fs.chmodSync(iec2iecDest, 0o755)
      }
    }

    // Copy lib/ to resources/sources/MatIEC/lib/
    // Only do this once (for the first platform/arch downloaded), since lib/ is platform-independent
    const libSrc = path.join(extractedToolDir, 'lib')
    if (fs.existsSync(libSrc)) {
      rmrf(MATIEC_LIB_DIR)
      copyRecursive(libSrc, MATIEC_LIB_DIR)
    }

    console.log(`  matiec ${tool.version} installed.`)
  } finally {
    rmrf(tmpDir)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { platform, arch, force } = parseArgs()

  if (!fs.existsSync(VERSIONS_FILE)) {
    console.error(`binary-versions.json not found at ${VERSIONS_FILE}`)
    process.exit(1)
  }

  const versions: BinaryVersions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf-8'))

  console.log(`[download-binaries] platform=${platform} arch=${arch} force=${force}`)

  const targetBinDir = binDir(platform, arch)
  fs.mkdirSync(targetBinDir, { recursive: true })

  const cached = force ? null : getCachedMetadata(platform, arch)
  const downloadXml2stNeeded = force || needsXml2st(versions, cached, platform, arch)
  const downloadMatiecNeeded = force || needsMatiec(versions, cached, platform, arch)

  if (!downloadXml2stNeeded && !downloadMatiecNeeded) {
    console.log(`[download-binaries] Binaries up to date for ${platform}-${arch}, skipping.`)
    return
  }

  if (downloadXml2stNeeded) {
    await downloadXml2st(versions.xml2st, platform, arch, targetBinDir)
  } else {
    console.log(`  xml2st ${versions.xml2st.version} already installed, skipping.`)
  }

  if (downloadMatiecNeeded) {
    await downloadMatiec(versions.matiec, platform, arch, targetBinDir)
  } else {
    console.log(`  matiec ${versions.matiec.version} already installed, skipping.`)
  }

  writeCache(versions, platform, arch)
  console.log(`[download-binaries] Done.`)
}

main().catch((err) => {
  console.error('[download-binaries] Fatal error:', err)
  process.exit(1)
})
