/**
 * Target-capability gate (BR24, FR32).
 *
 * EtherDOG advertises its feature set in its hello response, which the editor fetches on
 * connect. A project whose EtherCAT configuration needs a feature the connected runtime does
 * not advertise is refused before it is built, naming the EtherDOG version it needs, instead of
 * failing on the bus as "slave did not reach SAFE_OP".
 *
 * A plain-slave project needs no new feature and builds against any EtherDOG. Without a
 * connected runtime there is nothing to check against: the build goes ahead and the verdict
 * carries a warning naming what the target will need.
 *
 * Shape mirrors `vpp-backplane-gate` and `pre-build-plc-gate`: state in, verdict out, no store,
 * no HTTP, no dialog. Byte-identical with openplc-web.
 */

/** The first EtherDOG release providing every {@link RuntimeFeature}. */
export const MIN_ETHERDOG_VERSION = '1.0.0'

type PdoInput = {
  readonly assigned?: boolean
  readonly fixed?: boolean
  readonly entries: readonly unknown[]
}

type SdoEntryInput = {
  readonly valueBytes?: string
  readonly completeAccess?: boolean
}

/**
 * Structural shape of the remote-device slice the gate reads. Defined locally so the gate sits
 * on the shared `utils` layer without importing `backend/shared/types`.
 */
export interface RemoteDeviceInput {
  protocol: string
  ethercatConfig?: {
    devices?: ReadonlyArray<{
      config?: { coeFlags?: { pdoAssign: boolean; pdoConfig: boolean; completeAccess: boolean } }
      rxPdos?: readonly PdoInput[]
      txPdos?: readonly PdoInput[]
      sdoConfigurations?: readonly SdoEntryInput[]
      esiInitCmdSdos?: readonly SdoEntryInput[]
      slotsSpec?: { downloadModuleIdentList: boolean }
      modules?: ReadonlyArray<{ sdoConfigurations?: readonly SdoEntryInput[] }>
    }>
  }
}

/**
 * The named features EtherDOG advertises. The source of truth is EtherDOG's hello response
 * (`src/control.c`).
 */
export type RuntimeFeature =
  | 'ethercat.dynamic_alloc'
  | 'ethercat.sdo_byte_string'
  | 'ethercat.sdo_complete_access'
  | 'ethercat.scan_modules'

/** Advertisement side of the gate: what the runtime says it can do. */
export interface RuntimeCapabilityAdvertisement {
  /** Whether a runtime is connected. Without one the gate only warns. */
  connected: boolean
  /** Hello response's `features` array, or `undefined` when the runtime did not send one.
   *  Strings outside the {@link RuntimeFeature} union are ignored. */
  advertisedFeatures: readonly string[] | undefined
  /** Why the connected runtime's features could not be read; set only when they are unknown. */
  unavailableReason?: string
}

/** Everything the gate decides from. Primitives only, not a store slice. */
export interface RuntimeCapabilityState {
  /** The features this project uses; see {@link requiredRuntimeFeatures}. */
  requiredFeatures: readonly RuntimeFeature[]
  advertisement: RuntimeCapabilityAdvertisement
}

export type RuntimeCapabilityVerdict =
  | { kind: 'allow'; warning?: string }
  | { kind: 'refuse'; reason: string; missing: RuntimeFeature[] }

const FEATURE_LABELS: Readonly<Record<RuntimeFeature, string>> = {
  'ethercat.dynamic_alloc': 'modular couplers',
  'ethercat.sdo_byte_string': 'byte-string startup SDOs (ESI InitCmds, Complete Access payloads)',
  'ethercat.sdo_complete_access': 'Complete Access SDO writes',
  'ethercat.scan_modules': 'module scan',
}

const describe = (features: readonly RuntimeFeature[]): string => features.map((f) => FEATURE_LABELS[f]).join(', ')

const hasBytes = (e: SdoEntryInput): boolean => e.valueBytes !== undefined && e.valueBytes.length > 0

