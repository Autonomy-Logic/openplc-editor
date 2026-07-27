/**
 * export-actions.ts test file
 *
 * `executeExportPlcopen` reads `openPLCStoreBase.getState()`, converts the
 * flat store project shape into `XmlGenerator`'s schema shape, and calls
 * `projectPort.exportPlcopenFile`. All three collaborators are mocked so the
 * test exercises only the conversion + orchestration logic in this file.
 */

import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import type { PLCProjectData } from '../../../middleware/shared/ports/types'

const mockXmlGenerator = vi.fn()
vi.mock('../../../backend/shared/utils/PLC/xml-generator', () => ({
  XmlGenerator: (...args: unknown[]) => mockXmlGenerator(...args),
}))

const mockGetState = vi.fn()
vi.mock('../../store', () => ({
  openPLCStoreBase: {
    getState: () => mockGetState(),
  },
}))

const mockToast = vi.fn()
vi.mock('../../utils/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

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

function makeState(projectData: PLCProjectData, projectName = 'MyProject') {
  return {
    project: {
      meta: { name: projectName, type: 'plc-project' as const, path: 'proj-1' },
      data: projectData,
    },
  }
}

function makeProjectPort(overrides?: Partial<ProjectPort>): ProjectPort {
  return {
    exportPlcopenFile: vi.fn().mockResolvedValue({ success: true }),
    pickPlcopenImportFile: vi.fn(),
    ...overrides,
  } as unknown as ProjectPort
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetState.mockReturnValue(makeState(makeProjectData()))
})

describe('executeExportPlcopen', () => {
  it('converts the flat project data into schema shape and passes it to XmlGenerator', async () => {
    mockXmlGenerator.mockReturnValue({ ok: true, message: 'ok', data: '<project/>' })
    const projectPort = makeProjectPort()

    const result = await executeExportPlcopen(projectPort)

    expect(result).toEqual({ success: true })
    expect(mockXmlGenerator).toHaveBeenCalledTimes(1)
    const [schemaData, dialect] = mockXmlGenerator.mock.calls[0]
    expect(dialect).toBe('old-editor')
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
    mockGetState.mockReturnValue(makeState(projectData))

    await executeExportPlcopen(makeProjectPort())

    const [schemaData] = mockXmlGenerator.mock.calls[0]
    expect(schemaData.pous[0]).toMatchObject({ type: 'function', data: { name: 'AddOne', returnType: 'INT' } })
    expect(schemaData.pous[1]).toMatchObject({ type: 'function-block', data: { name: 'Counter' } })
  })

  it('calls exportPlcopenFile with the project name and generated XML, and toasts success', async () => {
    mockXmlGenerator.mockReturnValue({ ok: true, message: 'ok', data: '<project/>' })
    mockGetState.mockReturnValue(makeState(makeProjectData(), 'Widgets'))
    const exportPlcopenFile = vi.fn().mockResolvedValue({ success: true })
    const projectPort = makeProjectPort({ exportPlcopenFile })

    const result = await executeExportPlcopen(projectPort)

    expect(result).toEqual({ success: true })
    expect(exportPlcopenFile).toHaveBeenCalledWith('Widgets.xml', '<project/>')
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'default' }))
  })

  it('toasts a failure and returns success:false when XmlGenerator fails', async () => {
    mockXmlGenerator.mockReturnValue({ ok: false, message: 'Main POU not found.' })
    const projectPort = makeProjectPort()

    const result = await executeExportPlcopen(projectPort)

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

    const result = await executeExportPlcopen(projectPort)

    expect(result).toEqual({ success: false })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail', description: 'disk full' }))
  })

  it('catches unexpected exceptions and toasts a generic failure', async () => {
    mockXmlGenerator.mockImplementation(() => {
      throw new Error('boom')
    })
    const projectPort = makeProjectPort()

    const result = await executeExportPlcopen(projectPort)

    expect(result).toEqual({ success: false })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'fail', description: 'boom' }))
  })
})
