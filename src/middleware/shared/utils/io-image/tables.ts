/**
 * The I/O image tables, written down once (DOPE-615).
 *
 * "Which tables exist, which IEC prefix each one stores, in which unit, and on
 * which runtime" was stated in five places in this repository, and a sixth was
 * about to be added for the S7comm sizer. Five copies of one fact is five
 * chances for them to disagree, and every way they can disagree is silent:
 *
 *   - a table in the runtime's list but not the editor's is sized to zero and
 *     the program loses that area;
 *   - a prefix paired with the wrong table sizes the wrong storage;
 *   - a unit written differently on the two sides is a factor of eight nobody
 *     sees until an address above the first eighth stops answering.
 *
 * So the five derive from this. Adding a table is one line here.
 *
 * ORDER IS PART OF THE CONTRACT and is the declaration order of
 * `core/src/plc_app/image_tables.h`. `image.conf` is written in this order so
 * a reader can go down the file and the header in step, the runtime's own
 * contract test checks that order from the C side, and the compile cache
 * depends on the bytes being stable. It is not alphabetical and should not be
 * made so.
 *
 * The bare-metal macro order falls out of the same list: filtering to the
 * entries that have one yields exactly the order `defines.h` already emitted,
 * so there is no second order to maintain.
 */

/** How a table's addresses are counted. NOT always how its storage is shaped:
 *  the BOOL tables are `IEC_BOOL *[N][8]`, so their storage is in bytes while
 *  `%QX` addresses bits. The file carries the ADDRESS's unit and each consumer
 *  converts if its own storage needs it. */
export type ImageUnit = 'bits' | 'bytes' | 'words' | 'dwords' | 'lwords'

export interface ImageTable {
  /** The runtime's name for it, which is the `image.conf` key. */
  key: string
  /** The IEC prefix whose addresses it stores. */
  prefix: string
  unit: ImageUnit
  /** The firmware macro, for the areas bare metal has. `undefined` means bare
   *  metal declares no buffer of that kind at all — a fact about that
   *  firmware, not an omission to be tidied up. Spelled out on every row
   *  rather than left off, so the reader sees the answer for each table
   *  instead of inferring it from a missing key. */
  macro: string | undefined
}

export const IMAGE_TABLES = [
  { key: 'bool_input', prefix: '%IX', unit: 'bits', macro: 'MAX_DIGITAL_INPUT' },
  { key: 'bool_output', prefix: '%QX', unit: 'bits', macro: 'MAX_DIGITAL_OUTPUT' },
  { key: 'byte_input', prefix: '%IB', unit: 'bytes', macro: undefined },
  { key: 'byte_output', prefix: '%QB', unit: 'bytes', macro: undefined },
  { key: 'int_input', prefix: '%IW', unit: 'words', macro: 'MAX_ANALOG_INPUT' },
  { key: 'int_output', prefix: '%QW', unit: 'words', macro: 'MAX_ANALOG_OUTPUT' },
  { key: 'dint_input', prefix: '%ID', unit: 'dwords', macro: 'MAX_REAL_INPUT' },
  { key: 'dint_output', prefix: '%QD', unit: 'dwords', macro: 'MAX_REAL_OUTPUT' },
  { key: 'lint_input', prefix: '%IL', unit: 'lwords', macro: undefined },
  { key: 'lint_output', prefix: '%QL', unit: 'lwords', macro: undefined },
  { key: 'int_memory', prefix: '%MW', unit: 'words', macro: 'MAX_MEMORY_WORD' },
  { key: 'dint_memory', prefix: '%MD', unit: 'dwords', macro: 'MAX_MEMORY_DWORD' },
  { key: 'lint_memory', prefix: '%ML', unit: 'lwords', macro: 'MAX_MEMORY_LWORD' },
  { key: 'bool_memory', prefix: '%MX', unit: 'bits', macro: undefined },
] as const satisfies readonly ImageTable[]

/** The table names, as a literal union — what an `image.conf` key is, and
 *  what an S7comm data block may be mapped onto. Derived so the union cannot
 *  drift from the list. */
