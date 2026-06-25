/**
 * Minimal IR consumed by the JSON-fed transpiler.
 *
 * Decoupled from both `middleware/shared/ports/types.ts` (port shape,
 * what the renderer store holds) and `backend/shared/types/PLC/open-plc.ts`
 * (schema shape, what `project.json` persists).  Callers project their
 * own shape into `TranspileProject` via the adapter helpers
 * (`from-schema.ts` here for the editor's IPC payload; openplc-web
 * ships a `transpile-from-port.ts` under middleware for its port-shape
 * renderer payload).
 *
 * Carries ONLY the fields the transpiler actually reads — no
 * `servers`, no `remoteDevices`, no `libraries`, no `debugVariables`.
 * That makes the surface small, the projections cheap, and the
 * transpiler stable when the renderer eventually migrates between
 * shapes (only the adapters change; this IR doesn't).
 */

/* ─────────────────────────── project ────────────────────────────────────── */

export interface TranspileProject {
  dataTypes: TranspileDataType[]
  pous: TranspilePou[]
  configuration: {
    tasks: TranspileTask[]
    instances: TranspileInstance[]
    globalVariables: TranspileVariable[]
  }
}

/* ─────────────────────────── pou ────────────────────────────────────────── */

export type TranspilePouKind = 'program' | 'function' | 'function-block'
export type TranspileBodyLanguage = 'st' | 'il' | 'ld' | 'fbd' | 'sfc' | 'python' | 'cpp'

export interface TranspilePou {
  name: string
  pouType: TranspilePouKind
  documentation?: string
  /** Empty for POUs with no parameters / locals. */
  interface: TranspilePouInterface
  body: TranspileBody
}

export interface TranspilePouInterface {
  /** Only set on `function` POUs. */
  returnType?: string
  variables: TranspileVariable[]
}

/**
 * Body payload — discriminated by `language`:
 *
 *   - Textual ('st' | 'il' | 'python' | 'cpp') carry `value: string`
 *     (raw source) — the transpiler emits the IEC text directly.
 *
 *   - Graphical ('ld' | 'fbd') carry the raw React Flow body
 *     (`{ rungs: [...] }` for LD, `{ rung: {...} }` for FBD) that the
 *     editor stores on disk under `pous/<type>s/<name>.{ld,fbd}`.
 *     The walker in `./walker/` consumes this shape directly — no
 *     PLCOpen XML intermediate.
 *
 *   The plain-object shape is structured-clonable so the IR rides
 *   the worker boundary verbatim.
 */
export type TranspileBody =
  | {
      language: 'st' | 'il' | 'python' | 'cpp'
      value: string
    }
  | {
      language: 'ld'
      value: import('./walker/types').RFBody
    }
  | {
      language: 'fbd'
      value: import('./walker/fbd').RFFbdBody
    }

/* ──────────────────────────── variable ──────────────────────────────────── */

export type TranspileVariableClass = 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp'

export interface TranspileVariable {
  name: string
  type: TranspileVariableType
  class?: TranspileVariableClass
  /** IEC located address (`%QX0.0`, `%IW3`, …). */
  location?: string
  /** Raw initial-value text — caller-supplied, no quote-wrapping. */
  initialValue?: string
  documentation?: string
}

/* ──────────────────────────── variable type ─────────────────────────────── */

/**
 * - `base-type`        — elementary IEC type (`BOOL`, `INT`, `STRING`, …)
 * - `array`            — `ARRAY [a..b, …] OF T`
 * - `derived` /
 *   `user-data-type`   — referenced data-type name (struct/enum/subrange)
 */
export type TranspileVariableType =
  | { definition: 'base-type'; value: string }
  | { definition: 'derived' | 'user-data-type'; value: string }
  | {
      definition: 'array'
      data: {
        dimensions: { dimension: string }[]
        baseType: string | { value: string }
      }
    }

/* ──────────────────────────── data type ─────────────────────────────────── */

export type TranspileDataType =
  | {
      name: string
      derivation: 'array'
      dimensions: { dimension: string }[]
      baseType: string | { value: string }
      initialValue?: string
    }
  | {
      name: string
      derivation: 'enumerated'
      values: { description: string }[]
      initialValue?: string
    }
  | {
      name: string
      derivation: 'structure'
      variable: TranspileVariable[]
      initialValue?: string
    }
  | {
      name: string
      derivation: 'directly-derived'
      baseType: string
      initialValue?: string
    }

/* ──────────────────────────── configuration ─────────────────────────────── */

export interface TranspileTask {
  name: string
  priority: number
  /** Triggering mode: 'Cyclic' uses `interval`; 'Interrupt' uses `single`. */
  triggering: 'Cyclic' | 'Interrupt'
  interval?: string
  /** Source signal expression for non-Cyclic tasks (mapped to SINGLE/MULTI). */
  single?: string
}

export interface TranspileInstance {
  /** Instance name (`instance0`). */
  name: string
  /** POU type the instance references (`main`). */
  program: string
  /** Task this instance binds to.  Empty / unset → no task assignment
   *  (instance lives directly under the resource). */
  task?: string
}
