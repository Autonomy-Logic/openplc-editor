// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Library debug harness — turns a Library Project into a runnable PLC
 * Project that exercises every block the library ships.
 *
 * A library has no program of its own, so there is nothing to run and
 * nothing to attach a debugger to.  This module synthesises the
 * missing piece: a `LIBDBG_MAIN` program declaring ONE instance of
 * every function block in the library, a task, and a configuration
 * instance to hold it.  Compiled for the in-process simulator, that
 * project produces exactly the artefacts a debug session already
 * consumes — firmware plus a `debug-map.json` whose leaves are the
 * blocks' own members.  The author then forces inputs and watches
 * outputs through the existing debugger, per instance.
 *
 * Everything downstream of here is machinery that already shipped.
 * `buildFbInstanceMap` finds these instances because they are plain
 * `derived`-typed variables on a program POU; `useDebugCompositeKey`
 * rewrites a block editor's variable names onto the selected
 * instance; the watch table and the polling filter resolve through
 * the same map.  Giving every block exactly one instance is what
 * makes all of that work with no picker to teach.
 *
 * Deliberately NOT covered: standalone FUNCTIONs.  Binding a
 * function's inputs and return value into the harness means
 * synthesising a call site and a local per parameter, which is real
 * complexity for a block kind that has no state to watch between
 * scans.  An author who wants to exercise a function writes a small
 * wrapper function block that calls it — that gives them full control
 * over what the inputs are set to, and the results become readable
 * through the same FB-instance path as everything else.
 *
 * Pure: no IPC, no electron, no disk.  Same rules as
 * `middleware/shared/utils/iec-address` — this file is byte-identical
 * on openplc-web.
 */

import type { PLCInstance, PLCPou, PLCProjectData, PLCTask, PLCVariable } from '../../ports/types'

// ---------------------------------------------------------------------------
// Reserved identifiers
// ---------------------------------------------------------------------------

/**
 * The harness owns the `LIBDBG_` prefix.  These names are visible to
 * the author — a forced input reads as `LIBDBG_INST.MY_FB_I.SETPOINT`
 * in the debug tree — so they are a (small) UX surface, not just an
 * internal detail.  Chosen to be obviously synthetic and unlikely to
 * collide with a library's own identifiers; a collision is handled
 * regardless, see `uniqueName`.
 */
export const HARNESS_PROGRAM_NAME = 'LIBDBG_MAIN'
export const HARNESS_TASK_NAME = 'LIBDBG_TASK'
export const HARNESS_INSTANCE_NAME = 'LIBDBG_INST'

/** Suffix appended to a block's name to form its instance variable. */
const INSTANCE_SUFFIX = '_I'
/** Suffix pattern for the local backing a block's VAR_IN_OUT member. */
const INOUT_SUFFIX = '_IO_'

/**
 * Scan interval for the harness task.  Fast enough that a forced
 * input shows its effect on the next poll (the debugger polls on the
 * order of 100 ms), slow enough that the emulated ATmega2560 is not
 * spending every cycle in the scan loop.
 */
const DEFAULT_SCAN_INTERVAL = 'T#100ms'

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** One library block wired into the harness. */
export interface LibraryDebugHarnessBlock {
  /** Function block name exactly as the author wrote it. */
  pouName: string
  /** Harness variable holding this block's single instance. */
  instanceVariable: string
}

/** One library POU the harness left out, and why. */
export interface LibraryDebugHarnessSkip {
  pouName: string
  /** Sentence fragment, rendered to the console as a warning. */
  reason: string
}

export interface LibraryDebugHarness {
  /**
   * Port-shape project data for the synthetic PLC project: the
   * library's own POUs plus `LIBDBG_MAIN`, with the resource carrying
   * the harness task and instance.  Feed this to
   * `CompilerPort.compileProgram` with `isSimulator: true`.
   */
  projectData: PLCProjectData
  /** The synthesised program POU's name (also present in `projectData.pous`). */
  programName: string
  /** The configuration instance holding the program. */
  instanceName: string
  /** The task driving the instance. */
  taskName: string
  /** Blocks instantiated, in the order they appear in the library. */
  blocks: LibraryDebugHarnessBlock[]
  /** POUs deliberately left out.  Empty when everything was eligible. */
  skipped: LibraryDebugHarnessSkip[]
}

