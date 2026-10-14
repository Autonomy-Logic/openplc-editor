/**
 * Author the runtime v4 conf/* JSON strings (Modbus slave + master,
 * S7Comm, OPC-UA, EtherCAT, MQTT) from a project's `servers`,
 * `remoteDevices`, program metadata, and the target runtime version.
 *
 * Editor-canonical behaviour — every output string is byte-identical
 * to what the editor's `compileProgram` used to author inline in the
 * runtime-v4 branch.  Each conf is opaque to the
 * `composeRuntimeV4Bundle` step (which just slots them into
 * `conf/<name>.json`), so byte-identical here means byte-identical
 * uploads to the runtime, which means the v4 runtime sees the same
 * conf files regardless of which editor produced the program.
 *
 * Why this lives in shared:
 *  - The atomic generators (`generateModbusSlaveConfig`,
 *    `generateModbusMasterConfig`, `generateS7CommConfig`,
 *    `generateOpcUaConfig`, `generateEthercatConfig`,
 *    `validateEthercatConfig`) are already shared.
 *  - The orchestration (error-handling for OPC-UA, validation gate
 *    for EtherCAT, the specific log-message strings) used to live
 *    in two places: editor's `compiler-module.ts` and web's
 *    `compiler-adapter.ts`.  Drift between them surfaces as
 *    inconsistent error UX (one platform fails fast, the other
 *    silently produces a bad config).  This module is the single
 *    place where that orchestration lives.
 *
 * Pure function: no fs I/O, no DOM, no global state.  Caller passes
 * the project's `servers` / `remoteDevices`, the OPC-UA
 * resolver-input (`debugMapContent` + `instances`), and a log
 * callback that maps shared-pipeline progress events to the
 * platform's native log channel.
 */

// Frontend/utils imports — pure data transformers, Node-safe (no
// DOM dependencies).  Same legacy-tree path the editor's compiler-
// module.ts uses; flagged as an organisational smell (`backend-shared
// → frontend`) but functional, see the build-pipeline refactor plan.
import { getErrorMessage } from '../../../../frontend/utils/get-error-message'
import { generateModbusSlaveConfig } from '../../../../frontend/utils/modbus/generate-modbus-slave-config'
import type { MqttCredentialRef } from '../../../../frontend/utils/mqtt/contract/contract'
import type { MqttSourceModel } from '../../../../frontend/utils/mqtt/project/source-model'
import {
  generateMqttRuntimeConfig,
  MqttConfigGenerationError,
  type MqttRuntimeConfigPlan,
  type MqttRuntimeConfigResult,
  planMqttRuntimeConfig,
} from '../../../../frontend/utils/mqtt/runtime/generate'
import { generateOpcUaConfig, OpcUaConfigError } from '../../../../frontend/utils/opcua'
import { generateS7CommConfig } from '../../../../frontend/utils/s7comm'
import { generateEthercatConfig, generateEtherdogConfigs } from '../../ethercat/generate-ethercat-config'
import { validateEthercatConfig } from '../../ethercat/validate-ethercat-config'
import { isEtherdogCapableRuntime } from '../../firmware/runtime-version-gate'
import type { PLCRemoteDevice, PLCServer } from '../../types/PLC/open-plc'
import { generateModbusMasterConfig } from '../../utils/modbus/generate-modbus-master-config'

/**
 * Tagged shape for the program instances OPC-UA needs to resolve
 * `%I/%Q/%M` addresses against the runtime's variable table.  Matches
 * the editor's `projectData.configuration.resource.instances` slice.
 */
export interface OpcUaInstance {
  name: string
  task: string
  program: string
}

/** What MQTT generation needs beyond the project: the target's capability, declarations and credential. */
export interface GenerateConfsMqttInput {
  target: { mqttClient: boolean }
  sourceModel?: MqttSourceModel
  /** 'deferred': secret-bearing integrations are validated here and written by the deploy after staging. */
  credentialRef?: MqttCredentialRef | null | 'deferred'
}

