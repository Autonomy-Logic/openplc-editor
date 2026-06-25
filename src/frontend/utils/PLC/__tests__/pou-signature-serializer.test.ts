import type { PLCPou } from '../../../../middleware/shared/ports/types'
import {
  OPAQUE_BODY_PLACEHOLDER,
  SCOPE_QUERY_POU_NAME,
  serializePouScopeForQuery,
  serializePouSignatureToST,
} from '../pou-signature-serializer'

function makePou(overrides: Partial<PLCPou> = {}): PLCPou {
  return {
    name: 'Main',
    pouType: 'program',
    interface: {
      variables: [],
    },
    body: {
      language: 'st',
      value: 'x := 1;',
    },
    documentation: '',
    ...overrides,
  } as PLCPou
}

const FB_VARIABLES: PLCPou['interface'] = {
  variables: [
    {
      id: '1',
      name: 'in1',
      class: 'input',
      type: { definition: 'base-type', value: 'BOOL' },
      documentation: '',
      debug: false,
      location: '',
    },
    {
      id: '2',
      name: 'out1',
      class: 'output',
      type: { definition: 'base-type', value: 'INT' },
      documentation: '',
      debug: false,
      location: '',
    },
    {
      id: '3',
      name: 'state',
      class: 'local',
      type: { definition: 'base-type', value: 'DINT' },
      documentation: '',
      debug: false,
      location: '',
    },
  ],
}

