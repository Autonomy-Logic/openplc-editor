/**
 * STruC++ debug-path helpers — OPC-UA module only.
 *
 * STruC++ emits hierarchical leaf paths in debug-map.json under a single
 * convention: `<INSTANCE_NAME>.<MEMBER>...`, all uppercase, with `[i]`
 * for array elements and `.` for struct/FB members. There's no
 * `RES0__` / `CONFIG0__` prefix and no `.value.` shim — the codegen
 * walks fields uniformly regardless of FB vs struct, so callers no
 * longer need a fallback.
 *
 * Globals (VAR_GLOBAL in the CONFIG block) live at the top level of
 * the project model and are addressed by their plain name (no
 * instance prefix). The editor distinguishes them via the pseudo-
 * pouName "GVL" / "CONFIG" (the same convention used by the
 * variable-tree builder).
 */

import type { DebugVariable } from './types'

export interface PLCInstanceMapping {
  name: string
  program: string
}

export function findInstanceName(
  pouName: string,
  instances: Array<{ name: string; program: string }>,
): string | null {
  const inst = instances.find((i) => i.program.toUpperCase() === pouName.toUpperCase())
  return inst ? inst.name : null
}

/**
 * Build the leaf path for a per-instance variable.
 * STruC++ walks variable paths uniformly (no FB/struct distinction),
 * so this is a straightforward `<INSTANCE>.<PATH>` join with each
 * dot-segment uppercased and array brackets passed through.
 */
export function buildDebugPath(instanceName: string, variablePath: string): string {
  const parts = variablePath.split('.')
  const upper = parts.map((p) => {
    // Preserve trailing [N] on a segment but uppercase the name part.
    const m = p.match(/^([^[]+)(\[\d+\])?$/)
    if (!m) return p.toUpperCase()
    return m[1].toUpperCase() + (m[2] ?? '')
  })
  return [instanceName.toUpperCase(), ...upper].join('.')
}

/**
 * Build the leaf path for a global variable. STruC++'s leaves table
 * keys globals by their bare name (uppercased) — no instance prefix.
 */
export function buildGlobalDebugPath(variablePath: string): string {
  const parts = variablePath.split('.')
  return parts
    .map((p) => {
      const m = p.match(/^([^[]+)(\[\d+\])?$/)
      if (!m) return p.toUpperCase()
      return m[1].toUpperCase() + (m[2] ?? '')
    })
    .join('.')
}

/**
 * Look up a leaf in debug-map.json's leaves[] by exact path match
 * (case-insensitive — paths are uppercased by the codegen but caller
 * input may not be). Returns null if not found.
 */
export function findDebugVariable(
  debugVariables: DebugVariable[],
  expectedPath: string,
): DebugVariable | null {
  const upperPath = expectedPath.toUpperCase()
  return debugVariables.find((dv) => dv.path.toUpperCase() === upperPath) ?? null
}
