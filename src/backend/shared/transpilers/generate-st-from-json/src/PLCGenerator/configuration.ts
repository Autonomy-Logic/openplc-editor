/**
 * CONFIGURATION / RESOURCE emission.
 *
 * Port of `ProgramGenerator.GenerateConfiguration` (PLCGenerator.py:334)
 * and `ProgramGenerator.GenerateResource` (PLCGenerator.py:451).
 *
 * Emits the trailing `\nCONFIGURATION … END_CONFIGURATION\n` block of an
 * ST program — global variables, resources, tasks, and PROGRAM
 * instance bindings. Mirrors Python's chunk model: each fragment is a
 * `[text, location]` pair where `location` is a variable-arity tuple
 * pointing back at the source-XML element for editor cursor mapping.
 *
 * **Beremiz CTN-injected globals**: hosts that need to inject extra
 * configuration globals at emission time (the Beremiz path through
 * `Controler.GetConfigurationExtraVariables`) can pass a
 * `ConfigurationExtraVariablesProvider` via the options bag — see
 * `ctn_globals.ts`. The same bucketing Python applies at
 * PLCGenerator.py:345-360 (TC6-library `<globalVars>` go in verbatim;
 * `(name, type, initial)` tuples synthesize into a single trailing
 * `<globalVars>`) is performed here.
 */

import {
  getaddress,
  getconfigurations,
  getconstant,
  getcontentOfType,
  getglobalVars,
  getinitialValue,
  getinterval,
  getname,
  getnonretain,
  getpouInstance,
  getpriority,
  getresource,
  getretain,
  getsingle,
  gettask,
  gettype,
  gettypeName,
  getvalue,
  getvariable,
} from '../plcopen/accessors'
import type { ProjectTree } from '../plcopen/plcopen'
import { type Element } from '../xmlclass/xsdschema'
import { getLocalTag } from '../xmlclass/xsdschema'
import { type ConfigurationExtraVariablesProvider, resolveExtraVarLists } from './ctn_globals'
import { computeValue } from './pou_assembly'
import type { ProgramChunk } from './program'
import { computeConfigurationName, computeConfigurationResourceName } from './text_helpers'
import { gettypeAsText } from './type_text'

/* ─────────────────────────── GenerateConfiguration ──────────────────────── */

export interface GenerateConfigurationOptions {
  /**
   * Beremiz CTN-injected globals provider. When supplied, mirrors the
   * `Controler.GetConfigurationExtraVariables` hook Python invokes at
   * PLCGenerator.py:345.
   */
  extraVarsProvider?: ConfigurationExtraVariablesProvider | null
}

/**
 * Emit the full `CONFIGURATION … END_CONFIGURATION\n` chunk list for a
 * single `<configuration>` element. Mirrors PLCGenerator.py:334-448.
 */
export function generateConfiguration(
  configuration: Element,
  project: ProjectTree | Element | null,
  options: GenerateConfigurationOptions = {},
): ProgramChunk[] {
  const name = getname(configuration) ?? ''
  const tagname = computeConfigurationName(name)
  const config: ProgramChunk[] = []
  config.push(['\nCONFIGURATION ', []])
  config.push([name, [tagname, 'name']])
  config.push(['\n', []])

  // Global variables under the configuration (rare in practice — most
  // projects only declare globals on the <resource>) plus any CTN-
  // injected extras. The provider is invoked exactly once per
  // configuration; null falls back to the parsed-XML varlists only.
  emitGlobalVarLists(
    config,
    configuration,
    project,
    tagname,
    /*indent=*/ '  ',
    /*varIndent=*/ '    ',
    options.extraVarsProvider ?? null,
  )

  // Resources.
  for (const resource of getresource(configuration)) {
    config.push(...generateResource(resource, name, project))
  }

  config.push(['END_CONFIGURATION\n', []])
  return config
}

/* ─────────────────────────── GenerateResource ───────────────────────────── */

/**
 * Emit the `\n  RESOURCE … END_RESOURCE\n` chunk list for a single
 * `<resource>` element. Mirrors PLCGenerator.py:451-628.
 */