export type ImageTableKey = (typeof IMAGE_TABLES)[number]['key']

/**
 * The areas Runtime v4 declares tables for.
 *
 * Note the gap this makes visible: `byte_input` and `byte_output` exist but
 * there is no `byte_memory`, so `%MB` has no storage on v4 at all.
 */
export const IMAGE_AREAS_RUNTIME_V4: ReadonlySet<string> = new Set(
  IMAGE_TABLES.map((table) => table.prefix),
)

/**
 * The areas bare metal declares buffers for — the ones with a macro.
 *
 * Fewer than v4's: no byte-addressed buffer and no bit-addressed memory area,
 * which is why `%MX` on bare metal is reported as unsupported rather than
 * silently dropped as it is today (DOPE-605).
 */
export const IMAGE_AREAS_BAREMETAL: ReadonlySet<string> = new Set(
  IMAGE_TABLES.filter((table) => table.macro).map((table) => table.prefix),
)

/** How many elements of `table` a count in the file's unit amounts to.
 *  The BOOL tables are the only ones whose address unit and storage unit
 *  differ, and rounding UP is what keeps the slots of a partial byte
 *  addressable. */
export function elementsFor(table: Pick<ImageTable, 'unit'>, count: number): number {
  return table.unit === 'bits' ? Math.ceil(count / 8) : count
}

/**
 * How many BYTES one element of this table occupies.
 *
 * The BOOL tables are one byte per element because their storage is
 * `IEC_BOOL *[N][8]` — eight addressable bits packed into the byte.
 */
const BYTES_PER_ELEMENT: Record<ImageUnit, number> = {
  bits: 1,
  bytes: 1,
  words: 2,
  dwords: 4,
  lwords: 8,
}

/** How many ADDRESSES one element of this table carries. One, except for the
 *  BOOL tables, where an element is a byte and the addresses are its bits. */
const ADDRESSES_PER_ELEMENT: Record<ImageUnit, number> = {
  bits: 8,
  bytes: 1,
  words: 1,
  dwords: 1,
  lwords: 1,
}

/**
 * The extent an S7comm data block requires of the table it is mapped onto,
 * in that table's ADDRESS unit — which is what the image is sized in.
 *
 * Two conversions meet here and they pull in opposite directions, which is
 * why it is written down once with a test from both sides (DOPE-615, B3):
 *
 *   - `sizeBytes` is a size on the WIRE and has to become elements. 128 bytes
 *     of `int_output` is 64 words, not 128. A partial element is dropped:
 *     three bytes of a word table is one addressable word, not one and a half.
 *   - `startBuffer` is already an ELEMENT index into that table, and the
 *     result has to come back out in addresses. For the BOOL tables those
 *     differ by eight: a block at element 2 of `bool_output`, four bytes long,
 *     reaches bit 47 and so needs 48 bits.
 *
 * Getting either backwards sizes an area by a factor of two, four or eight,
 * with no diagnostic: the block simply stops answering partway through.
 *
 * RETURNS BOTH ENDS, and the caller needs both for different things. `end` is
 * the high-water mark, which is what SIZES the area, because the image is a
 * contiguous buffer and a block reaching address 103 needs 104 of them.
 * `start` is where the block's coverage actually begins, which is what BACKS:
 * a block at `startBuffer` 100 produces nothing at all below 100, and saying
 * otherwise would vouch for addresses the plugin never writes.
 */
export function extentForDataBlock(
  table: Pick<ImageTable, 'unit'>,
  startBuffer: number,
  sizeBytes: number,
): { start: number; end: number } {
  const elements = Math.floor(sizeBytes / BYTES_PER_ELEMENT[table.unit])
  const scale = ADDRESSES_PER_ELEMENT[table.unit]
  return { start: startBuffer * scale, end: (startBuffer + elements) * scale }
}

/** Look a table up by the prefix it stores, or `undefined` for a prefix no
 *  runtime has storage for (`%MB`). */
export function tableForPrefix(prefix: string): (typeof IMAGE_TABLES)[number] | undefined {
  return IMAGE_TABLES.find((table) => table.prefix === prefix)
}
