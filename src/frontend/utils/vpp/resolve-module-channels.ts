/**
 * Resolve which channel array applies to a given slot.
 *
 * Three modes, evaluated in this order:
 *
 *   1. **Module-wide format selector** — `formatFieldId` +
 *      `channelsByFormat`. The slot's current value of `formatFieldId`
 *      (or `formatDefault` when unset) picks ONE of several whole-
 *      channel-array variants. Used by the SLM-RP4 V/mA cards: raw
 *      UINT16 on `%IW`/`%QW` versus REAL/engineering-units on
 *      `%ID`/`%QD` — all channels switch together. When this kicks
 *      in, `channels` + `perChannelChoices` are ignored (the format
 *      is the entire interface).
 *
 *   2. **Per-channel format selector** — `perChannelChoices`. An
 *      array of `{ fieldId, default, modes }` entries; each entry
 *      contributes EITHER one channel (the one its `modes[value]`
 *      picks) OR zero channels (when `modes[value]` is `null` — the
 *      "this mode disables the channel" case). Used by the Arduino
 *      Opta built-in's eight physical input pins: each pin can be a
 *      `BOOL` on `%IX` or a `UINT` on `%IW` independently, so the
 *      module-wide switch above doesn't fit. The resulting channel
 *      list is `[ static channels, …, per-channel-resolved channels, … ]`
 *      in declaration order.
 *
 *   3. **Static channels** — the literal `channels` array, returned
 *      verbatim when neither selector above applies. Modules with a
 *      single, static channel set (the common case across SLM-RP4
 *      and most modules) only declare `channels`.
 *
 * The three modes are mutually exclusive at the top level
 * (`channelsByFormat` short-circuits before `perChannelChoices`), but
 * `perChannelChoices` is additive with `channels` — static channels
 * (relays, LEDs, button) come from `channels`; the pins-that-vary
 * come from `perChannelChoices`. That mirrors the Opta hardware:
 * outputs/LEDs/button are fixed BOOLs; only the eight input pins
 * carry per-pin mode state.
 */

export type ResolverModuleChannel = {
  name: string
  type: string
  dataType: string
  addressPrefix: string
  /** When this channel was resolved out of a `perChannelChoices` entry,
   *  the `fieldId` that selected it (so callers like the IO Table can
   *  surface a per-row mode dropdown that mutates the same slotsConfig
   *  field). Absent for statically-declared channels. */
  modeFieldId?: string
  /** The set of mode keys available on the originating
   *  `perChannelChoices` entry (`Object.keys(modes)`). Absent for
   *  statically-declared channels. The IO Table renders one option per
   *  key; selecting one writes `key` back to `slotsConfig[slot][modeFieldId]`. */
  modeOptions?: string[]
  /** Current selected mode key (the value of `slotConfig[modeFieldId]`,
   *  or the entry's `default`). Absent for static channels. */
  modeValue?: string
}

/** One per-channel selector entry. `modes` maps the slot's value for
 *  `fieldId` to a channel (or `null` = mode contributes nothing —
 *  e.g. "disabled" or "not connected"). When the slot doesn't set the
 *  field, `default` is consulted. When the resolved key isn't in
 *  `modes`, the entry contributes nothing (defensive — never throws). */
export type ResolverPerChannelChoice = {
  fieldId: string
  default?: string
  modes: Record<string, ResolverModuleChannel | null>
}

export type ResolverAddressMapping = {
  channels?: ResolverModuleChannel[]
  formatFieldId?: string
  formatDefault?: string
  channelsByFormat?: Record<string, ResolverModuleChannel[]>
  perChannelChoices?: ResolverPerChannelChoice[]
}

export type ResolverModuleDef = {
  addressMapping?: ResolverAddressMapping
}

export type SlotFieldValue = string | number | boolean

export function resolveModuleChannels(
  moduleDef: ResolverModuleDef | undefined,
  slotConfig: Record<string, SlotFieldValue> | undefined,
): ResolverModuleChannel[] {
  const mapping = moduleDef?.addressMapping
  if (!mapping) return []

  // 1. Module-wide format selector (V/mA cards).
  const fid = mapping.formatFieldId
  const byFormat = mapping.channelsByFormat
  if (fid && byFormat) {
    const slotValue = slotConfig?.[fid]
    const key =
      slotValue !== undefined && slotValue !== null && slotValue !== '' ? String(slotValue) : mapping.formatDefault
    if (key && byFormat[key]) return byFormat[key]
  }

  // 2. Static channels + per-channel selectors (Opta-style per-pin
  //    mode). Static channels first so address allocation stays
  //    stable across mode changes; per-channel-resolved appended in
  //    declaration order.
  const out: ResolverModuleChannel[] = []
  if (mapping.channels) out.push(...mapping.channels)
  if (mapping.perChannelChoices) {
    for (const entry of mapping.perChannelChoices) {
      const slotValue = slotConfig?.[entry.fieldId]
      const key = slotValue !== undefined && slotValue !== null && slotValue !== '' ? String(slotValue) : entry.default
      if (key === undefined) continue
      const channel = entry.modes[key]
      if (channel) {
        // Tag with the originating field — lets the IO Table render a
        // mode selector for this row and write back to the same slot
        // config field that drove this resolution.
        out.push({
          ...channel,
          modeFieldId: entry.fieldId,
          modeOptions: Object.keys(entry.modes),
          modeValue: key,
        })
      }
    }
  }
  return out
}
