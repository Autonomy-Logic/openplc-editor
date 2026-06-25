/**
 * Generates a runtime plugin config JSON for a VPP vendor package.
 *
 * The plugin config merges three sources:
 *   1. The VPP package's `config_template.json` (fixed fields, defaults)
 *   2. Vendor screen form data (e.g., "hal-config" settings) — merged at the root level
 *   3. Module slot assignments + I/O mapping — serialized as the `slots` array
 *
 * The resulting JSON is what the runtime plugin reads at startup to configure
 * bus settings and know which modules are installed in which slots.
 *
 * Slot format conforms to the convention used by runtime plugins (e.g., synergy):
 *   {
 *     "slot": 1,
 *     "module_hw_id": "0x24A500E1",   // from VPP manifest module.hwId
 *     "io_mapping": {
 *       "digital_inputs":  { "base_byte": 0, "base_bit": 0, "count": 8 },
 *       "digital_outputs": { "base_byte": 0, "base_bit": 1, "count": 8 },
 *       "analog_inputs":   { "base_word": 0, "count": 4 },
 *       "analog_outputs":  { "base_word": 0, "count": 2 },
 *       "analog_real_inputs":  { "base_dword": 0, "count": 4 },
 *       "analog_real_outputs": { "base_dword": 0, "count": 2 }
 *     }
 *   }
 *
 * Channels are bucketed by `addressPrefix` (not `type`) because a single
 * "analogInput" channel may live in either the UINT16 image table (%IW,
 * scaled counts) or the 32-bit image table (%ID, IEEE-754 floats).
 */

import { bytesToHexString, encodeConfigBytes } from './byte-encoder'

type ModuleChannel = {
  name: string
  type: string
  dataType: string
  addressPrefix: string
}

type VppModuleDefinition = {
  id: string
  name: string
  hwId?: string
  addressMapping?: unknown
  /** Optional per-module config-screen JSON. Pre-loaded by the caller
   *  (compiler-module) so this pure-function generator never touches
   *  the filesystem. */
  configScreenDefinition?: unknown
}

type ModuleConfiguration = {
  slots?: (string | null)[]
  /** Per-slot bag of form-field values, keyed by 1-based slot number
   *  (stored as a string for JSON safety). Populated by the master-
   *  detail backplane editor when the user fills in a module's
   *  configuration form. */
  slotsConfig?: Record<string, Record<string, string | number | boolean>>
}

type IoMappingEntry = {
  slot: number
  channelName: string
  iecAddress: string
  alias: string
}

type IoMapping = {
  entries?: IoMappingEntry[]
}

type VendorScreenData = Record<string, unknown>

/** A single row of the editor's GPIO pin-mapping table. Only the fields
 *  this serializer needs are modelled. */
type DevicePinInput = {
  pin: string
  pinType: string
  address: string
}

/** One entry of the plugin config's `pins` array, as consumed by a
 *  pin-based runtime-v4 plugin (e.g. the Raspberry Pi GPIO HAL). `pin` is
 *  the board's native pin identifier as typed in the pin-mapping table — for
 *  the Raspberry Pi that's the physical 40-pin header position.
 *
 *  Digital lines carry byte/bit (the %IX/%QX image-table location); PWM
 *  (analog) outputs carry word (the %QW index). */
type PluginPin =
  | { pin: number; direction: 'input' | 'output'; byte: number; bit: number }
  | { pin: number; direction: 'pwm'; word: number }

type BitRangeMapping = {
  base_byte: number
  base_bit: number
  count: number
}

type WordRangeMapping = {
  base_word: number
  count: number
}

type DwordRangeMapping = {
  base_dword: number
  count: number
}

type PluginSlotIoMapping = {
  digital_inputs?: BitRangeMapping
  digital_outputs?: BitRangeMapping
  analog_inputs?: WordRangeMapping
  analog_outputs?: WordRangeMapping
  analog_real_inputs?: DwordRangeMapping
  analog_real_outputs?: DwordRangeMapping
}