export interface ComposeLibraryDebugHarnessOptions {
  /**
   * Restrict the harness to these block names (case-insensitive).
   * Omitted means every eligible block.  Exists for the case where a
   * library is too large to fit the simulator and the author picks a
   * subset; nothing drives it yet.
   */
  include?: readonly string[]
  /** Override the harness task's cyclic interval.  Testing hook. */
  scanInterval?: string
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Build the harness project.  Never throws and never returns a
 * partially-formed project: when no block is eligible the result
 * carries `blocks: []` and the caller refuses with a message rather
 * than compiling a program that does nothing.
 */
export function composeLibraryDebugHarness(
  libraryData: PLCProjectData,
  options: ComposeLibraryDebugHarnessOptions = {},
): LibraryDebugHarness {
  const includeSet = options.include === undefined ? null : new Set(options.include.map((name) => name.toUpperCase()))

  const skipped: LibraryDebugHarnessSkip[] = []
  const blocks: LibraryDebugHarnessBlock[] = []
  const variables: PLCVariable[] = []
  const statements: string[] = []

  // Every name the harness program declares, so a second block whose
  // generated name collides gets a numeric suffix instead of silently
  // shadowing the first.
  const taken = new Set<string>()

  for (const pou of libraryData.pous) {
    if (pou.pouType !== 'function-block') {
      // Functions and (impossible in a library, but cheap to state)
      // programs are not instantiable state — see the module header.
      continue
    }
    if (includeSet !== null && !includeSet.has(pou.name.toUpperCase())) continue

    // The AVR simulator ships no Python interpreter.  Preprocessing
    // for a simulator target lowers a Python POU to a `first_run := 0;`
    // no-op, so instantiating one would put a block in the debug tree
    // that looks live and never computes anything — worse than leaving
    // it out and saying so.
    if (pou.body.language === 'python') {
      skipped.push({
        pouName: pou.name,
        reason: 'Python blocks cannot run on the simulator, so this block is not in the harness.',
      })
      continue
    }

    const instanceVariable = uniqueName(`${pou.name.toUpperCase()}${INSTANCE_SUFFIX}`, taken)
    variables.push(harnessVariable(instanceVariable, { definition: 'derived', value: pou.name }))

    // VAR_IN_OUT members are references the caller has to bind — a bare
    // `MY_FB_I();` with one unbound fails to compile.  Give each one a
    // harness local of the same type and bind it at the call site, so
    // the author can force the local and watch the block read it.
    const inOutBindings: string[] = []
    for (const member of pou.interface?.variables ?? []) {
      if (member.class !== 'inOut') continue
      const backing = uniqueName(`${pou.name.toUpperCase()}${INOUT_SUFFIX}${member.name.toUpperCase()}`, taken)
      variables.push(harnessVariable(backing, member.type))
      inOutBindings.push(`${member.name} := ${backing}`)
    }

    statements.push(
      inOutBindings.length > 0 ? `${instanceVariable}(${inOutBindings.join(', ')});` : `${instanceVariable}();`,
    )
    blocks.push({ pouName: pou.name, instanceVariable })
  }

  const programName = uniqueProgramName(libraryData.pous)
  const harnessProgram: PLCPou = {
    name: programName,
    pouType: 'program',
    interface: { variables },
    body: {
      language: 'st',
      // A program with no statements is rejected by the transpiler, and
      // an empty harness never reaches the compiler anyway — the caller
      // refuses on `blocks.length === 0`.  The fallback keeps the body
      // syntactically valid for that unreachable path rather than
      // emitting an empty PROGRAM.
      value: statements.length > 0 ? statements.join('\n') : '(* no blocks to exercise *)\n;',
    },
    documentation: 'Generated harness — instantiates every library block once for debugging.',
  }

  const task: PLCTask = {
    name: HARNESS_TASK_NAME,
    triggering: 'Cyclic',
    interval: options.scanInterval ?? DEFAULT_SCAN_INTERVAL,
    priority: 1,
  }
  const instance: PLCInstance = {
    name: HARNESS_INSTANCE_NAME,
    program: programName,
    task: HARNESS_TASK_NAME,
  }

  return {
    // The library's own tasks / instances are dropped rather than
    // merged: a library project has none (the create flow ships empty
    // lists for `plc-library`), and anything that did survive an import
    // would reference a program the library cannot contain.
    projectData: {
      ...libraryData,
      pous: [...libraryData.pous, harnessProgram],
      configurations: {
        resource: {
          ...libraryData.configurations.resource,
          tasks: [task],
          instances: [instance],
        },
      },
    },
    programName,
    instanceName: HARNESS_INSTANCE_NAME,
    taskName: HARNESS_TASK_NAME,
    blocks,
    skipped,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A harness variable is always a watched local: `debug: true` puts it
 * in the watch table the moment the session opens, which is the whole
 * point of the harness — the author should not have to tick a box per
 * block before seeing anything.
 */
function harnessVariable(name: string, type: PLCVariable['type']): PLCVariable {
  return {
    name,
    class: 'local',
    type,
    location: '',
    documentation: '',
    debug: true,
  }
}

/**
 * Claim `base`, or the first `base_2`, `base_3`, … that is free.
 * Compared case-insensitively because IEC identifiers are.
 */
function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base
  let counter = 2
  while (taken.has(candidate.toUpperCase())) {
    candidate = `${base}_${counter}`
    counter += 1
  }
  taken.add(candidate.toUpperCase())
  return candidate
}

/**
 * `LIBDBG_MAIN`, unless the library already ships a POU by that name —
 * in which case the harness yields and takes a suffixed one, rather
 * than producing a project with two POUs of the same name.
 */
function uniqueProgramName(pous: readonly PLCPou[]): string {
  const existing = new Set(pous.map((pou) => pou.name.toUpperCase()))
  let candidate = HARNESS_PROGRAM_NAME
  let counter = 2
  while (existing.has(candidate.toUpperCase())) {
    candidate = `${HARNESS_PROGRAM_NAME}_${counter}`
    counter += 1
  }
  return candidate
}