describe('serializePouSignatureToST', () => {
  describe('ST POU — body included verbatim', () => {
    it('emits declaration, VAR blocks, real body, end keyword', () => {
      const pou = makePou({
        name: 'AdderFB',
        pouType: 'function-block',
        interface: FB_VARIABLES,
        body: { language: 'st', value: 'out1 := in1 + state;' },
      })
      const result = serializePouSignatureToST(pou)
      expect(result).toContain('FUNCTION_BLOCK AdderFB')
      expect(result).toContain('VAR_INPUT')
      expect(result).toContain('in1 : BOOL;')
      expect(result).toContain('VAR_OUTPUT')
      expect(result).toContain('out1 : INT;')
      expect(result).toContain('state : DINT;')
      expect(result).toContain('out1 := in1 + state;')
      expect(result).toContain('END_FUNCTION_BLOCK')
      expect(result).not.toContain(OPAQUE_BODY_PLACEHOLDER)
    })
  })

  describe('graphical and hybrid POUs — opaque body', () => {
    it.each(['ld', 'fbd', 'sfc', 'il', 'python', 'cpp'] as const)(
      'replaces the %s body with the opaque placeholder',
      (language) => {
        const pou = makePou({
          name: 'Foo',
          pouType: 'function-block',
          interface: FB_VARIABLES,
          // Real graphical bodies are objects; this test only cares
          // that whatever the body holds, the serializer drops it.
          body: { language, value: language === 'il' ? 'LD x' : ({} as never) },
        })
        const result = serializePouSignatureToST(pou)
        expect(result).toContain(OPAQUE_BODY_PLACEHOLDER)
        expect(result).not.toContain('LD x')
      },
    )
  })

  describe('declaration line', () => {
    it('emits PROGRAM for programs', () => {
      const pou = makePou({ name: 'MainProg', pouType: 'program' })
      expect(serializePouSignatureToST(pou)).toMatch(/^PROGRAM MainProg\b/m)
    })

    it('emits FUNCTION with return type', () => {
      const pou = makePou({
        name: 'AbsInt',
        pouType: 'function',
        interface: { returnType: 'INT', variables: [] },
        body: { language: 'st', value: '' },
      })
      const result = serializePouSignatureToST(pou)
      expect(result).toMatch(/^FUNCTION AbsInt : INT\b/m)
      expect(result).toMatch(/END_FUNCTION\b/m)
    })

    it('omits return type when missing (defensive — programs/FBs have no return)', () => {
      const pou = makePou({
        name: 'NoReturn',
        pouType: 'function',
        interface: { variables: [] },
        body: { language: 'st', value: '' },
      })
      expect(serializePouSignatureToST(pou)).toMatch(/^FUNCTION NoReturn$/m)
    })

    it('emits FUNCTION_BLOCK for function blocks', () => {
      const pou = makePou({ name: 'TankFB', pouType: 'function-block' })
      const result = serializePouSignatureToST(pou)
      expect(result).toMatch(/^FUNCTION_BLOCK TankFB\b/m)
      expect(result).toMatch(/END_FUNCTION_BLOCK\b/m)
    })
  })

  describe('variables', () => {
    it('emits VAR/END_VAR even when the POU has no variables', () => {
      const pou = makePou({
        name: 'Empty',
        pouType: 'function-block',
        interface: { variables: [] },
        body: { language: 'fbd', value: {} as never },
      })
      const result = serializePouSignatureToST(pou)
      // Block keywords carry the xml2st-parity 2-space indent.
      expect(result).toContain('  VAR\n  END_VAR')
    })

    it('respects variable class — input goes to VAR_INPUT', () => {
      const pou = makePou({
        name: 'Foo',
        pouType: 'function-block',
        interface: FB_VARIABLES,
        body: { language: 'ld', value: {} as never },
      })
      const lines = serializePouSignatureToST(pou).split('\n')
      // Block keywords ship with a 2-space indent now; the closing
      // keyword check needs to ignore that prefix.
      const inputBlockStart = lines.findIndex((l) => l.trimStart().startsWith('VAR_INPUT'))
      const inputBlockEnd = lines.findIndex((l, idx) => idx > inputBlockStart && l.trimStart().startsWith('END_VAR'))
      const inputSlice = lines.slice(inputBlockStart, inputBlockEnd + 1).join('\n')
      expect(inputSlice).toContain('in1')
      expect(inputSlice).not.toContain('out1')
      expect(inputSlice).not.toContain('state')
    })
  })

  describe('serializePouScopeForQuery', () => {
    it('wraps the partial expression in the POU scope with a throwaway name', () => {
      const pou = makePou({
        name: 'Irrigation',
        pouType: 'function-block',
        interface: FB_VARIABLES,
        body: { language: 'ld', value: {} as never },
      })
      const { text, position } = serializePouScopeForQuery(pou, 'in1.')
      // Emits the POU's real kind + a throwaway name (not the real one).
      expect(text).toMatch(new RegExp(`^FUNCTION_BLOCK ${SCOPE_QUERY_POU_NAME}\\b`, 'm'))
      expect(text).not.toContain('FUNCTION_BLOCK Irrigation')
      // VAR sections + the partial expression as the body line.
      expect(text).toContain('in1 : BOOL;')
      expect(text).toContain('in1.')
      expect(text).toContain('END_FUNCTION_BLOCK')
      // Cursor sits at the end of the body expression.
      expect(position.character).toBe('in1.'.length)
      // The body line is after the declaration + VAR blocks.
      expect(text.split('\n')[position.line]).toBe('in1.')
    })

    it('keeps the function return type while swapping only the name', () => {
      const pou = makePou({
        name: 'AbsInt',
        pouType: 'function',
        interface: { returnType: 'INT', variables: [] },
        body: { language: 'st', value: '' },
      })
      const { text } = serializePouScopeForQuery(pou, 'x')
      expect(text).toMatch(new RegExp(`^FUNCTION ${SCOPE_QUERY_POU_NAME} : INT\\b`, 'm'))
      expect(text).toMatch(/END_FUNCTION\b/m)
    })

    it('omits the return type for a program', () => {
      const pou = makePou({ name: 'MainProg', pouType: 'program', interface: { variables: [] } })
      const { text } = serializePouScopeForQuery(pou, '')
      expect(text).toMatch(new RegExp(`^PROGRAM ${SCOPE_QUERY_POU_NAME}$`, 'm'))
    })

    it('makes the synthetic POU name unique when a uniqueId is given', () => {
      const pou = makePou({ name: 'Foo', pouType: 'function-block', interface: { variables: [] } })
      const { text } = serializePouScopeForQuery(pou, '', 42)
      expect(text).toContain(`FUNCTION_BLOCK ${SCOPE_QUERY_POU_NAME}42__`)
    })
  })

  describe('integration shape — output parses round-trip', () => {
    it('produces a self-contained ST chunk with all four sections', () => {
      const pou = makePou({
        name: 'RoundTrip',
        pouType: 'function-block',
        interface: FB_VARIABLES,
        body: { language: 'ld', value: {} as never },
      })
      const result = serializePouSignatureToST(pou)
      // Section order: declaration → vars → body → end.
      const declIdx = result.indexOf('FUNCTION_BLOCK RoundTrip')
      const varIdx = result.indexOf('VAR_INPUT')
      const bodyIdx = result.indexOf(OPAQUE_BODY_PLACEHOLDER)
      const endIdx = result.indexOf('END_FUNCTION_BLOCK')
      expect(declIdx).toBeGreaterThanOrEqual(0)
      expect(varIdx).toBeGreaterThan(declIdx)
      expect(bodyIdx).toBeGreaterThan(varIdx)
      expect(endIdx).toBeGreaterThan(bodyIdx)
    })
  })
})
