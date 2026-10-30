import { useOpenPLCStore } from '@root/frontend/store'
import {
  getSectionPersistenceKey,
  getSectionVppExtensionScreenId,
  isVppExtensionsSection,
  type PersistableSection,
} from '@root/frontend/utils/vpp/persistence-keys'
import { useCallback } from 'react'

type FieldValue = string | number | boolean | null | Array<unknown> | Record<string, unknown>

export type SectionStoragePayload = Record<string, unknown>

export interface SectionStorage {
  values: SectionStoragePayload
  setField: (key: string, value: FieldValue) => void
  // Merge multiple keys in one write. Prefer this over several setField calls
  // when a single user action seeds defaults alongside the edit, so dirty
  // tracking sees one commit.
  setPayload: (patch: SectionStoragePayload) => void
  // true when a storage path could not be resolved (vpp-extensions section
  // viewed before a board is picked, malformed section, etc.) — writes are
  // dropped silently, reads return `{}`. Callers may surface a hint.
  readonly: boolean
}

/**
 * Resolves a section's storage adapter — the single call both form-layout
 * and table-layout make to read current values and persist individual
 * fields. Internally routes to the right project slice:
 *
 *   - `persistence: "vpp-extensions"` → `project.data.vppExtensions[packageId][screenId]`
 *     with `screenId = storageId ?? section.id` (so sibling sections can share
 *     a bucket like the Data Hub's Connection + Variables).
 *   - everything else → `deviceDefinitions.configuration.vendorScreenData[key]`
 *     with `key = getSectionPersistenceKey(section)`.
 *
 * Writes are read-modify-write merges: the whole bucket is replaced with
 * `{ ...current, [key]: value }`. For a vpp-extensions section without a
 * resolvable `packageId` or `screenId`, `setField` is a no-op and `readonly`
 * is true — the section renders but changes don't stick.
 */
export function useSectionStorage(section: PersistableSection): SectionStorage {
  const isVpp = isVppExtensionsSection(section)
  const vppScreenId = isVpp ? getSectionVppExtensionScreenId(section) : null
  const vendorKey = isVpp ? null : getSectionPersistenceKey(section)

  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const packageId = useOpenPLCStore((s) =>
    isVpp ? s.deviceAvailableOptions.availableBoards.get(deviceBoard)?.vpp?.packageId : undefined,
  )

  const vppValues = useOpenPLCStore((s) => {
    if (!isVpp || !packageId || !vppScreenId) return undefined
    return s.project.data.vppExtensions?.[packageId]?.[vppScreenId] as SectionStoragePayload | undefined
  })
  const vendorValues = useOpenPLCStore((s) => {
    if (isVpp || !vendorKey) return undefined
    return s.deviceDefinitions.configuration.vendorScreenData?.[vendorKey] as SectionStoragePayload | undefined
  })

  const setVppExtension = useOpenPLCStore((s) => s.projectActions.setVppExtension)
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)

  const values = (isVpp ? vppValues : vendorValues) ?? {}
  const readonly = isVpp ? !packageId || !vppScreenId : !vendorKey

  const setPayload = useCallback(
    (patch: SectionStoragePayload) => {
      if (readonly) return
      const merged = { ...values, ...patch }
      if (isVpp && packageId && vppScreenId) {
        setVppExtension(packageId, vppScreenId, merged)
      } else if (!isVpp && vendorKey) {
        setVendorScreenData(vendorKey, merged as Record<string, string | number | boolean>)
      }
    },
    [isVpp, packageId, vppScreenId, vendorKey, values, readonly, setVppExtension, setVendorScreenData],
  )

  const setField = useCallback(
    (key: string, value: FieldValue) => {
      setPayload({ [key]: value })
    },
    [setPayload],
  )

  return { values, setField, setPayload, readonly }
}
