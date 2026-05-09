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
import { useCallback, useEffect, useState } from 'react'

import { cn } from '@root/frontend/utils/cn'
import type { InstalledLibrary } from '@root/middleware/shared/ports/library-types'
import { useLibrary } from '@root/middleware/shared/providers/platform-context'

import { ProjectLibrariesTab } from './project-libraries-tab'
import { SystemLibrariesTab } from './system-libraries-tab'

type ManagerTab = 'system' | 'project'

const TabItem = ({
  value,
  label,
  isActive,
  badge,
}: {
  value: string
  label: string
  isActive: boolean
  badge?: React.ReactNode
}) => (
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
    {badge}
  </Tabs.Trigger>
)

const LibraryManagerEditor = () => {
  const library = useLibrary()
  const [activeTab, setActiveTab] = useState<ManagerTab>('system')
  const [installed, setInstalled] = useState<InstalledLibrary[]>([])

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
          <TabItem
            value='system'
            label='System Libraries'
            isActive={activeTab === 'system'}
            badge={
              installed.length > 0 ? (
                <span className='ml-1 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] dark:bg-neutral-700'>
                  {installed.length}
                </span>
              ) : undefined
            }
          />
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
