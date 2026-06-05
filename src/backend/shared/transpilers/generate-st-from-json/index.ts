/**
 * PLCOpen JSON → Structured Text transpiler.
 *
 * Phase 1 dispatch:
 *   - Data types, configuration, textual POUs (ST / IL / Python / C++)
 *     emit DIRECTLY from the IR via `ir-emit/*`.  No DOM round-trip.
 *   - Graphical POUs (LD / FBD / SFC) still use the DOM-based walker
 *     from the XML-fed sibling (`src/PLCGenerator/`) — for those we
 *     synthesise a minimum-viable PLCOpen project DOM containing
 *     just the data types + POUs the graphical walker needs to do
 *     its type-inference (`computeConnectionTypes`) and block-library
 *     lookups, then run `generateProgram` against the POU element.
 *
 * Subsequent phases (2-4) replace the LD / FBD / SFC walkers with
 * JSON-native ones, at which point `ir-to-plcopen-xml.ts` and the
 * whole `src/` subdirectory get deleted.
 *
 * Callers project their own project shape into `TranspileProject`
 * via `fromSchemaShape` (defined here, against the schema-shape
 * `PLCProjectData` the editor's IPC delivers) — see `from-schema.ts`.
 */

import { type GenerateConfigurationOptions, generateConfigurations } from './ir-emit/configuration'
import { generateDataTypes } from './ir-emit/data-types'
import { generateGraphicalPou } from './ir-emit/pou-graphical'
import { generateTextualPou } from './ir-emit/pou-textual'
import { irToPlcOpenDom } from './ir-to-plcopen-dom'
import { buildPouEmissionOrder } from './pou-emission-order'
import { generateProgram } from './src/PLCGenerator/pou_assembly'
import { getbody, getcontent, getname, getpous } from './src/plcopen/accessors'
import type { ProjectTree } from './src/plcopen/plcopen'
import type { TranspileProject } from './types'

export { fromSchemaShape, type SchemaProjectData } from './from-schema'
export type {
  ConfigurationExtraVariablesProvider,
  CtnGlobalEntry,
  CtnGlobalVarTuple,
} from './src/PLCGenerator/ctn_globals'
export type {
  TranspileBody,
  TranspileBodyLanguage,
  TranspileDataType,
  TranspileInstance,
  TranspilePou,
  TranspilePouInterface,
  TranspilePouKind,
  TranspileProject,
  TranspileTask,
  TranspileVariable,
  TranspileVariableClass,
  TranspileVariableType,
} from './types'

export type TranspileOptions = GenerateConfigurationOptions

export interface TranspileResult {
  /** Concatenated Structured Text, or `null` if no POU compiled. */
  programSt: string | null
  /** Names of POUs that compiled successfully, in emission order. */
  pouNames: string[]
  /** Non-fatal diagnostics (skipped empty bodies, missing libraries, …). */
  warnings: string[]
  /**
   * Per-POU compile errors (and any project-level load error). Empty when
   * every POU compiled cleanly.
   */
  errors: string[]
}

const TEXTUAL_LANGUAGES = new Set(['st', 'il', 'python', 'cpp'])

/**
 * Walk a `TranspileProject` and emit Structured Text for every data
 * type, POU, and configuration.  Pure function — no I/O, no
 * network, safe to call in the browser / Web Worker.
 *
 * Throws synchronously only on internal invariant failures; per-POU
 * compile errors land in `result.errors` and the rest of the
 * program still emits.
 */
export function transpileToSt(project: TranspileProject, options: TranspileOptions = {}): TranspileResult {
  const errors: string[] = []
  const warnings: string[] = []
  const pouNames: string[] = []
  const pieces: string[] = []

  // Lazily build a DOM project IFF we need it for graphical POUs.
  // Phase 2: built directly via DOMImplementation — no XML string
  // serialise / parse cycle.
  let domCache: ProjectTree | null = null
  const ensureDom = (): ProjectTree | null => {
    if (domCache) return domCache
    try {
      domCache = irToPlcOpenDom(project) as unknown as ProjectTree
      return domCache
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`Failed to build project DOM for graphical walker: ${msg}`)
      return null
    }
  }

  // TYPE … END_TYPE — emit IR-native.
  for (const [text] of generateDataTypes(project)) {
    pieces.push(text)
  }

  // Per-POU emission.  Textual bodies use the IR-native emitter;
  // graphical bodies still use the DOM-based walker against a
  // synthesised project DOM.
  //
  // Iteration order mirrors python's lazy / on-reference scheme
  // (`PLCGenerator.GeneratePouProgram`, PLCGenerator.py:302):
  // dependencies (POUs whose names appear inside another POU's body
  // or as a derived-type variable declaration) are emitted BEFORE
  // their dependents.  See `pou_emission_order.ts`.
  const orderedPous = buildPouEmissionOrder(project.pous)
  for (const pou of orderedPous) {
    try {
      if (TEXTUAL_LANGUAGES.has(pou.body.language)) {
        const chunks = generateTextualPou(pou, project)
        pieces.push(chunks.map((c) => c[0]).join(''))
        pouNames.push(pou.name)
        continue
      }
      // Graphical POU.  When the adapter populated `ldBody` (LD/FBD
      // only — SFC still flows through the DOM walker), use the
      // JSON-native walker.  Otherwise fall back to the DOM walker.
      if (
        (pou.body.language === 'ld' || pou.body.language === 'fbd') &&
        'ldBody' in pou.body &&
        pou.body.ldBody !== undefined
      ) {
        const chunks = generateGraphicalPou(pou, pou.body.ldBody, project)
        pieces.push(chunks.map((c) => c[0]).join(''))
        pouNames.push(pou.name)
        continue
      }
      const tree = ensureDom()
      if (!tree) {
        errors.push(`POU "${pou.name}" (${pou.body.language} body): DOM build failed for graphical walker`)
        continue
      }
      const domPou = findDomPou(tree, pou.name)
      if (!domPou) {
        errors.push(`POU "${pou.name}" not found in synthesised DOM`)
        continue
      }
      const bodies = getbody(domPou)
      if (bodies.length === 0) {
        warnings.push(`POU "${pou.name}" has no <body>; skipped`)
        continue
      }
      const content = getcontent(bodies[0])
      if (!content) {
        warnings.push(`POU "${pou.name}" has empty body content; skipped`)
        continue
      }
      const chunks = generateProgram(domPou, { project: tree })
      pieces.push(chunks.map((c) => c[0]).join(''))
      pouNames.push(pou.name)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`POU "${pou.name}" (${pou.body.language} body): ${msg}`)
    }
  }

  // Trailing CONFIGURATION block — emit IR-native.
  for (const [text] of generateConfigurations(project, options)) {
    pieces.push(text)
  }

  if (pouNames.length === 0 && errors.length > 0) {
    return { programSt: null, pouNames, warnings, errors }
  }

  return { programSt: pieces.join(''), pouNames, warnings, errors }
}

function findDomPou(tree: ProjectTree, name: string) {
  for (const pou of getpous(tree)) {
    if (getname(pou) === name) return pou
  }
  return null
}
