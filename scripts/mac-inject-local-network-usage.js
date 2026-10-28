/* afterPack hook, darwin only: stamp a deterministic LC_UUID (UUID v5 of appId)
 * on the main executable and mirror NSLocalNetworkUsageDescription into Electron
 * Framework and the helper apps. Runs before codesign. Thin 64-bit Mach-O only.
 */

const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MH_MAGIC_64 = 0xfeedfacf // thin 64-bit, host endian
const MH_CIGAM_64 = 0xcffaedfe // thin 64-bit, swapped
const LC_UUID = 0x1b

const UUID_NAMESPACE_DNS = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex')

/**
 * Deterministic UUID v5 (RFC 4122) derived from a bundle id in the DNS namespace.
 * Same bundle id always yields the same UUID so the TCC grant survives upgrades.
 *
 * @param {string} bundleId
 * @returns {Buffer} 16-byte UUID
 */
function uuidFromBundleId(bundleId) {
  const hash = crypto.createHash('sha1').update(UUID_NAMESPACE_DNS).update(bundleId).digest()
  const uuid = Buffer.from(hash.subarray(0, 16))
  uuid[6] = (uuid[6] & 0x0f) | 0x50 // version 5
  uuid[8] = (uuid[8] & 0x3f) | 0x80 // RFC 4122 variant
  return uuid
}

/**
 * Overwrites the LC_UUID load command payload of a thin 64-bit Mach-O with the
 * UUID v5 derived from bundleId. Throws when the file is not a thin 64-bit
 * Mach-O or carries no LC_UUID.
 *
 * @param {string} filePath
 * @param {string} bundleId
 * @returns {string} hex of the stamped UUID
 */
function stampMainExecutableUuid(filePath, bundleId) {
  const buf = fs.readFileSync(filePath)
  const magic = buf.readUInt32LE(0)
  const littleEndian = magic === MH_MAGIC_64
  const bigEndian = magic === MH_CIGAM_64
  if (!littleEndian && !bigEndian) {
    throw new Error(
      `${filePath}: expected a thin 64-bit Mach-O (magic 0xfeedfacf), got 0x${magic.toString(16)}. ` +
        `Universal (fat) binaries are not supported; electron-builder is configured to emit single-arch bundles.`,
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

/**
 * electron-builder afterPack hook. On darwin, stamps a unique LC_UUID on the
 * main executable and mirrors NSLocalNetworkUsageDescription into the Electron
 * Framework and every helper .app under Contents/Frameworks. No-op on other
 * platforms. Throws when any required input or expected file is missing so the
 * build fails loudly instead of shipping without the fix.
 *
 * @param {{ electronPlatformName: string, appOutDir: string, packager: any }} context
 */
async function patchMacosLocalNetworkPermission(context) {
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

  const stamped = stampMainExecutableUuid(mainExecutable, bundleId)
  console.log(`mac-inject: stamped LC_UUID ${stamped} on ${mainExecutable}`)

  const frameworkPlist = path.join(
    frameworksDir,
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
    'Info.plist',
  )
  if (!fs.existsSync(frameworkPlist)) {
    throw new Error(`mac-inject: Electron Framework Info.plist not found at ${frameworkPlist}`)
  }
  writeUsageDescription(frameworkPlist, usageDescription)
  console.log(`mac-inject: wrote NSLocalNetworkUsageDescription into ${frameworkPlist}`)

  let helpersPatched = 0
  for (const entry of fs.readdirSync(frameworksDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      const helperPlist = path.join(frameworksDir, entry.name, 'Contents', 'Info.plist')
      if (fs.existsSync(helperPlist)) {
        writeUsageDescription(helperPlist, usageDescription)
        console.log(`mac-inject: wrote NSLocalNetworkUsageDescription into ${helperPlist}`)
        helpersPatched++
      }
    }
  }
  if (helpersPatched === 0) {
    throw new Error(`mac-inject: no helper .app with an Info.plist found under ${frameworksDir}`)
  }
}

exports.default = patchMacosLocalNetworkPermission
exports.uuidFromBundleId = uuidFromBundleId
exports.stampMainExecutableUuid = stampMainExecutableUuid
