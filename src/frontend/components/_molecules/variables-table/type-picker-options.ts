import { baseTypeEnum } from '../../../../middleware/shared/ports/plc-schemas'
import { hasStringName } from '../../../utils/safe-upper'

type NamedEntry = { name?: unknown }

type SystemLibraryEntry = { pous?: ({ type?: string } & NamedEntry)[] }

type UserLibraryEntry = { type?: string } & NamedEntry

type TypePickerOptionGroup<D extends string> = { definition: D; values: string[] }

type TypePickerOptions = {
  variableTypes: [TypePickerOptionGroup<'base-type'>, TypePickerOptionGroup<'user-data-type'>]
  libraryTypes: [TypePickerOptionGroup<'system'>, TypePickerOptionGroup<'user'>]
}

type BuildTypePickerOptionsArgs = {
  dataTypes: NamedEntry[]
  libraries: { system: SystemLibraryEntry[]; user: UserLibraryEntry[] }
  /** A user library left out of the list, such as the library being edited. */
  excludeUserLibrary?: string
}

const functionBlockNames = (pous: ({ type?: string } & NamedEntry)[]): string[] =>
  pous
    .filter((pou) => pou?.type === 'function-block')
    .filter(hasStringName)
    .map((pou) => pou.name.toUpperCase())

/** The type picker's groups: base and user data types, then system and user library function blocks. */
const buildTypePickerOptions = ({
  dataTypes,
  libraries,
  excludeUserLibrary,
}: BuildTypePickerOptionsArgs): TypePickerOptions => ({
  variableTypes: [
    { definition: 'base-type', values: [...baseTypeEnum.options] },
    { definition: 'user-data-type', values: dataTypes.filter(hasStringName).map((dataType) => dataType.name) },
  ],
  libraryTypes: [
    {
      definition: 'system',
      values: libraries.system.flatMap((library) => functionBlockNames(library.pous ?? [])),
    },
    {
      definition: 'user',
      values: libraries.user
        .filter(hasStringName)
        .filter((userLibrary) => userLibrary.name !== excludeUserLibrary)
        .flatMap((userLibrary) => {
          const pous = (userLibrary as { pous?: ({ type?: string } & NamedEntry)[] }).pous
          if (Array.isArray(pous)) return functionBlockNames(pous)
          return userLibrary.type === 'function-block' ? [userLibrary.name.toUpperCase()] : []
        }),
    },
  ],
})

/** The groups with no values, used by a closed picker. */
const CLOSED_TYPE_PICKER_OPTIONS: TypePickerOptions = {
  variableTypes: [
    { definition: 'base-type', values: [] },
    { definition: 'user-data-type', values: [] },
  ],
  libraryTypes: [
    { definition: 'system', values: [] },
    { definition: 'user', values: [] },
  ],
}

export type { TypePickerOptions }
export { buildTypePickerOptions, CLOSED_TYPE_PICKER_OPTIONS }