type PluginSlot = {
  slot: number
  module_hw_id?: string
  /** Module configuration bytes for the runtime to push over SPI
   *  immediately after sign-on. Hex-encoded space-separated string,
   *  e.g. "40 03 60 05 21 00 22 00 ...". Absent when the module has
   *  no configuration screen or the user left every field empty. */
  module_config?: string
  io_mapping: PluginSlotIoMapping
}

const BIT_ADDRESS_REGEX = /^%[IQ]X(\d+)\.(\d+)$/
const WORD_ADDRESS_REGEX = /^%[IQ]W(\d+)$/
const DWORD_ADDRESS_REGEX = /^%[IQ]D(\d+)$/

/** Parse a bit IEC address (%IX5.3 / %QX1.7) into a byte+bit pair. */
function parseBitAddress(addr: string): { byte: number; bit: number } | null {
  const m = BIT_ADDRESS_REGEX.exec(addr)
  if (!m) return null
  return { byte: Number(m[1]), bit: Number(m[2]) }
}

/** Parse a word IEC address (%IW12 / %QW5) into a word index. */
function parseWordAddress(addr: string): number | null {
  const m = WORD_ADDRESS_REGEX.exec(addr)
  if (!m) return null
  return Number(m[1])
}

/** Parse a double-word IEC address (%ID12 / %QD5) into a dword index. */
function parseDwordAddress(addr: string): number | null {
  const m = DWORD_ADDRESS_REGEX.exec(addr)
  /* istanbul ignore if -- callers (buildDwordRange) only invoke this with addresses
     pulled from `io-mapping` rows the editor already validated; malformed input is a
     schema-drift guard, not a runtime path */
  if (!m) return null
  return Number(m[1])
}

/**
 * Convert (byte, bit) to a linear bit index so that wrap-across-byte
 * channel ranges can still be expressed as base + count.
 * %IX0.0 → 0, %IX0.7 → 7, %IX1.0 → 8, %IX1.7 → 15, etc.
 */
function bitAddressToLinear(byte: number, bit: number): number {
  return byte * 8 + bit
}

/**
 * Given a list of channels of the same type and their assigned IEC addresses,
 * compute a contiguous base_byte / base_bit / count mapping. Addresses are
 * assumed to be linearly contiguous (editor allocator allocates a block for
 * each module's channel type), but we tolerate a non-contiguous layout by
 * falling back to count=channels.length even if there are gaps — the plugin
 * would still see the correct count.
 */
function buildBitRange(channels: { name: string; address: string }[]): BitRangeMapping | null {
  if (channels.length === 0) return null
  const parsed: { byte: number; bit: number; linear: number }[] = []
  for (const ch of channels) {
    const p = parseBitAddress(ch.address)
    /* istanbul ignore if -- defensive: channel addresses come from the editor's io-mapping
       store which validates address shape on entry */
    if (!p) return null
    parsed.push({ ...p, linear: bitAddressToLinear(p.byte, p.bit) })
  }
  parsed.sort((a, b) => a.linear - b.linear)
  return {
    base_byte: parsed[0].byte,
    base_bit: parsed[0].bit,
    count: parsed.length,
  }
}

function buildWordRange(channels: { name: string; address: string }[]): WordRangeMapping | null {
  if (channels.length === 0) return null
  const parsed: number[] = []
  for (const ch of channels) {
    const w = parseWordAddress(ch.address)
    if (w === null) return null
    parsed.push(w)
  }
  parsed.sort((a, b) => a - b)
  return { base_word: parsed[0], count: parsed.length }
}

function buildDwordRange(channels: { name: string; address: string }[]): DwordRangeMapping | null {
  if (channels.length === 0) return null
  const parsed: number[] = []
  for (const ch of channels) {
    const d = parseDwordAddress(ch.address)
    /* istanbul ignore if -- defensive guard, same rationale as buildBitRange */
    if (d === null) return null
    parsed.push(d)
  }
  parsed.sort((a, b) => a - b)
  return { base_dword: parsed[0], count: parsed.length }
}

