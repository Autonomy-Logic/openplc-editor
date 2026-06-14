/**
 * Project IR → Structured Text transpiler.
 *
 * Dispatch:
 *   - Data types, configuration, textual POUs (ST / IL / Python / C++)
 *     emit directly from the IR via `./emit/*`.
 *   - Graphical POUs (LD / FBD) emit via the React Flow walker
 *     (`./walker/`), wrapped by `./emit/pou-graphical.ts`.  SFC is
 *     currently unsupported — `from-schema.ts` throws at projection
 *     time.
 *
 * Callers project their own project shape into `TranspileProject`
 * via `fromSchemaShape` (defined here, against the schema-shape
 * `PLCProjectData` the editor's IPC delivers) — see `from-schema.ts`.
 */

import { generateConfigurations } from './emit/configuration'
import { generateDataTypes } from './emit/data-types'
import { generateGraphicalPou } from './emit/pou-graphical'
import { generateTextualPou } from './emit/pou-textual'
import { buildPouEmissionOrder } from './pou-emission-order'
import type { TranspileProject } from './types'

export { fromSchemaShape, type SchemaProjectData } from './from-schema'
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
export function transpileToSt(project: TranspileProject): TranspileResult {
  const errors: string[] = []
  const warnings: string[] = []
  const pouNames: string[] = []
  const pieces: string[] = []

  // TYPE … END_TYPE — emit IR-native.
  for (const [text] of generateDataTypes(project)) {
    pieces.push(text)
  }

  // Per-POU emission.
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
      if (pou.body.language === 'ld' || pou.body.language === 'fbd') {
        const chunks = generateGraphicalPou(pou, project)
        pieces.push(chunks.map((c) => c[0]).join(''))
        pouNames.push(pou.name)
        continue
      }
      errors.push(`POU "${pou.name}" (${pou.body.language} body): language not supported`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`POU "${pou.name}" (${pou.body.language} body): ${msg}`)
    }
  }

  // Trailing CONFIGURATION block — emit IR-native.
  for (const [text] of generateConfigurations(project)) {
    pieces.push(text)
  }

  if (pouNames.length === 0 && errors.length > 0) {
    return { programSt: null, pouNames, warnings, errors }
  }

  return { programSt: pieces.join(''), pouNames, warnings, errors }
}
