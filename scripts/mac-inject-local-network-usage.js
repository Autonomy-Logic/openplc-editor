/* eslint-disable */
// macOS 15+ Local Network permission requires NSLocalNetworkUsageDescription on
// the Electron Framework and every helper .app, not only the host app. Without
// it the OS silently denies LAN access and never prompts. Mirrors the key from
// the host's mac.extendInfo into the nested Info.plists before signing so the
// subsequent codesign pass covers the change.

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

exports.default = async function injectLocalNetworkUsageDescription(context) {
  const { electronPlatformName, appOutDir, packager } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  const usageDescription = packager.config?.mac?.extendInfo?.NSLocalNetworkUsageDescription
  if (!usageDescription) {
    return
  }

  const appName = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)
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