/**
 * Build the `slots` array for the plugin config by cross-referencing:
 *   - Which module is in each slot (from vendor screen `module-configuration`)
 *   - The channel definitions of that module (from VPP manifest `addressMapping`)
 *   - The assigned IEC addresses and user aliases (from vendor screen `io-mapping`)
 *   - The manifest module's hwId for the plugin's module database lookup
 */
function buildSlots(vendorScreenData: VendorScreenData, modules: VppModuleDefinition[]): PluginSlot[] {
  const moduleConfig = (vendorScreenData['module-configuration'] as ModuleConfiguration | undefined) ?? {}
  const ioMapping = (vendorScreenData['io-mapping'] as IoMapping | undefined) ?? {}
  const slotAssignments = moduleConfig.slots ?? []
  const slotsConfigBag = moduleConfig.slotsConfig ?? {}
  const ioEntries = ioMapping.entries ?? []

  const slots: PluginSlot[] = []

  for (let slotIndex = 0; slotIndex < slotAssignments.length; slotIndex++) {
    const moduleId = slotAssignments[slotIndex]
    if (!moduleId) continue

    const moduleDef = modules.find((m) => m.id === moduleId)
    if (!moduleDef) continue

    const slotNumber = slotIndex + 1
    const channels = (moduleDef.addressMapping as { channels?: ModuleChannel[] } | undefined)?.channels ?? []
    const configScreenDef = moduleDef.configScreenDefinition
    const slotConfigValues = slotsConfigBag[String(slotNumber)] ?? {}

    // Bucket channels by the resolved address prefix from the io-mapping
    // (the authoritative source for what address the editor assigned),
    // not by the manifest's static channel.addressPrefix. For modules
    // that use channelsByFormat (e.g. SLM V/mA cards toggling between
    // %IW and %ID via the data_format selector), the manifest's
    // `channels` fallback array carries the raw-mode prefix; the actual
    // allocated address is what determines whether the channel goes to
    // analog_inputs (%IW) or analog_real_inputs (%ID).
    const di: { name: string; address: string }[] = []
    const dout: { name: string; address: string }[] = []
    const ai: { name: string; address: string }[] = []
    const ao: { name: string; address: string }[] = []
    const aiReal: { name: string; address: string }[] = []
    const aoReal: { name: string; address: string }[] = []

    for (const channel of channels) {
      const ioEntry = ioEntries.find((e) => e.slot === slotNumber && e.channelName === channel.name)
      const address = ioEntry?.iecAddress
      if (!address) continue
      if (address.startsWith('%IX')) di.push({ name: channel.name, address })
      else if (address.startsWith('%QX')) dout.push({ name: channel.name, address })
      else if (address.startsWith('%IW')) ai.push({ name: channel.name, address })
      else if (address.startsWith('%QW')) ao.push({ name: channel.name, address })
      else if (address.startsWith('%ID')) aiReal.push({ name: channel.name, address })
      else if (address.startsWith('%QD')) aoReal.push({ name: channel.name, address })
    }

    const ioMappingBlock: PluginSlotIoMapping = {}
    const diRange = buildBitRange(di)
    const doRange = buildBitRange(dout)
    const aiRange = buildWordRange(ai)
    const aoRange = buildWordRange(ao)
    const aiRealRange = buildDwordRange(aiReal)
    const aoRealRange = buildDwordRange(aoReal)
    if (diRange) ioMappingBlock.digital_inputs = diRange
    if (doRange) ioMappingBlock.digital_outputs = doRange
    if (aiRange) ioMappingBlock.analog_inputs = aiRange
    if (aoRange) ioMappingBlock.analog_outputs = aoRange
    if (aiRealRange) ioMappingBlock.analog_real_inputs = aiRealRange
    if (aoRealRange) ioMappingBlock.analog_real_outputs = aoRealRange

    const slot: PluginSlot = {
      slot: slotNumber,
      io_mapping: ioMappingBlock,
    }
    if (moduleDef.hwId) slot.module_hw_id = moduleDef.hwId

    // Module configuration bytes — only when the manifest declared a
    // configScreen for this SKU and the editor has either user input
    // or schema defaults to feed the encoder.
    const moduleConfigBytes = encodeModuleConfig(configScreenDef, slotConfigValues)
    if (moduleConfigBytes !== null) slot.module_config = bytesToHexString(moduleConfigBytes)

    slots.push(slot)
  }

  return slots
}

