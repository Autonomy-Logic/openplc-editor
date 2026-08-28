import { executeStDocumentUri, executeStScopeId, parseExecuteStDocumentUri } from '../execute-st-uri'

// The Monaco model URI and the LSP document URI for an Execute ("ST Block")
// snippet must be the same string — `attachDiagnosticsBridge` matches
// published diagnostics to models by comparing URIs, so a mismatch silently
// costs the user their red squiggles with nothing logged to explain it.

describe('executeStDocumentUri', () => {
  it('builds a stable URI from POU name and node id', () => {
    expect(executeStDocumentUri('Main', 'EXECUTE_a1b2')).toBe('inmemory://execute/Main/EXECUTE_a1b2.st')
  })

  it('percent-encodes names that would otherwise break the URI', () => {
    const uri = executeStDocumentUri('My Program/v2', 'node/1')
    expect(uri).toBe('inmemory://execute/My%20Program%2Fv2/node%2F1.st')
    // Still round-trips despite the encoded separators.
    expect(parseExecuteStDocumentUri(uri)).toEqual({ pouName: 'My Program/v2', nodeId: 'node/1' })
  })

  it('gives distinct URIs to the same node id under different POUs', () => {
    expect(executeStDocumentUri('A', 'n1')).not.toBe(executeStDocumentUri('B', 'n1'))
  })
})

describe('parseExecuteStDocumentUri', () => {
  it('round-trips a generated URI', () => {
    expect(parseExecuteStDocumentUri(executeStDocumentUri('Main', 'n1'))).toEqual({ pouName: 'Main', nodeId: 'n1' })
  })

  it('returns null for URIs belonging to other schemes', () => {
    expect(parseExecuteStDocumentUri('inmemory://pou/Main.st')).toBeNull()
    expect(parseExecuteStDocumentUri('inmemory://stub/Main.st')).toBeNull()
    expect(parseExecuteStDocumentUri('file:///tmp/Main.st')).toBeNull()
    expect(parseExecuteStDocumentUri('')).toBeNull()
  })

  it('returns null rather than throwing on malformed percent-encoding', () => {
    // A stray `%` is not valid encoding; decodeURIComponent would throw, and
    // this runs inside notification handlers walking every open document.
    expect(parseExecuteStDocumentUri('inmemory://execute/%E0%A4%A/n1.st')).toBeNull()
  })
})

describe('executeStScopeId', () => {
  it('is stable for a given node id, so edits are didChange not close/reopen', () => {
    expect(executeStScopeId('n1')).toBe(executeStScopeId('n1'))
    expect(executeStScopeId('n1')).toBe('execute_n1')
  })

  it('sanitises characters that are not legal in an IEC identifier', () => {
    expect(executeStScopeId('EXECUTE-a1/b2 c')).toBe('execute_EXECUTE_a1_b2_c')
  })

  it('distinguishes two different nodes', () => {
    expect(executeStScopeId('n1')).not.toBe(executeStScopeId('n2'))
  })
})
