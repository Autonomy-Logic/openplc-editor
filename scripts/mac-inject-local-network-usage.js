/* eslint-disable */
// macOS 15+ Local Network permission requires two things on top of the
// defaults electron-builder ships:
//
//   1. NSLocalNetworkUsageDescription on the host app Info.plist AND on the
//      Electron Framework and every helper .app, not only the host app.
//      Without it the OS silently denies LAN access and never prompts.
//
//   2. A UNIQUE LC_UUID on the main executable. Per Apple TN3179 the
//      local-network TCC decision is keyed on the main executable's Mach-O
//      UUID; electron-builder ships Electron's stock binary unchanged, so our
//      main executable UUID collides with every other Electron app built from
//      the same prebuilt binary (including the one `npm run dev` runs). macOS
//      then resolves our bundle id to `com.github.Electron` through that UUID,
//      silently denies, never prompts, and the app never appears in Privacy &
//      Security -> Local Network. Terminal-launched runs work because the
//      responsible-process attribution bypasses the UUID lookup.
//
// Both run before electron-builder's signing pass so the subsequent codesign
// seals our changes.

const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MH_MAGIC_64 = 0xfeedfacf
const MH_CIGAM_64 = 0xcffaedfe
const FAT_MAGIC = 0xcafebabe
const FAT_CIGAM = 0xbebafeca
const LC_UUID = 0x1b

/**
 * Deterministic UUID v5 from a namespace and name, so every build of the same
 * bundle id produces the same UUID and the user's TCC grant survives updates.
 */
function uuidFromBundleId(bundleId) {
  const namespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex') // DNS namespace
  const hash = crypto.createHash('sha1').update(namespace).update(bundleId).digest()
  const uuid = Buffer.from(hash.subarray(0, 16))
  uuid[6] = (uuid[6] & 0x0f) | 0x50 // version 5
  uuid[8] = (uuid[8] & 0x3f) | 0x80 // RFC 4122 variant
  return uuid
}

function stampUuidInSlice(buf, sliceOffset, uuid) {
  const magic = buf.readUInt32LE(sliceOffset)
  const littleEndian = magic === MH_MAGIC_64
  const bigEndian = magic === MH_CIGAM_64
  if (!littleEndian && !bigEndian) {
    throw new Error(`Not a 64-bit Mach-O at offset ${sliceOffset} (magic 0x${magic.toString(16)})`)
  }
  const readU32 = (off) => (littleEndian ? buf.readUInt32LE(off) : buf.readUInt32BE(off))
  const ncmds = readU32(sliceOffset + 16)
  // 64-bit Mach-O header is 32 bytes
  let cursor = sliceOffset + 32
  for (let i = 0; i < ncmds; i++) {
    const cmd = readU32(cursor)
    const cmdsize = readU32(cursor + 4)
    if (cmd === LC_UUID) {
      uuid.copy(buf, cursor + 8, 0, 16)
      return true
    }
    cursor += cmdsize
  }
  return false
}

function stampUniqueUuid(filePath, bundleId) {
  const buf = fs.readFileSync(filePath)
  const magic = buf.readUInt32BE(0)
  const uuid = uuidFromBundleId(bundleId)
  const slices = []
  if (magic === FAT_MAGIC || magic === FAT_CIGAM) {
    const nfat = buf.readUInt32BE(4)
    for (let i = 0; i < nfat; i++) {
      slices.push(buf.readUInt32BE(8 + i * 20 + 8))
    }
  } else {
    slices.push(0)
  }
  let changed = 0
  for (const offset of slices) {
    if (stampUuidInSlice(buf, offset, uuid)) changed++
  }
  if (changed === 0) {
    throw new Error(`No LC_UUID found in ${filePath}`)
  }
  fs.writeFileSync(filePath, buf)
  return { slices: slices.length, uuid: uuid.toString('hex') }
}

exports.default = async function injectLocalNetworkUsageDescription(context) {
  const { electronPlatformName, appOutDir, packager } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  const bundleId = packager.config?.appId
  const usageDescription = packager.config?.mac?.extendInfo?.NSLocalNetworkUsageDescription
  if (!bundleId) {
    throw new Error('Cannot patch main executable UUID: appId not resolved')
  }

  const appName = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  // 1. Stamp a unique LC_UUID on the main executable derived from the bundle id.
  const mainExecutable = path.join(appPath, 'Contents', 'MacOS', appName)
  if (fs.existsSync(mainExecutable)) {
    const result = stampUniqueUuid(mainExecutable, bundleId)
    console.log(
      `Stamped unique LC_UUID on main executable (${result.slices} slice(s), uuid=${result.uuid}): ${mainExecutable}`,
    )
  }

  // 2. Mirror NSLocalNetworkUsageDescription into the Electron Framework and every helper .app.
  if (!usageDescription) {
    return
  }
  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks')
  if (!fs.existsSync(frameworksDir)) {
    return
  }
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
  for (const plist of targets) {
    try {
      execFileSync('/usr/bin/plutil', [
        '-insert',
        'NSLocalNetworkUsageDescription',
        '-string',
        usageDescription,
        plist,
      ])
    } catch (err) {
      execFileSync('/usr/bin/plutil', [
        '-replace',
        'NSLocalNetworkUsageDescription',
        '-string',
        usageDescription,
        plist,
      ])
    }
    console.log(`Injected NSLocalNetworkUsageDescription into: ${plist}`)
  }
}
