/**
 * `openplc devices` — list OpenPLC Runtime v4 targets on the local network.
 *
 * The same UDP scan the editor's "Search" button runs, via
 * `discoverRuntimes`, which covers bare v4 runtimes and v4 behind a VPP
 * package because both advertise the same service.
 */

import { discoverRuntimes } from '@root/backend/editor/hardware/discover-runtimes'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { ErrorCode } from '../exit-codes'
import { ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'

export async function runDevices(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const rawTimeout = stringFlag(args, 'timeout')
  const durationMs = rawTimeout === undefined ? undefined : Number(rawTimeout)
  if (durationMs !== undefined && !Number.isFinite(durationMs)) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: `--timeout must be a number of milliseconds, got "${rawTimeout}"` },
      ExitCode.Usage,
    )
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

  return reporter.success({ devices }, () => {
    if (devices.length === 0) {
      return 'No runtimes answered. They must be powered on and on this subnet.'
    }
    const rows = devices.map((device) => [
      device.ipAddress,
      device.hostname || '-',
      device.runtimeVersion || '-',
      String(device.apiPort),
    ])
    return renderTable(['ADDRESS', 'HOSTNAME', 'VERSION', 'PORT'], rows)
  })
}

/** Column-aligned plain text — no box drawing, so it survives a narrow terminal. */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd()
  return [line(headers), ...rows.map(line)].join('\n')
}
