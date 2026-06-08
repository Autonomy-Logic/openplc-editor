/**
 * Chunk model — the unit the transpiler accumulates and then joins
 * into the final ST source.
 *
 * A chunk is `[text, location]`: the text fragment to emit, plus a
 * variable-arity tuple identifying where the fragment came from
 * (POU tag, region, index, …) so the editor can navigate back to
 * source from cursor positions in the generated ST.
 */

export type LocationAtom = string | number | readonly (string | number)[]
export type Location = readonly LocationAtom[]
export type ProgramChunk = readonly [text: string, location: Location]
