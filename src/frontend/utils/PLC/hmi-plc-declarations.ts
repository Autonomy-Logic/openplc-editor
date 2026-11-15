import type { PLCProjectData } from '../../../middleware/shared/ports/types'
import { serializeDataTypesToST } from './data-type-serializer'
import {
  serializeGlobalVariableListInstances,
  serializeGlobalVariableListsToTypes,
} from './global-variable-list-serializer'
import { serializePouSignatureToSTWithBodyOffset } from './pou-signature-serializer'
import { serializeResourceGlobalsToST } from './resource-globals-serializer'

/**
 * The PLC program as the HMI build compiles screens against it: data types, Global Variable Lists, every POU's
 * declarations without bodies, and the configuration with its globals and program instances. Built by the same
 * serializers the ST language server's documents use, so a path that resolves in the editor compiles.
 */
export function hmiPlcDeclarations(
  project: Pick<PLCProjectData, 'pous' | 'dataTypes' | 'configurations'> &
    Partial<Pick<PLCProjectData, 'globalVariableLists'>>,
  aliasIndex: ReadonlyMap<string, string> = new Map(),
): string {
  const lists = project.globalVariableLists ?? []
  const { resource } = project.configurations
  return [
    serializeDataTypesToST(project.dataTypes),
    serializeGlobalVariableListsToTypes(lists),
    serializeGlobalVariableListInstances(lists),
    ...project.pous.map((pou) => `${serializePouSignatureToSTWithBodyOffset(pou, aliasIndex, true).text}\n`),
    serializeResourceGlobalsToST(resource.globalVariables, aliasIndex, resource),
  ]
    .filter((part) => part.length > 0)
    .join('\n')
}
