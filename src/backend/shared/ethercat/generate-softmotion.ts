// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Compile-time SoftMotion code generation.
 *
 * Turns each CiA 402 EtherCAT drive (recognized by cia402.ts, opted-in via its
 * Cia402AxisConfig) into the ST glue that lets CODESYS-style application code
 * run unmodified:
 *
 *   - an AXIS_REF_SM3 global named after the device (so `MC_Power(Axis := X_Axis)`
 *     resolves directly to the drive),
 *   - a located scalar global per mapped CiA 402 PDO object, bound to the
 *     editor-allocated %I/%Q address,
 *   - a per-scan `__sm3_bridge` PROGRAM (run first each cycle) that calls
 *     SM_Drive_GenericDS402 to marshal the PDO image <-> the axis and apply the
 *     configured scaling.
 *
 * The user never maps an address: the EtherCAT device's name IS the axis name.
 * Called from preprocessPous so every compile path (build/download/deploy/debug)
 * gets the generated artifacts. Pure: returns a new PLCProjectData, never
 * mutates the input.
 */

import type { PLCInstance, PLCPou, PLCProjectData, PLCTask, PLCVariable } from '@root/middleware/shared/ports/types'

import type { Cia402Role } from './cia402'
import { resolveCia402Objects } from './cia402'

export const SM3_BRIDGE_POU_NAME = '__sm3_bridge'
export const SM3_BRIDGE_INSTANCE_NAME = '__sm3_bridge_inst'
const SM3_FALLBACK_TASK: PLCTask = {
  name: '__sm3_task',
  triggering: 'Cyclic',
  interval: 'T#10ms',
  priority: 0,
}

/**
 * Maps a CiA 402 object role to the SM_Drive_GenericDS402 pin it binds and the
 * IEC type the located scalar is declared with. The scalar type is fixed to the
 * bridge pin's type (not the ESI-declared type) so the generated FB call is
 * always type-correct — the PDO byte width is identical either way (a 32-bit
 * position reads the same 4 bytes as DINT or UDINT at the same %QD address).
 * `pinKind` decides `:=` (FB input, drive feedback) vs `=>` (FB output, command).
 */
interface RoleBinding {
  pin: string
  pinKind: 'input' | 'output'
  iecType: string
}
const ROLE_BINDINGS: Record<Cia402Role, RoleBinding> = {
  controlWord: { pin: 'wControlWord', pinKind: 'output', iecType: 'UINT' },
  modesOfOperation: { pin: 'siModes', pinKind: 'output', iecType: 'SINT' },
  targetPosition: { pin: 'diTargetPosition', pinKind: 'output', iecType: 'DINT' },
  profileVelocity: { pin: 'udiProfileVelocity', pinKind: 'output', iecType: 'UDINT' },
  targetVelocity: { pin: 'diTargetVelocity', pinKind: 'output', iecType: 'DINT' },
  targetTorque: { pin: 'iTargetTorque', pinKind: 'output', iecType: 'INT' },
  statusWord: { pin: 'wStatusWord', pinKind: 'input', iecType: 'UINT' },
  modesDisplay: { pin: 'siModesDisplay', pinKind: 'input', iecType: 'SINT' },
  positionActual: { pin: 'diActualPosition', pinKind: 'input', iecType: 'DINT' },
  velocityActual: { pin: 'diActualVelocity', pinKind: 'input', iecType: 'DINT' },
  torqueActual: { pin: 'iActualTorque', pinKind: 'input', iecType: 'INT' },
}

/** Sanitize a device name into a valid IEC 61131-3 identifier. */
export function sanitizeAxisName(name: string): string {
  let s = name.replace(/[^A-Za-z0-9_]/g, '_')
  if (!/^[A-Za-z_]/.test(s)) s = `_${s}`
  return s
}

/**
 * True when `name` is already a valid IEC 61131-3 identifier — a letter or
 * underscore followed by letters, digits, or underscores. A SoftMotion drive's
 * name IS the axis variable name used in `MC_*(Axis := <name>)`, so it must
 * satisfy this (no spaces, hyphens, or leading digits).
 */
export function isValidIecIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

