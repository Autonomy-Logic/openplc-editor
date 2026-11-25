/** @jest-environment node */
import { sha256Hex } from '../../../wasm-toolchain/content-digest'
import {
  encodeHmiPrelude,
  HMI_PRELUDE_FILE,
  HMI_PRELUDE_INDEX,
  HMI_PRELUDE_SOURCE,
  type HmiPrelude,
  hmiPreludeFits,
  hmiPreludeText,
  loadHmiPrelude,
} from '../hmi-prelude'

const OPENING = '#pragma once\n#include "iec_types.hpp"\n#include "hmi_core.h"\n\n#include "hmi_unit_libraries.hpp"\n'
const UNIT_HEADER = `${OPENING}\nnamespace hmi {\nclass MAIN;\n}\n`
const LIBRARIES = '#pragma once\nnamespace hmi { class HMILABEL; }\n'
const TOOLCHAIN = '@yowasp/clang@1'
const fixed = {
  'strucpp_runtime/include/iec_types.hpp': '// types',
  'hmi/core/hmi_core.h': '// core',
}
const FLAGS = ['--target=wasm32-wasip1', '-std=gnu++17', '-O1']
const prelude: HmiPrelude = { header: OPENING, libraries: LIBRARIES, pch: new Uint8Array([1, 2, 3]), flags: FLAGS }

async function inputs(files: Record<string, string>): Promise<Array<[string, string]>> {
  return Promise.all(
    Object.entries(files).map(async ([path, text]): Promise<[string, string]> => [path, await sha256Hex(text)]),
  )
}

async function shipped(
  overrides: { toolchain?: string; inputs?: Array<[string, string]>; flags?: readonly string[] } = {},
) {
  const files = await encodeHmiPrelude(
    overrides.toolchain ?? TOOLCHAIN,
    { ...prelude, flags: overrides.flags ?? FLAGS },
    overrides.inputs ??
      (await inputs({ ...fixed, [HMI_PRELUDE_SOURCE]: OPENING, 'unit/hmi_unit_libraries.hpp': LIBRARIES })),
  )
  return { index: files[HMI_PRELUDE_INDEX], pch: files[HMI_PRELUDE_FILE] }
}

describe('hmiPreludeText', () => {
  it('takes the unit header up to and including the line that includes its libraries header', () => {
    expect(hmiPreludeText(UNIT_HEADER)).toBe(OPENING)
  })

  it('is null for a header that does not include the libraries header', () => {
    expect(hmiPreludeText('#pragma once\nnamespace hmi {}\n')).toBeNull()
  })
})

describe('hmiPreludeFits', () => {
  it('fits a unit whose header opens with the prelude, over the same libraries header', () => {
    expect(hmiPreludeFits(prelude, { 'hmi_unit.hpp': UNIT_HEADER, 'hmi_unit_libraries.hpp': LIBRARIES }, FLAGS)).toBe(
      true,
    )
  })

  it('does not fit units compiled with other flags than the prelude', () => {
    const files = { 'hmi_unit.hpp': UNIT_HEADER, 'hmi_unit_libraries.hpp': LIBRARIES }
    expect(hmiPreludeFits(prelude, files, ['--target=wasm32-wasip1', '-std=gnu++17', '-O2'])).toBe(false)
    expect(hmiPreludeFits(prelude, files, ['-std=gnu++17', '-O1'])).toBe(false)
    expect(hmiPreludeFits(prelude, files, [...FLAGS, '-DEXTRA'])).toBe(false)
  })

  it('does not fit another libraries header, another opening, or no prelude', () => {
    expect(
      hmiPreludeFits(prelude, { 'hmi_unit.hpp': UNIT_HEADER, 'hmi_unit_libraries.hpp': `${LIBRARIES}//x\n` }, FLAGS),
    ).toBe(false)
    expect(
      hmiPreludeFits(prelude, { 'hmi_unit.hpp': `// x\n${UNIT_HEADER}`, 'hmi_unit_libraries.hpp': LIBRARIES }, FLAGS),
    ).toBe(false)
    expect(hmiPreludeFits(null, { 'hmi_unit.hpp': UNIT_HEADER, 'hmi_unit_libraries.hpp': LIBRARIES }, FLAGS)).toBe(
      false,
    )
  })
})

describe('loadHmiPrelude', () => {
  it('loads a prelude built by this toolchain from the files the preview compiles with', async () => {
    const { index, pch } = await shipped()
    expect(await loadHmiPrelude(index, pch, TOOLCHAIN, FLAGS, fixed)).toEqual(prelude)
  })

  it('is null when nothing is shipped or the index is not one', async () => {
    const { index, pch } = await shipped()
    expect(await loadHmiPrelude(null, pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
    expect(await loadHmiPrelude(index, null, TOOLCHAIN, FLAGS, fixed)).toBeNull()
    expect(await loadHmiPrelude(new TextEncoder().encode('{"format":1'), pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
    expect(await loadHmiPrelude(new TextEncoder().encode('{"format":2}'), pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
  })

  it('is null for a prelude built with other flags than the preview units use', async () => {
    const { index, pch } = await shipped({ flags: ['--target=wasm32-wasip1', '-std=gnu++17', '-O2'] })
    expect(await loadHmiPrelude(index, pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
    const reordered = await shipped({ flags: ['--target=wasm32-wasip1', '-O1', '-std=gnu++17'] })
    expect(await loadHmiPrelude(reordered.index, reordered.pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
  })

  it('is null for an index written before it recorded the flags', async () => {
    const { pch } = await shipped()
    const legacy = new TextEncoder().encode(
      JSON.stringify({
        format: 1,
        toolchain: TOOLCHAIN,
        header: OPENING,
        libraries: LIBRARIES,
        pch: '0'.repeat(64),
        inputs: [],
      }),
    )
    expect(await loadHmiPrelude(legacy, pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
  })

  it('is null for a prelude another toolchain built', async () => {
    const { index, pch } = await shipped({ toolchain: '@yowasp/clang@2' })
    expect(await loadHmiPrelude(index, pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
  })

  it('is null when the precompiled header is not the one the index names', async () => {
    const { index } = await shipped()
    expect(await loadHmiPrelude(index, new Uint8Array([1, 2, 4]), TOOLCHAIN, FLAGS, fixed)).toBeNull()
  })

  it('is null when a file it was built from changed or is missing', async () => {
    const { index, pch } = await shipped()
    expect(
      await loadHmiPrelude(index, pch, TOOLCHAIN, FLAGS, {
        ...fixed,
        'strucpp_runtime/include/iec_types.hpp': '// newer',
      }),
    ).toBeNull()
    expect(await loadHmiPrelude(index, pch, TOOLCHAIN, FLAGS, { 'hmi/core/hmi_core.h': '// core' })).toBeNull()
  })

  it('is null when it read a project file other than the libraries header', async () => {
    const { index, pch } = await shipped({ inputs: await inputs({ ...fixed, 'unit/pou_MAIN.cpp': '// main' }) })
    expect(await loadHmiPrelude(index, pch, TOOLCHAIN, FLAGS, fixed)).toBeNull()
  })
})
