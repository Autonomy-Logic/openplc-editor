/**
 * `read_pou_body` is how the model sees a POU it did not write. The cases that
 * matter are the ones where a wrong answer is indistinguishable from a right
 * one: a graphical POU must never come back as its flow-graph JSON, and a POU
 * whose ST could not be produced must say so rather than look empty.
 *
 * The transpiler is injected through `executeTool`'s options, so nothing here
 * mocks a module and the file runs under both runners.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

import { openPLCStoreBase } from '../../../../store'
import { invalidateSTCache } from '../../graphical-context'
import { AI_TOOLS } from '../tool-definitions'
import { executeTool, type ToolExecutionOptions } from '../tool-executor'

type TestPou = { name: string; pouType: string; body: { language: string; value: unknown } }

function seedStore(pous: TestPou[]) {
  vi.spyOn(openPLCStoreBase, 'getState').mockReturnValue({
    project: { data: { pous } },
  } as unknown as ReturnType<typeof openPLCStoreBase.getState>)
}

/** A transpiler that always answers the same whole-program ST. */
function transpilerYielding(programSt: string | null): ToolExecutionOptions {
  return { transpileProject: () => Promise.resolve(programSt) }
}

beforeEach(() => {
  vi.restoreAllMocks()
  // The shared module caches the last successful transpile for 30s; without
  // this, one case's ST answers the next case's question.
  invalidateSTCache()
})

describe('read_pou_body tool definition', () => {
  it('is registered and requires a name', () => {
    const tool = AI_TOOLS.find((t) => t.name === 'read_pou_body')
    expect(tool).toBeDefined()
    expect(tool?.input_schema.required).toEqual(['name'])
  })
})

describe('executeTool("read_pou_body")', () => {
  it('returns a textual body verbatim, untruncated', async () => {
    const body = 'x := 1;\n'.repeat(2000)
    seedStore([{ name: 'Main', pouType: 'program', body: { language: 'st', value: body } }])

    const result = await executeTool('read_pou_body', { name: 'Main' })
    expect(result.success).toBe(true)
    expect(result.message).toContain('Main [program, st]')
    expect(result.message).toContain(body)
  })

  it('matches the POU name case-insensitively and trims the input', async () => {
    seedStore([{ name: 'TCP_CLIENT', pouType: 'function-block', body: { language: 'cpp', value: 'void loop(){}' } }])

    const result = await executeTool('read_pou_body', { name: '  tcp_client  ' })
    expect(result.success).toBe(true)
    expect(result.message).toContain('void loop(){}')
  })

  it('reports an unknown POU and lists what is available', async () => {
    seedStore([{ name: 'Main', pouType: 'program', body: { language: 'st', value: 'x := 1;' } }])

    const result = await executeTool('read_pou_body', { name: 'Nope' })
    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
    expect(result.message).toContain('Main')
  })

  it('reports "(none)" when the project has no POUs', async () => {
    seedStore([])
    const result = await executeTool('read_pou_body', { name: 'Anything' })
    expect(result.success).toBe(false)
    expect(result.message).toContain('(none)')
  })

  it.each([undefined, '', '   ', 42])('rejects a missing or blank name (%p)', async (name) => {
    seedStore([])
    const result = await executeTool('read_pou_body', { name })
    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required field: name')
  })

  it('rejects a null input object without throwing', async () => {
    seedStore([])
    const result = await executeTool('read_pou_body', null)
    expect(result.success).toBe(false)
    expect(result.message).toContain('Missing required field: name')
  })

  it('reports an empty body rather than returning nothing', async () => {
    seedStore([{ name: 'Blank', pouType: 'program', body: { language: 'st', value: '   ' } }])
    const result = await executeTool('read_pou_body', { name: 'Blank' })
    expect(result.success).toBe(true)
    expect(result.message).toContain('body is empty')
  })

  it('reports a non-string body as empty rather than serialising it', async () => {
    seedStore([{ name: 'Weird', pouType: 'program', body: { language: 'st', value: { nodes: [] } } }])
    const result = await executeTool('read_pou_body', { name: 'Weird' })
    expect(result.success).toBe(true)
    expect(result.message).toContain('body is empty')
  })

  describe('graphical POUs', () => {
    it('returns the transpiled ST equivalent, never the flow graph', async () => {
      seedStore([{ name: 'Rungs', pouType: 'program', body: { language: 'ld', value: { rungs: [{ x: 1, y: 2 }] } } }])

      const result = await executeTool(
        'read_pou_body',
        { name: 'Rungs' },
        transpilerYielding('PROGRAM Rungs\n  motor := start;\nEND_PROGRAM'),
      )
      expect(result.success).toBe(true)
      expect(result.message).toContain('transpiled ST equivalent')
      expect(result.message).toContain('motor := start;')
      expect(result.message).not.toContain('rungs')
    })

    it('fails clearly when no transpiler is wired up at all', async () => {
      seedStore([{ name: 'Rungs', pouType: 'program', body: { language: 'ld', value: {} } }])

      const result = await executeTool('read_pou_body', { name: 'Rungs' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('could not produce the ST equivalent')
      expect(result.message).toContain('LD')
    })

    it('fails clearly when the transpile is unavailable', async () => {
      seedStore([{ name: 'Rungs', pouType: 'program', body: { language: 'ld', value: {} } }])

      const result = await executeTool('read_pou_body', { name: 'Rungs' }, transpilerYielding(null))
      expect(result.success).toBe(false)
      expect(result.message).toContain('could not produce the ST equivalent')
      expect(result.message).toContain('LD')
    })

    it('fails clearly when the POU produced no ST', async () => {
      seedStore([{ name: 'Blocks', pouType: 'function-block', body: { language: 'fbd', value: {} } }])

      const result = await executeTool(
        'read_pou_body',
        { name: 'Blocks' },
        transpilerYielding('PROGRAM Other\nEND_PROGRAM'),
      )
      expect(result.success).toBe(false)
      expect(result.message).toContain('could not produce the ST equivalent')
      expect(result.message).toContain('FBD')
    })

    it('surfaces a transpiler rejection as a failed tool result, not a throw', async () => {
      // The shared cache swallows the rejection and falls back to whatever it
      // last knew — nothing, here — so the user gets the "no ST" message rather
      // than a stack trace or, worse, the previous project's code.
      seedStore([{ name: 'Rungs', pouType: 'program', body: { language: 'ld', value: {} } }])

      const result = await executeTool(
        'read_pou_body',
        { name: 'Rungs' },
        { transpileProject: () => Promise.reject(new Error('worker died')) },
      )
      expect(result.success).toBe(false)
      expect(result.message).toContain('could not produce the ST equivalent')
    })
  })
})
