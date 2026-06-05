/**
 * Beremiz CTN-injected configuration globals.
 *
 * Port of `Controler.GetConfigurationExtraVariables`
 * (PLCControler.py:1248-1285) and the bucketing loop in
 * `ProgramGenerator.GenerateConfiguration`
 * (PLCGenerator.py:345-360).
 *
 * The Python pipeline lets the host (Beremiz) inject extra
 * configuration-level globals at compile time:
 *   - Pre-built `<globalVars>` elements (TC6 libraries) flow straight
 *     through into the configuration's varlist loop.
 *   - `(name, type, initial)` tuples (CTN globals) are synthesized
 *     into one `<variable>` each, then wrapped in a synthesized
 *     `<globalVars>` element appended after the existing varlists.
 *
 * In `xml2st`'s standalone build the underlying
 * `GetConfNodeGlobalInstances` is stubbed to `[]`, so observable
 * behaviour against the existing Python oracle is unchanged. The
 * mechanism is still ported so hosts (openplc-web / openplc-editor
 * wiring up plugins that need globals) can plug into the same
 * pipeline.
 */

import { DOMImplementation } from '@xmldom/xmldom'

import type { ProjectTree } from '../plcopen/plcopen'
import type { Element } from '../xmlclass/xsdschema'

/**
 * IEC 61131-3 elementary base types, mirroring
 * `Controler.GetBaseTypes()` (which derives from `TypeHierarchy_list`
 * in `plcopen/definitions.py:84`). Used to decide whether a CTN
 * global tuple's `type` resolves to an elementary `<TYPE/>` element
 * or a `<derived name="…"/>` wrapper.
 *
 * Identical to Python — `WSTRING` is intentionally absent (the
 * Python list has it commented out at definitions.py:118).
 */
export const PLC_BASE_TYPES: ReadonlySet<string> = new Set([
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
])

/**
 * Tuple shape Beremiz hands back from `GetConfNodeGlobalInstances`
 * (PLCControler.py:1253) — `(name, type, initial)`. Mirrored as a
 * record for readability; `initial` is optional because Python uses
 * `""` to mean "no initial value".
 */
export interface CtnGlobalVarTuple {
  name: string
  /** Elementary type name (`'BOOL'`, `'INT'`, …) or a derived-type name. */
  type: string
  /** ST source for the initial value (`''` omits `:= …`). */
  initial?: string
}

/**
 * One entry returned by a CTN-globals provider. Either a pre-built
 * `<globalVars>` DOM element (Python's TC6-library path) or a single
 * tuple to be synthesized into a `<variable>` (Python's CTN-global
 * path).
 */
export type CtnGlobalEntry =
  | { kind: 'varlist'; varlist: Element }
  | { kind: 'variable'; variable: CtnGlobalVarTuple }

/**
 * Host-provided source of CTN-injected configuration globals. Mirrors
 * `Controler.GetConfNodeGlobalInstances` followed by
 * `GetConfigurationExtraVariables`. Called once per configuration
 * during emission; the return value's order is preserved.
 */
export type ConfigurationExtraVariablesProvider = () => CtnGlobalEntry[]

const TC6_NS = 'http://www.plcopen.org/xml/tc6_0201'

/**
 * Resolve a CTN provider's output into the final flat varlist array
 * that `generateConfiguration` should iterate.
 *
 * The first array is the parsed-XML varlists `getglobalVars()` already
 * gave us. Onto that we tack:
 *   1. Every `kind: 'varlist'` entry verbatim.
 *   2. One synthesized `<globalVars>` element wrapping every
 *      `kind: 'variable'` entry's freshly-built `<variable>` child —
 *      but only when there is at least one such tuple, mirroring
 *      Python's `if len(extra_CTN_globals) > 0` guard at
 *      PLCGenerator.py:354.
 */
