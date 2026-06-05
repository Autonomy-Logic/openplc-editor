/**
 * Public-catalog DTOs that cross the port boundary.
 *
 * The shared `public-catalog-client` (in `backend/shared/library/`)
 * validates HTTP responses with zod and produces these shapes; the
 * Library Manager UI consumes them through the port.  Types live
 * here — not next to the schemas — so the renderer can import them
 * without the architecture validator flagging a `frontend/components/
 * → backend/shared/` jump.
 *
 * Source of truth for both the schema definitions and these
 * interfaces is the autonomy-edge `apps/backend/src/presentation/
 * dtos/public-libraries/` DTOs.  Keep the three in lockstep.
 */

export interface ManifestPous {
  functions: string[]
  functionBlocks: string[]
  types: string[]
}

export interface PublicLibrary {
  id: string
  projectId: string
  name: string
  version: string
  displayName: string
  description: string | null
  license: string | null
  authorHandle: string
  manifestPous: ManifestPous
  sizeBytes: number
  sha256: string
  downloadsCount: number
  publishedAt: string
  updatedAt: string
  isProjectPublic: boolean
  projectUrl: string | null
  projectStarsCount: number | null
}

export interface PublicLibraryDetail extends PublicLibrary {
  siblingVersions: PublicLibrary[]
}

export interface ListPublicLibrariesResponse {
  libraries: PublicLibrary[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface GetPublicLibraryByNameResponse {
  versions: PublicLibrary[]
}

export type PublicLibrarySort = 'popular' | 'recent'

export interface ListPublicLibrariesArgs {
  q?: string
  page?: number
  /** Server caps at 50; client requests at most that. */
  limit?: number
  sort?: PublicLibrarySort
  signal?: AbortSignal
}
