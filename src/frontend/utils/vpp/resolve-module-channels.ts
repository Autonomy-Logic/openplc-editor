/**
 * Resolve which channel array applies to a given slot.
 *
 * Modules with a single, static channel set (every module except the
 * V/mA cards as of writing) just declare `addressMapping.channels`,
 * which is returned verbatim.
 *
 * V/mA cards (SLM-AI4-AO2-V, SLM-AI-8-V, etc.) ship two channel
 * arrays — one for the raw UINT16 path mapped to %IW/%QW, one for the
 * REAL/engineering-units path mapped to %ID/%QD. They opt in by
 * declaring `formatFieldId` + `channelsByFormat` on `addressMapping`.
 * The resolver picks the array whose key matches the slot's current
 * value of `formatFieldId` (or `formatDefault` when the slot hasn't
 * set the field yet, or the legacy `channels` array as a last fallback).
 */

export type ResolverModuleChannel = {
  name: string
  type: string
  dataType: string
  addressPrefix: string
}

export type ResolverAddressMapping = {
  channels?: ResolverModuleChannel[]
  formatFieldId?: string
  formatDefault?: string
  channelsByFormat?: Record<string, ResolverModuleChannel[]>
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

  const fid = mapping.formatFieldId
  const byFormat = mapping.channelsByFormat

  if (fid && byFormat) {
    const slotValue = slotConfig?.[fid]
    const key = slotValue !== undefined && slotValue !== null && slotValue !== ''
      ? String(slotValue)
      : mapping.formatDefault
    if (key && byFormat[key]) return byFormat[key]
  }

  return mapping.channels ?? []
}
