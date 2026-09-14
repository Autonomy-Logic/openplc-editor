/**
 * `openplc-cli runtime info` — what a device is, before you write to it.
 *
 * Everything else that talks to a runtime changes it: `upload` replaces the
 * program, and `debug open` against a device running something else fails
 * `md5_mismatch` with `--upload-if-needed` as the only way forward. So the only
 * way to learn a device's version was to overwrite what it was running — which
 * is backwards for a box in the field, and it is how a project that needs a
 * feature the device lacks got as far as a full compile and upload before
 * anyone found out.
 *
 * `/api/capabilities` is unauthenticated by the runtime's own design, so this
 * needs no credentials. `probeRuntimeVersion` falls back to `/api/version` for
 * runtimes that predate it.
 */

import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import {
  isRetainConfigCapableRuntime,
  isStrucppCompatibleRuntime,
  isUserManagementCapableRuntime,
  MIN_RETAIN_CONFIG_RUNTIME_VERSION,
  MIN_RUNTIME_VERSION,
} from '@root/backend/shared/firmware/runtime-version-gate'
import { probeRuntimeVersion } from '@root/backend/shared/library/probe-runtime-version'

import { type ParsedArgs, stringFlag } from '../args'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'

export async function runRuntime(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const action = args.positionals[0]
  if (action !== undefined && action !== 'info') {
    return reporter.failure(
      { code: ErrorCode.UnknownCommand, message: `Unknown runtime action "${action}". The only one is "info".` },
      ExitCode.Usage,
    )
  }

  const host = stringFlag(args, 'host') ?? stringFlag(args, 'address') ?? args.positionals[1]
  if (!host) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'runtime info needs --host <address> (see `openplc-cli devices`).' },
      ExitCode.Usage,
    )
  }

  const client = new RuntimeApiClient()
  const getJson = async (endpoint: string) => {
    const result = await client.makeRuntimeApiRequest<unknown>(host, endpoint, (body: string) => JSON.parse(body))
    if (!result.success) return { success: false as const, error: result.error }
    return { success: true as const, body: result.data }
  }

  const probe = await probeRuntimeVersion({
    fetchCapabilities: () => getJson('/api/capabilities'),
    fetchVersion: () => getJson('/api/version'),
    log: () => undefined,
  })

  if (!probe.version) {
    return reporter.failure(
      {
        code: ErrorCode.NotConnected,
        message: `No runtime answered at "${host}". It may be unreachable, or too old to report a version.`,
      },
      ExitCode.Connection,
    )
  }

  const payload = {
    ok: true,
    host,
    runtimeVersion: probe.version,
    /** The oldest editor this runtime accepts programs from. */
    minEditorVersion: probe.minEditorVersion ?? null,
    supportsProjectSnapshot: probe.supportsProjectSnapshot === true,
    capabilities: {
      /** Below this the editor cannot build for it at all. */
      strucppPrograms: isStrucppCompatibleRuntime(probe.version),
      /** `device.persistentStorage` and `flag: "retain"` do nothing without it. */
      retainStore: isRetainConfigCapableRuntime(probe.version),
      userManagement: isUserManagementCapableRuntime(probe.version),
    },
  }

  return reporter.success(payload, () => render(payload))
}

function render(payload: {
  host: string
  runtimeVersion: string
  minEditorVersion: string | null
  supportsProjectSnapshot: boolean
  capabilities: { strucppPrograms: boolean; retainStore: boolean; userManagement: boolean }
}): string {
  const mark = (on: boolean) => (on ? 'yes' : 'no')
  const lines = [
    `${payload.host} — ${payload.runtimeVersion}`,
    `  accepts programs from editor  ${payload.minEditorVersion ?? '(not reported)'} and newer`,
    `  builds STruC++ programs       ${mark(payload.capabilities.strucppPrograms)}${
      payload.capabilities.strucppPrograms ? '' : `  (needs ${MIN_RUNTIME_VERSION})`
    }`,
    `  built-in retain store         ${mark(payload.capabilities.retainStore)}${
      payload.capabilities.retainStore ? '' : `  (needs ${MIN_RETAIN_CONFIG_RUNTIME_VERSION})`
    }`,
    `  user management API           ${mark(payload.capabilities.userManagement)}`,
    `  stores the source project     ${mark(payload.supportsProjectSnapshot)}`,
  ]
  if (!payload.capabilities.retainStore) {
    lines.push('', 'A project using `flag: "retain"` will run here, but retained values reset on restart.')
  }
  return lines.join('\n')
}
