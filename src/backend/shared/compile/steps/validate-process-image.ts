/**
 * Reject `AT %…` locations that fall outside the target's process image.
 *
 * The firmware declares its I/O buffers from the `MAX_*` macros in
 * `resources/sources/arduino/openplc.h`, so a location past the end names
 * a slot that does not exist. Nothing downstream can rescue it: the glue
 * now skips the binding (it used to write past the array), the HAL never
 * reads the slot, and the variable is simply inert on the board.
 *
 * The Python editor caught this at glue-code generation and refused the
 * build with `wrong location for var __QX7_0`. That check did not survive
 * the move to strucpp, so between then and now the editor happily built a
 * program whose I/O silently did nothing — the failure mode reported in
 * openplc-editor#296, where a P1AM backplane wide enough to need more than
 * 56 outputs lost every point past the 56th without a word.
 *
 * This step restores the refusal, and says which board and which limit.
 *
 * Pure function: no fs I/O, no DOM, no global state.
 */

import type { ProcessImageSizes } from '@root/middleware/shared/utils/target-capabilities'

import { type AddressClass, parseAddress } from '../../../../middleware/shared/utils/iec-address/registry'
import type { PLCProjectData, PLCVariable } from '../../types/PLC/open-plc'

/**
 * The sizes `openplc.h` falls back to when the target declares no
 * `processImage` — its `#else` branch, i.e. every board that is not one of
 * the four small AVRs.
 *
 * Deliberately NOT the small-AVR branch (8 DI / 6 AI / no `%M` area at
 * all). Picking the larger of the two makes this check permissive rather
 * than strict on an Uno or a Leonardo, which is the safe direction: the
 * cost of being permissive is a variable that stays inert exactly as it
 * does today, while the cost of being strict would be refusing to build a
 * project that has been building for years. Distinguishing the two
 * branches here would mean mapping an arduino-cli FQBN back to its MCU
 * define, a mapping the editor does not otherwise keep and that would
 * silently rot as cores are added.
 */
export const FIRMWARE_FALLBACK_PROCESS_IMAGE: ProcessImageSizes = {
  digitalInputs: 56,
  digitalOutputs: 56,
  analogInputs: 32,
  analogOutputs: 32,
  realInputs: 32,
  realOutputs: 32,
  memoryWords: 20,
  memoryDwords: 20,
  memoryLwords: 20,
}

/** One located variable whose address has no slot on the target. */
export type OutOfRangeLocation = {
  /** POU that declares it, or `'Global Variables'` for a config global. */
  scope: string
  variableName: string
  /** The offending literal address, e.g. `'%QX7.0'`. */
  location: string
  /** Highest slot the declaration needs (`byte*8 + bit` for bits). For an
   *  array this is its LAST element, which is the one that overflows. */
  slot: number
  /** How many slots the target actually has in that area. */
  capacity: number
  /** Human name of the area, for the message: `'%QX (digital outputs)'`. */
  area: string
  /** Elements the declaration occupies; 1 for a scalar. Present so the
   *  message can explain that the address itself is fine and the array's
   *  length is what runs off the end. */
  slotCount: number
}

/**
 * `%<direction><size>` → the process-image field that bounds it, plus the
 * label used in the error message.
 *
 * `%IB`/`%QB`/`%MB`/`%MX` are absent on purpose: the Arduino firmware
 * declares no byte-addressed buffers and no bit-addressed memory area, so
 * there is no capacity to compare against. Leaving them unmapped skips
 * them rather than measuring them against a number that means something
 * else.
 */
const AREA_BOUNDS: Record<string, { field: keyof ProcessImageSizes; label: string }> = {
  IX: { field: 'digitalInputs', label: '%IX (digital inputs)' },
  QX: { field: 'digitalOutputs', label: '%QX (digital outputs)' },
  IW: { field: 'analogInputs', label: '%IW (analog inputs)' },
  QW: { field: 'analogOutputs', label: '%QW (analog outputs)' },
  ID: { field: 'realInputs', label: '%ID (analog inputs, REAL)' },
  QD: { field: 'realOutputs', label: '%QD (analog outputs, REAL)' },
  MW: { field: 'memoryWords', label: '%MW (memory words)' },
  MD: { field: 'memoryDwords', label: '%MD (memory double words)' },
  ML: { field: 'memoryLwords', label: '%ML (memory long words)' },
}

const areaKey = (cls: AddressClass): string => `${cls.direction}${cls.size}`

/**
 * Every located variable in the project, paired with the scope that
 * declares it. Covers POU-local `VAR … AT` and CONFIGURATION
 * VAR_GLOBAL — the only two places IEC allows a location, and the two the
 * editor's own validation permits.
 */
