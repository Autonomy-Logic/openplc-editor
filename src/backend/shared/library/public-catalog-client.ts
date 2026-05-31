/**
 * Shared public-library catalog client.
 *
 * Pure functions over a `CatalogTransportPort` — no platform code.
 * Mirrors the autonomy-edge `public-libraries` HTTP surface:
 *
 *   GET /public/libraries                — paginated list
 *   GET /public/libraries/:id            — detail + sibling versions
 *   GET /public/libraries/by-name/:name  — every version of a named library
 *   GET /public/libraries/:id/download   — raw .stlib bytes
 *
 * The desktop editor and the web editor both consume this module
 * byte-identical; only the transport differs.  Response shapes are
 * validated with zod so a backend drift surfaces as a precise
 * "field X missing" message instead of `Cannot read .name of undefined`
 * downstream.
 */

import { z } from 'zod'

import type { CatalogTransportPort } from '../../../middleware/shared/ports/catalog-transport-port'
import type {
  GetPublicLibraryByNameResponse,
  ListPublicLibrariesArgs,
  ListPublicLibrariesResponse,
  PublicLibraryDetail,
} from '../../../middleware/shared/ports/public-catalog-types'

// ---------------------------------------------------------------------------
// Response schemas — mirror apps/backend/src/presentation/dtos/public-libraries/
// ---------------------------------------------------------------------------

const ManifestPousSchema = z.object({
  functions: z.array(z.string()),
  functionBlocks: z.array(z.string()),
  types: z.array(z.string()),
})

const PublicLibrarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  version: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  license: z.string().nullable(),
  authorHandle: z.string(),
  manifestPous: ManifestPousSchema,
  sizeBytes: z.number(),
  sha256: z.string(),
  downloadsCount: z.number(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  isProjectPublic: z.boolean(),
  projectUrl: z.string().nullable(),
  projectStarsCount: z.number().nullable(),
})

const ListPublicLibrariesResponseSchema = z.object({
  libraries: z.array(PublicLibrarySchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
})

const PublicLibraryDetailSchema = PublicLibrarySchema.extend({
  siblingVersions: z.array(PublicLibrarySchema),
})

const GetPublicLibraryByNameSchema = z.object({
  versions: z.array(PublicLibrarySchema),
})

// The schemas above guard the wire shape at runtime.  Static types
// for everything that crosses the port boundary live in
// `middleware/shared/ports/public-catalog-types.ts` — keeping types
// there (not next to the schemas) lets the renderer import them
// without crossing the architecture's `components → backend/shared`
// boundary.  If the two ever drift, each client function's declared
// return type forces TypeScript to reconcile its `z.infer<...>`
// against the port-layer interface; a missing/renamed field surfaces
// as a compile error at the `return ...Schema.parse(...)` call below.

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Page through `GET /public/libraries`.  Server-side sort options are
 * `popular` (default) and `recent`; alphabetical sorting is a UI
 * concern handled after the page arrives.
 *
 * Throws on transport failure (network error, non-2xx) and on schema
 * mismatch (backend response shape drift).  Both render to the modal's
 * error state the same way.
 */
export async function listPublicLibraries(
  transport: CatalogTransportPort,
  args: ListPublicLibrariesArgs = {},
): Promise<ListPublicLibrariesResponse> {
  const params: Record<string, string | number | boolean | undefined> = {
    q: args.q,
    page: args.page,
    limit: args.limit,
    sort: args.sort,
  }
  const raw = await transport.fetchJson<unknown>('/public/libraries', params, args.signal)
  // The autonomy-edge response wraps the payload in `{ statusCode, data }`.
  // We unwrap here so callers consume the schema-validated payload directly.
  const inner = unwrapHttpEnvelope(raw)
  return ListPublicLibrariesResponseSchema.parse(inner)
}

export async function getPublicLibraryDetail(
  transport: CatalogTransportPort,
  args: { id: string; signal?: AbortSignal },
): Promise<PublicLibraryDetail> {
  const raw = await transport.fetchJson<unknown>(
    `/public/libraries/${encodeURIComponent(args.id)}`,
    undefined,
    args.signal,
  )
  const inner = unwrapHttpEnvelope(raw)
  return PublicLibraryDetailSchema.parse(inner)
}

export async function getPublicLibraryByName(
  transport: CatalogTransportPort,
  args: { name: string; signal?: AbortSignal },
): Promise<GetPublicLibraryByNameResponse> {
  const raw = await transport.fetchJson<unknown>(
    `/public/libraries/by-name/${encodeURIComponent(args.name)}`,
    undefined,
    args.signal,
  )
  const inner = unwrapHttpEnvelope(raw)
  return GetPublicLibraryByNameSchema.parse(inner)
}

/**
 * Download the raw `.stlib` archive bytes (utf-8 string).  Server
 * returns `application/octet-stream` with a JSON body — the same
 * shape `library-manager-module.persistPrepared` already accepts via
 * the .stlib install path, so the caller can write the response
 * verbatim to disk.
 */
export function downloadPublicLibrary(
  transport: CatalogTransportPort,
  args: { id: string; signal?: AbortSignal },
): Promise<string> {
  return transport.fetchText(`/public/libraries/${encodeURIComponent(args.id)}/download`, args.signal)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * autonomy-edge wraps every JSON response in `{ statusCode: number,
 * data: T }`.  The catalog client unwraps once here so every schema
 * targets the payload (`data`).  Older or off-spec responses (no
 * envelope) fall through unchanged so a hand-rolled local backend
 * during development still works.
 */
function unwrapHttpEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in raw && 'statusCode' in raw) {
    return (raw as { data: unknown }).data
  }
  return raw
}
