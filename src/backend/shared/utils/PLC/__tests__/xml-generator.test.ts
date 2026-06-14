/**
 * Tests for XmlGenerator.
 *
 * All XML generator sub-functions (pou/datatype/instance parsers) and
 * xmlbuilder2 are mocked. We verify the orchestration and branching logic.
 */

import type { PLCProjectData } from '@root/middleware/shared/ports/open-plc-types'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockOldBaseXml = { type: 'old' }
const mockCodeSysBaseXml = { type: 'codesys' }

const mockOldParsePous = jest.fn((xml: any) => xml)
const mockOldParseDataTypes = jest.fn((xml: any) => xml)
const mockOldInstanceToXml = jest.fn((xml: any) => xml)
const mockOldGetBase = jest.fn(() => ({ ...mockOldBaseXml }))

const mockCsParsePous = jest.fn((xml: any) => xml)
const mockCsParseDataTypes = jest.fn((xml: any) => xml)
const mockCsInstanceToXml = jest.fn((xml: any) => xml)
const mockCsGetBase = jest.fn(() => ({ ...mockCodeSysBaseXml }))

jest.mock('../../../../../frontend/utils/PLC/xml-generator/old-editor', () => ({
  getBaseOldEditorXmlStructure: mockOldGetBase,
  oldEditorParsePousToXML: mockOldParsePous,
  oldEditorParseDataTypesToXML: mockOldParseDataTypes,
  oldEditorInstanceToXml: mockOldInstanceToXml,
}))

jest.mock('../../../../../frontend/utils/PLC/xml-generator/codesys', () => ({
  getBaseCodeSysXmlStructure: mockCsGetBase,
  codeSysParsePousToXML: mockCsParsePous,
  codeSysParseDataTypesToXML: mockCsParseDataTypes,
  codeSysInstanceToXml: mockCsInstanceToXml,
}))

const mockDocEnd = jest.fn().mockReturnValue('<xml>output</xml>')
const mockDocDec = jest.fn()
jest.mock('xmlbuilder2', () => ({
  create: jest.fn(() => ({
    dec: mockDocDec,
    end: mockDocEnd,
  })),
}))

// Import after mocks
import { XmlGenerator } from '../xml-generator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<PLCProjectData> = {}): PLCProjectData {
  return {
    dataTypes: [],
    pous: [
      {
        type: 'program',
        data: {
          language: 'st',
          name: 'main',
          variables: [],
          body: { language: 'st', value: '' },
          documentation: '',
        },
      },
    ],
    configuration: {
      resource: {
        tasks: [],
        instances: [],
        globalVariables: [],
      },
    },
    ...overrides,
  }
}

describe('XmlGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // POU naming flexibility
  // -----------------------------------------------------------------------
  // The "Main POU not found" guard was a v3-era restriction.  The
  // compiler now picks the entry program from the configuration's
  // instance bindings — any program POU name is accepted, and a
  // project with zero program POUs still serialises cleanly (the IEC
  // compile step downstream surfaces a precise error if no program
  // exists for the instance to point at).
  it('serialises a project with zero program POUs without erroring at the XML stage', () => {
    const project = makeProject({ pous: [] })
    const result = XmlGenerator(project)
    expect(result.ok).toBe(true)
  })

  it('serialises a project whose only POU is a function (no program named "main")', () => {
    const project = makeProject({
      pous: [
        {
          type: 'function',
          data: {
            language: 'st',
            name: 'main',
            returnType: 'BOOL',
            variables: [],
            body: { language: 'st', value: '' },
            documentation: '',
          },
        },
      ],
    })
    const result = XmlGenerator(project)
    expect(result.ok).toBe(true)
  })

  it('serialises a project whose program POU has a non-"main" name', () => {
    const project = makeProject({
      pous: [
        {
          type: 'program',
          data: {
            language: 'st',
            name: 'conveyor_ctrl',
            variables: [],
            body: { language: 'st', value: '' },
            documentation: '',
          },
        },
      ],
    })
    const result = XmlGenerator(project)
    expect(result.ok).toBe(true)
  })

  // -----------------------------------------------------------------------
  // old-editor format (default)
  // -----------------------------------------------------------------------
  describe('old-editor format', () => {
    it('uses old-editor pipeline when format is old-editor', () => {
      const project = makeProject()
      const result = XmlGenerator(project, 'old-editor')

      expect(mockOldGetBase).toHaveBeenCalledTimes(1)
      expect(mockOldParsePous).toHaveBeenCalledWith(expect.objectContaining({ type: 'old' }), project.pous)
      expect(mockOldParseDataTypes).toHaveBeenCalledWith(expect.anything(), project.dataTypes)
      expect(mockOldInstanceToXml).toHaveBeenCalledWith(expect.anything(), project.configuration)

      expect(result.ok).toBe(true)
      expect(result.message).toBe('XML generated')
      expect(result.data).toBe('<xml>output</xml>')
    })

    it('defaults to old-editor when no format specified', () => {
      const project = makeProject()
      XmlGenerator(project)

      expect(mockOldGetBase).toHaveBeenCalledTimes(1)
      expect(mockCsGetBase).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // codesys format
  // -----------------------------------------------------------------------
  describe('codesys format', () => {
    it('uses codesys pipeline when format is codesys', () => {
      const project = makeProject()
      const result = XmlGenerator(project, 'codesys')

      expect(mockCsGetBase).toHaveBeenCalledTimes(1)
      expect(mockCsParsePous).toHaveBeenCalledWith(expect.objectContaining({ type: 'codesys' }), project.pous)
      expect(mockCsParseDataTypes).toHaveBeenCalledWith(expect.anything(), project.dataTypes)
      expect(mockCsInstanceToXml).toHaveBeenCalledWith(expect.anything(), project.configuration)

      expect(result.ok).toBe(true)
      expect(result.data).toBe('<xml>output</xml>')
    })
  })

  // -----------------------------------------------------------------------
  // XML declaration
  // -----------------------------------------------------------------------
  it('sets XML declaration with version and encoding', () => {
    const project = makeProject()
    XmlGenerator(project)

    expect(mockDocDec).toHaveBeenCalledWith({ version: '1.0', encoding: 'utf-8' })
    expect(mockDocEnd).toHaveBeenCalledWith({ prettyPrint: true })
  })
})
