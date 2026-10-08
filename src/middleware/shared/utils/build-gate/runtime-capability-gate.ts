/**
 * DOPE-704 E7 — target-capability gate.
 *
 * EtherDOG from RTOP-319 R4 onwards advertises its feature set in its hello response.
 * This gate asks "does the runtime the project is being built for advertise every
 * feature the project uses?" and refuses the build if not, naming the missing features
 * so the user knows which EtherDOG version they need.
 *
 * The gate exists because a modular-coupler project built with E5's generator emits
 * `0xF030` and (eventually) byte-string `InitCmd` writes that a pre-R2 EtherDOG does
 * not know how to send — and the failure, if the gate did not catch it, would land on
 * the bus thread as "slave did not reach SAFE_OP" with no indication that the runtime
 * is simply too old.
 *
 * Shape mirrors `vpp-backplane-gate` and `pre-build-plc-gate`: state in, verdict out,
 * no store, no HTTP, no dialog. Byte-identical with openplc-web.
 *
 * Backward compatibility (BR24): a plain-slave project built against pre-R4 EtherDOG
 * must continue to build. When `advertisedFeatures` is `undefined` (the hello response
 * did not carry a `features` array, which pre-R4 EtherDOG does not), the gate allows
 * the build and the compile step may still emit a warning that the runtime is older.
 * A plain-slave project needs no new features anyway, so the gate stays allow in that
 * common case regardless of what the runtime advertises.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'

/**
 * The named features EtherDOG advertises. The source of truth is RTOP-319's hello
 * response in `src/control.c` of EtherDOG. New entries land here when the runtime
 * grows a new capability the editor's generator wants to use.
 */
export type RuntimeFeature =
  | 'ethercat.dynamic_alloc'
  | 'ethercat.sdo_byte_string'
  | 'ethercat.sdo_complete_access'
  | 'ethercat.scan_modules'

/** Advertisement side of the gate — what the runtime says it can do. */
export interface RuntimeCapabilityAdvertisement {
  /** Hello response's `features` array, or `undefined` for pre-R4 EtherDOG. */
  advertisedFeatures: readonly RuntimeFeature[] | undefined
  /** EtherDOG version string, used in the refusal message. `undefined` is pre-R4. */
  runtimeVersion?: string
}

/** Everything the gate decides from. Primitives only, not a store slice. */
export interface RuntimeCapabilityState {
  /**
   * The features this project uses, derived from its EtherCAT configuration.
   * Produced by {@link requiredRuntimeFeatures}.
   */
  requiredFeatures: readonly RuntimeFeature[]
  advertisement: RuntimeCapabilityAdvertisement
}

export type RuntimeCapabilityVerdict = { kind: 'allow' } | { kind: 'refuse'; reason: string; missing: RuntimeFeature[] }

/**
 * Walks the project's remote devices and returns every runtime feature the generator
 * will need in order to produce a bus config this project's shape demands. Deliberately
 * conservative: a plain-slave project returns `[]` so the gate stays allow against every
 * EtherDOG.
 *
 * Detection rules:
 *   - **modular coupler** (`device.modules?` non-empty) → requires `dynamic_alloc` and
 *     `sdo_byte_string`. A UR20-class station has module-count × 32 extra PDO entries
 *     and typical module InitCmd writes carry byte-string payloads (the module name at
 *     `0x80n0:03` is the obvious case).
 *   - **explicit byte-string SDO** (any `sdoConfigurations` entry marked byte-string
 *     via the dedicated field) → requires `sdo_byte_string`. The field does not yet
 *     exist on `SDOConfigurationEntry`; the branch is in place so adding the field is
 *     a one-line change that lights the detector up without a gate rewrite.
 *   - **explicit complete-access SDO** → requires `sdo_complete_access`. Same
 *     structural point: the field does not yet exist on the model, the detector is
 *     ready for it.
 */
export function requiredRuntimeFeatures(remoteDevices: readonly PLCRemoteDevice[] | undefined): RuntimeFeature[] {
  if (!remoteDevices || remoteDevices.length === 0) return []
  const required = new Set<RuntimeFeature>()

  for (const remote of remoteDevices) {
    if (remote.protocol !== 'ethercat') continue
    const devices = remote.ethercatConfig?.devices
    if (!devices) continue

    for (const device of devices) {
      if (device.modules && device.modules.length > 0) {
        required.add('ethercat.dynamic_alloc')
        required.add('ethercat.sdo_byte_string')
      }

      // Byte-string / complete-access flags are not yet persisted on
      // SDOConfigurationEntry; when they land they do not change this detector,
      // only the branch condition. Kept defensive so a future shape change can
      // be a one-line edit at the type definition.
      const scanEntries = (
        entries: readonly {
          readonly value?: string
          readonly completeAccess?: boolean
          readonly valueBytes?: string
        }[],
      ): void => {
        for (const entry of entries) {
          if (entry.valueBytes !== undefined) required.add('ethercat.sdo_byte_string')
          if (entry.completeAccess === true) required.add('ethercat.sdo_complete_access')
        }
      }

      if (device.sdoConfigurations) scanEntries(device.sdoConfigurations)
      if (device.modules) {
        for (const module of device.modules) {
          if (module.sdoConfigurations) scanEntries(module.sdoConfigurations)
        }
      }
    }
  }

  return [...required].sort()
}

/** May the compile step proceed against the runtime it was pointed at? */
export function evaluateRuntimeCapabilityGate(state: RuntimeCapabilityState): RuntimeCapabilityVerdict {
  if (state.requiredFeatures.length === 0) return { kind: 'allow' }

  // Pre-R4 EtherDOG does not advertise features at all. Pre-R4 is also pre-R1/R2/R3,
  // so a project with modules or byte-string SDOs cannot run on it. Refuse by naming
  // all required features and asking the user to upgrade.
  if (state.advertisement.advertisedFeatures === undefined) {
    const missing = [...state.requiredFeatures].sort()
    return {
      kind: 'refuse',
      reason:
        `This project uses EtherCAT features the connected runtime does not advertise: ` +
        `${missing.join(', ')}. Upgrade EtherDOG to a version that supports them` +
        (state.advertisement.runtimeVersion !== undefined
          ? ` (current: ${state.advertisement.runtimeVersion}).`
          : ' and reconnect.'),
      missing,
    }
  }

  const advertised = new Set(state.advertisement.advertisedFeatures)
  const missing = state.requiredFeatures.filter((f) => !advertised.has(f)).sort()
  if (missing.length === 0) return { kind: 'allow' }

  return {
    kind: 'refuse',
    reason:
      `This project uses EtherCAT features the connected runtime does not advertise: ` +
      `${missing.join(', ')}. Upgrade EtherDOG to a version that supports them` +
      (state.advertisement.runtimeVersion !== undefined
        ? ` (current: ${state.advertisement.runtimeVersion}).`
        : ' and reconnect.'),
    missing,
  }
}

/**
 * Convenience: the full state built from a project's remoteDevices and an advertisement.
 *
 * The compile step holds both halves — the project data at the point it is calling the
 * generator, and the runtime hello captured when the user connected — so passing them
 * through this helper keeps the call site readable.
 */
export function runtimeCapabilityStateFor(args: {
  remoteDevices: readonly PLCRemoteDevice[] | undefined
  advertisement: RuntimeCapabilityAdvertisement
}): RuntimeCapabilityState {
  return {
    requiredFeatures: requiredRuntimeFeatures(args.remoteDevices),
    advertisement: args.advertisement,
  }
}
