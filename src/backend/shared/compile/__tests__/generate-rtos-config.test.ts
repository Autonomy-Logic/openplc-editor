/**
 * The generated `rtos_config.h`: the switch the runtime compiles RTOS mode
 * under, the OS backend it builds against, and for a multi-task project the
 * threaded runtime and which task owns each run of the debug table.
 */

import {
  generateRtosConfigContent,
  runtimeCanBeThreaded,
  runtimeHasPlatformThreads,
  withRtosConfigInclude,
} from '../steps/generate-rtos-config'

const profile = {
  backend: 'freertos-esp32' as const,
  tickNs: 1_000_000,
  workLevels: 8,
  maxTasks: 8,
  threads: 'native' as const,
}

describe('generateRtosConfigContent', () => {
  const single = generateRtosConfigContent({ profile, threaded: false, workers: 1, debugOwners: [] })

  it('turns RTOS mode on and names the backend', () => {
    expect(single).toContain('#define OPENPLC_RTOS 1')
    expect(single).toContain('#define OPENPLC_RTOS_FREERTOS_ESP32 1')
    expect(single).toContain('#define OPENPLC_RTOS_TICK_NS 1000000UL')
  })

  it('is include-guarded under the same guard as the skeleton stub it replaces', () => {
    expect(single).toMatch(/#ifndef RTOS_CONFIG_H\n#define RTOS_CONFIG_H\n[\s\S]*#endif \/\/ RTOS_CONFIG_H\n$/)
  })

  it('leaves a single-task build unthreaded', () => {
    expect(single).not.toContain('STRUCPP_THREADED')
    expect(single).not.toContain('OPENPLC_RTOS_DEBUG_OWNERS')
  })

  it('builds a multi-task project threaded, with each task’s debug ranges', () => {
    const header = generateRtosConfigContent({
      profile,
      threaded: true,
      workers: 2,
      debugOwners: [
        { arr: 0, first: 0, last: 9, task: 'MainTask' },
        { arr: 0, first: 10, last: 12, task: 'NET "x"' },
      ],
    })
    expect(header).toContain('#define STRUCPP_THREADED 1')
    expect(header).toContain('{ 0, 0, 9, "MainTask" }, \\')
    expect(header).toContain('{ 0, 10, 12, "NET \\"x\\"" }, \\')
  })

  it('takes the locks from the RTOS on a toolchain without <mutex>', () => {
    expect(generateRtosConfigContent({ profile, threaded: true, workers: 2, debugOwners: [] })).not.toContain(
      'STRUCPP_PLATFORM_THREADS',
    )
    const header = generateRtosConfigContent({
      profile: { ...profile, backend: 'mbed-rtx', threads: 'platform' },
      threaded: true,
      workers: 2,
      debugOwners: [],
    })
    expect(header).toContain('#define OPENPLC_RTOS_MBED_RTX 1')
    expect(header).toContain('#define STRUCPP_PLATFORM_THREADS 1')
  })

  it('sizes the worker tables to the build', () => {
    expect(single).toContain('#define OPENPLC_RTOS_MAX_WORKERS 1')
    expect(generateRtosConfigContent({ profile, threaded: true, workers: 3, debugOwners: [] })).toContain(
      '#define OPENPLC_RTOS_MAX_WORKERS 3',
    )
    expect(generateRtosConfigContent({ profile, threaded: true, workers: 40, debugOwners: [] })).toContain(
      '#define OPENPLC_RTOS_MAX_WORKERS 32',
    )
  })

  it('omits the owner table when there is nothing to list', () => {
    const header = generateRtosConfigContent({ profile, threaded: true, workers: 2, debugOwners: [] })
    expect(header).toContain('#define STRUCPP_THREADED 1')
    expect(header).not.toContain('OPENPLC_RTOS_DEBUG_OWNERS')
  })
})

describe('runtimeHasPlatformThreads', () => {
  const GLOBAL = 'namespace detail {\nextern "C" void *strucpp_platform_mutex_create(void);\n}'
  const STD_LIB =
    '#ifdef STRUCPP_PLATFORM_THREADS\nextern "C" int64_t *strucpp_platform_current_time_slot(void);\n#endif'

  it('reads both hooks from the bundled runtime headers', () => {
    expect(runtimeHasPlatformThreads({ 'src/iec_global.hpp': GLOBAL, 'src/iec_std_lib.hpp': STD_LIB })).toBe(true)
    expect(runtimeHasPlatformThreads({ 'src/iec_global.hpp': GLOBAL })).toBe(false)
    expect(
      runtimeHasPlatformThreads({ 'src/iec_global.hpp': '#include <mutex>', 'src/iec_std_lib.hpp': STD_LIB }),
    ).toBe(false)
    expect(runtimeHasPlatformThreads({})).toBe(false)
  })

  it('does not take a mention in a comment for the hook', () => {
    expect(
      runtimeHasPlatformThreads({
        'src/iec_global.hpp': '// STRUCPP_PLATFORM_THREADS: strucpp_platform_mutex_create() one day',
        'src/iec_std_lib.hpp': '// strucpp_platform_current_time_slot',
      }),
    ).toBe(false)
  })
})

describe('runtimeCanBeThreaded', () => {
  const GLOBAL = 'extern "C" void *strucpp_platform_mutex_create(void);'
  const STD_LIB = 'extern "C" int64_t *strucpp_platform_current_time_slot(void);'

  it('needs both runtime headers, and on a platform backend their hooks', () => {
    const plain = { 'src/iec_global.hpp': '#include <mutex>', 'src/iec_std_lib.hpp': '' }
    expect(runtimeCanBeThreaded(plain, { threads: 'native' })).toBe(true)
    expect(runtimeCanBeThreaded(plain, { threads: 'platform' })).toBe(false)
    expect(
      runtimeCanBeThreaded({ 'src/iec_global.hpp': GLOBAL, 'src/iec_std_lib.hpp': STD_LIB }, { threads: 'platform' }),
    ).toBe(true)
    expect(runtimeCanBeThreaded({ 'src/iec_global.hpp': '' }, { threads: 'native' })).toBe(false)
  })
})

describe('withRtosConfigInclude', () => {
  it('puts the include before anything in the header', () => {
    expect(withRtosConfigInclude('#pragma once\n')).toMatch(/^#include "rtos_config.h"[^\n]*\n#pragma once\n$/)
  })
})
