import type { ReferenceImpactAnalysis } from '../variable-references/types'

export type DataTypeReferenceKind = 'pou-variable' | 'global-variable' | 'data-type-field' | 'data-type-base-type'

export type DataTypeReferenceLocation = {
  kind: DataTypeReferenceKind
  /** POU name, referencing data type name, or the global-variables table label. */
  container: string
  /** Declaring variable / structure field name; absent for an array data type's base type. */
  variableName?: string
}

export type DataTypeReferenceImpactAnalysis = ReferenceImpactAnalysis<DataTypeReferenceLocation>
