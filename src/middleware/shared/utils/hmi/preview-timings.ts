/**
 * One line that says where a preview build spent its time, for the Console and the preview test: the build steps, the
 * files the toolchain compiled (slowest first) and, once the module ran, its start and first frame.
 */
import type { HmiPreviewTimings } from '../../ports/hmi-preview-types'
import type { WasmCompileStats } from '../../ports/wasm-toolchain-types'

/** How long the built module took to start in its Worker and to draw its first frame, in ms. */
export interface HmiPreviewRunTimings {
  startMs: number
  firstFrameMs: number
}

const ms = (value: number): string => String(Math.round(value))
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The timings of a preview build as one line. */
export function formatHmiPreviewTimings(
  timings: HmiPreviewTimings,
  stats?: WasmCompileStats,
  run?: HmiPreviewRunTimings,
): string {
  const parts = [
    `files ${ms(timings.sourcesMs)}`,
    `generate ${ms(timings.generateMs)} (widget blocks ${ms(timings.widgetsMs)}, STruC++ ${ms(timings.strucppMs)})`,
    `fonts ${ms(timings.fontsMs)}`,
  ]
  if (stats) {
    const compiled = (stats.jobs ?? []).filter((j) => !j.cached).sort((a, b) => b.ms - a.ms)
    const files = compiled.map((j) => `${fileName(j.source)} ${ms(j.ms)}`).join(', ')
    parts.push(
      `toolchain ${ms(timings.toolchainMs)} (compile ${ms(stats.compileMs)}, link ${ms(stats.linkMs)}; ` +
        `${stats.units - stats.cached} of ${stats.units} compiled${files === '' ? '' : `: ${files}`})`,
    )
  } else {
    parts.push(`toolchain ${ms(timings.toolchainMs)}`)
  }
  const total = timings.totalMs + (run ? run.startMs + run.firstFrameMs : 0)
  if (run) parts.push(`start ${ms(run.startMs)}`, `first frame ${ms(run.firstFrameMs)}`)
  return `HMI preview built in ${ms(total)} ms: ${parts.join(', ')}`
}
