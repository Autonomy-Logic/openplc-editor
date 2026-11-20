import type {
  GsdmlCatalog,
  GsdmlDeviceAccessPoint,
  GsdmlModule,
  GsdmlPluggableSubmodule,
} from '@root/middleware/shared/ports/gsdml-types'

/**
 * Indexes over a GSDML catalog. By-ID maps keep the first element with an ID; by-ident maps group every
 * element under its normalised ident number, in document order. Values are the catalog objects themselves.
 */
export interface GsdmlCatalogLookups {
  readonly dapById: ReadonlyMap<string, GsdmlDeviceAccessPoint>
  readonly moduleById: ReadonlyMap<string, GsdmlModule>
  /** Every submodule of the catalog SubmoduleList, all kinds. */
  readonly submoduleById: ReadonlyMap<string, GsdmlPluggableSubmodule>
  readonly dapsByIdent: ReadonlyMap<string, readonly GsdmlDeviceAccessPoint[]>
  readonly modulesByIdent: ReadonlyMap<string, readonly GsdmlModule[]>
  /** Every submodule of the catalog SubmoduleList, all kinds. */
  readonly submodulesByIdent: ReadonlyMap<string, readonly GsdmlPluggableSubmodule[]>
}

/** Maps each item to its ID, keeping the first item of a repeated ID. */
function indexById<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  const index = new Map<string, T>()
  for (const item of items) {
    if (!index.has(item.id)) index.set(item.id, item)
  }
  return index
}

/** Groups the items by ident number, in document order. */
function groupByIdent<T extends { readonly identNumber: string }>(items: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const group = groups.get(item.identNumber)
    if (group === undefined) groups.set(item.identNumber, [item])
    else group.push(item)
  }
  return groups
}

/**
 * Builds the lookups of a catalog without changing it.
 *
 * @param catalog - A catalog returned by the GSDML parser.
 * @returns Maps by ID and by normalised ident number over its device access points, modules and SubmoduleList.
 */
export function buildGsdmlCatalogLookups(catalog: GsdmlCatalog): GsdmlCatalogLookups {
  return {
    dapById: indexById(catalog.deviceAccessPoints),
    moduleById: indexById(catalog.modules),
    submoduleById: indexById(catalog.submodules),
    dapsByIdent: groupByIdent(catalog.deviceAccessPoints),
    modulesByIdent: groupByIdent(catalog.modules),
    submodulesByIdent: groupByIdent(catalog.submodules),
  }
}
