/** A hand-made module on the simulator's host interface: its setup writes to stdout and stderr and reports four WASI
 * results on the serial line, its serial input echoes back, and its loop and scan period are the caller's. */
import { I32, I64, i32, OP, type TinyFunction, tinyModule, u32le, uleb } from './tiny-wasm'

const HOST_IMPORTS = [
  { module: 'env', name: 'host_clock_us', params: [], results: [I64] },
  { module: 'env', name: 'host_uart_write', params: [I32, I32], results: [] },
  { module: 'wasi_snapshot_preview1', name: 'fd_write', params: [I32, I32, I32, I32], results: [I32] },
  { module: 'wasi_snapshot_preview1', name: 'proc_exit', params: [I32], results: [] },
  { module: 'wasi_snapshot_preview1', name: 'fd_seek', params: [I32, I64, I32, I32], results: [I32] },
  { module: 'wasi_snapshot_preview1', name: 'fd_close', params: [I32], results: [I32] },
  { module: 'wasi_snapshot_preview1', name: 'random_get', params: [I32, I32], results: [I32] },
]
export const [CLOCK, UART_WRITE, FD_WRITE, PROC_EXIT, FD_SEEK, FD_CLOSE, RANDOM_GET] = HOST_IMPORTS.map(
  (_, index) => index,
)

export const call = (index: number): number[] => [OP.call, ...uleb(index)]
const store8 = (address: number, value: number[]): number[] => [...i32(address), ...value, OP.i32Store8, 0x00, 0x00]

/** Writes `hi\nthere` to stdout and `err\n` to stderr, then reports four WASI results on the serial line. */
const SETUP = [
  ...i32(1),
  ...i32(16),
  ...i32(1),
  ...i32(32),
  ...call(FD_WRITE),
  OP.drop,
  ...i32(2),
  ...i32(40),
  ...i32(1),
  ...i32(32),
  ...call(FD_WRITE),
  OP.drop,
  ...store8(200, [...i32(5), ...i32(16), ...i32(1), ...i32(32), ...call(FD_WRITE)]),
  ...store8(201, [...i32(1), OP.i64Const, 0x00, ...i32(0), ...i32(32), ...call(FD_SEEK)]),
  ...store8(202, [...i32(1), ...call(FD_CLOSE)]),
  ...store8(203, [...i32(0), ...i32(0), ...call(RANDOM_GET)]),
  ...i32(200),
  ...i32(4),
  ...call(UART_WRITE),
]

const TEXT = (value: string): number[] => Array.from(new TextEncoder().encode(value))

export interface HostModuleOptions {
  loop?: number[]
  periodUs?: number
  omit?: string
}

export function hostModule(options: HostModuleOptions = {}): Uint8Array {
  const functions: TinyFunction[] = [
    { export: '_initialize', params: [], results: [], body: [] },
    { export: 'sim_setup', params: [], results: [], body: SETUP },
    { export: 'sim_loop', params: [], results: [], body: options.loop ?? [...call(CLOCK), OP.drop] },
    {
      export: 'sim_uart_receive',
      params: [I32],
      results: [],
      body: [...store8(100, [OP.localGet, 0x00]), ...i32(100), ...i32(1), ...call(UART_WRITE)],
    },
    { export: 'sim_scan_period_us', params: [], results: [I32], body: i32(options.periodUs ?? 20000) },
  ].filter((fn) => fn.export !== options.omit)
  return tinyModule({
    imports: HOST_IMPORTS,
    functions,
    data: [
      { offset: 16, bytes: [...u32le(64), ...u32le(8)] },
      { offset: 40, bytes: [...u32le(80), ...u32le(4)] },
      { offset: 64, bytes: TEXT('hi\nthere') },
      { offset: 80, bytes: TEXT('err\n') },
    ],
  })
}
