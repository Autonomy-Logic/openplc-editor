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
 *       "analog_outputs":  { "base_word": 0, "count": 2 }
 *     }
 *   }
 */

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
}

type ModuleConfiguration = {
  slots?: (string | null)[]
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

type BitRangeMapping = {
  base_byte: number
  base_bit: number
  count: number
}

type WordRangeMapping = {
  base_word: number
  count: number
}

type PluginSlotIoMapping = {
  digital_inputs?: BitRangeMapping
  digital_outputs?: BitRangeMapping
  analog_inputs?: WordRangeMapping
  analog_outputs?: WordRangeMapping
}

type PluginSlot = {
  slot: number
  module_hw_id?: string
  io_mapping: PluginSlotIoMapping
}

const BIT_ADDRESS_REGEX = /^%[IQ]X(\d+)\.(\d+)$/
const WORD_ADDRESS_REGEX = /^%[IQ]W(\d+)$/

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
  const ioEntries = ioMapping.entries ?? []

  const slots: PluginSlot[] = []

  for (let slotIndex = 0; slotIndex < slotAssignments.length; slotIndex++) {
    const moduleId = slotAssignments[slotIndex]
    if (!moduleId) continue

    const moduleDef = modules.find((m) => m.id === moduleId)
    if (!moduleDef) continue

    const slotNumber = slotIndex + 1
    const channels = (moduleDef.addressMapping as { channels?: ModuleChannel[] } | undefined)?.channels ?? []

    // Group channels by type and resolve each channel's assigned IEC address
    const di: { name: string; address: string }[] = []
    const dout: { name: string; address: string }[] = []
    const ai: { name: string; address: string }[] = []
    const ao: { name: string; address: string }[] = []

    for (const channel of channels) {
      const ioEntry = ioEntries.find((e) => e.slot === slotNumber && e.channelName === channel.name)
      const address = ioEntry?.iecAddress
      if (!address) continue
      if (channel.type === 'digitalInput') di.push({ name: channel.name, address })
      else if (channel.type === 'digitalOutput') dout.push({ name: channel.name, address })
      else if (channel.type === 'analogInput') ai.push({ name: channel.name, address })
      else if (channel.type === 'analogOutput') ao.push({ name: channel.name, address })
    }

    const ioMappingBlock: PluginSlotIoMapping = {}
    const diRange = buildBitRange(di)
    const doRange = buildBitRange(dout)
    const aiRange = buildWordRange(ai)
    const aoRange = buildWordRange(ao)
    if (diRange) ioMappingBlock.digital_inputs = diRange
    if (doRange) ioMappingBlock.digital_outputs = doRange
    if (aiRange) ioMappingBlock.analog_inputs = aiRange
    if (aoRange) ioMappingBlock.analog_outputs = aoRange

    const slot: PluginSlot = {
      slot: slotNumber,
      io_mapping: ioMappingBlock,
    }
    if (moduleDef.hwId) slot.module_hw_id = moduleDef.hwId
    slots.push(slot)
  }

  return slots
}

/**
 * Generate the final plugin config JSON for a VPP runtime-v4 package.
 *
 * All fields from the config template are preserved. Form-based vendor screen
 * data (keyed by persistence keys other than 'module-configuration' and
 * 'io-mapping') is merged at the root level. The `slots` array is always set
 * from the backplane configuration + I/O mapping.
 */
export function generateVendorPluginConfig(
  configTemplate: Record<string, unknown>,
  vendorScreenData: VendorScreenData,
  modules: VppModuleDefinition[],
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

  return result
}

export type { PluginSlot, PluginSlotIoMapping, VendorScreenData, VppModuleDefinition }
