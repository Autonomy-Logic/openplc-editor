/**
 * A hand-made module that starts one Python block as the generated stub does: its setup calls `host_python_block`
 * with the name `Doubler`, a script and two 2-byte buffers, then seeds the outputs with 0x2a; each scan adds one to
 * the first input byte. The block's two output bytes are echoed on the serial line every scan.
 */
import { I32, i32, OP, tinyModule } from './tiny-wasm'

export const NAME = 'Doubler'
export const SCRIPT = 'print("block")'
const NAME_AT = 500
const SCRIPT_AT = 520
export const INPUT_AT = 600
export const OUTPUT_AT = 610

const IMPORTS = [
  { module: 'env', name: 'host_clock_us', params: [], results: [0x7e] },
  { module: 'env', name: 'host_uart_write', params: [I32, I32], results: [] },
  { module: 'env', name: 'host_python_block', params: [I32, I32, I32, I32, I32, I32, I32, I32], results: [I32] },
]
const [, UART_WRITE, PYTHON_BLOCK] = IMPORTS.map((_, index) => index)
const call = (index: number): number[] => [OP.call, index]
const bytes = (value: string): number[] => Array.from(new TextEncoder().encode(value))

export function pythonModule(): Uint8Array {
  const setup = [
    ...i32(NAME_AT),
    ...i32(NAME.length),
    ...i32(SCRIPT_AT),
    ...i32(SCRIPT.length),
    ...i32(INPUT_AT),
    ...i32(2),
    ...i32(OUTPUT_AT),
    ...i32(2),
    ...call(PYTHON_BLOCK),
    OP.drop,
    ...i32(OUTPUT_AT),
    ...i32(0x2a),
    OP.i32Store8,
    0x00,
    0x00,
  ]
  const loop = [
    ...i32(INPUT_AT),
    ...i32(INPUT_AT),
    OP.i32Load8U,
    0x00,
    0x00,
    ...i32(1),
    OP.i32Add,
    OP.i32Store8,
    0x00,
    0x00,
    ...i32(OUTPUT_AT),
    ...i32(2),
    ...call(UART_WRITE),
  ]
  return tinyModule({
    imports: IMPORTS,
    functions: [
      { export: '_initialize', params: [], results: [], body: [] },
      { export: 'sim_setup', params: [], results: [], body: setup },
      { export: 'sim_loop', params: [], results: [], body: loop },
      { export: 'sim_uart_receive', params: [I32], results: [], body: [] },
      { export: 'sim_scan_period_us', params: [], results: [I32], body: i32(10000) },
    ],
    data: [
      { offset: NAME_AT, bytes: bytes(NAME) },
      { offset: SCRIPT_AT, bytes: bytes(SCRIPT) },
    ],
  })
}
