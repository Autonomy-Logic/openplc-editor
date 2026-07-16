/**
 * import-actions.ts test file
 *
 * `executeImportPlcopen` picks a file via the platform port, parses it with
 * `parsePlcopenXml`, and hands the result to the store's
 * `handleOpenProjectResponse` action. All collaborators are mocked so the
 * test exercises only the orchestration logic in this file.
 */

import type { ProjectPort } from '../../../middleware/shared/ports/project-port'

const mockParsePlcopenXml = vi.fn()
vi.mock('../../utils/PLC/xml-parser', () => ({
  parsePlcopenXml: (...args: unknown[]) => mockParsePlcopenXml(...args),
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

import { executeImportPlcopen } from '../import-actions'

function makeProjectPort(overrides?: Partial<ProjectPort>): ProjectPort {
  return {
    pickPlcopenImportFile: vi.fn().mockResolvedValue({ success: true, content: '<project/>' }),
    exportPlcopenFile: vi.fn(),
    ...overrides,
  } as unknown as ProjectPort
}

const handleOpenProjectResponse = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockGetState.mockReturnValue({
    project: { meta: { name: 'Old', type: 'plc-project', path: 'proj-1' } },
    sharedWorkspaceActions: { handleOpenProjectResponse },
  })
  mockParsePlcopenXml.mockReturnValue({
    projectData: {
      dataTypes: [],
      pous: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
    warnings: [],
    projectName: 'Imported',
  })
})

describe('executeImportPlcopen', () => {
  it('returns success:false silently when the picker is cancelled', async () => {
    const projectPort = makeProjectPort({
      pickPlcopenImportFile: vi.fn().mockResolvedValue({ success: false }),
    })

    const result = await executeImportPlcopen(projectPort)

    expect(result).toEqual({ success: false })
    expect(handleOpenProjectResponse).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('returns success:false silently when the picker succeeds but has no content', async () => {
    const projectPort = makeProjectPort({
      pickPlcopenImportFile: vi.fn().mockResolvedValue({ success: true }),
    })

    const result = await executeImportPlcopen(projectPort)

    expect(result).toEqual({ success: false })
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('parses the picked content and overwrites the open project in-place, preserving path', async () => {
    const projectPort = makeProjectPort()

    const result = await executeImportPlcopen(projectPort)

    expect(result).toEqual({ success: true })
    expect(mockParsePlcopenXml).toHaveBeenCalledWith('<project/>')
    expect(handleOpenProjectResponse).toHaveBeenCalledWith({
      meta: { name: 'Imported', type: 'plc-project', path: 'proj-1' },
      projectData: {
        dataTypes: [],
        pous: [],
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
      warnings: [],
    })
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'default' }))
  })

  it('falls back to "Imported Project" when the XML carries no project name', async () => {
    mockParsePlcopenXml.mockReturnValue({
      projectData: {
        dataTypes: [],
        pous: [],
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
      warnings: [],
      projectName: '',
    })
    const projectPort = makeProjectPort()

    await executeImportPlcopen(projectPort)

    expect(handleOpenProjectResponse).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ name: 'Imported Project' }) }),
    )
  })

  it('logs warnings to console and shows a warning toast mentioning the count', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockParsePlcopenXml.mockReturnValue({
      projectData: {
        dataTypes: [],
        pous: [],
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
      warnings: ['SFC body dropped', 'Unknown dialect element'],
      projectName: 'Imported',
    })
    const projectPort = makeProjectPort()

    const result = await executeImportPlcopen(projectPort)

    expect(result).toEqual({ success: true })
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
    expect(consoleWarnSpy).toHaveBeenCalledWith('[PLCopen import] SFC body dropped')
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'warn', description: expect.stringContaining('2 warning(s)') }),
    )

    consoleWarnSpy.mockRestore()
  })

  it('catches parse exceptions and toasts a failure without touching the store', async () => {
    mockParsePlcopenXml.mockImplementation(() => {
      throw new Error('Invalid PLCopen XML: missing <project> root element')
    })
    const projectPort = makeProjectPort()

    const result = await executeImportPlcopen(projectPort)

    expect(result).toEqual({ success: false })
    expect(handleOpenProjectResponse).not.toHaveBeenCalled()
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'fail', description: 'Invalid PLCopen XML: missing <project> root element' }),
    )
  })
})
