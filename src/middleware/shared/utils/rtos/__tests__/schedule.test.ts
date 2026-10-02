import {
  firmwareOutgrewBoard,
  locatedVariableCount,
  ramLeftAfterLink,
  rtosBuildFailureIsOurs,
  rtosRamNeed,
  rtosRamProblem,
  rtosScheduleProblem,
} from '../schedule'
import type { RtosTargetProfile } from '../types'

const profile = {
  backend: 'freertos-esp32' as const,
  tickNs: 1_000_000,
  workLevels: 3,
  maxTasks: 4,
  threads: 'native' as const,
}
const task = (name: string, interval: string, priority: number) => ({
  name,
  triggering: 'Cyclic',
  interval,
  priority,
})

describe('rtosScheduleProblem', () => {
  it('passes a project the board can run', () => {
    expect(rtosScheduleProblem([task('main', 'T#10ms', 0), task('net', 'T#100ms', 1)], profile)).toBeUndefined()
  })

  it('names too many tasks first', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(`t${i}`, 'T#10ms', 0))
    expect(rtosScheduleProblem(tasks, profile)).toMatch(/room for 4; the project has 5/)
  })

  it('names each interval off the tick', () => {
    expect(rtosScheduleProblem([task('fast', 'T#500us', 0)], profile)).toMatch(/fast \(T#500us\)/)
  })

  it('names more distinct priorities than levels', () => {
    const tasks = [task('a', 'T#10ms', 0), task('b', 'T#10ms', 1), task('c', 'T#10ms', 2), task('d', 'T#10ms', 3)]
    expect(rtosScheduleProblem(tasks, profile)).toMatch(/has 3; the project uses 4/)
  })
})

describe('firmwareOutgrewBoard', () => {
  it('reads a build too big for the board, from the linker or arduino-cli', () => {
    expect(firmwareOutgrewBoard(["region `RAM' overflowed by 312 bytes"])).toBe(true)
    expect(firmwareOutgrewBoard(["section `.bss' will not fit in region `RAM'"])).toBe(true)
    expect(firmwareOutgrewBoard(['Sketch too big; see https://support.arduino.cc/'])).toBe(true)
    expect(firmwareOutgrewBoard(['Not enough memory; see https://support.arduino.cc/'])).toBe(true)
    expect(
      firmwareOutgrewBoard([
        'ld: section .stack_dummy VMA [0000000020007b00,0000000020007eff] overlaps section .heap VMA [0000000020005b18,0000000020007b17]',
      ]),
    ).toBe(true)
  })

  it('does not mistake any other failure for it', () => {
    expect(
      firmwareOutgrewBoard(["error: 'foo' was not declared in this scope", 'collect2: error: ld returned 1']),
    ).toBe(false)
    expect(firmwareOutgrewBoard([])).toBe(false)
  })
})

describe('firmwareOutgrewBoard, as the output streams', () => {
  it('reads a line or a chunk, and never a compiler quoting the user’s source', () => {
    expect(firmwareOutgrewBoard("ld: region `FLASH' overflowed by 20 bytes")).toBe(true)
    expect(firmwareOutgrewBoard("a\nld: region `FLASH' overflowed by 20 bytes\nb")).toBe(true)
    expect(firmwareOutgrewBoard('   12 |   Serial.println("Sketch too big");')).toBe(false)
    expect(firmwareOutgrewBoard('      |   // Not enough memory here')).toBe(false)
  })
})

