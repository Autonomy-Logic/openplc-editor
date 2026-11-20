import { formatHmiPreviewTimings } from '../preview-timings'

const timings = {
  sourcesMs: 0.4,
  generateMs: 23.2,
  widgetsMs: 4.6,
  strucppMs: 12.1,
  fontsMs: 1.2,
  toolchainMs: 612.7,
  totalMs: 640.3,
}

describe('formatHmiPreviewTimings', () => {
  it('names every step and the compiled files, slowest first, with the start and first frame', () => {
    const line = formatHmiPreviewTimings(
      timings,
      {
        units: 14,
        cached: 12,
        compileMs: 580.4,
        linkMs: 31.6,
        jobs: [
          { source: 'hmi/core/hmi_theme.c', ms: 0, cached: true },
          { source: 'groups/glue.cpp', ms: 291.2, cached: false },
          { source: 'groups/screen_Details.cpp', ms: 252.9, cached: false },
          { source: 'hmi/core/hmi_core.c', ms: 0, cached: true },
        ],
      },
      { startMs: 20.2, firstFrameMs: 3.6 },
    )
    expect(line).toBe(
      'HMI preview built in 664 ms: files 0, generate 23 (widget blocks 5, STruC++ 12), fonts 1, toolchain 613 ' +
        '(compile 580, link 32; 2 of 14 compiled: glue.cpp 291, screen_Details.cpp 253), start 20, first frame 4',
    )
  })

  it('leaves out what it does not know', () => {
    expect(formatHmiPreviewTimings(timings)).toBe(
      'HMI preview built in 640 ms: files 0, generate 23 (widget blocks 5, STruC++ 12), fonts 1, toolchain 613',
    )
    expect(formatHmiPreviewTimings(timings, { units: 3, cached: 3, compileMs: 2, linkMs: 30 })).toContain(
      'toolchain 613 (compile 2, link 30; 0 of 3 compiled)',
    )
  })
})
