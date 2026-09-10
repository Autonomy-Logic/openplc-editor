/**
 * @jest-environment jsdom
 */
import type { Location as LspLocation } from 'vscode-languageserver-protocol'

import { __clearBodyLineOffsetsForTests, setBodyLineOffset } from '../../lsp-shared/body-offsets'
import { lspMirrorUri } from '../../lsp-shared/lsp-mirror'
import { mapStDefinitionLocation } from '../definition-locations'
import { DATA_TYPES_URI, GLOBAL_VARIABLE_LISTS_URI, pouUri, stubUri } from '../types'

const at = (uri: string, line: number, character = 2): LspLocation => ({
  uri,
  range: { start: { line, character }, end: { line, character: character + 5 } },
})

// pou://main: declaration line 0, VAR lines 1..4, body from line 5.
beforeEach(() => {
  __clearBodyLineOffsetsForTests()
  setBodyLineOffset(pouUri('main'), 5)
  setBodyLineOffset(stubUri('Ladder'), 3)
})

describe('mapStDefinitionLocation', () => {
  it('keeps a body target in the POU model, shifted to the body view', () => {
    expect(mapStDefinitionLocation(at(pouUri('main'), 6))).toEqual({
      uri: pouUri('main'),
      range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 8 },
    })
  })

  it('sends a VAR-block target to the document mirror, unshifted', () => {
    expect(mapStDefinitionLocation(at(pouUri('main'), 2))).toEqual({
      uri: lspMirrorUri(pouUri('main')),
      range: { startLineNumber: 3, startColumn: 3, endLineNumber: 3, endColumn: 8 },
    })
  })

  it('sends the declaration line to the mirror too', () => {
    expect(mapStDefinitionLocation(at(pouUri('main'), 0))?.uri).toBe(lspMirrorUri(pouUri('main')))
  })

  it('sends every target of a POU whose body line is not registered yet to the mirror', () => {
    expect(mapStDefinitionLocation(at(pouUri('Unknown'), 9))?.uri).toBe(lspMirrorUri(pouUri('Unknown')))
  })

  it('sends stubs and the synthesized documents to the mirror', () => {
    expect(mapStDefinitionLocation(at(stubUri('Ladder'), 7))?.uri).toBe(lspMirrorUri(stubUri('Ladder')))
    expect(mapStDefinitionLocation(at(DATA_TYPES_URI, 2))?.uri).toBe(lspMirrorUri(DATA_TYPES_URI))
    expect(mapStDefinitionLocation(at(GLOBAL_VARIABLE_LISTS_URI, 4))?.uri).toBe(lspMirrorUri(GLOBAL_VARIABLE_LISTS_URI))
  })

  it('passes an unknown URI through with its own offset', () => {
    expect(mapStDefinitionLocation(at('stlib://oscat/basic.st', 40))).toEqual({
      uri: 'stlib://oscat/basic.st',
      range: { startLineNumber: 41, startColumn: 3, endLineNumber: 41, endColumn: 8 },
    })
  })
})
