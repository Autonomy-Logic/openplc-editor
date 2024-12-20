
/* eslint-disable */
const notarize = require('@electron/notarize')

exports.default = async function notarizeMacos(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  // Must set process.env.CI to true for notarization to work
  if (process.env.CI !== 'true') {
    console.warn('Skipping notarizing step. Packaging is not running in CI')
    return
  }

  const appName = context.packager.appInfo.productFilename

  await notarize.notarize({
    appBundleId: '66HTP4XT8H.com.autonomylogic.openplceditor',
    appPath: `${appOutDir}/${appName}.app`,
    teamId: '66HTP4XT8H',
    appleId: 'thiago.alves@autonomylogic.com',
    appleIdPassword: 'INSERT-APP-SPECIFIC-PASSWORD-HERE',
  })
}
