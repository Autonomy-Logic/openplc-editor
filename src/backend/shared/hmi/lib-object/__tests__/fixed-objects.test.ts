import type { CachedWasmObject } from '../../../wasm-toolchain/compile-to-wasm'
import { fixedHmiObjects, isFixedHmiPath } from '../fixed-objects'

const object = (paths: string[]): CachedWasmObject => ({
  object: new Uint8Array([1]),
  digest: paths.join('|'),
  dependencies: paths.map((path) => [path, 'd']),
  includeNames: [],
  shadowDigest: '',
})

describe('fixed HMI objects', () => {
  it('counts the runtime headers, the HMI sources, the library units and the font tables as fixed', () => {
    for (const path of [
      'strucpp_runtime/include/iec_types.hpp',
      'hmi/core/hmi_core.c',
      'hmilib/standard-widgets/library.cpp',
      'unit/hmi_preview_fonts.c',
      'unit/hmi_fonts.c',
    ])
      expect(isFixedHmiPath(path)).toBe(true)
    for (const path of [
      'unit/hmi_unit.hpp',
      'unit/hmi_preview_pch.hpp',
      'groups/glue.cpp',
      'unit/pou_MAIN.cpp',
      'hmilibx/a.cpp',
    ])
      expect(isFixedHmiPath(path)).toBe(false)
  })

  it("keeps only objects built from fixed files: never a project's unit, never a linked module", () => {
    const core = { key: 'core', entry: object(['hmi/core/hmi_core.c', 'hmi/core/hmi_core.h']) }
    const screen = { key: 'screen', entry: object(['groups/screen_A.cpp', 'unit/hmi_unit.hpp', 'hmi/core/hmi_core.h']) }
    const module = { key: 'module', entry: object([]) }
    expect(fixedHmiObjects([core, screen, module])).toEqual([core])
  })
})
