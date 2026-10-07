/*
 * macOS Local Network permission on packaged Electron apps.
 *
 * electron-builder copies Electron's prebuilt binary verbatim, so our main
 * executable's Mach-O LC_UUID collides with every other app built against the
 * same Electron release. macOS keys its Local Network TCC decision on that
 * UUID (Apple TN3179), so it silently resolves our bundle id to
 * `com.github.Electron` through the shared UUID and reuses that decision.
 * No prompt fires and the app never shows up under Privacy & Security.
 *
 * electron-builder tracks this as issue #9158 but closed it "not planned".
 * Until there is first-class support, we work around it in an afterPack hook,
 * which runs after copy and before signing so codesign seals our changes.
 *
 * The hook does two things on darwin builds:
 *
 *   1. Rewrites the main executable's LC_UUID to a deterministic UUID v5
 *      derived from the bundle id. Deterministic so the user's TCC grant
 *      survives version upgrades; the UUID only changes if the bundle id does.
 *
 *   2. Mirrors NSLocalNetworkUsageDescription from mac.extendInfo into the
 *      Electron Framework and every helper .app under Contents/Frameworks.
 *      macOS checks the Info.plist of whichever bundle actually opens the
 *      socket (the main Helper, for Electron's network subprocess), not just
 *      the host app's.
 *
 * The electron-builder config emits a separate single-arch bundle for arm64
 * and x64, so we only ever see thin 64-bit Mach-O here. Fat binaries are
 * rejected rather than silently misparsed.
 */

const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MH_MAGIC_64 = 0xfeedfacf // thin 64-bit, host endian
const MH_CIGAM_64 = 0xcffaedfe // thin 64-bit, swapped
const LC_UUID = 0x1b

/** DNS namespace from RFC 4122, used so repeated hashes of the same bundle id yield the same UUID. */
const UUID_NAMESPACE_DNS = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex')

function uuidFromBundleId(bundleId) {
  const hash = crypto.createHash('sha1').update(UUID_NAMESPACE_DNS).update(bundleId).digest()
  const uuid = Buffer.from(hash.subarray(0, 16))
  uuid[6] = (uuid[6] & 0x0f) | 0x50 // version 5
  uuid[8] = (uuid[8] & 0x3f) | 0x80 // RFC 4122 variant
  return uuid
}

function stampMainExecutableUuid(filePath, bundleId) {
  const buf = fs.readFileSync(filePath)
  const magic = buf.readUInt32LE(0)
  const littleEndian = magic === MH_MAGIC_64
  const bigEndian = magic === MH_CIGAM_64
  if (!littleEndian && !bigEndian) {
    throw new Error(
      `${filePath}: expected a thin 64-bit Mach-O (magic 0xfeedfacf), got 0x${magic.toString(16)}. ` +
        `Universal (fat) binaries are not supported here; electron-builder is configured to emit single-arch bundles.`,
    )
  }
  const readU32 = (off) => (littleEndian ? buf.readUInt32LE(off) : buf.readUInt32BE(off))
  const ncmds = readU32(16)
  const uuid = uuidFromBundleId(bundleId)
  // 64-bit Mach-O header is 32 bytes; load commands follow.
  let cursor = 32
  for (let i = 0; i < ncmds; i++) {
    const cmd = readU32(cursor)
    const cmdsize = readU32(cursor + 4)
    if (cmd === LC_UUID) {
      uuid.copy(buf, cursor + 8, 0, 16)
      fs.writeFileSync(filePath, buf)
      return uuid.toString('hex')
    }
    cursor += cmdsize
  }
  throw new Error(`${filePath}: Mach-O has no LC_UUID load command, cannot stamp a unique identity for TCC.`)
}

function writeUsageDescription(plistPath, value) {
  try {
    execFileSync('/usr/bin/plutil', ['-insert', 'NSLocalNetworkUsageDescription', '-string', value, plistPath])
  } catch {
    execFileSync('/usr/bin/plutil', ['-replace', 'NSLocalNetworkUsageDescription', '-string', value, plistPath])
  }
}

exports.default = async function patchMacosLocalNetworkPermission(context) {
  const { electronPlatformName, appOutDir, packager } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  const bundleId = packager.config?.appId
  if (!bundleId) {
    throw new Error('mac-inject: electron-builder config has no appId')
  }
  const usageDescription = packager.config?.mac?.extendInfo?.NSLocalNetworkUsageDescription
  if (!usageDescription) {
    throw new Error('mac-inject: mac.extendInfo.NSLocalNetworkUsageDescription is missing')
  }

  const appName = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)
  const mainExecutable = path.join(appPath, 'Contents', 'MacOS', appName)
  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks')

  // 1. Give the main executable its own LC_UUID so TCC can tell this app apart
  //    from every other Electron app built against the same prebuilt binary.
  const stamped = stampMainExecutableUuid(mainExecutable, bundleId)
  console.log(`mac-inject: stamped LC_UUID ${stamped} on ${mainExecutable}`)

  // 2. Mirror the usage description into every nested bundle macOS might
  //    attribute the network call to.
  const targets = []
  const frameworkPlist = path.join(
    frameworksDir,
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
    'Info.plist',
  )
  if (fs.existsSync(frameworkPlist)) targets.push(frameworkPlist)
  for (const entry of fs.readdirSync(frameworksDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      const helperPlist = path.join(frameworksDir, entry.name, 'Contents', 'Info.plist')
      if (fs.existsSync(helperPlist)) targets.push(helperPlist)
    }
  }
  for (const plistPath of targets) {
    writeUsageDescription(plistPath, usageDescription)
    console.log(`mac-inject: wrote NSLocalNetworkUsageDescription into ${plistPath}`)
  }
}