/**
 * Build the per-slot module-configuration byte entries for an Arduino
 * (microcontroller) VPP target.
 *
 * The runtime-v4 path serialises module config bytes into the plugin's
 * JSON (see `buildSlots` -> `module_config`). Arduino targets have no
 * runtime JSON: every byte must be baked into flash through
 * `vpp_config.h`. This helper produces the same encoded bytes, keyed by
 * 1-based slot, so the caller can inject them into `vendorScreenData`
 * under a synthetic `module-config` key — the generic `vpp_config.h`
 * walker then emits them as `VPP_MODULE_CONFIG_ENTRIES_*` macros that
 * the HAL feeds to `P1.configureModule()` (or equivalent) at boot.
 *
 * Only slots whose module declared a configScreen and resolved to a
 * non-empty byte array are returned; everything else is omitted (the
 * module library's factory defaults apply).
 */
export function buildModuleConfigEntries(
  vendorScreenData: VendorScreenData,
  modules: VppModuleDefinition[],
): Array<{ slot: number; bytes: number[] }> {
  const moduleConfig = (vendorScreenData['module-configuration'] as ModuleConfiguration | undefined) ?? {}
  const slotAssignments = moduleConfig.slots ?? []
  const slotsConfigBag = moduleConfig.slotsConfig ?? {}

  const entries: Array<{ slot: number; bytes: number[] }> = []
  for (let slotIndex = 0; slotIndex < slotAssignments.length; slotIndex++) {
    const moduleId = slotAssignments[slotIndex]
    if (!moduleId) continue
    const moduleDef = modules.find((m) => m.id === moduleId)
    if (!moduleDef) continue
    const slotNumber = slotIndex + 1
    const bytes = encodeModuleConfig(moduleDef.configScreenDefinition, slotsConfigBag[String(slotNumber)] ?? {})
    if (bytes && bytes.length > 0) entries.push({ slot: slotNumber, bytes })
  }
  return entries
}

/**
 * Build the `pins` array for a pin-based plugin from the editor's GPIO
 * pin-mapping table.
 *
 * Each digital pin becomes `{ pin, direction, byte, bit }`, where the
 * byte/bit come straight from the IEC address the editor's allocator
 * assigned (%IX<byte>.<bit> for inputs, %QX<byte>.<bit> for outputs) — the
 * same image-table location the compiled PLC program reads/writes, which is
 * what binds a physical pin to a program variable. `pin` is the board's pin
 * identifier as entered by the user (the physical header position on a Pi).
 *
 * Analog OUTPUTS (%QW) map to hardware PWM (direction 'pwm', word index).
 * Analog INPUTS are skipped: the Raspberry Pi SBC has no on-board ADC.
 */
function buildPins(devicePins: DevicePinInput[]): PluginPin[] {
  const pins: PluginPin[] = []
  for (const dp of devicePins) {
    const pinNumber = Number.parseInt(dp.pin, 10)
    if (!Number.isInteger(pinNumber) || pinNumber < 0) continue

    if (dp.pinType === 'digitalInput' || dp.pinType === 'digitalOutput') {
      const parsed = parseBitAddress(dp.address)
      if (!parsed) continue
      const direction = dp.pinType === 'digitalInput' ? 'input' : 'output'
      pins.push({ pin: pinNumber, direction, byte: parsed.byte, bit: parsed.bit })
    } else if (dp.pinType === 'analogOutput') {
      const word = parseWordAddress(dp.address)
      /* istanbul ignore if -- defensive: addresses on the pin-mapping table go through the
         same IEC-address validator that gates the io-mapping entries */
      if (word === null) continue
      pins.push({ pin: pinNumber, direction: 'pwm', word })
    }
    // analogInput: no on-board ADC on the Pi — nothing to map.
  }
  return pins
}

