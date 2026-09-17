/**
 * The build's package-update notice, at the point it reaches the console.
 *
 * The notice exists so a user chasing odd board behaviour learns there is a
 * newer package to try. It is therefore advisory in the strict sense: it may
 * not gate a build, may not change one's outcome, and may not appear on a
 * target that has no package behind it.
 */

import type { BoardInfo, CompileProgressEvent, PLCProjectData } from '../../../shared/ports/types'
import { compileProgramFlow, type CompileProgramTransport } from '../compile-program-flow'

const projectData: PLCProjectData = {
  dataTypes: [],
  pous: [
    {
      name: 'main',
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: '' },
      documentation: '',
    },
  ],
  configurations: {
    resource: {
      tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
      instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
      globalVariables: [],
    },
  },
}

const vppBoard: BoardInfo = {
  core: 'esp8266:esp8266',
  compiler: 'arduino-cli',
  preview: '',
  specs: {},
  vpp: {
    packageId: 'com.openplc.esp',
    vendor: 'OpenPLC',
    deviceId: 'esp8266',
    packagePath: '/packages/esp',
    screens: {},
    moduleSystem: null,
  },
}

const nativeBoard: BoardInfo = { core: 'arduino:avr', compiler: 'arduino-cli', preview: '', specs: {} }

async function build(board: BoardInfo, findPackageUpdateNotice?: CompileProgramTransport['findPackageUpdateNotice']) {
  const events: CompileProgressEvent[] = []
  const transport: CompileProgramTransport = {
    getAvailableBoards: async () => new Map([['Board', board]]),
    loadAllLibraries: async () => [],
    runCompileProgram: (_args, onMessage) => onMessage({ closePort: true, success: true }),
    findPackageUpdateNotice,
  }

  const result = await compileProgramFlow(
    { projectData, boardTarget: 'Board', projectPath: '/tmp/project' },
    transport,
    (event) => events.push(event),
  )
  return { result, events }
}

describe('compileProgramFlow — package-update notice', () => {
  it('warns before the build runs, so a failed build does not bury it', async () => {
    const { result, events } = await build(vppBoard, async () => 'A newer ESP package is available: 1.1.1 -> 1.2.0.')

    const notice = events.find((event) => event.level === 'warning')
    expect(notice?.message).toContain('1.1.1 -> 1.2.0')
    // Ahead of everything the pipeline itself emitted.
    expect(events.indexOf(notice as CompileProgressEvent)).toBe(0)
    expect(result.success).toBe(true)
  })

  it('asks about the package the board came from, not the target name', async () => {
    const findPackageUpdateNotice = jest.fn().mockResolvedValue(null)
    await build(vppBoard, findPackageUpdateNotice)

    expect(findPackageUpdateNotice).toHaveBeenCalledWith('com.openplc.esp')
  })

  it('says nothing when there is no newer version', async () => {
    const { events } = await build(vppBoard, async () => null)

    expect(events.some((event) => event.level === 'warning')).toBe(false)
  })

  it('never asks for a board that came from hals.json rather than a package', async () => {
    // There is nothing for such a user to update, so the question is not worth
    // an IPC round trip on every build.
    const findPackageUpdateNotice = jest.fn().mockResolvedValue('should not appear')
    const { events } = await build(nativeBoard, findPackageUpdateNotice)

    expect(findPackageUpdateNotice).not.toHaveBeenCalled()
    expect(events.some((event) => event.level === 'warning')).toBe(false)
  })

  it('builds normally on a transport that has no catalog at all', async () => {
    // The CLI supplies none.
    const { result, events } = await build(vppBoard, undefined)

    expect(result.success).toBe(true)
    expect(events.some((event) => event.level === 'warning')).toBe(false)
  })
})