describe('rtosBuildFailureIsOurs', () => {
  const at = (file: string) => ({ message: `${file}:10:3: error: expected ';' before '}' token` })

  it('is not RTOS mode’s when every error is in the project’s own C/C++ code', () => {
    expect(rtosBuildFailureIsOurs([at('/p/build/src/c_blocks_code.cpp')])).toBe(false)
    expect(rtosBuildFailureIsOurs([at('C:\\p\\src\\c_blocks.h'), at('/p/src/c_blocks_code.cpp')])).toBe(false)
  })

  it('is RTOS mode’s when anything else fails, or nothing says where', () => {
    expect(rtosBuildFailureIsOurs([at('/p/examples/Baremetal/plc_os.cpp')])).toBe(true)
    expect(rtosBuildFailureIsOurs([at('/p/src/c_blocks_code.cpp'), at('/p/src/iec_global.hpp')])).toBe(true)
    expect(rtosBuildFailureIsOurs([{ message: 'collect2: error: ld returned 1 exit status' }])).toBe(true)
    expect(rtosBuildFailureIsOurs([])).toBe(true)
  })

  it('reads the compiler’s lines out of one message, and a structured file', () => {
    const output = `Compilation failed with code 1\n${at('/p/src/c_blocks_code.cpp').message}\n${at('/p/src/generated.cpp').message}`
    expect(rtosBuildFailureIsOurs([{ message: output }])).toBe(true)
    expect(rtosBuildFailureIsOurs([{ message: 'x', file: '/p/src/c_blocks_code.cpp' }])).toBe(false)
    expect(rtosBuildFailureIsOurs([{ message: 'fatal', file: '/p/libraries/FreeRTOS/src/port.c' }])).toBe(true)
  })
})

describe('the RAM RTOS mode’s tasks take', () => {
  const heap: RtosTargetProfile = {
    backend: 'freertos-stm32',
    tickNs: 1e6,
    workLevels: 3,
    maxTasks: 4,
    threads: 'platform',
  }

  it('reads what the link leaves free', () => {
    expect(
      ramLeftAfterLink(
        'Global variables use 8352 bytes (40%) of dynamic memory, leaving 12128 bytes for local variables. Maximum is 20480 bytes.',
      ),
    ).toBe(12128)
    expect(ramLeftAfterLink('leaving -512 bytes for local variables')).toBe(-512)
    expect(ramLeftAfterLink('Sketch uses 9 bytes')).toBeUndefined()
  })

  const need = (args: Partial<Parameters<typeof rtosRamNeed>[0]> = {}) =>
    rtosRamNeed({
      profile: { ...heap, ownDispatcher: true },
      workers: 1,
      serviceB: false,
      lockedGlobals: 0,
      locatedVariables: 0,
      ...args,
    }) ?? 0

  it('counts each task’s stack, the services’, the dispatcher’s and the RTOS’s own tasks', () => {
    const one = need()
    expect(one).toBeGreaterThan(32_000)
    expect(need({ workers: 2 }) - one).toBe(16384 + 448 + 96)
    expect(need({ serviceB: true }) - one).toBe(16384 + 448)
    expect(need({ lockedGlobals: 10 }) - one).toBe(960)
    expect(one - need({ profile: heap })).toBe(8192 + 448 + 2700)
  })

  it('counts each located variable’s place in the process image', () => {
    expect(need({ locatedVariables: 20 }) - need()).toBe(20 * 32)
  })

  it('reads the located variables’ count from the generated header, and 0 when it does not say', () => {
    expect(locatedVariableCount('namespace x {\nconstexpr uint32_t locatedVarsCount = 37;\n}')).toBe(37)
    expect(locatedVariableCount('constexpr uint32_t locatedVarsCount = 0;')).toBe(0)
    expect(locatedVariableCount('')).toBe(0)
  })

  it('leaves a fixed RTOS heap to the firmware’s own check', () => {
    expect(
      rtosRamNeed({
        profile: { ...heap, fixedHeap: true },
        workers: 1,
        serviceB: false,
        lockedGlobals: 0,
        locatedVariables: 0,
      }),
    ).toBeUndefined()
  })

  it('says why they will not fit, and nothing when they will or it cannot tell', () => {
    expect(rtosRamProblem(53_000, 40_000)).toBe(
      "RTOS mode's tasks need about 52 KB of RAM when the board starts, and this build leaves 39 KB free.",
    )
    expect(rtosRamProblem(53_000, 60_000)).toBeUndefined()
    expect(rtosRamProblem(undefined, 1)).toBeUndefined()
    expect(rtosRamProblem(53_000, undefined)).toBeUndefined()
  })
})
