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

  // Validate required environment variables
  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_ID_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID || '66HTP4XT8H'

  if (!appleId || !appleIdPassword) {
    throw new Error(
      'Missing required environment variables for notarization. ' +
        'Please set APPLE_ID and APPLE_ID_PASSWORD.'
    )
  }

  const appName = context.packager.appInfo.productFilename
  const appBundleId = `${teamId}.com.autonomylogic.openplceditor`

  console.log(`Notarizing ${appName}.app...`)

  await notarize.notarize({
    appBundleId,
    appPath: `${appOutDir}/${appName}.app`,
    teamId,
    appleId,
    appleIdPassword,
  })

  console.log(`Successfully notarized ${appName}.app`)
}