function* locatedVariables(
  projectData: PLCProjectData,
): Generator<{ scope: string; name: string; location: string; slotCount: number }> {
  for (const pou of projectData.pous) {
    for (const variable of pou.data.variables) {
      if (variable.location)
        yield {
          scope: pou.data.name,
          name: variable.name,
          location: variable.location,
          slotCount: declaredSlotCount(variable.type),
        }
    }
  }
  for (const variable of projectData.configuration.resource.globalVariables) {
    if (variable.location)
      yield {
        scope: 'Global Variables',
        name: variable.name,
        location: variable.location,
        slotCount: declaredSlotCount(variable.type),
      }
  }
}

/**
 * How many consecutive slots a declaration claims from its address.
 *
 * A scalar claims one. A located ARRAY claims one per element, laid out from
 * the declared address — `AT %MW60 : ARRAY [0..66] OF WORD` needs %MW60
 * through %MW126 (openplc-editor#565), so checking only the base address
 * would pass a declaration whose tail runs off the end of the image.
 *
 * Falls back to 1 for anything whose extent can't be read: a malformed
 * dimension, a multi-dimensional array (which the compiler rejects for a
 * located variable anyway), or a missing `data` block. Under-counting only
 * costs a missed diagnostic, whereas guessing high would refuse builds that
 * are fine.
 */
function declaredSlotCount(variableType: PLCVariable['type'] | undefined): number {
  // `type` is schema-required, but project.json is a file on disk that the
  // user (or an older editor) can have written; a missing type must not
  // crash the build with a TypeError instead of a diagnostic.
  if (variableType?.definition !== 'array') return 1

  const dimensions = variableType.data?.dimensions
  if (!dimensions || dimensions.length !== 1) return 1

  const bounds = /^\s*(\d+)\s*\.\.\s*(\d+)\s*$/.exec(dimensions[0]?.dimension ?? '')
  if (!bounds) return 1

  const start = Number(bounds[1])
  const end = Number(bounds[2])
  return end >= start ? end - start + 1 : 1
}

/**
 * Find every located variable that addresses a slot the target does not
 * have.
 *
 * `processImage` is the target's declared image, or `undefined` for a
 * board that declares none — in which case the firmware's own fallback
 * sizes apply, since that is what `openplc.h` will compile with.
 *
 * Only literal `%…` locations are checked. A location that is an alias
 * name has already been resolved to a literal by
 * `getCompileReadyProjectData()` before the pipeline runs; anything still
 * unresolved at this point resolved to nothing, which makes the variable
 * unlocated rather than out of range. Addresses in an area the firmware
 * has no buffer for (`%IB`, `%MX`) are skipped for the same reason:
 * there is no capacity to measure them against.
 */
export function findOutOfRangeLocations(
  projectData: PLCProjectData,
  processImage: ProcessImageSizes | undefined,
): OutOfRangeLocation[] {
  const image = processImage ?? FIRMWARE_FALLBACK_PROCESS_IMAGE
  const issues: OutOfRangeLocation[] = []

  for (const { scope, name, location, slotCount } of locatedVariables(projectData)) {
    const parsed = parseAddress(location)
    if (parsed === null) continue

    const bound = AREA_BOUNDS[areaKey(parsed.cls)]
    if (bound === undefined) continue

    // The LAST slot is what has to fit: an array starting inside the image
    // can still run off the end of it.
    const lastSlot = parsed.linear + slotCount - 1
    const capacity = image[bound.field]
    if (lastSlot < capacity) continue

    issues.push({
      scope,
      variableName: name,
      location,
      slot: lastSlot,
      capacity,
      area: bound.label,
      slotCount,
    })
  }

  return issues
}

/**
 * One-line, actionable rendering of an out-of-range location.
 *
 * Names the board because the same project can be valid on one target and
 * not on another — switching targets is exactly how a user lands here —
 * and quoting the limit turns "it does not work" into a number the user
 * can design against.
 */
export function describeOutOfRangeLocation(issue: OutOfRangeLocation, boardTarget: string): string {
  const last =
    issue.capacity === 0
      ? `"${boardTarget}" has no ${issue.area} area at all`
      : `"${boardTarget}" supports ${issue.capacity} (last usable: slot ${issue.capacity - 1})`
  // For an array the base address is usually fine and the LENGTH is what
  // overflows, so say which slot the last element lands on rather than
  // pointing at an address that looks perfectly legal.
  const reach =
    issue.slotCount > 1 ? `whose ${issue.slotCount} elements reach slot ${issue.slot}` : `which is slot ${issue.slot}`
  return (
    `${issue.scope}: variable "${issue.variableName}" is located at ${issue.location}, ` +
    `${reach} of ${issue.area} — ${last}.`
  )
}
