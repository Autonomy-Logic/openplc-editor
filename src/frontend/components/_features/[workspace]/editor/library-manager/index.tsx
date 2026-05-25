/**
 * Library Manager screen — system-wide library pool + per-project
 * enablement.
 *
 * Two-tab layout:
 *
 *   - **System Libraries** — every installed library (bundled +
 *     user-installed).  Add/remove from the pool.  Bundled libs
 *     show a badge and refuse uninstall.
 *
 *   - **Project Libraries** — the subset of the pool the current
 *     project pulls in.  Add/remove from this project.  Bundled
 *     libs show as always-on and aren't removable.
 *
 * Both tabs share a left-list / right-details layout so the user
 * doesn't need to relearn the surface between tabs.  Tab structure
 * mirrors the EtherCAT editor; left/right pane shape mirrors the
 * package-manager editor — both are existing patterns in the design
 * system, so we lean on them rather than inventing new primitives.
 */

import * as Tabs from '@radix-ui/react-tabs'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import type { InstalledLibrary } from '@root/middleware/shared/ports/library-types'
import { useLibrary } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useState } from 'react'

import { ProjectLibrariesTab } from './project-libraries-tab'
import { SystemLibrariesTab } from './system-libraries-tab'

/** Canonical fileSlice name for the Library Manager tab. Used to
 *  register the dirty-tracking file entry and routed through the
 *  save-changes-file modal + executeSaveFile when the user toggles
 *  project libraries. */
const LIBRARY_MANAGER_FILE_NAME = 'Library Manager'

/** Stable serialization of the project's library refs (full
 *  {name, version} tuples, not just names).  Sorted by name so a
 *  set-equal mutation order produces the same string and the
 *  dirty-vs-clean compare doesn't flap.  Storing the full refs (not
 *  just names) is what lets "Don't save" later revert to the exact
 *  pre-edit state via `setProjectLibraries(parsedRefs)` — see
 *  `reloadFileFromDisk` in save-actions.ts. */
function serializeProjectLibraries(refs: { name: string; version: string }[]): string {
  return JSON.stringify(
    [...refs].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ name: r.name, version: r.version })),
  )
}

type ManagerTab = 'system' | 'project'

const TabItem = ({ value, label, isActive }: { value: string; label: string; isActive: boolean }) => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'px-4 py-2 font-caption !text-xs font-medium transition-colors',
      'border-b-2 border-transparent',
      'hover:text-brand-medium dark:hover:text-brand-light',
      isActive
        ? 'border-brand-medium text-brand-medium dark:border-brand-light dark:text-brand-light'
        : 'text-neutral-500 dark:text-neutral-400',
    )}
  >
    {label}
  </Tabs.Trigger>
)

const LibraryManagerEditor = () => {
  const library = useLibrary()
  const [activeTab, setActiveTab] = useState<ManagerTab>('system')
  const [installed, setInstalled] = useState<InstalledLibrary[]>([])
  /** Durable per-project library list (full refs).  Watch this rather
   *  than the derived `enabledLibraries` (which is just the name
   *  subset that's also in the system pool) — `enabledLibraries`
   *  can't round-trip a "Don't save" revert because version info is
   *  lost. */
  const projectLibraries = useOpenPLCStore((s) => s.project.data.libraries ?? [])
  const addFile = useOpenPLCStore((s) => s.fileActions.addFile)
  const updateFile = useOpenPLCStore((s) => s.fileActions.updateFile)
  const getFile = useOpenPLCStore((s) => s.fileActions.getFile)

  /**
   * Refresh the system pool catalogue.  Single source of truth for
   * both tabs — the System Libraries tab renders this list directly,
   * the Project Libraries tab cross-references it against the
   * project's enabled set.
   */
  const refreshInstalled = useCallback(async () => {
    if (!library) return
    setInstalled(await library.listInstalled())
  }, [library])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  // Backend pushes a `libraries:changed` event after install /
  // uninstall succeeds (and from any future CDN flow).  Re-fetch the
  // catalogue so the count badge + the lists reflect reality without
  // requiring the user to switch tabs.
  useEffect(() => {
    if (!library) return
    return library.onLibrariesChanged(() => {
      void refreshInstalled()
    })
  }, [library, refreshInstalled])

  // Register a fileSlice entry for this tab on mount so the save
  // pipeline (Ctrl+S, the save-changes-file modal on close) has a
  // file to look up.  cleanState captures the project library list
  // (full {name, version} refs) as it stood when the tab opened —
  // subsequent toggles are compared against it for the dirty flag,
  // and "Don't save" restores it verbatim via setProjectLibraries.
  // addFile is a no-op when the entry already exists (re-opening
  // the tab keeps the prior cleanState).
  useEffect(() => {
    addFile({
      name: LIBRARY_MANAGER_FILE_NAME,
      type: 'library-manager',
      filePath: '',
      cleanState: serializeProjectLibraries(projectLibraries),
    })
    // Intentionally only on mount — adding `projectLibraries` would
    // reset cleanState on every change, defeating dirty-tracking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dirty-tracking: compare the live project-library list against the
  // cleanState snapshot stored in the file entry.  Equal → saved=true;
  // different → saved=false.  Updating cleanState on a successful save
  // happens in `executeSaveFile`; here we only observe changes.
  useEffect(() => {
    const file = getFile({ name: LIBRARY_MANAGER_FILE_NAME }).file
    if (!file) return
    const current = serializeProjectLibraries(projectLibraries)
    const clean = typeof file.cleanState === 'string' ? file.cleanState : current
    const isClean = current === clean
    if (file.saved !== isClean) {
      updateFile({ name: LIBRARY_MANAGER_FILE_NAME, saved: isClean })
    }
  }, [projectLibraries, getFile, updateFile])

  if (!library) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
        Library management is not available on this platform.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden p-4'>
      <div className='mb-4 shrink-0'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>Library Manager</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>
          Install IEC 61131-3 libraries system-wide, then enable them per project.
        </p>
      </div>

      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ManagerTab)}
        className='flex min-h-0 flex-1 flex-col overflow-hidden'
      >
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='system' label='System Libraries' isActive={activeTab === 'system'} />
          <TabItem value='project' label='Project Libraries' isActive={activeTab === 'project'} />
        </Tabs.List>

        <Tabs.Content
          value='system'
          className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4 data-[state=inactive]:hidden'
        >
          <SystemLibrariesTab installed={installed} onRefresh={() => void refreshInstalled()} />
        </Tabs.Content>

        <Tabs.Content
          value='project'
          className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4 data-[state=inactive]:hidden'
        >
          <ProjectLibrariesTab installed={installed} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

export { LibraryManagerEditor }