export interface GenerateConfsInput {
  /** Project's `data.servers` — Modbus slave, S7Comm, OPC-UA all
   *  read from this. */
  servers: PLCServer[] | undefined
  /** Project's `data.remoteDevices` — Modbus master + EtherCAT read
   *  from this. */
  remoteDevices: PLCRemoteDevice[] | undefined
  /** Program instances (mapped from `projectData.configuration.resource.
   *  instances`).  OPC-UA resolver uses this to bind addresses to
   *  the program that owns them. */
  instances: OpcUaInstance[]
  /** Strucpp's `debug-map.json` content (NOT `generated_debug.cpp`).
   *  OPC-UA's `parseDebugMap` reads this to resolve `%I/%Q/%M`.
   *  Caller pulls it out of the strucpp emitted-files map. */
  debugMapContent: string
  /** Log channel.  OPC-UA generation emits informational progress
   *  via this; error logs go here too before the relevant errors
   *  are rethrown.  Each adapter wires its native log channel
   *  through this callback. */
  log: (message: string, level: 'info' | 'warning' | 'error') => void
  /** Version the target runtime reports, or null when unknown (compile
   *  only, no device).  Picks the EtherCAT file format; see
   *  `isEtherdogCapableRuntime`. */
  runtimeVersion: string | null
  /** Absent means the caller cannot vouch for the target, so an enabled MQTT integration is refused. */
  mqtt?: GenerateConfsMqttInput
}

/**
 * Each output is the JSON string that lands at `conf/<name>.json` in
 * the runtime v4 bundle, or `null` when the project has no config of
 * that type (the composer skips the file in that case).
 */
export interface GenerateConfsOutput {
  modbusSlave: string | null
  modbusMaster: string | null
  s7Comm: string | null
  opcUa: string | null
  /** Validated before return. Legacy runtimes: `ethercat` only ('' without EtherCAT).
   *  EtherDOG runtimes: `ethercatBusconfig` + `ethercatIomapping`, both null without EtherCAT. */
  ethercat: string | null
  ethercatBusconfig: string | null
  ethercatIomapping: string | null
  /** `conf/mqtt.json`; null when no MQTT integration is enabled, so the runtime removes its copy. */
  mqtt: string | null
  /** Present when `conf/mqtt.json` waits for the runtime credential (see `GenerateConfsMqttInput.credentialRef`). */
  mqttDeferred?: MqttRuntimeConfigPlan
}

export const describeGeneratedMqttConfig = (generated: MqttRuntimeConfigResult): string => {
  const birth = generated.birthUpperBoundBytes === null ? '' : `, NBIRTH up to ${generated.birthUpperBoundBytes} bytes`
  return `Generated conf/mqtt.json for "${generated.server}": ${generated.leafCount} leaves, mode ${generated.config.mode}${birth}`
}

/**
 * Errors:
 *  - `OpcUaConfigError` (from `generateOpcUaConfig`) is logged with
 *    `OPC-UA Configuration Error:` prefix and rethrown.  Other
 *    errors from OPC-UA generation are logged as `Failed to
 *    generate OPC-UA config:` and rethrown.  The rethrow stops the
 *    caller's pipeline — same gate the editor's compileProgram
 *    runtime-v4 try/catch uses.
 *  - EtherCAT validation errors throw `Error('EtherCAT
 *    configuration is invalid: <joined messages>')` without logging
 *    here; caller surfaces the error message in its own catch.
 *
 * Both error paths abort BEFORE the composer runs — matching the
 * editor's "fail fast" gate.
 */