export function resolveExtraVarLists(
  baseVarLists: Element[],
  provider: ConfigurationExtraVariablesProvider | null | undefined,
  project: ProjectTree | Element,
): Element[] {
  if (!provider) return baseVarLists
  const entries = provider()
  if (entries.length === 0) return baseVarLists

  const out = [...baseVarLists]
  const tupleVars: CtnGlobalVarTuple[] = []
  for (const entry of entries) {
    if (entry.kind === 'varlist') {
      out.push(entry.varlist)
    } else {
      tupleVars.push(entry.variable)
    }
  }
  if (tupleVars.length > 0) {
    out.push(synthesizeGlobalVarsElement(tupleVars, project))
  }
  return out
}

/**
 * Build a `<globalVars>` DOM element with one `<variable>` child per
 * tuple. Mirrors `Controler.GetConfigurationExtraVariables`'s
 * `<variable>` factory loop (PLCControler.py:1254-1280) and its
 * "wrap in globalVars" step (PLCGenerator.py:355-360). The element
 * carries no `constant`/`retain`/`nonretain` modifier — same as
 * Python's `PLCOpenParser.CreateElement("globalVars", "interface")`.
 */
function synthesizeGlobalVarsElement(
  tuples: readonly CtnGlobalVarTuple[],
  project: ProjectTree | Element,
): Element {
  const doc = getOwnerDocument(project)
  const wrapper = doc.createElementNS(TC6_NS, 'globalVars')
  for (const tuple of tuples) {
    wrapper.appendChild(synthesizeVariableElement(doc, tuple))
  }
  return wrapper
}

/**
 * Build a single `<variable name="…"><type>…</type>[<initialValue>…]</variable>`
 * element. Type selection mirrors PLCControler.py:1258-1273 exactly:
 *   - Elementary base type → `<TYPE/>` (or `<string/>` / `<wstring/>` lower-cased).
 *   - Anything else → `<derived name="X"/>`.
 *
 * Initial values are wrapped in `<simpleValue value="…"/>` to match
 * the shape `getvalue()` reads back (plcopen.py:3398 simpleValue
 * branch). Empty initial values are omitted entirely, matching
 * Python's `if var_initial != ""` guard.
 */
function synthesizeVariableElement(
  doc: ReturnType<typeof getOwnerDocument>,
  tuple: CtnGlobalVarTuple,
): Element {
  const variable = doc.createElementNS(TC6_NS, 'variable')
  variable.setAttribute('name', tuple.name)

  const typeEl = doc.createElementNS(TC6_NS, 'type')
  if (PLC_BASE_TYPES.has(tuple.type)) {
    const localName =
      tuple.type === 'STRING' || tuple.type === 'WSTRING'
        ? tuple.type.toLowerCase()
        : tuple.type
    typeEl.appendChild(doc.createElementNS(TC6_NS, localName))
  } else {
    const derived = doc.createElementNS(TC6_NS, 'derived')
    derived.setAttribute('name', tuple.type)
    typeEl.appendChild(derived)
  }
  variable.appendChild(typeEl)

  if (tuple.initial && tuple.initial.length > 0) {
    const ivEl = doc.createElementNS(TC6_NS, 'initialValue')
    const simple = doc.createElementNS(TC6_NS, 'simpleValue')
    simple.setAttribute('value', tuple.initial)
    ivEl.appendChild(simple)
    variable.appendChild(ivEl)
  }

  return variable
}

/**
 * Return a Document we can call `createElementNS` on. The project
 * argument can be either a `Document` (the parsed tree itself, when
 * loaded via `LoadProjectXML`) or any `Element` inside that tree —
 * we walk to `ownerDocument` in the latter case. When the host
 * passes neither (e.g. tests that build a project by hand without
 * a Document), we fall back to a fresh `DOMImplementation`.
 */
function getOwnerDocument(project: ProjectTree | Element) {
  if ('createElementNS' in project) return project
  const owner = (project).ownerDocument
  if (owner) return owner
  return new DOMImplementation().createDocument(TC6_NS, 'project', null)
}
