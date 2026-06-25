/**
 * IR-native `CONFIGURATION … END_CONFIGURATION` block emitter.
 *
 * Walks `TranspileProject.configuration` and emits byte-identical
 * chunks against the python oracle's `ProgramGenerator.GenerateConfiguration`
 * + `GenerateResource` (PLCGenerator.py:334-628).
 *
 * The IR carries exactly one configuration with one resource, named
 * `Config0` / `Res0` — same hardcoded names the python oracle
 * produces.  Global vars are emitted under the configuration block
 * (not under the resource).
 */

import type { ProgramChunk } from '../helpers/program'
import { computeConfigurationName, computeConfigurationResourceName } from '../helpers/text-helpers'
import type { TranspileProject, TranspileVariable } from '../types'
import { declaredTypeName, getTypeAsText } from './type-text'
import { computeValue } from './value'

const CONFIG_NAME = 'Config0'
const RESOURCE_NAME = 'Res0'

/**
 * Emit the trailing `\nCONFIGURATION … END_CONFIGURATION\n` block.
 * Returns an empty array when the IR carries no tasks / instances /
 * globals (caller may still want the keyword shell — Python always
 * emits the block; we mirror that).
 */
export function generateConfigurations(project: TranspileProject): ProgramChunk[] {
  const configTagname = computeConfigurationName(CONFIG_NAME)
  const resourceTagname = computeConfigurationResourceName(CONFIG_NAME, RESOURCE_NAME)

  const out: ProgramChunk[] = []

  out.push(['\nCONFIGURATION ', []])
  out.push([CONFIG_NAME, [configTagname, 'name']])
  out.push(['\n', []])

  // Configuration-level global variables.
  emitGlobalVarList(
    out,
    project.configuration.globalVariables,
    configTagname,
    /*indent=*/ '  ',
    /*varIndent=*/ '    ',
    project,
  )

  // RESOURCE block.  The IR has exactly one resource (`Res0`).
  out.push(['\n  RESOURCE ', []])
  out.push([RESOURCE_NAME, [resourceTagname, 'name']])
  out.push([' ON PLC\n', []])

  // Resource-scope globals are not in the IR today (Python supports
  // them; we don't surface a field for them yet).  Skipping the
  // resource-level VAR_GLOBAL emit matches `irToPlcOpenXml`'s
  // current shape.

  // Tasks.
  project.configuration.tasks.forEach((task, taskNumber) => {
    out.push(['    TASK ', []])
    out.push([task.name, [resourceTagname, 'task', taskNumber, 'name']])
    out.push(['(', []])

    if (task.triggering !== 'Cyclic') {
      const single = task.single ?? ''
      if (single.length === 0) {
        throw new Error(
          `Source signal has to be defined for single task '${task.name}' in resource '${CONFIG_NAME}.${RESOURCE_NAME}'.`,
        )
      }
      const snglkw = single.startsWith('[') && single.endsWith(']') ? 'MULTI' : 'SINGLE'
      out.push([`${snglkw} := `, []])
      out.push([single, [resourceTagname, 'task', taskNumber, 'single']])
      out.push([',', []])
    }

    if (task.interval !== undefined) {
      out.push(['INTERVAL := ', []])
      out.push([task.interval, [resourceTagname, 'task', taskNumber, 'interval']])
      out.push([',', []])
    }

    out.push(['PRIORITY := ', []])
    out.push([`${task.priority}`, [resourceTagname, 'task', taskNumber, 'priority']])
    out.push([');\n', []])
  })

  // PROGRAM bindings — first the task-bound instances (in task
  // iteration order, then instance order within each task), then the
  // task-less instances directly under the resource.
  let instanceNumber = 0
  for (const task of project.configuration.tasks) {
    for (const instance of project.configuration.instances) {
      if (instance.task !== task.name) continue
      out.push(['    PROGRAM ', []])
      out.push([instance.name, [resourceTagname, 'instance', instanceNumber, 'name']])
      out.push([' WITH ', []])
      out.push([task.name, [resourceTagname, 'instance', instanceNumber, 'task']])
      out.push([' : ', []])
      out.push([instance.program, [resourceTagname, 'instance', instanceNumber, 'type']])
      out.push([';\n', []])
      instanceNumber++
    }
  }
  for (const instance of project.configuration.instances) {
    if (instance.task !== undefined && instance.task !== '') continue
    out.push(['    PROGRAM ', []])
    out.push([instance.name, [resourceTagname, 'instance', instanceNumber, 'name']])
    out.push([' : ', []])
    out.push([instance.program, [resourceTagname, 'instance', instanceNumber, 'type']])
    out.push([';\n', []])
    instanceNumber++
  }

  out.push(['  END_RESOURCE\n', []])
  out.push(['END_CONFIGURATION\n', []])
  return out
}

/* ────────────────────── helpers ─────────────────────────────────────────── */

function emitGlobalVarList(
  out: ProgramChunk[],
  variables: TranspileVariable[],
  tagname: string,
  indent: string,
  _varIndent: string,
  project: TranspileProject,
): void {
  if (variables.length === 0) return

  const variableType = 'var_local'
  const range: [number, number] = [0, variables.length]

  out.push([`${indent}VAR_GLOBAL`, []])
  // CONSTANT / RETAIN / NON_RETAIN modifiers come from the
  // <globalVars> wrapper in the DOM path; the IR doesn't surface
  // per-list modifiers today (only the bare variable list).
  void range
  void tagname
  out.push(['\n', []])

  variables.forEach((variable, idx) => {
    out.push([_varIndent, []])
    out.push([variable.name, [tagname, variableType, idx, 'name']])
    out.push([' ', []])

    if (variable.location) {
      out.push(['AT ', []])
      out.push([variable.location, [tagname, variableType, idx, 'location']])
      out.push([' ', []])
    }

    out.push([': ', []])
    out.push([getTypeAsText(variable), [tagname, variableType, idx, 'type']])

    if (variable.initialValue !== undefined && variable.initialValue !== '') {
      const declaredType = declaredTypeName(variable)
      out.push([' := ', []])
      out.push([
        computeValue(project, variable.initialValue, declaredType),
        [tagname, variableType, idx, 'initial value'],
      ])
    }
    out.push([';\n', []])
  })

  out.push([`${indent}END_VAR\n`, []])
}
