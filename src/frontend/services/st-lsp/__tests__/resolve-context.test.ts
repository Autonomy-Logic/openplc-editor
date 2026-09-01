/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { __clearBodyLineOffsetsForTests, setBodyLineOffset } from '../../lsp-shared/body-offsets'
import { resolveStLspContext } from '../resolve-context'
import { DATA_TYPES_URI, dtViewUri, pouUri, pouVarsUri } from '../types'

const enumType = (name: string) => ({
  name,
  derivation: 'enumerated' as const,
  values: [{ description: 'RED' }],
  initialValue: 'RED',
})

function makeStPou(name: string): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: [] },
    body: { language: 'st', value: 'x := 1;' },
    documentation: '',
  } as PLCPou
}

describe('resolveStLspContext', () => {
  beforeEach(() => {
    __clearBodyLineOffsetsForTests()
    openPLCStoreBase.setState((s) => ({
      project: {
        ...s.project,
        data: {
          ...s.project.data,
          pous: [makeStPou('main')],
          dataTypes: [enumType('Colors'), enumType('Motor')],
        },
      },
    }))
  })

  it('windows a pouvars view to the VAR region once the body line is registered', () => {
    setBodyLineOffset(pouUri('main'), 5)
    expect(resolveStLspContext(pouVarsUri('main'))).toEqual({
      lspUri: pouUri('main'),
      lineOffset: 1,
      lineWindow: { startLine: 1, endLineExclusive: 5 },
    })
  })

  it('leaves the pouvars view unwindowed while the registry still reads 0 for the POU', () => {
    // An unpopulated registry must not window the view down to nothing.
    expect(resolveStLspContext(pouVarsUri('main'))).toEqual({
      lspUri: pouUri('main'),
      lineOffset: 1,
    })
  })

  it('windows a dt view to its own span in the aggregate document', () => {
    // Aggregate: line 0 TYPE, 1 Colors, 2 Motor, 3 END_TYPE.
    expect(resolveStLspContext(dtViewUri('Motor'))).toEqual({
      lspUri: DATA_TYPES_URI,
      lineOffset: 1,
      lineWindow: { startLine: 2, endLineExclusive: 3 },
    })
  })

  it('passes an unknown dt view through with no window (unparseable file)', () => {
    const uri = dtViewUri('Ghost')
    expect(resolveStLspContext(uri)).toEqual({ lspUri: uri, lineOffset: 0 })
  })

  it('passes a body-editor URI through with the registered offset and no window', () => {
    setBodyLineOffset(pouUri('main'), 5)
    expect(resolveStLspContext(pouUri('main'))).toEqual({ lspUri: pouUri('main'), lineOffset: 5 })
  })
})
