/** One downloadable file of a GitHub release, as the update check reads it. */
export interface ReleaseAsset {
  name: string
  /** `browser_download_url`. */
  url: string
  size: number
  /** `sha256:<hex>`, set by GitHub on every uploaded asset. */
  digest: string | undefined
}

export interface Release {
  version: string
  assets: ReleaseAsset[]
}

/** Where every installer is published; anything else in a release response is not downloaded. */
export const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/Autonomy-Logic/openplc-editor/releases/download/'

type InstallerTarget = 'windows' | 'windows-arm' | 'mac-intel' | 'mac-arm' | 'linux' | 'linux-arm'

/**
 * The same rules as the website's download buttons (`mapAssetToOS` in
 * autonomy-website), so the editor offers the file a user would pick there.
 */
function targetOf(fileName: string): InstallerTarget | null {
  const name = fileName.toLowerCase()
  if (name.endsWith('-arm64.exe') || name.endsWith('-arm.exe')) return 'windows-arm'
  if (name.endsWith('.exe')) return 'windows'
  if (name.endsWith('-arm.dmg')) return 'mac-arm'
  if (name.endsWith('.dmg')) return 'mac-intel'
  if (name.endsWith('-arm64.appimage') || name.endsWith('-arm.appimage')) return 'linux-arm'
  if (name.endsWith('.appimage')) return 'linux'
  return null
}

function targetFor(platform: NodeJS.Platform, arch: string): InstallerTarget | null {
  const arm = arch === 'arm64'
  switch (platform) {
    case 'win32':
      return arm ? 'windows-arm' : 'windows'
    case 'darwin':
      return arm ? 'mac-arm' : 'mac-intel'
    case 'linux':
      return arm ? 'linux-arm' : 'linux'
    default:
      return null
  }
}

/** The installer for this platform and architecture, or null when the release has none. */
export function pickInstaller(assets: ReleaseAsset[], platform: NodeJS.Platform, arch: string): ReleaseAsset | null {
  const target = targetFor(platform, arch)
  if (!target) return null
  return (
    assets.find((asset) => targetOf(asset.name) === target && asset.url.startsWith(RELEASE_DOWNLOAD_PREFIX)) ?? null
  )
}

/**
 * The architectures whose installer to offer, best first. A Mac running the
 * Intel build under Rosetta is an Apple silicon Mac: it gets the Apple silicon
 * installer, and the Intel one only when a release has none. Windows on ARM
 * running the x64 build is left on x64 until installing ARM64 over it is tested.
 */
export function installerArchs(platform: NodeJS.Platform, arch: string, translated: boolean): string[] {
  if (platform === 'darwin' && translated && arch !== 'arm64') return ['arm64', arch]
  return [arch]
}

/** The hex digest of a GitHub `sha256:` digest, or null when it is missing or not one. */
export function sha256Of(digest: string | undefined): string | null {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest ?? '')
  return match ? match[1].toLowerCase() : null
}