/* ------------------------------------------------------------------ */
/* Module configuration encoding                                      */
/* ------------------------------------------------------------------ */

type FormField = {
  id: string
  default?: unknown
  encoding?: unknown
}

type ConfigSection = {
  layout?: string
  fields?: unknown
  totalBytes?: number
}

type ConfigScreenDef = {
  sections?: ConfigSection[]
}

/** Walk a module's configScreenDefinition and produce (fields, total). */
function collectConfigFormFields(def: unknown): { fields: FormField[]; totalBytes?: number } {
  const screen = (def ?? {}) as ConfigScreenDef
  const sections = Array.isArray(screen.sections) ? screen.sections : []
  const fields: FormField[] = []
  let totalBytes: number | undefined
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue
    if (typeof section.totalBytes === 'number' && totalBytes === undefined) {
      totalBytes = section.totalBytes
    }
    const sectionFields = Array.isArray(section.fields) ? section.fields : []
    for (const f of sectionFields) {
      if (f && typeof f === 'object' && typeof (f as { id?: unknown }).id === 'string') {
        fields.push(f as FormField)
      }
    }
  }
  return { fields, totalBytes }
}

/**
 * Encode the configuration bytes for a single slot.
 *
 * Returns `null` when the module has no config screen (and therefore
 * no module_config in the emitted slot), or when the screen declares
 * no encodable fields.
 *
 * Field values come from the user's stored input where present and
 * from the field's `default` otherwise — mirroring what the editor's
 * UI shows so the runtime gets what the user sees.
 */
function encodeModuleConfig(
  configScreenDef: unknown,
  storedValues: Record<string, string | number | boolean>,
): number[] | null {
  if (!configScreenDef) return null
  const { fields, totalBytes } = collectConfigFormFields(configScreenDef)
  if (fields.length === 0) return null

  const merged: Record<string, string | number | boolean> = {}
  for (const f of fields) {
    const v = storedValues[f.id]
    if (v !== undefined && v !== null && v !== '') {
      merged[f.id] = v
    } else if (f.default !== undefined && f.default !== null && f.default !== '') {
      merged[f.id] = f.default as string | number | boolean
    }
  }

  return encodeConfigBytes(fields, merged, totalBytes)
}

/**
 * Generate the final plugin config JSON for a VPP runtime-v4 package.
 *
 * All fields from the config template are preserved. Form-based vendor screen
 * data (keyed by persistence keys other than 'module-configuration' and
 * 'io-mapping') is merged at the root level. The `slots` array is always set
 * from the backplane configuration + I/O mapping. When `devicePins` is
 * non-empty (pin-based GPIO boards), a `pins` array is emitted from the
 * editor's pin-mapping table.
 */
export function generateVendorPluginConfig(
  configTemplate: Record<string, unknown>,
  vendorScreenData: VendorScreenData,
  modules: VppModuleDefinition[],
  devicePins: DevicePinInput[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...configTemplate }

  // Merge form-based vendor screen data at root. Skip the keys that have
  // specific handling below.
  const RESERVED_KEYS = new Set(['module-configuration', 'io-mapping'])
  for (const [key, value] of Object.entries(vendorScreenData)) {
    if (RESERVED_KEYS.has(key)) continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, value as Record<string, unknown>)
    }
  }

  // Always write the slots array from module configuration + IO mapping
  result.slots = buildSlots(vendorScreenData, modules)

  // Pin-based GPIO boards (capabilities.pinMapping) serialize their
  // pin-mapping table into a pins[] array. Module-based boards pass no
  // pins, so the key stays absent for them.
  if (devicePins.length > 0) {
    result.pins = buildPins(devicePins)
  }

  return result
}

export type { PluginSlot, PluginSlotIoMapping, VendorScreenData, VppModuleDefinition }
