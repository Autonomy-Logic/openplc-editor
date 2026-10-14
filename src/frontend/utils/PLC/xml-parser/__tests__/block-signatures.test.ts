import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

import { createBlockSignatureResolver } from '../block-signatures'
import { parseXmlDocument } from '../parse-xml-document'

const library = (pous: SystemLibrary['pous']): SystemLibrary => ({
  name: 'iec-standard-fb',
  author: '',
  version: '1.0.0',
  stPath: '',
  cPath: '',
  pous,
})

const TON: SystemLibrary['pous'][number] = {
  name: 'TON',
  type: 'function-block',
  language: 'st',
  body: '',
  documentation: 'On-delay timer',
  variables: [
    { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
    { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
}

const embedded = (pou: string) =>
  parseXmlDocument(
    `<project><addData><data name="other"/><data name="openplc.org/library-blocks"><libraryBlocks>${pou}</libraryBlocks></data></addData></project>`,
  ).addData

describe('createBlockSignatureResolver', () => {
  it('resolves an installed library block case-insensitively, as the drop handler copies it', () => {
    const resolve = createBlockSignatureResolver([], [library([TON])], undefined)
    expect(resolve('ton')).toEqual({
      name: 'TON',
      type: 'function-block',
      variables: TON.variables,
      documentation: 'On-delay timer',
      extensible: false,
    })
    expect(resolve('TOF')).toBeUndefined()
  })

  it('prefers the project’s own POU over a library block of the same name', () => {
    const resolve = createBlockSignatureResolver(
      [
        {
          name: 'TON',
          pouType: 'function-block',
          interface: {
            variables: [
              {
                name: 'go',
                class: 'input',
                type: { definition: 'base-type', value: 'bool' },
                location: '',
                documentation: '',
              },
            ],
          },
          documentation: 'mine',
        },
      ],
      [library([TON])],
      undefined,
    )
    expect(resolve('TON')).toEqual({
      name: 'TON',
      type: 'function-block',
      variables: [{ name: 'go', class: 'input', type: { definition: 'base-type', value: 'BOOL' } }],
      documentation: 'mine',
      extensible: false,
    })
  })

  it('gives a user function its OUT pin and never offers a program as a block', () => {
    const resolve = createBlockSignatureResolver(
      [
        { name: 'SCALE', pouType: 'function', interface: { variables: [], returnType: 'real' } },
        { name: 'main', pouType: 'program', interface: { variables: [] } },
      ],
      [],
      undefined,
    )
    expect(resolve('SCALE')?.variables).toEqual([
      { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'REAL' } },
    ])
    expect(resolve('main')).toBeUndefined()
  })

  it('falls back to the library blocks the exporter embedded', () => {
    const resolve = createBlockSignatureResolver(
      [],
      [],
      embedded(
        `<pou name="LIMIT_INT" pouType="function"><interface><returnType><INT/></returnType><inputVars><variable name="MN"><type><INT/></type></variable></inputVars></interface></pou>` +
          `<pou name="CTU" pouType="functionBlock"><interface><outputVars><variable name="Q"><type><BOOL/></type></variable></outputVars></interface></pou>`,
      ),
    )
    expect(resolve('LIMIT_INT')).toEqual({
      name: 'LIMIT_INT',
      type: 'function',
      variables: [
        { name: 'MN', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'INT' } },
      ],
      documentation: '',
      extensible: false,
    })
    expect(resolve('CTU')?.type).toBe('function-block')
  })

  it('ignores an addData block without the library-blocks entry', () => {
    const addData = parseXmlDocument('<project><addData><data name="other"/></addData></project>').addData
    expect(createBlockSignatureResolver([], [], addData)('CTU')).toBeUndefined()
  })
})
