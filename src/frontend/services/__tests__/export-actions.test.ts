/**
 * export-actions.ts test file
 *
 * `executeExportPlcopen` reads the store it is given, converts the
 * flat store project shape into `PlcopenXmlGenerator`'s schema shape, and calls
 * `projectPort.exportPlcopenFile`. The generator and toast are mocked and the
 * store is a real one seeded per test, so the test exercises only the
 * conversion + orchestration logic in this file.
 */

import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import type { PLCProjectData } from '../../../middleware/shared/ports/types'

const mockXmlGenerator = vi.fn()
vi.mock('../../../backend/shared/utils/PLC/plcopen-xml-generator', () => ({
  PlcopenXmlGenerator: (...args: unknown[]) => mockXmlGenerator(...args),
}))

const mockToast = vi.fn()
vi.mock('../../utils/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

import type { OpenPLCStore } from '../../store'
import { createTestStore } from '../../store/testing'
import { executeExportPlcopen } from '../export-actions'

function makeProjectData(overrides?: Partial<PLCProjectData>): PLCProjectData {
  return {
    dataTypes: [],
    pous: [
      {
        name: 'main',
        pouType: 'program',
        body: { language: 'st', value: 'a := 1;' },
        interface: { variables: [] },
        documentation: '',
      },
    ],
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    ...overrides,
  }
}

function seedProject(projectData: PLCProjectData, projectName = 'MyProject') {
  store.setState({
    project: {
      meta: { name: projectName, type: 'plc-project', path: 'proj-1' },
      data: projectData,
    },
  })
}

function makeProjectPort(overrides?: Partial<ProjectPort>): ProjectPort {
  return {
    exportPlcopenFile: vi.fn().mockResolvedValue({ success: true }),
    pickPlcopenImportFile: vi.fn(),
    ...overrides,
  } as unknown as ProjectPort
}

let store: OpenPLCStore

beforeEach(() => {
  vi.clearAllMocks()
  store = createTestStore()
  seedProject(makeProjectData())
})

describe('executeExportPlcopen', () => {
  it('converts the flat project data into schema shape and passes it to PlcopenXmlGenerator', async () => {
    mockXmlGenerator.mockReturnValue({ ok: true, message: 'ok', data: '<project/>' })
    const projectPort = makeProjectPort()

    const result = await executeExportPlcopen(store, projectPort)

    expect(result).toEqual({ success: true })
    expect(mockXmlGenerator).toHaveBeenCalledTimes(1)
    const [schemaData] = mockXmlGenerator.mock.calls[0]
    expect(schemaData.pous).toEqual([
      {
        type: 'program',
        data: {
          language: 'st',
          name: 'main',
          variables: [],
          body: { language: 'st', value: 'a := 1;' },
          documentation: '',
        },
      },
    ])
    expect(schemaData.configuration).toEqual({
      resource: { tasks: [], instances: [], globalVariables: [] },
    })
  })

  it('maps function and function-block POUs to their discriminated schema shapes', async () => {
    mockXmlGenerator.mockReturnValue({ ok: true, message: 'ok', data: '<project/>' })
    const projectData = makeProjectData({
      pous: [
        {
          name: 'AddOne',
          pouType: 'function',
          body: { language: 'st', value: 'AddOne := IN + 1;' },
          interface: { returnType: 'INT', variables: [] },
          documentation: 'doc',
        },
        {
          name: 'Counter',
          pouType: 'function-block',
          body: { language: 'st', value: '' },
          interface: { variables: [] },
        },
      ],
    })
    seedProject(projectData)

    await executeExportPlcopen(store, makeProjectPort())

    const [schemaData] = mockXmlGenerator.mock.calls[0]
    expect(schemaData.pous[0]).toMatchObject({ type: 'function', data: { name: 'AddOne', returnType: 'INT' } })
    expect(schemaData.pous[1]).toMatchObject({ type: 'function-block', data: { name: 'Counter' } })
  })

  it('calls exportPlcopenFile with the project name and generated XML, and toasts success', async () => {
    mockXmlGenerator.mockReturnValue({ ok: true, message: 'ok', data: '<project/>' })
    seedProject(makeProjectData(), 'Widgets')
    const exportPlcopenFile = vi.fn().mockResolvedValue({ success: true })
    const projectPort = makeProjectPort({ exportPlcopenFile })

    const result = await executeExportPlcopen(store, projectPort)

    expect(result).toEqual({ success: true })
    expect(exportPlcopenFile).toHaveBeenCalledWith('Widgets.xml', '<project/>')
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'default' }))
  })

  it('toasts a failure and returns success:false when PlcopenXmlGenerator fails', async () => {
    mockXmlGenerator.mockReturnValue({ ok: false, message: 'Main POU not found.' })
    const projectPort = makeProjectPort()

    const result = await executeExportPlcopen(store, projectPort)

    expect(result).toEqual({ success: false })
    expect(projectPort.exportPlcopenFile).not.toHaveBeenCalled()
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'fail', description: 'Main POU not found.' }),
    )
  })

  it('toasts a failure and returns success:false when the platform port fails to save the file', async () => {
    mockXmlGenerator.mockReturnValue({ ok: true, message: 'ok', data: '<project/>' })
    const exportPlcopenFile = vi.fn().mockResolvedValue({ success: false, error: 'disk full' })
    const projectPort = makeProjectPort({ exportPlcopenFile })

    const result = await executeExportPlcopen(store, projectPort)

    expect(result).toEqual({ success: false })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail', description: 'disk full' }))
  })

  it('catches unexpected exceptions and toasts a generic failure', async () => {
    mockXmlGenerator.mockImplementation(() => {
      throw new Error('boom')
    })
    const projectPort = makeProjectPort()

    const result = await executeExportPlcopen(store, projectPort)

    expect(result).toEqual({ success: false })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail', description: 'boom' }))
  })
})
