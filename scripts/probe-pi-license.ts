/**
 * Headless end-to-end licensing probe against a real runtime-v4 device.
 *
 * Runs the SAME code path the editor's connect flow uses -- the real
 * `WebSocketDebugTransport` and, in `--recover` mode, the real
 * `probeAndRecover` (derive deviceId -> ask the backend -> write 0x49). No
 * reimplementation, so a pass here is evidence about the shipped code and not
 * about this script.
 *
 * Two modes, because the deviceId is only knowable after talking to the device:
 *
 *   --probe    read the anchor (0x48) and the stored license (0x4A), print the
 *              derived deviceId. Use it to seed the purchase for that device.
 *   --recover  full flow: probeAndRecover against the configured backend, then
 *              re-read 0x4A to confirm the device now holds a valid license.
 *
 * `--recover` REQUIRES `OPENPLC_EDGE_API_URL` (or an explicit
 * `--allow-production`): it consumes a real single-use nonce and rate-limit
 * quota and, on success, WRITES a license onto the board.
 *
 * Usage (from openplc-editor):
 *   npx tsx scripts/probe-pi-license.ts --probe --host 192.168.0.128
 *   OPENPLC_EDGE_API_URL=http://127.0.0.1:3333 \
 *     npx tsx scripts/probe-pi-license.ts --recover --host 192.168.0.128 \
 *       --packageId com.openplc.raspberry-pi-licensed
 *
 * The runtime serves HTTPS with a self-signed cert, so TLS verification is off
 * for the login call and the socket. That is fine for a lab device on the LAN
 * and matches what the editor does when the user accepts the device.
 */

import { probeAndRecover } from '../src/backend/editor/license/device-connect'
import { deriveDeviceId } from '../src/backend/editor/license/device-identity'
import { readBoardIdWithRetries } from '../src/backend/editor/license/license-probe'
import { WebSocketDebugTransport } from '../src/backend/shared/debug/websocket-debug-transport'

const LIC_STATUS_SUCCESS = 0x7e
const LIC_STATUS_UNSUPPORTED = 0x85

interface Args {
  host: string
  port: number
  user: string
  password: string
  packageId: string
  mode: 'probe' | 'recover'
  /** Opt in, explicitly, to talking to the PRODUCTION backend in --recover. */
  allowProduction: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    host: '192.168.0.128',
    port: 8443,
    user: 'admin',
    password: 'admin',
    packageId: 'com.openplc.raspberry-pi-licensed',
    mode: 'probe',
    allowProduction: false,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host' && argv[i + 1]) args.host = argv[++i]
    else if (argv[i] === '--port' && argv[i + 1]) args.port = Number(argv[++i])
    else if (argv[i] === '--user' && argv[i + 1]) args.user = argv[++i]
    else if (argv[i] === '--password' && argv[i + 1]) args.password = argv[++i]
    else if (argv[i] === '--packageId' && argv[i + 1]) args.packageId = argv[++i]
    else if (argv[i] === '--recover') args.mode = 'recover'
    else if (argv[i] === '--probe') args.mode = 'probe'
    else if (argv[i] === '--allow-production') args.allowProduction = true
  }
  return args
}

