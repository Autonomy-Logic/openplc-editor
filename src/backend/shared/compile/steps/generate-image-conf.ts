/**
 * Author the `image.conf` a runtime-v4 upload carries (DOPE-615).
 *
 * The image size is a PROJECT property. It is derived at compile time from
 * what the project contains (`compute-io-image.ts`), travels to the device
 * inside the program upload, and the runtime allocates its tables from it on
 * load — the same route `retain.conf` and the VPP plugin configuration take.
 * Before this, the runtime allocated `BUFFER_SIZE 1024` per table for every
 * program that ever ran on it.
 *
 * WHY FLAT `key=value` AND NOT JSON
 * ---------------------------------
 * The same reasoning recorded for `retain.conf`: this file is read by the PLC
 * application in C++ during startup, before any plugin exists, and a
 * dependency-free parser for a handful of keys is a better trade there than
 * pulling a JSON library into the PLC application. It is deliberately NOT one
 * of the `conf/*.json` files — those are read by plugins, in Python, after the
 * core is already up.
 *
 * WHAT THE KEYS ARE
 * -----------------
 * One key per table in `core/src/plc_app/image_tables.h`, named after the
 * table, because the runtime is the reader and these are its own words. There
 * are fourteen, and the set has one asymmetry worth knowing: `byte_input` and
 * `byte_output` exist but there is no `byte_memory`, so `%MB` has no storage.
 *
 * THE UNIT IS THE TABLE'S OWN, WHICH IS NOT ALWAYS THE ADDRESS'S
 * -------------------------------------------------------------
 * Every value is a count of that table's elements — how long the runtime has
 * to make the array. For eleven tables that is the same as the number of
 * addresses (`int_memory[N]` holds N `%MW`s). For the three BOOL tables it is
 * not: they are declared `IEC_BOOL *table[N][8]`, so N is a count of BYTES
 * while `%QX` addresses bits. A bits-for-bytes mixup here would produce an
 * image eight times too small and no diagnostic anywhere, so the conversion is
 * done once, here, and asserted in the tests. Sizes arrive as multiples of 8
 * (FR06), which is what makes the division exact.
 *
 * WHY EVERY KEY IS WRITTEN, INCLUDING ZEROS
 * -----------------------------------------
 * "Absent means zero" is an editor-side convention and the C parser should not
 * have to know it. A zero is a real answer, not a gap: a program with no `%QX`
 * has no reason to carry a `bool_output` image, and the memory it does not
 * reserve goes back to the program (FR21, BR12, BR10).
 *
 * Pure function: no fs I/O, no platform coupling. The caller puts the returned
 * string into the upload bundle.
 */

import type { IoImageSizes } from './compute-io-image'

/** Bit tables are `IEC_BOOL *table[N][8]` — N counts bytes, not bits. */
const BITS_PER_BYTE = 8

/**
 * The fourteen tables, in the order `image_tables.h` declares them, paired
 * with the IEC prefix whose addresses they store.
 *
 * Declaration order rather than alphabetical: the file is meant to be read
 * next to the header, and a reader checking that nothing is missing should be
 * able to go down both in step. Fixed order is also what makes the output
 * byte-stable for the same project (FR07).
 */
const TABLES: ReadonlyArray<{ key: string; prefix: string; bits: boolean }> = [
  { key: 'bool_input', prefix: '%IX', bits: true },
  { key: 'bool_output', prefix: '%QX', bits: true },
  { key: 'byte_input', prefix: '%IB', bits: false },
  { key: 'byte_output', prefix: '%QB', bits: false },
  { key: 'int_input', prefix: '%IW', bits: false },
  { key: 'int_output', prefix: '%QW', bits: false },
  { key: 'dint_input', prefix: '%ID', bits: false },
  { key: 'dint_output', prefix: '%QD', bits: false },
  { key: 'lint_input', prefix: '%IL', bits: false },
  { key: 'lint_output', prefix: '%QL', bits: false },
  { key: 'int_memory', prefix: '%MW', bits: false },
  { key: 'dint_memory', prefix: '%MD', bits: false },
  { key: 'lint_memory', prefix: '%ML', bits: false },
  { key: 'bool_memory', prefix: '%MX', bits: true },
]

/**
 * How long the runtime has to make one table, in that table's own elements.
 *
 * `Math.ceil` on the bit tables rather than a plain division: the sizer
 * rounds bit areas to a whole byte, so the division is already exact and the
 * ceiling is unreachable — but rounding DOWN if that ever stopped being true
 * would leave the slots of the partial byte unaddressable, which is the
 * failure mode the rounding exists to prevent. Erring upward costs one byte.
 */
function elementCount(sizes: IoImageSizes, table: (typeof TABLES)[number]): number {
  const slots = sizes[table.prefix] ?? 0
  return table.bits ? Math.ceil(slots / BITS_PER_BYTE) : slots
}

/**
 * The `image.conf` body for this project.
 *
 * Always a string, never `null` — unlike `retain.conf`, whose absence is a
 * meaningful instruction ("delete your copy and switch the built-in store
 * off"). An absent `image.conf` says nothing: the runtime falls back to the
 * floor it derives from the loaded program, which is a safe default rather
 * than a configuration choice, so there is no case where withholding the file
 * expresses something writing it could not.
 *
 * A runtime too old to read it is safe for the same reason. It ignores a file
 * it does not know and keeps its compiled-in `BUFFER_SIZE`, which is exactly
 * today's behaviour — so no editor-side version gate is needed here, and
 * inventing a minimum version before the runtime side exists would be picking
 * a number out of the air.
 */
export function generateImageConf(sizes: IoImageSizes): string {
  const lines = [
    '# I/O image sizes for this program.',
    '# Emitted by the OpenPLC editor from what the project actually contains',
    '# and installed by the program upload; read by the PLC application when',
    '# the program loads. Edits here are overwritten on the next upload.',
    '#',
    '# One key per table in core/src/plc_app/image_tables.h. Each value is a',
    '# count of ELEMENTS in that table, so the three BOOL tables are in bytes',
    '# (they are declared [N][8]) while every other table is in its own',
    '# width. Zero means the program addresses nothing in that area and the',
    '# runtime should allocate nothing for it.',
  ]

  for (const table of TABLES) {
    lines.push(`${table.key}=${elementCount(sizes, table)}`)
  }

  return `${lines.join('\n')}\n`
}
