import type { DescriptionRowStore, DescriptionStoredRow } from './device-description-repository'
import type { GsdmlParseResult } from './gsdml-types'

/** What a GSDML file contributes to its repository row. */
export interface GsdmlRepositorySummary {
  readonly vendorId: string
  readonly deviceId: string
  readonly vendorName: string
  readonly deviceInfoText: string
  readonly schemaVersion: string
  readonly deviceAccessPointCount: number
  readonly moduleCount: number
  readonly submoduleCount: number
  readonly noticeCount: number
}

/** One request to the shared GSDML parser, run on the platform's parsing thread. */
export type GsdmlParseRequest = { readonly op: 'summary' | 'catalog'; readonly xml: string }

/** The summary of a parsed file, or the reason it was rejected. */
export type GsdmlSummaryResult =
  | { readonly success: true; readonly summary: GsdmlRepositorySummary }
  | { readonly success: false; readonly error: string }

/** The answer to a GSDML parse request, tagged with the op it answers. */
export type GsdmlParseResponse =
  | { readonly op: 'summary'; readonly result: GsdmlSummaryResult }
  | { readonly op: 'catalog'; readonly result: GsdmlParseResult }

/** Runs one parse request on the platform's parsing thread and returns the response unchanged. */
export interface GsdmlParserMechanism {
  run(request: GsdmlParseRequest): Promise<GsdmlParseResponse>
}

/** A GSDML repository row. Stores keep it exactly as given and return it exactly as kept. */
export type GsdmlStoredRow = DescriptionStoredRow<GsdmlRepositorySummary>

/** GSDML row storage. Stores and returns rows verbatim. */
export type GsdmlRowStore = DescriptionRowStore<GsdmlRepositorySummary>