/** The runtime's Flask login; returns the JWT the debug socket authenticates with. */
async function login(args: Args): Promise<string> {
  const res = await fetch(`https://${args.host}:${args.port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: args.user, password: args.password }),
  })
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error('login returned no access_token')
  return body.access_token
}

function describeLicenseStatus(status: number | undefined): string {
  if (status === LIC_STATUS_SUCCESS) return 'SUCCESS (a valid license is stored)'
  if (status === LIC_STATUS_UNSUPPORTED) return 'UNSUPPORTED (no on-device store)'
  return `0x${(status ?? 0).toString(16)} (absent / corrupt -> demo)`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  // Self-signed cert on the device. Scoped to this script's process.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  console.log(`device   ${args.host}:${args.port}`)
  console.log(`mode     ${args.mode}`)
  if (args.mode === 'recover') {
    // NO IMPLICIT PRODUCTION. `getEdgeApiBaseUrl()` falls back to the production
    // host when `OPENPLC_EDGE_API_URL` is unset, and this mode does not merely
    // read: it consumes a real single-use nonce and rate-limit quota, and on
    // success it WRITES a license onto the board (0x49). Getting that from a
    // forgotten env var — the previous behaviour, announced only as a
    // "(default: production!)" line in the output — is not a default worth
    // having. The target is now required, and `--allow-production` is the one
    // way to aim at production, spelled out on the command line.
    const backend = process.env.OPENPLC_EDGE_API_URL?.trim()
    if (!backend && !args.allowProduction) {
      console.error(
        'refusing to run --recover without an explicit backend.\n' +
          '  point it at a local backend:  OPENPLC_EDGE_API_URL=http://127.0.0.1:3333\n' +
          '  or opt in to production on purpose:  --allow-production',
      )
      process.exit(2)
    }
    console.log(`backend  ${backend ?? 'PRODUCTION (--allow-production)'}`)
    console.log(`vpp      ${args.packageId}`)
  }
  console.log()

  const token = await login(args)
  console.log('login OK')

  const transport = new WebSocketDebugTransport({
    host: args.host,
    port: args.port,
    token,
    rejectUnauthorized: false,
  })

  await transport.connect()
  console.log('debug socket connected')

  try {
    if (args.mode === 'probe') {
      // Via the editor's own helper: the transport reports `boardId`, which
      // `mapArduinoAnchorResult` normalises into the `anchor` shape the rest of
      // the licensing code (and probeAndRecover) works with. Reading the raw
      // transport field here would be a second, drifting interpretation.
      const anchor = await readBoardIdWithRetries(transport, { attempts: 6, backoffMs: 500 })
      if (!anchor.success || !anchor.anchor?.length) {
        console.error(`0x48 getBoardId failed: ${anchor.error ?? 'no anchor bytes'}`)
        process.exit(1)
      }
      const deviceId = deriveDeviceId(Uint8Array.from(anchor.anchor))
      const lic = await transport.readLicense()

      console.log(`\n0x48 anchor      ${anchor.anchorHex}`)
      console.log(`     deviceId    ${deviceId}`)
      console.log(`0x4A license     ${describeLicenseStatus(lic.status)}`)
      console.log(
        `\nSeed the purchase for this device, then re-run with --recover:\n` +
          `  npx tsx --env-file=.env scripts/seed-vpp-licensing-local.ts --deviceId ${deviceId} --packageId ${args.packageId}`,
      )
      return
    }

    // Full flow through the shipped orchestration.
    const before = await transport.readLicense()
    console.log(`0x4A before      ${describeLicenseStatus(before.status)}`)

    const result = await probeAndRecover(transport, {
      isLicensable: true,
      packageId: args.packageId,
    })
    console.log(
      `\nprobeAndRecover  status=${result.status} licenseStatus=${result.licenseStatus} ` +
        `activation=${result.activation}${result.error ? ` error=${result.error}` : ''}`,
    )
    // The renderer can only show/copy what this field carries (node:crypto is
    // main-only), so print it: an `undefined` here is the license popover with
    // no Device ID and the buy link with nothing to bind a purchase to.
    console.log(`     anchorHex   ${result.anchorHex}`)
    console.log(`     deviceId    ${result.deviceId}`)

    const after = await transport.readLicense()
    console.log(`0x4A after       ${describeLicenseStatus(after.status)}`)

    // Two things this must NOT claim, both of which the old single line did.
    //
    // 1. That a blob was sent. On `already-licensed` the flow short-circuits on
    //    the 0x4A read and never calls the backend or writes anything, so
    //    "license-core accepted the blob" described an event that did not happen
    //    -- and it was the WHOLE POINT of the run (#21: 0x49 has never been
    //    observed live). A pass that reports success without exercising the thing
    //    under test is worse than a failure.
    // 2. That license-core accepted anything. 0x4A is answered by the runtime's
    //    debug webserver, not by the closed verifier: it reports what is STORED.
    //    The signature / key_id verdict never crosses the debug channel.
    const wrote = result.activation === 'activated'
    const ok = after.status === LIC_STATUS_SUCCESS
    if (result.activation === 'already-licensed') {
      console.log(
        '\nNO BLOB WAS SENT: the device already held a license, so the flow returned before\n' +
          'calling the backend and 0x49 was never exercised. Erase the stored license and\n' +
          're-run to test the write path.',
      )
    } else if (wrote && ok) {
      console.log(
        '\n0x49 WROTE A LICENSE AND 0x4A READS IT BACK. This proves the transport and the\n' +
          'store, NOT the verdict: license-core checks the signature and key_id inside the\n' +
          'closed binary and that answer never crosses the debug channel.',
      )
    } else {
      console.log('\nTHE DEVICE DOES NOT HOLD A LICENSE WE RECOGNISE. See activation/error above.')
    }
    process.exit(ok ? 0 : 1)
  } finally {
    transport.disconnect()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
