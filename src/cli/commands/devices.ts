/**
 * `openplc-cli devices` — everything this machine can reach a PLC through.
 *
 * Two lists, because the editor has two: the "Search" button's UDP scan for
 * Runtime v4 targets on the network (`discoverRuntimes`, covering bare v4 and v4
 * behind a VPP package, since both advertise the same service), and the serial
 * port dropdown's list (`HardwareModule.getAvailableSerialPorts`, whose labels
 * carry the arduino-cli-identified board name when it knows one).
 *
 * Both are needed to answer "what do I pass to --host or --port", which is the
 * question this command exists for.
 */

import { HardwareModule } from '@root/backend/editor/hardware'
import { discoverRuntimes } from '@root/backend/editor/hardware/discover-runtimes'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { ErrorCode } from '../exit-codes'
import { ExitCode } from '../exit-codes'
import { type CliResult, renderTable, type Reporter } from '../output'

export async function runDevices(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const rawTimeout = stringFlag(args, 'timeout')
  const durationMs = rawTimeout === undefined ? undefined : Number(rawTimeout)
  if (durationMs !== undefined && !Number.isFinite(durationMs)) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: `--timeout must be a number of milliseconds, got "${rawTimeout}"` },
      ExitCode.Usage,
    )
  }

  // Serial first: it is local and instant, so the network scan's few seconds do
  // not delay the half of the answer that needs no waiting.
  const serialPorts = await new HardwareModule().getAvailableSerialPorts()
  for (const port of serialPorts) {
    reporter.progress(`  serial ${port.address}${describePort(port)}`)
  }

  reporter.progress('Scanning the local network for OpenPLC runtimes…')

  const result = await discoverRuntimes({
    durationMs,
    onDevice: (device) => reporter.progress(`  found ${device.ipAddress} (${device.hostname || 'no hostname'})`),
    onDiagnostic: (message) => {
      if (boolFlag(args, 'verbose')) reporter.progress(`  ${message}`)
    },
  })

  if (!result.success) {
    return reporter.failure({ code: ErrorCode.Internal, message: result.error }, ExitCode.Internal)
  }

  const devices = [...result.devices].sort((a, b) => a.ipAddress.localeCompare(b.ipAddress))

  return reporter.success({ devices, serialPorts }, () => {
    const sections: string[] = []

    sections.push(
      serialPorts.length === 0
        ? 'Serial ports: none found.'
        : `Serial ports (pass with --port):\n${renderTable(
            ['PORT', 'BOARD'],
            serialPorts.map((port) => [port.address, port.boardName ?? port.manufacturer ?? '-']),
          )}`,
    )

    sections.push(
      devices.length === 0
        ? 'Network runtimes: none answered. They must be powered on and on this subnet.'
        : `Network runtimes (pass with --host):\n${renderTable(
            ['ADDRESS', 'HOSTNAME', 'VERSION', 'API PORT'],
            devices.map((device) => [
              device.ipAddress,
              device.hostname || '-',
              device.runtimeVersion || '-',
              String(device.apiPort),
            ]),
          )}`,
    )

    return sections.join('\n\n')
  })
}

/** The parenthetical the port dropdown shows: board name when arduino-cli knows it. */
function describePort(port: { boardName?: string; manufacturer?: string }): string {
  const label = port.boardName ?? port.manufacturer
  return label ? ` (${label})` : ''
}
