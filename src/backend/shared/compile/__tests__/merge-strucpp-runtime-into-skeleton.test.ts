import { describe, expect, it } from '@jest/globals'

import { mergeStrucppRuntimeIntoSkeleton } from '../steps/merge-strucpp-runtime-into-skeleton'

describe('mergeStrucppRuntimeIntoSkeleton', () => {
  it('re-keys runtime headers from strucpp_runtime/include/<file> into src/<file>', () => {
    const merged = mergeStrucppRuntimeIntoSkeleton({
      firmwareSkeleton: { 'examples/Baremetal/Baremetal.ino': '/* sketch */' },
      strucppRuntimeHeaders: {
        'strucpp_runtime/include/iec_std_lib.hpp': '/* iec_std_lib */',
        'strucpp_runtime/include/debug_dispatch.hpp': '/* debug_dispatch */',
      },
    })
    expect(merged['examples/Baremetal/Baremetal.ino']).toBe('/* sketch */')
    expect(merged['src/iec_std_lib.hpp']).toBe('/* iec_std_lib */')
    expect(merged['src/debug_dispatch.hpp']).toBe('/* debug_dispatch */')
    // The original v4-shape key is NOT preserved — re-keyed only.
    expect(merged['strucpp_runtime/include/iec_std_lib.hpp']).toBeUndefined()
  })

  it('drops boardHalContent at src/arduino.cpp when supplied', () => {
    const merged = mergeStrucppRuntimeIntoSkeleton({
      firmwareSkeleton: {},
      strucppRuntimeHeaders: {},
      boardHalContent: 'void hardwareInit() {}',
    })
    expect(merged['src/arduino.cpp']).toBe('void hardwareInit() {}')
  })

  it('does not overwrite src/arduino.cpp when boardHalContent is undefined', () => {
    const merged = mergeStrucppRuntimeIntoSkeleton({
      firmwareSkeleton: { 'src/arduino.cpp': 'existing HAL' },
      strucppRuntimeHeaders: {},
    })
    expect(merged['src/arduino.cpp']).toBe('existing HAL')
  })

  it('does not overwrite src/arduino.cpp when boardHalContent is the empty string', () => {
    // Empty content is treated as "no override" — caller signals
    // "no HAL to merge" by passing undefined or "".  Without this
    // guard, an editor read that returned an empty file would wipe
    // out a skeleton's HAL.
    const merged = mergeStrucppRuntimeIntoSkeleton({
      firmwareSkeleton: { 'src/arduino.cpp': 'existing HAL' },
      strucppRuntimeHeaders: {},
      boardHalContent: '',
    })
    expect(merged['src/arduino.cpp']).toBe('existing HAL')
  })

  it('runtime header re-key OVERWRITES a same-named entry in the skeleton (strucpp wins)', () => {
    const merged = mergeStrucppRuntimeIntoSkeleton({
      firmwareSkeleton: { 'src/iec_std_lib.hpp': 'stale stub' },
      strucppRuntimeHeaders: { 'strucpp_runtime/include/iec_std_lib.hpp': 'canonical strucpp' },
    })
    expect(merged['src/iec_std_lib.hpp']).toBe('canonical strucpp')
  })

  it('skips runtime header entries whose key has no filename component', () => {
    // Defensive: if an entry's key is something pathological like
    // `strucpp_runtime/include/`, `split('/').pop()` yields '' and
    // we don't want to emit `src/`.
    const merged = mergeStrucppRuntimeIntoSkeleton({
      firmwareSkeleton: {},
      strucppRuntimeHeaders: {
        '': '/* unkeyed garbage */',
      },
    })
    expect(merged['src/']).toBeUndefined()
    expect(Object.keys(merged)).toHaveLength(0)
  })

  it('does not mutate the input firmwareSkeleton', () => {
    const input = { 'examples/Baremetal/Baremetal.ino': '/* sketch */' }
    const before = { ...input }
    mergeStrucppRuntimeIntoSkeleton({
      firmwareSkeleton: input,
      strucppRuntimeHeaders: { 'strucpp_runtime/include/a.hpp': 'a' },
      boardHalContent: 'hal',
    })
    expect(input).toEqual(before)
  })
})