export function generateRuntimeConfs(input: GenerateConfsInput): GenerateConfsOutput {
  const { servers, remoteDevices, instances, debugMapContent, log } = input

  // Modbus slave / master / S7Comm: pure helpers.  Each returns `null`
  // when the project has no config of that type.  Master also forwards
  // non-fatal skip diagnostics (e.g. an RTU device missing a serial
  // port) through `log` so they reach the build console.
  // Type assertions match the editor's call sites — the generators
  // accept a narrower shape than `PLCServer[]` / `PLCRemoteDevice[]`
  // but the runtime values are compatible.
  const modbusSlave = generateModbusSlaveConfig(servers as Parameters<typeof generateModbusSlaveConfig>[0])
  const modbusMaster = generateModbusMasterConfig(
    remoteDevices as Parameters<typeof generateModbusMasterConfig>[0],
    (msg) => log(msg, 'warning'),
  )
  const s7Comm = generateS7CommConfig(servers)

  // OPC-UA: unresolvable nodes are dropped with a warning; throws
  // `OpcUaConfigError` only when the debug map is unusable.
  // Editor logs the error message with a specific prefix BEFORE
  // rethrowing so the user sees the diagnostic in the compile log
  // even if the outer pipeline catches and short-circuits.
  let opcUa: string | null = null
  try {
    opcUa = generateOpcUaConfig(servers, debugMapContent, instances, (msg) => log(msg, 'warning'))
  } catch (error) {
    if (error instanceof OpcUaConfigError) {
      log(`OPC-UA Configuration Error:\n${error.message}`, 'error')
    } else {
      log(`Failed to generate OPC-UA config: ${getErrorMessage(error)}`, 'error')
    }
    throw error
  }

  // EtherCAT: validate BEFORE returning so a bad config aborts the
  // compile before the composer runs.  Validation failures throw a
  // plain `Error` — caller's try/catch wraps it with the runtime-v4
  // "Stopping compilation process" log line, matching the editor.
  let ethercat: string | null = null
  let ethercatBusconfig: string | null = null
  let ethercatIomapping: string | null = null
  let ethercatErrors: string[]
  if (isEtherdogCapableRuntime(input.runtimeVersion)) {
    const configs = generateEtherdogConfigs(remoteDevices)
    ethercatBusconfig = configs?.busconfig ?? null
    ethercatIomapping = configs?.iomapping ?? null
    ethercatErrors = validateEthercatConfig(ethercatBusconfig, ethercatIomapping)
  } else {
    const legacy = generateEthercatConfig(remoteDevices)
    ethercat = legacy ?? ''
    ethercatErrors = validateEthercatConfig(legacy)
  }
  if (ethercatErrors.length > 0) {
    throw new Error(`EtherCAT configuration is invalid: ${ethercatErrors.join('; ')}`)
  }

  let mqtt: string | null = null
  let mqttDeferred: MqttRuntimeConfigPlan | null = null
  try {
    const mqttInput = {
      servers,
      target: input.mqtt?.target ?? { mqttClient: false },
      debugMapContent,
      instances,
      sourceModel: input.mqtt?.sourceModel,
    }
    const credentialRef = input.mqtt?.credentialRef
    const plan = credentialRef === 'deferred' ? planMqttRuntimeConfig(mqttInput) : null
    if (plan?.credentialRequired) {
      mqttDeferred = plan
      log(
        `Validated MQTT configuration for "${plan.server}": ${plan.leafCount} leaves, mode ${plan.integration.mode}; ` +
          'conf/mqtt.json is written when uploading, after the runtime credential is prepared',
        'info',
      )
    } else {
      const generated = generateMqttRuntimeConfig({
        ...mqttInput,
        credentialRef: credentialRef === 'deferred' ? null : credentialRef,
      })
      if (generated !== null) {
        mqtt = generated.content
        log(describeGeneratedMqttConfig(generated), 'info')
      }
    }
  } catch (error) {
    if (error instanceof MqttConfigGenerationError) {
      log(`MQTT Configuration Error:\n${error.message}`, 'error')
    } else {
      log(`Failed to generate MQTT config: ${getErrorMessage(error)}`, 'error')
    }
    throw error
  }

  return {
    modbusSlave,
    modbusMaster,
    s7Comm,
    opcUa,
    ethercat,
    ethercatBusconfig,
    ethercatIomapping,
    mqtt,
    ...(mqttDeferred === null ? {} : { mqttDeferred }),
  }
}
