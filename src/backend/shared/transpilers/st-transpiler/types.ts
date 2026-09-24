/**
 * Minimal IR consumed by the JSON-fed transpiler, decoupled from both the port shape and the
 * `project.json` schema shape via adapter helpers (`from-schema.ts`, `../transpile-from-port.ts`).
 * Carries only the fields the transpiler reads — no `servers`, `remoteDevices`, `libraries`, etc.
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
  /** Base function block, from `FUNCTION_BLOCK X EXTENDS Y`. */
  extends?: string
  variables: TranspileVariable[]
}

/**
 * Body payload, discriminated by `language`: textual languages carry raw source `value: string`;
 * graphical ('ld'/'fbd') carry the raw React Flow body the walker in `./walker/` consumes directly.
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
  /**
   * IEC block qualifier (absent = plain `VAR`). IEC puts the qualifier on the var *block*, so
   * this is a bucketing key for `computeInterface`'s emission, not a per-line annotation.
   */
  flag?: TranspileVariableFlag
}

/** Mirrors `VariableFlag` in middleware/shared/ports/types.ts. */
export type TranspileVariableFlag = 'constant' | 'retain'

/* ──────────────────────────── variable type ─────────────────────────────── */

/** `base-type` = elementary IEC type; `array` = `ARRAY [a..b, …] OF T`; `derived`/`user-data-type` = referenced data-type name. */
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
