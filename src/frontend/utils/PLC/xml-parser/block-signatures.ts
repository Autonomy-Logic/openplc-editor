import type { SystemLibrary } from '../../../../middleware/shared/ports/library-types'
import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { parseInterfaceXml, PouHeader } from './pou-xml'
import { asArray, asRecord, asString } from './xml-node'

// Structurally the ladder editor's BlockVariant: what a block dropped on the canvas carries.
export interface BlockSignature {
  name: string
  type: string
  variables: { id?: string; name: string; class: string; type: { definition: string; value: string } }[]
  documentation: string
  extensible: boolean
}

export type BlockSignatureResolver = (typeName: string) => BlockSignature | undefined

// The generator embeds every library block a project places here, so its own exports reopen without the library.
const LIBRARY_BLOCKS_DATA_NAME = 'openplc.org/library-blocks'

// Mirrors the user-library branch of the LD drop handler (rung/body.tsx).
function signatureFromPou(
  name: string,
  pouType: string,
  variables: PLCVariable[],
  returnType: string | undefined,
  documentation: string,
): BlockSignature {
  const pins = variables.map((variable) => ({
    name: variable.name,
    class: variable.class ?? 'local',
    type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
  }))
  if (pouType === 'function' && returnType) {
    pins.push({ name: 'OUT', class: 'output', type: { definition: 'base-type', value: returnType.toUpperCase() } })
  }
  return { name, type: pouType, variables: pins, documentation, extensible: false }
}

function parseEmbeddedLibraryBlocks(addDataXml: unknown): BlockSignature[] {
  const data = asArray(asRecord(addDataXml).data).map(asRecord)
  const entry = data.find((item) => item['@name'] === LIBRARY_BLOCKS_DATA_NAME)
  if (!entry) return []
  return asArray(asRecord(entry.libraryBlocks).pou).map((pouXml) => {
    const pou = asRecord(pouXml)
    const pouType = asString(pou['@pouType']) === 'functionBlock' ? 'function-block' : 'function'
    const { variables, returnType } = parseInterfaceXml(pou.interface)
    return signatureFromPou(asString(pou['@name']), pouType, variables, returnType, '')
  })
}

// Precedence: the project's own POUs, then the installed libraries, then the copies the exporter embedded.
export function createBlockSignatureResolver(
  userPous: PouHeader[],
  systemLibraries: SystemLibrary[],
  addDataXml: unknown,
): BlockSignatureResolver {
  const byName = new Map<string, BlockSignature>()
  const register = (signature: BlockSignature) => {
    const key = signature.name.toUpperCase()
    if (!byName.has(key)) byName.set(key, signature)
  }

  for (const pou of userPous) {
    if (pou.pouType === 'program') continue
    register(
      signatureFromPou(
        pou.name,
        pou.pouType,
        pou.interface?.variables ?? [],
        pou.interface?.returnType,
        pou.documentation ?? '',
      ),
    )
  }
  for (const library of systemLibraries) {
    for (const pou of library.pous) {
      register({
        name: pou.name,
        type: pou.type,
        variables: pou.variables.map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value },
        })),
        documentation: pou.documentation,
        extensible: pou.extensible ?? false,
      })
    }
  }
  for (const signature of parseEmbeddedLibraryBlocks(addDataXml)) register(signature)

  return (typeName) => byName.get(typeName.toUpperCase())
}