export function generateResource(
  resource: Element,
  configName: string,
  project: ProjectTree | Element | null,
): ProgramChunk[] {
  const name = getname(resource) ?? ''
  const tagname = computeConfigurationResourceName(configName, name)
  const out: ProgramChunk[] = []
  out.push(['\n  RESOURCE ', []])
  out.push([name, [tagname, 'name']])
  out.push([' ON PLC\n', []])

  // Resource-scope global vars are NOT augmented by the CTN provider
  // — Python only consults the provider for configuration-scope
  // globals (PLCGenerator.py:345 is inside GenerateConfiguration,
  // not GenerateResource).
  emitGlobalVarLists(out, resource, project, tagname, /*indent=*/ '    ', /*varIndent=*/ '      ', /*provider=*/ null)

  // Tasks.
  const tasks = gettask(resource)
  let taskNumber = 0
  for (const task of tasks) {
    out.push(['    TASK ', []])
    out.push([getname(task) ?? '', [tagname, 'task', taskNumber, 'name']])
    out.push(['(', []])

    const single = getsingle(task)
    if (single !== null) {
      if (single.length === 0) {
        throw new Error(
          `Source signal has to be defined for single task '${getname(task) ?? ''}' in resource '${configName}.${name}'.`,
        )
      }
      const snglkw = single.startsWith('[') && single.endsWith(']') ? 'MULTI' : 'SINGLE'
      out.push([`${snglkw} := `, []])
      out.push([single, [tagname, 'task', taskNumber, 'single']])
      out.push([',', []])
    }

    const interval = getinterval(task)
    if (interval !== null) {
      out.push(['INTERVAL := ', []])
      out.push([interval, [tagname, 'task', taskNumber, 'interval']])
      out.push([',', []])
    }

    const priority = getpriority(task) ?? 0
    out.push(['PRIORITY := ', []])
    out.push([`${priority}`, [tagname, 'task', taskNumber, 'priority']])
    out.push([');\n', []])

    taskNumber++
  }

  // Programs assigned to tasks.
  let instanceNumber = 0
  for (const task of tasks) {
    for (const instance of getpouInstance(task)) {
      out.push(['    PROGRAM ', []])
      out.push([getname(instance) ?? '', [tagname, 'instance', instanceNumber, 'name']])
      out.push([' WITH ', []])
      out.push([getname(task) ?? '', [tagname, 'instance', instanceNumber, 'task']])
      out.push([' : ', []])
      out.push([gettypeName(instance) ?? '', [tagname, 'instance', instanceNumber, 'type']])
      out.push([';\n', []])
      instanceNumber++
    }
  }

  // Programs declared directly under the resource (no task assignment).
  for (const instance of getpouInstance(resource)) {
    out.push(['    PROGRAM ', []])
    out.push([getname(instance) ?? '', [tagname, 'instance', instanceNumber, 'name']])
    out.push([' : ', []])
    out.push([gettypeName(instance) ?? '', [tagname, 'instance', instanceNumber, 'type']])
    out.push([';\n', []])
    instanceNumber++
  }

  out.push(['  END_RESOURCE\n', []])
  return out
}

/* ─────────────────────── shared globalVars emitter ──────────────────────── */

/**
 * Emit every `<globalVars>` block under `parent` (which is either a
 * `<configuration>` or `<resource>`) as a `VAR_GLOBAL … END_VAR` chunk
 * sequence. `indent` controls the keyword indent (`  ` for config,
 * `    ` for resource); `varIndent` controls the per-variable indent
 * (`    ` for config, `      ` for resource).  These widths come
 * straight from PLCGenerator.py:366 and 463.
 */
function emitGlobalVarLists(
  out: ProgramChunk[],
  parent: Element,
  project: ProjectTree | Element | null,
  tagname: string,
  indent: string,
  varIndent: string,
  provider: ConfigurationExtraVariablesProvider | null,
): void {
  const variableType = 'var_local'
  let varNumber = 0
  const baseVarLists = getglobalVars(parent)
  const varLists =
    provider !== null && project !== null ? resolveExtraVarLists(baseVarLists, provider, project) : baseVarLists
  for (const varlist of varLists) {
    const variables = getvariable(varlist)
    out.push([`${indent}VAR_GLOBAL`, []])
    const range: [number, number] = [varNumber, varNumber + variables.length]
    if (getconstant(varlist)) {
      out.push([' CONSTANT', [tagname, variableType, range, 'constant']])
    } else if (getretain(varlist)) {
      out.push([' RETAIN', [tagname, variableType, range, 'retain']])
    } else if (getnonretain(varlist)) {
      out.push([' NON_RETAIN', [tagname, variableType, range, 'non_retain']])
    }
    out.push(['\n', []])

    for (const variable of variables) {
      const typeEl = gettype(variable)
      const varTypeContent = typeEl ? getcontentOfType(typeEl) : null
      const varType =
        varTypeContent && getLocalTag(varTypeContent) === 'derived'
          ? (getname(varTypeContent) ?? '')
          : (gettypeAsText(variable) ?? '')

      out.push([varIndent, []])
      out.push([getname(variable) ?? '', [tagname, variableType, varNumber, 'name']])
      out.push([' ', []])

      const address = getaddress(variable)
      if (address) {
        out.push(['AT ', []])
        out.push([address, [tagname, variableType, varNumber, 'location']])
        out.push([' ', []])
      }

      out.push([': ', []])
      out.push([gettypeAsText(variable) ?? '', [tagname, variableType, varNumber, 'type']])

      const initial = getinitialValue(variable)
      if (initial !== null) {
        const value = getvalue(initial) ?? ''
        out.push([' := ', []])
        out.push([computeValue(project, value, varType), [tagname, variableType, varNumber, 'initial value']])
      }
      out.push([';\n', []])
      varNumber++
    }
    out.push([`${indent}END_VAR\n`, []])
  }
}

/* ───────────────────────── project-level helper ─────────────────────────── */

/**
 * Iterate every `<configuration>` in the project and concatenate the
 * `generateConfiguration` chunks. Mirrors PLCGenerator.py:656-658
 * (the loop at the tail of `ProgramGenerator.GenerateProgram`).
 */
export function generateConfigurations(
  project: ProjectTree | Element,
  options: GenerateConfigurationOptions = {},
): ProgramChunk[] {
  const chunks: ProgramChunk[] = []
  for (const cfg of getconfigurations(project)) {
    chunks.push(...generateConfiguration(cfg, project, options))
  }
  return chunks
}
