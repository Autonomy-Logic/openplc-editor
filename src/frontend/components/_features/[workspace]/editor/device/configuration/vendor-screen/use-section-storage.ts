import { useOpenPLCStore, useOpenPLCStoreApi } from '@root/frontend/store'
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

/** Shared frozen empty payload returned when the section has no backing bucket yet. Reusing one
 *  reference keeps `storage.values` identity stable across renders, so downstream `useMemo`s that
 *  depend on it (column defs, memoized form shapes) are not invalidated by every store commit. */
const EMPTY_VALUES: SectionStoragePayload = Object.freeze({})

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
 * is true — the section renders but changes don't stick. The merge reads
 * `current` through `storeApi.getState()` at the moment of the write so the
 * `setPayload` identity does not thrash on every unrelated store commit.
 */
export function useSectionStorage(section: PersistableSection): SectionStorage {
  const storeApi = useOpenPLCStoreApi()
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

  const values = (isVpp ? vppValues : vendorValues) ?? EMPTY_VALUES
  const readonly = isVpp ? !packageId || !vppScreenId : !vendorKey

  const setPayload = useCallback(
    (patch: SectionStoragePayload) => {
      if (readonly) return
      const state = storeApi.getState()
      if (isVpp && packageId && vppScreenId) {
        const current =
          (state.project.data.vppExtensions?.[packageId]?.[vppScreenId] as SectionStoragePayload | undefined) ?? {}
        state.projectActions.setVppExtension(packageId, vppScreenId, { ...current, ...patch })
      } else if (!isVpp && vendorKey) {
        const current =
          (state.deviceDefinitions.configuration.vendorScreenData?.[vendorKey] as SectionStoragePayload | undefined) ??
          {}
        state.deviceActions.setVendorScreenData(vendorKey, {
          ...current,
          ...patch,
        } as Record<string, string | number | boolean>)
      }
    },
    [storeApi, isVpp, packageId, vppScreenId, vendorKey, readonly],
  )

  const setField = useCallback(
    (key: string, value: FieldValue) => {
      setPayload({ [key]: value })
    },
    [setPayload],
  )

  return { values, setField, setPayload, readonly }
}
