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

type PluginSlotChannel = {
  name: string
  type: string
  dataType: string
  iecLocation: string
  alias: string
}

type PluginSlot = {
  slot: number
  moduleId: string
  moduleName: string
  channels: PluginSlotChannel[]
}

/**
 * Build the `slots` array for the plugin config by cross-referencing:
 *   - Which module is in each slot (from vendor screen `module-configuration`)
 *   - The channel definitions of that module (from VPP manifest `addressMapping`)
 *   - The assigned IEC addresses and user aliases (from vendor screen `io-mapping`)
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

    const pluginChannels: PluginSlotChannel[] = channels.map((channel) => {
      const ioEntry = ioEntries.find((e) => e.slot === slotNumber && e.channelName === channel.name)
      return {
        name: channel.name,
        type: channel.type,
        dataType: channel.dataType,
        iecLocation: ioEntry?.iecAddress ?? '',
        alias: ioEntry?.alias ?? '',
      }
    })

    slots.push({
      slot: slotNumber,
      moduleId,
      moduleName: moduleDef.name,
      channels: pluginChannels,
    })
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

export type { PluginSlot, PluginSlotChannel, VendorScreenData, VppModuleDefinition }
