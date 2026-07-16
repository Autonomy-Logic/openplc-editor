// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * SoftMotion axis discovery & naming — the pure, platform-agnostic half of
 * compile-time SoftMotion code generation (see
 * `backend/shared/ethercat/generate-softmotion.ts` for the codegen itself).
 *
 * Lives here rather than alongside the codegen because it's also needed by
 * the ST LSP (go-to-definition, ambient axis globals) and the store's device
 * rename validation — none of which may import `backend/shared/` directly.
 */

import type { PLCProjectData } from '@root/middleware/shared/ports/types'

import type { Cia402Role } from './cia402'
import { resolveCia402Objects } from './cia402'

/**
 * Maps a CiA 402 object role to the SM_Drive_GenericDS402 pin it binds and the
 * IEC type the located scalar is declared with. The scalar type is fixed to the
 * bridge pin's type (not the ESI-declared type) so the generated FB call is
 * always type-correct — the PDO byte width is identical either way (a 32-bit
 * position reads the same 4 bytes as DINT or UDINT at the same %QD address).
 * `pinKind` decides `:=` (FB input, drive feedback) vs `=>` (FB output, command).
 */
export interface RoleBinding {
  pin: string
  pinKind: 'input' | 'output'
  iecType: string
}
export const ROLE_BINDINGS: Record<Cia402Role, RoleBinding> = {
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

export interface AxisPlan {
  axisName: string
  scaleNum: number
  scaleDenom: number
  scaleFactor: number
  objects: { role: Cia402Role; scalarName: string; iecLocation: string; binding: RoleBinding }[]
}

/** Collect every opted-in, resolvable CiA 402 axis in the project. */
export function collectAxes(project: PLCProjectData): AxisPlan[] {
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

/** Sanitized names of every enabled, resolvable CiA 402 axis in the project. */
export function softMotionAxisNames(project: PLCProjectData): string[] {
  return collectAxes(project).map((a) => a.axisName)
}

/**
 * Serialize the SoftMotion axis globals as a standalone ST configuration for the
 * language server. Each CiA 402 drive becomes a `VAR_GLOBAL <name> : AXIS_REF_SM3`
 * so editor code referencing the axis (e.g. `MC_Power(Axis := X_Axis)`) resolves
 * against the same public axis the compiler generates — without the user
 * declaring anything. Returns '' when the project has no axes.
 *
 * Emitted as a **bare top-level `VAR_GLOBAL` block** (not wrapped in a
 * CONFIGURATION): strucpp registers top-level global blocks into the ambient
 * global scope, so a POU can reference the axis directly — no `VAR_EXTERNAL`
 * needed, which is what keeps the editor documents byte-for-byte what the user
 * wrote (no injected declarations shifting line numbers). Only the axis
 * references are declared (not the located PDO scalar globals) — those are
 * internal to the generated drive bridge and never named in user code.
 * `AXIS_REF_SM3` itself comes from the bundled plcopen-softmotion stlib the LSP
 * already ingests.
 *
 * The declaration order matches `softMotionAxisNames`, so line N+1 of this
 * document (line 0 is `VAR_GLOBAL`) is axis N — the go-to-definition redirect
 * relies on that to map a click back to its drive.
 */
export function serializeSoftMotionAxisGlobalsToST(project: PLCProjectData): string {
  const axes = collectAxes(project)
  if (axes.length === 0) return ''

  const decls = axes.map((a) => `  ${a.axisName} : AXIS_REF_SM3;`).join('\n')
  return ['VAR_GLOBAL', decls, 'END_VAR', ''].join('\n')
}
