// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Compile-time SoftMotion code generation.
 *
 * Turns each CiA 402 EtherCAT drive (recognized by
 * middleware/shared/utils/ethercat/cia402.ts, opted-in via its
 * Cia402AxisConfig) into the ST glue that lets CODESYS-style application code
 * run unmodified. Axis discovery/naming (`collectAxes`, `sanitizeAxisName`, …)
 * lives in middleware/shared/utils/ethercat/softmotion-axis-naming.ts — this
 * file only owns the codegen that the discovery feeds into:
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
import { collectAxes } from '@root/middleware/shared/utils/ethercat'

export const SM3_BRIDGE_POU_NAME = '__sm3_bridge'
export const SM3_BRIDGE_INSTANCE_NAME = '__sm3_bridge_inst'
const SM3_FALLBACK_TASK: PLCTask = {
  name: '__sm3_task',
  triggering: 'Cyclic',
  interval: 'T#10ms',
  priority: 0,
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

/** POU types that may access a SoftMotion axis global via VAR_EXTERNAL. Functions
 *  are stateless and can't hold VAR_EXTERNAL, so they're excluded. */
const AXIS_EXTERNAL_POU_TYPES = new Set(['program', 'function-block'])

/**
 * Inject a `VAR_EXTERNAL <axis> : AXIS_REF_SM3` into `pou` for every axis in
 * `axisNames` its body references but hasn't already declared — so
 * `MC_*(Axis := <axis>)` resolves without the user declaring the global.
 * Returns the POU unchanged when nothing applies. Programs and function blocks
 * only: strucpp requires a VAR_EXTERNAL to touch a global, and both POU kinds
 * support it (a function can't). Shared by the compiler and the language server
 * so the editor sees exactly what the compiler generates.
 */
export function injectAxisExternals(pou: PLCPou, axisNames: string[]): PLCPou {
  if (!AXIS_EXTERNAL_POU_TYPES.has(pou.pouType)) return pou
  const declared = new Set((pou.interface?.variables ?? []).map((v) => v.name.toUpperCase()))
  const toAdd = axisNames
    .filter((name) => !declared.has(name.toUpperCase()) && bodyReferences(pou.body.value, name))
    .map((name) => external(name, 'AXIS_REF_SM3', 'derived'))
  if (toAdd.length === 0) return pou
  return {
    ...pou,
    interface: { ...pou.interface, variables: [...(pou.interface?.variables ?? []), ...toAdd] },
  }
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

  // Inject a VAR_EXTERNAL for each axis into user programs and function blocks
  // that reference it, so `MC_*(Axis := X_Axis)` resolves without the user
  // declaring the global.
  const axisNames = axes.map((a) => a.axisName)
  const patchedPous = project.pous.map((pou) => injectAxisExternals(pou, axisNames))

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
