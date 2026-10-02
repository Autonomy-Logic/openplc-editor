/**
 * Build Settings screen — a Library Project's verify target and the library
 * folders it ships in `resources/`.
 *
 * Two tabs, same shape as the Library Manager (which is itself the EtherCAT
 * editor's tab structure over the package manager's card layout):
 *
 *   - **Verify Target** — which toolchain the library is checked with.
 *     Stored in `library.json`'s `build` block, because a library project has
 *     `hasDevices: false` and so has no device screen to hang it on. Edits go
 *     to the same store field the Manifest tab is bound to, so the two stay
 *     in step and the change saves with the project.
 *
 *   - **Resources** — the library folders packaged into the `.stlib`. These
 *     are files on disk, so add and remove take effect as they are made — the
 *     same way the Library Manager installs an archive.
 *
 * Named Build Settings rather than Build Options because arduino-cli already
 * owns "build options" (`--build-property`, `build.options.json`), as does
 * the editor's own build-options popover.
 */

import * as Tabs from '@radix-ui/react-tabs'
import { useOpenPLCStore } from '@root/frontend/store'
import { LIBRARY_MANIFEST_TAB_NAME } from '@root/frontend/store/slices/tabs/utils'
import { cn } from '@root/frontend/utils/cn'
import type { LibraryVerifyTarget } from '@root/middleware/shared/ports/library-build-port'
import {
  DEFAULT_VERIFY_TARGET,
  parseVerifyTarget,
  withVerifyTarget,
} from '@root/middleware/shared/utils/library/manifest-build-block'
import { useMemo, useState } from 'react'

import { ResourcesTab } from './resources-tab'
import { VerifyTargetTab } from './verify-target-tab'

type SettingsTab = 'verify' | 'resources'

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

const BuildSettingsEditor = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('verify')

  const manifestContent = useOpenPLCStore((s) => s.project.data.libraryManifest ?? '')
  const updateLibraryManifest = useOpenPLCStore((s) => s.projectActions.updateLibraryManifest)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )
  const addFile = useOpenPLCStore((s) => s.fileActions.addFile)

  /**
   * Derived from the manifest on every render rather than held in state, so
   * the screen always shows what the Manifest tab holds right now — including
   * a hand-edited `build` block, and including a half-typed one.
   */
  const parsed = useMemo((): { target: LibraryVerifyTarget } | { error: string } => {
    let raw: unknown
    try {
      raw = JSON.parse(manifestContent)
    } catch {
      return { error: 'library.json is not valid JSON. Fix it on the Manifest tab first.' }
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { error: 'library.json must be a JSON object.' }
    }
    const result = parseVerifyTarget(raw as Record<string, unknown>)
    if ('errors' in result) return { error: result.errors[0] }
    return { target: result.target }
  }, [manifestContent])

  const manifestError = 'error' in parsed ? parsed.error : null
  const target = 'target' in parsed ? parsed.target : DEFAULT_VERIFY_TARGET

  const handleTargetChange = (next: LibraryVerifyTarget) => {
    const updated = withVerifyTarget(manifestContent, next)
    if (updated === null) return
    // Nothing is saved under this tab's own name: the setting lives in
    // `library.json`, so the Manifest entry is what goes dirty. That entry is
    // registered when the Manifest tab mounts, and this screen can be opened
    // without ever opening it — `addFile` is a no-op when it exists.
    addFile({
      name: LIBRARY_MANIFEST_TAB_NAME,
      type: 'library-manifest',
      filePath: 'library.json',
      cleanState: manifestContent,
    })
    handleFileAndWorkspaceSavedState(LIBRARY_MANIFEST_TAB_NAME)
    updateLibraryManifest(updated)
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden p-4'>
      <div className='mb-4 shrink-0'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>Build Settings</h2>
        <p className='text-sm text-neutral-600 dark:text-neutral-400'>
          Choose the toolchain this library is checked against, and manage the C/C++ libraries it ships.
        </p>
      </div>

      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as SettingsTab)}
        className='flex min-h-0 flex-1 flex-col overflow-hidden'
      >
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='verify' label='Verify Target' isActive={activeTab === 'verify'} />
          <TabItem value='resources' label='Resources' isActive={activeTab === 'resources'} />
        </Tabs.List>

        <Tabs.Content
          value='verify'
          className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4 data-[state=inactive]:hidden'
        >
          <VerifyTargetTab target={target} onChange={handleTargetChange} manifestError={manifestError} />
        </Tabs.Content>

        <Tabs.Content
          value='resources'
          className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4 data-[state=inactive]:hidden'
        >
          <ResourcesTab />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

export { BuildSettingsEditor }
