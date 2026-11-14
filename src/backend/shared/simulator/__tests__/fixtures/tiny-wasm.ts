/** A minimal WebAssembly encoder for hand-made test modules: functions, imports, one memory and data segments. */

export const I32 = 0x7f
export const I64 = 0x7e

/** Instruction opcodes the tests use. */
export const OP = {
  unreachable: 0x00,
  call: 0x10,
  drop: 0x1a,
  localGet: 0x20,
  i32Load8U: 0x2d,
  i32Store8: 0x3a,
  i32Store: 0x36,
  i32Add: 0x6a,
  i32Const: 0x41,
  i64Const: 0x42,
}

export interface TinyImport {
  module: string
  name: string
  params: number[]
  results: number[]
}

export interface TinyFunction {
  export?: string
  params: number[]
  results: number[]
  body: number[]
}

export interface TinyModule {
  imports?: TinyImport[]
  functions: TinyFunction[]
  /** Exports one page of memory as `memory` unless false. */
  memory?: boolean
  data?: Array<{ offset: number; bytes: number[] }>
}

export function uleb(value: number): number[] {
  const out: number[] = []
  let rest = value
  do {
    let byte = rest & 0x7f
    rest = Math.floor(rest / 128)
    if (rest !== 0) byte |= 0x80
    out.push(byte)
  } while (rest !== 0)
  return out
}

export function sleb(value: number): number[] {
  const out: number[] = []
  let rest = value
  for (;;) {
    const byte = rest & 0x7f
    rest >>= 7
    const done = (rest === 0 && (byte & 0x40) === 0) || (rest === -1 && (byte & 0x40) !== 0)
    out.push(done ? byte : byte | 0x80)
    if (done) return out
  }
}

const text = (value: string): number[] => {
  const bytes = Array.from(new TextEncoder().encode(value))
  return [...uleb(bytes.length), ...bytes]
}

const vector = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()]

const section = (id: number, content: number[]): number[] => [id, ...uleb(content.length), ...content]

const functionType = (params: number[], results: number[]): number[] => [
  0x60,
  ...uleb(params.length),
  ...params,
  ...uleb(results.length),
  ...results,
]

/** Encodes `module`; function indexes count the imports first, in order. */
export function tinyModule(spec: TinyModule): Uint8Array {
  const imports = spec.imports ?? []
  const types = [
    ...imports.map((entry) => functionType(entry.params, entry.results)),
    ...spec.functions.map((fn) => functionType(fn.params, fn.results)),
  ]
  const exportEntries: number[][] = []
  if (spec.memory !== false) exportEntries.push([...text('memory'), 0x02, 0x00])
  spec.functions.forEach((fn, index) => {
    if (fn.export) exportEntries.push([...text(fn.export), 0x00, ...uleb(imports.length + index)])
  })
  const bytes = [
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, vector(types)),
    ...section(
      2,
      vector(imports.map((entry, index) => [...text(entry.module), ...text(entry.name), 0x00, ...uleb(index)])),
    ),
    ...section(3, vector(spec.functions.map((_, index) => uleb(imports.length + index)))),
    ...(spec.memory !== false ? section(5, vector([[0x00, 0x01]])) : []),
    ...section(7, vector(exportEntries)),
    ...section(
      10,
      vector(
        spec.functions.map((fn) => {
          const body = [0x00, ...fn.body, 0x0b]
          return [...uleb(body.length), ...body]
        }),
      ),
    ),
    ...(spec.data && spec.memory !== false
      ? section(
          11,
          vector(
            spec.data.map((segment) => [
              0x00,
              OP.i32Const,
              ...sleb(segment.offset),
              0x0b,
              ...uleb(segment.bytes.length),
              ...segment.bytes,
            ]),
          ),
        )
      : []),
  ]
  return new Uint8Array(bytes)
}

/** `i32.const value`. */
export const i32 = (value: number): number[] => [OP.i32Const, ...sleb(value)]

/** Little-endian bytes of a 32-bit value. */
export const u32le = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  value >>> 24,
]