const rewritesMapping = (pdos: readonly PdoInput[] | undefined): boolean =>
  (pdos ?? []).some((p) => p.assigned !== false && p.fixed !== true && p.entries.length > 0)

/**
 * The runtime features the generated bus configuration will use, following the generator's own
 * rules: a modular coupler needs dynamic allocation; a startup SDO with a byte payload (an ESI
 * InitCmd `<Data>`, a module name) needs byte strings; and with the slave's CompleteAccess flag,
 * the PDO assignment, the PDO mapping rewrite and the `0xF030` module list are each one Complete
 * Access write with a byte payload.
 */
export function requiredRuntimeFeatures(remoteDevices: readonly RemoteDeviceInput[] | undefined): RuntimeFeature[] {
  const required = new Set<RuntimeFeature>()
  for (const remote of remoteDevices ?? []) {
    if (remote.protocol !== 'ethercat') continue
    for (const device of remote.ethercatConfig?.devices ?? []) {
      const modules = device.modules ?? []
      if (modules.length > 0) required.add('ethercat.dynamic_alloc')

      const entries = [
        ...(device.sdoConfigurations ?? []),
        ...(device.esiInitCmdSdos ?? []),
        ...modules.flatMap((m) => m.sdoConfigurations ?? []),
      ]
      for (const entry of entries) {
        if (hasBytes(entry)) required.add('ethercat.sdo_byte_string')
        if (entry.completeAccess === true) required.add('ethercat.sdo_complete_access')
      }

      const flags = device.config?.coeFlags
      if (flags?.completeAccess === true) {
        const pdos = [...(device.rxPdos ?? []), ...(device.txPdos ?? [])]
        const assignment = flags.pdoAssign && pdos.length > 0
        const mapping = flags.pdoConfig && (rewritesMapping(device.rxPdos) || rewritesMapping(device.txPdos))
        const moduleList = modules.length > 0 && device.slotsSpec?.downloadModuleIdentList === true
        if (assignment || mapping || moduleList) {
          required.add('ethercat.sdo_complete_access')
          required.add('ethercat.sdo_byte_string')
        }
      }
    }
  }
  return [...required].sort()
}

/** May the build proceed against the runtime it targets? */
export function evaluateRuntimeCapabilityGate(state: RuntimeCapabilityState): RuntimeCapabilityVerdict {
  const required = [...state.requiredFeatures].sort()
  if (required.length === 0) return { kind: 'allow' }

  if (!state.advertisement.connected) {
    return {
      kind: 'allow',
      warning: `This project requires EtherDOG ${MIN_ETHERDOG_VERSION} or newer on the target (it uses ${describe(required)}).`,
    }
  }

  if (state.advertisement.unavailableReason !== undefined) {
    return {
      kind: 'refuse',
      reason:
        `This project requires EtherDOG ${MIN_ETHERDOG_VERSION} or newer (it uses ${describe(required)}), ` +
        `and the EtherCAT features of the connected runtime could not be read: ` +
        `${state.advertisement.unavailableReason}. Reconnect and build again.`,
      missing: required,
    }
  }

  const advertised = new Set(state.advertisement.advertisedFeatures ?? [])
  const missing = required.filter((f) => !advertised.has(f))
  if (missing.length === 0) return { kind: 'allow' }

  return {
    kind: 'refuse',
    reason:
      `This project requires EtherDOG ${MIN_ETHERDOG_VERSION} or newer: it uses ${describe(missing)}, ` +
      'which the connected runtime does not provide. Update the runtime and reconnect.',
    missing,
  }
}

/** The gate's state from a project's remote devices and the runtime advertisement. */
export function runtimeCapabilityStateFor(args: {
  remoteDevices: readonly RemoteDeviceInput[] | undefined
  advertisement: RuntimeCapabilityAdvertisement
}): RuntimeCapabilityState {
  return {
    requiredFeatures: requiredRuntimeFeatures(args.remoteDevices),
    advertisement: args.advertisement,
  }
}
