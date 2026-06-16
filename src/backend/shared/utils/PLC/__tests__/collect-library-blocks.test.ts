/**
 * Tests for collectLibraryBlocks — the pure project→<addData> collector that
 * embeds used library-block signatures for the xml2st transpiler.
 */

import type { PLCProjectData } from '@root/middleware/shared/ports/open-plc-types'

import { collectLibraryBlocks } from '../collect-library-blocks'

const baseType = (value: string) => ({ definition: 'base-type' as const, value })
const genericType = (value: string) => ({ definition: 'generic-type' as const, value })

const blockNode = (variant: unknown) => ({ type: 'block', data: { variant } })

/** Build a project with a single FBD program containing the given block nodes. */
function fbdProject(nodes: unknown[], extraPous: unknown[] = []): PLCProjectData {
  return {
    dataTypes: [],
    pous: [
      {
        type: 'program',
        data: {
          name: 'main',
          language: 'fbd',
          variables: [],
          documentation: '',
          body: { language: 'fbd', value: { name: 'main', rung: { nodes } } },
        },
      },
      ...extraPous,
    ],
    // configuration etc. are unused by the collector
  } as unknown as PLCProjectData
}

/** Build a project with a single Ladder program; blocks live in rungs[].nodes. */
function ldProject(nodesByRung: unknown[][]): PLCProjectData {
  return {
    dataTypes: [],
    pous: [
      {
        type: 'program',
        data: {
          name: 'main',
          language: 'ld',
          variables: [],
          documentation: '',
          body: { language: 'ld', value: { name: 'main', rungs: nodesByRung.map((nodes) => ({ nodes })) } },
        },
      },
    ],
  } as unknown as PLCProjectData
}

describe('collectLibraryBlocks', () => {
  it('returns null when there are no graphical blocks', () => {
    const project = {
      dataTypes: [],
      pous: [{ type: 'program', data: { name: 'main', body: { language: 'st', value: '' } } }],
    } as unknown as PLCProjectData
    expect(collectLibraryBlocks(project)).toBeNull()
  })

  it('emits a nullary function as a returnType-only pou', () => {
    const project = fbdProject([
      blockNode({
        name: 'CURRENT_DT',
        type: 'function',
        variables: [
          { name: 'EN', class: 'input', type: baseType('BOOL') },
          { name: 'ENO', class: 'output', type: baseType('BOOL') },
          { name: 'OUT', class: 'output', type: baseType('DT') },
        ],
      }),
    ])

    const result = collectLibraryBlocks(project) as any
    expect(result.data['@name']).toBe('openplc.org/xml2st/library-blocks')
    const pous = result.data.libraryBlocks.pou
    expect(pous).toHaveLength(1)
    expect(pous[0]).toMatchObject({
      '@name': 'CURRENT_DT',
      '@pouType': 'function',
      interface: { returnType: { DT: '' } },
    })
    // EN/ENO are dropped; no spurious inputVars/outputVars
    expect(pous[0].interface.inputVars).toBeUndefined()
    expect(pous[0].interface.outputVars).toBeUndefined()
    expect(pous[0]['@extensible']).toBeUndefined()
  })

  it('preserves generic types and the extensible flag for variadic functions', () => {
    const project = fbdProject([
      blockNode({
        name: 'ADD',
        type: 'function',
        extensible: true,
        variables: [
          { name: 'EN', class: 'input', type: baseType('BOOL') },
          { name: 'IN1', class: 'input', type: genericType('ANY_NUM') },
          { name: 'IN2', class: 'input', type: genericType('ANY_NUM') },
          { name: 'OUT', class: 'output', type: genericType('ANY_NUM') },
        ],
      }),
    ])

    const pou = (collectLibraryBlocks(project) as any).data.libraryBlocks.pou[0]
    expect(pou['@extensible']).toBe(true)
    expect(pou.interface.returnType).toEqual({ ANY_NUM: '' })
    expect(pou.interface.inputVars.variable).toEqual([
      { '@name': 'IN1', type: { ANY_NUM: '' } },
      { '@name': 'IN2', type: { ANY_NUM: '' } },
    ])
  })

  it('emits function blocks with outputVars (no returnType)', () => {
    const project = fbdProject([
      blockNode({
        name: 'TON',
        type: 'function-block',
        variables: [
          { name: 'IN', class: 'input', type: baseType('BOOL') },
          { name: 'PT', class: 'input', type: baseType('TIME') },
          { name: 'Q', class: 'output', type: baseType('BOOL') },
          { name: 'ET', class: 'output', type: baseType('TIME') },
        ],
      }),
    ])

    const pou = (collectLibraryBlocks(project) as any).data.libraryBlocks.pou[0]
    expect(pou['@pouType']).toBe('functionBlock')
    expect(pou.interface.returnType).toBeUndefined()
    expect(pou.interface.outputVars.variable).toEqual([
      { '@name': 'Q', type: { BOOL: '' } },
      { '@name': 'ET', type: { TIME: '' } },
    ])
  })

  it('dedupes by name and skips user-defined POUs', () => {
    const userFb = {
      type: 'function-block',
      data: { name: 'MyFB', body: { language: 'st', value: '' } },
    }
    const project = fbdProject(
      [
        blockNode({
          name: 'ADD',
          type: 'function',
          variables: [{ name: 'OUT', class: 'output', type: genericType('ANY_NUM') }],
        }),
        blockNode({
          name: 'ADD',
          type: 'function',
          variables: [{ name: 'OUT', class: 'output', type: genericType('ANY_NUM') }],
        }),
        blockNode({ name: 'MyFB', type: 'function-block', variables: [] }),
      ],
      [userFb],
    )

    const pous = (collectLibraryBlocks(project) as any).data.libraryBlocks.pou
    expect(pous.map((p: any) => p['@name'])).toEqual(['ADD'])
  })

  it('collects blocks from Ladder rungs (the common case)', () => {
    const project = ldProject([
      [
        blockNode({
          name: 'TON',
          type: 'function-block',
          variables: [
            { name: 'IN', class: 'input', type: baseType('BOOL') },
            { name: 'PT', class: 'input', type: baseType('TIME') },
            { name: 'Q', class: 'output', type: baseType('BOOL') },
          ],
        }),
      ],
      [
        blockNode({
          name: 'CURRENT_DT',
          type: 'function',
          variables: [{ name: 'OUT', class: 'output', type: baseType('DT') }],
        }),
      ],
    ])

    const pous = (collectLibraryBlocks(project) as any).data.libraryBlocks.pou
    // blocks gathered across both rungs, sorted by name
    expect(pous.map((p: any) => p['@name'])).toEqual(['CURRENT_DT', 'TON'])
    expect(pous.find((p: any) => p['@name'] === 'TON')['@pouType']).toBe('functionBlock')
    expect(pous.find((p: any) => p['@name'] === 'CURRENT_DT').interface.returnType).toEqual({ DT: '' })
  })
})
