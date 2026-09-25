/**
 * `openplc-cli esi import <file.xml>` — add an ESI file to the project's device
 * repository, so an EtherCAT slave can be declared against it.
 *
 * Without this the only way to get an ESI file into a project is the device
 * screen's file picker, which makes the whole EtherCAT surface unreachable
 * headless. `esi list` exists because `apply` resolves an `esiDeviceRef` by id
 * OR filename, and a spec author needs to see which devices a file offers and
 * at which index.
 */

import { promises as fs } from 'node:fs'
import { basename, resolve } from 'node:path'

import { ESIService } from '@root/backend/editor/ethercat/esi-service'

import { type ParsedArgs, stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'

export async function runEsi(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const action = args.positionals[0]
  if (action !== 'import' && action !== 'list') {
    return reporter.failure(
      { code: ErrorCode.UnknownCommand, message: `Unknown esi action "${action ?? ''}". Use "import" or "list".` },
      ExitCode.Usage,
    )
  }

  const projectPath = stringFlag(args, 'project')
  if (!projectPath) {
    return reporter.failure({ code: ErrorCode.InvalidArgument, message: 'esi needs --project <dir>.' }, ExitCode.Usage)
  }

  const esi = new ESIService()
  return action === 'import' ? importFile(args, projectPath, esi, reporter) : list(projectPath, esi, reporter)
}

async function importFile(
  args: ParsedArgs,
  projectPath: string,
  esi: ESIService,
  reporter: Reporter,
): Promise<CliResult> {
  const filePath = args.positionals[1] ?? stringFlag(args, 'file')
  if (!filePath) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'esi import needs the path of an ESI .xml file.' },
      ExitCode.Usage,
    )
  }

  let content: string
  try {
    content = await fs.readFile(resolve(filePath), 'utf8')
  } catch (error) {
    return reporter.failure(
      {
        code: ErrorCode.ProjectNotFound,
        message: `Could not read "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      },
      ExitCode.NotFound,
    )
  }

  const filename = basename(filePath)
  const result = await esi.parseAndSaveFile(projectPath, filename, content)
  if (!result.success) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: `"${filename}" is not a usable ESI file: ${result.error ?? ''}` },
      ExitCode.CompileFailed,
    )
  }

  // A re-import is a no-op, not a failure — the same bargain the GUI strikes.
  if (result.duplicate || !result.item) {
    const payload = { ok: true, imported: false, filename, reason: 'already in this project' }
    return reporter.success(payload, () => `${filename} is already in this project — nothing to do.`)
  }

  const payload = {
    ok: true,
    imported: true,
    filename,
    repositoryItemId: result.item.id,
    vendor: result.item.vendor,
    devices: result.item.devices.map((device, index) => ({
      deviceIndex: index,
      name: device.name,
      productCode: device.type.productCode,
      revisionNo: device.type.revisionNo,
    })),
    ...(result.item.warnings?.length ? { warnings: result.item.warnings } : {}),
  }
  return reporter.success(payload, () => renderItem(filename, payload.repositoryItemId, payload.devices))
}

async function list(projectPath: string, esi: ESIService, reporter: Reporter): Promise<CliResult> {
  const index = await esi.loadRepositoryIndex(projectPath)
  // The index carries device summaries only when they were cached at import;
  // `deviceCount` is always there, so an uncached file still reports its size.
  const items = (index?.items ?? []).map((item) => ({
    filename: item.filename,
    repositoryItemId: item.id,
    vendor: { id: item.vendorId, name: item.vendorName },
    deviceCount: item.deviceCount,
    devices: (item.devices ?? []).map((device, deviceIndex) => ({
      deviceIndex,
      name: device.name,
      productCode: device.type.productCode,
      revisionNo: device.type.revisionNo,
    })),
  }))

  const payload = { ok: true, count: items.length, items }
  return reporter.success(payload, () =>
    items.length === 0
      ? 'This project has no ESI files — add one with `openplc-cli esi import`.'
      : items.map((item) => renderItem(item.filename, item.repositoryItemId, item.devices)).join('\n\n'),
  )
}

function renderItem(
  filename: string,
  repositoryItemId: string,
  devices: { deviceIndex: number; name: string; productCode: string; revisionNo: string }[],
): string {
  const lines = [`${filename}  (${repositoryItemId})`]
  for (const device of devices) {
    lines.push(`  [${device.deviceIndex}] ${device.name}  ${device.productCode} rev ${device.revisionNo}`)
  }
  return lines.join('\n')
}
