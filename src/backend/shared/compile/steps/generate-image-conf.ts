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
 * THE UNIT IS THE ADDRESS'S OWN, AND IT TRAVELS WITH THE NUMBER
 * -------------------------------------------------------------
 * Every value carries the unit the addresses of that table use, as a word:
 * `int_output=4 words`, `bool_output=6 bits`. Nothing here converts anything.
 *
 * The three BOOL tables are the reason the unit is written down at all. Their
 * STORAGE is `IEC_BOOL *table[N][8]`, so N counts bytes, while `%QX` addresses
 * bits — the one place where a table's storage unit and its address unit
 * differ. This file emits bits and the runtime divides, once, where the
 * storage shape is known. A value read in the wrong unit is an image eight
 * times too small with no diagnostic on either side, which is what the unit
 * word exists to make impossible.
 *
 * Nothing pads either: the sizer reports a raw high-water mark. FR06's
 * multiple-of-8 rule belongs to `generate-defines.ts`, the only consumer that
 * declares `bool_input[MAX/8][8]` and divides.
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

import { IMAGE_TABLES } from '../../../../middleware/shared/utils/io-image/tables'
import type { IoImageSizes } from './compute-io-image'

/**
 * The fourteen tables, in the order `image_tables.h` declares them, paired
 * with the IEC prefix whose addresses they store.
 *
 * Declaration order rather than alphabetical: the file is meant to be read
 * next to the header, and a reader checking that nothing is missing should be
 * able to go down both in step. Fixed order is also what makes the output
 * byte-stable for the same project (FR07).
 */

/** Bumped whenever a reader would misread an older file. Version 2 is the
 *  first version any device has ever seen: version 1 was written but never
 *  merged, so the parser needs no compatibility branch. */
const FORMAT_VERSION = 2

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
    '# One key per table in core/src/plc_app/image_tables.h. Every value',
    '# carries the unit of the ADDRESS it stores: the three BOOL tables are',
    '# in bits, because %QX addresses bits, and the runtime converts to the',
    '# [N][8] shape its storage actually has. Zero means the program',
    '# addresses nothing in that area and the runtime allocates nothing.',
    `format_version=${FORMAT_VERSION}`,
  ]

  for (const table of IMAGE_TABLES) {
    lines.push(`${table.key}=${sizes[table.prefix] ?? 0} ${table.unit}`)
  }

  return `${lines.join('\n')}\n`
}