function lrealLiteral(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`
}

function global(name: string, typeValue: string, definition: 'base-type' | 'derived', location: string): PLCVariable {
  return { name, type: { definition, value: typeValue }, location, documentation: '' }
}

/** A VAR_EXTERNAL declaration referencing a configuration global. */
function external(name: string, typeValue: string, definition: 'base-type' | 'derived'): PLCVariable {
  return { name, class: 'external', type: { definition, value: typeValue }, location: '', documentation: '' }
}

/** A POU-local variable (e.g. the bridge FB instance). */
function local(name: string, typeValue: string, definition: 'base-type' | 'derived'): PLCVariable {
  return { name, class: 'local', type: { definition, value: typeValue }, location: '', documentation: '' }
}

/** True when a POU body (ST text or a serialized graphical body) references `identifier`. */
function bodyReferences(bodyValue: unknown, identifier: string): boolean {
  const text = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue ?? '')
  return new RegExp(`\\b${identifier}\\b`).test(text)
}

interface AxisPlan {
  axisName: string
  scaleNum: number
  scaleDenom: number
  scaleFactor: number
  objects: { role: Cia402Role; scalarName: string; iecLocation: string; binding: RoleBinding }[]
}

/** Collect every opted-in, resolvable CiA 402 axis in the project. */
function collectAxes(project: PLCProjectData): AxisPlan[] {
  const plans: AxisPlan[] = []
  const seen = new Set<string>()
  for (const rd of project.remoteDevices ?? []) {
    if (rd.protocol !== 'ethercat') continue
    for (const dev of rd.ethercatConfig?.devices ?? []) {
      if (!dev.cia402?.enabled) continue
      const resolved = resolveCia402Objects(dev.channelInfo ?? [], dev.channelMappings)
      const hasControl = resolved.some((o) => o.role === 'controlWord')
      const hasStatus = resolved.some((o) => o.role === 'statusWord')
      // A drive can only be an axis if both mandatory objects are mapped.
      if (!hasControl || !hasStatus) continue

      const axisName = sanitizeAxisName(dev.name)
      // Skip a duplicate sanitized name to avoid emitting two globals with the
      // same identifier (later devices lose — surfaced by compile if referenced).
      if (seen.has(axisName.toUpperCase())) continue
      seen.add(axisName.toUpperCase())

      plans.push({
        axisName,
        scaleNum: dev.cia402.scaleNum,
        scaleDenom: dev.cia402.scaleDenom,
        scaleFactor: dev.cia402.scaleFactor,
        objects: resolved.map((o) => ({
          role: o.role,
          scalarName: `${axisName}_${o.role}`,
          iecLocation: o.iecLocation,
          binding: ROLE_BINDINGS[o.role],
        })),
      })
    }
  }
  return plans
}

/**
 * Inject generated SoftMotion globals + the per-scan bridge program for every
 * CiA 402 axis in the project. No-op (returns the input) when there are none.
 */
export function generateSoftMotionArtifacts(project: PLCProjectData): PLCProjectData {
  const axes = collectAxes(project)
  if (axes.length === 0) return project

  const newGlobals: PLCVariable[] = []
  const bridgeVars: PLCVariable[] = []
  const bodyLines: string[] = []

  for (const axis of axes) {
    // AXIS_REF_SM3 instance (the name used in MC_*(Axis := ...)) — a config
    // global; the bridge reaches it via VAR_EXTERNAL.
    newGlobals.push(global(axis.axisName, 'AXIS_REF_SM3', 'derived', ''))
    bridgeVars.push(external(axis.axisName, 'AXIS_REF_SM3', 'derived'))

    bodyLines.push(`(* ---- SoftMotion axis ${axis.axisName} ---- *)`)
    // Apply configured scaling each scan (device config is authoritative).
    bodyLines.push(`${axis.axisName}.iRatioTechUnitsNum := DINT#${Math.trunc(axis.scaleNum)};`)
    bodyLines.push(`${axis.axisName}.dwRatioTechUnitsDenom := DWORD#${Math.trunc(axis.scaleDenom)};`)
    bodyLines.push(`${axis.axisName}.fScalefactor := ${lrealLiteral(axis.scaleFactor)};`)

    const inBinds: string[] = []
    const outBinds: string[] = []
    for (const obj of axis.objects) {
      const iecType = obj.binding.iecType.toLowerCase()
      // located scalar global bound to the drive PDO address...
      newGlobals.push(global(obj.scalarName, iecType, 'base-type', obj.iecLocation))
      // ...and the bridge's VAR_EXTERNAL view of it.
      bridgeVars.push(external(obj.scalarName, iecType, 'base-type'))
      if (obj.binding.pinKind === 'input') inBinds.push(`${obj.binding.pin} := ${obj.scalarName}`)
      else outBinds.push(`${obj.binding.pin} => ${obj.scalarName}`)
    }

    const fbInstance = `${axis.axisName}_drive`
    bridgeVars.push(local(fbInstance, 'SM_Drive_GenericDS402', 'derived'))
    const binds = [`Axis := ${axis.axisName}`, ...inBinds, 'bOnline := TRUE', ...outBinds]
    bodyLines.push(`${fbInstance}(`)
    bodyLines.push(`\t${binds.join(',\n\t')});`)
  }

  const bridgePou: PLCPou = {
    name: SM3_BRIDGE_POU_NAME,
    pouType: 'program',
    interface: { variables: bridgeVars },
    body: { language: 'st', value: bodyLines.join('\n') },
    documentation: 'Auto-generated SoftMotion drive bridge — do not edit; regenerated each compile.',
  }

  // Inject a VAR_EXTERNAL for each axis into user programs that reference it, so
  // `MC_*(Axis := X_Axis)` resolves without the user declaring the global.
  const patchedPous = project.pous.map((pou) => {
    if (pou.pouType !== 'program') return pou
    const declared = new Set((pou.interface?.variables ?? []).map((v) => v.name.toUpperCase()))
    const toAdd = axes
      .filter((a) => !declared.has(a.axisName.toUpperCase()) && bodyReferences(pou.body.value, a.axisName))
      .map((a) => external(a.axisName, 'AXIS_REF_SM3', 'derived'))
    if (toAdd.length === 0) return pou
    return {
      ...pou,
      interface: { ...pou.interface, variables: [...(pou.interface?.variables ?? []), ...toAdd] },
    }
  })

  const resource = project.configurations.resource
  // Ensure a task exists to run the bridge, then attach the bridge instance at
  // the FRONT of the instance list so it runs before user POUs each scan
  // (fresh PDO feedback in, commands out).
  const tasks = resource.tasks.length > 0 ? resource.tasks : [SM3_FALLBACK_TASK]
  const bridgeInstance: PLCInstance = {
    name: SM3_BRIDGE_INSTANCE_NAME,
    task: tasks[0].name,
    program: SM3_BRIDGE_POU_NAME,
  }

  return {
    ...project,
    pous: [...patchedPous, bridgePou],
    configurations: {
      ...project.configurations,
      resource: {
        ...resource,
        tasks,
        globalVariables: [...resource.globalVariables, ...newGlobals],
        instances: [bridgeInstance, ...resource.instances],
      },
    },
  }
}
