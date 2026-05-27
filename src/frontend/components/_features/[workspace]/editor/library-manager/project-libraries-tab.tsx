/**
 * Project Libraries tab — per-project enablement, dual-card layout.
 *
 * Two side-by-side cards:
 *
 *   - **Left:** Available system libraries.  A search input filters
 *     the list; each row has an inline "+" affordance that pulls the
 *     library into the project.  Bundled libraries don't appear here
 *     — they're always-on and live on the right.
 *
 *   - **Right:** Project libraries.  Bundled libraries appear in a
 *     subdued, non-removable group at the top.  Opt-in libraries the
 *     project enables follow, each with an inline "−" affordance to
 *     pull them back out.  A missing-libraries callout sits above
 *     the list when `project.libraries` references libraries not
 *     present in the system pool.
 *
 * The dual-card transfer shape mirrors the EtherCAT module-selection
 * UX so users move between the two managers without relearning the
 * surface.  No right-pane "details view" — selecting a library in
 * either card has no side effect; the cards exist purely to manage
 * project enablement.  Details remain available on the System
 * Libraries tab.
 */

import { MagnifierIcon } from '@root/frontend/assets/icons/interface/Magnifier'
import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { useOpenPLCStore } from '@root/frontend/store'
import type { InstalledLibrary } from '@root/middleware/shared/ports/library-types'
import { useMemo, useState } from 'react'

interface ProjectLibrariesTabProps {
  installed: InstalledLibrary[]
}

const ProjectLibrariesTab = ({ installed }: ProjectLibrariesTabProps) => {
  const enabledNames = useOpenPLCStore((s) => s.enabledLibraries)
  const missingLibraries = useOpenPLCStore((s) => s.missingLibraries)
  const enableLibrary = useOpenPLCStore((s) => s.libraryActions.enableLibrary)
  const disableLibrary = useOpenPLCStore((s) => s.libraryActions.disableLibrary)

  const [availableFilter, setAvailableFilter] = useState('')

  // Partition the catalogue.  Bundled libraries are always-on so they
  // belong to the project group only (and as a locked row).  Opt-in
  // libraries split between "available" (not yet enabled) and
  // "enabled in this project".  We compute against `enabledNames`
  // rather than `project.libraries` directly so the UI reflects the
  // exact list the next save will write.
  const { bundled, enabled, available } = useMemo(() => {
    const bundled: InstalledLibrary[] = []
    const enabled: InstalledLibrary[] = []
    const available: InstalledLibrary[] = []
    const enabledSet = new Set(enabledNames)
    for (const lib of installed) {
      if (lib.bundled) bundled.push(lib)
      else if (enabledSet.has(lib.name)) enabled.push(lib)
      else available.push(lib)
    }
    return { bundled, enabled, available }
  }, [installed, enabledNames])

  const filteredAvailable = useMemo(() => {
    const q = availableFilter.trim().toLowerCase()
    if (!q) return available
    return available.filter(
      (lib) =>
        lib.name.toLowerCase().includes(q) ||
        (lib.displayName ?? '').toLowerCase().includes(q) ||
        (lib.description ?? '').toLowerCase().includes(q),
    )
  }, [available, availableFilter])

  return (
    <div className='flex min-h-0 flex-1 gap-4 overflow-hidden'>
      {/* Left card — available system libraries */}
      <Card title='Available Libraries' subtitle='Pick a library to add to this project.'>
        <SearchBar value={availableFilter} onChange={setAvailableFilter} />
        <ListBody>
          {available.length === 0 ? (
            <EmptyState>
              Every installed library is already in this project. Install more on the System Libraries tab.
            </EmptyState>
          ) : filteredAvailable.length === 0 ? (
            <EmptyState>No libraries match &ldquo;{availableFilter}&rdquo;.</EmptyState>
          ) : (
            filteredAvailable.map((lib) => (
              <LibraryRow
                key={lib.name}
                lib={lib}
                action='add'
                onAction={() => enableLibrary(lib.name)}
                actionTitle='Add to project'
              />
            ))
          )}
        </ListBody>
      </Card>

      {/* Right card — project libraries */}
      <Card
        title='Project Libraries'
        subtitle={
          enabled.length + bundled.length === 0
            ? 'No libraries enabled yet.'
            : `${bundled.length} bundled, ${enabled.length} added.`
        }
      >
        {missingLibraries.length > 0 && (
          <div className='shrink-0 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs dark:border-yellow-700 dark:bg-yellow-950/40'>
            <span className='font-medium text-yellow-800 dark:text-yellow-200'>Missing libraries:</span>
            <ul className='mt-1 list-inside list-disc text-yellow-700 dark:text-yellow-300'>
              {missingLibraries.map((m) => (
                <li key={m.name}>
                  {m.name}
                  {m.version ? ` (v${m.version})` : ''}
                </li>
              ))}
            </ul>
            <p className='mt-1 text-yellow-700 dark:text-yellow-300'>
              Install them on the System Libraries tab to make them available to this project.
            </p>
          </div>
        )}
        <ListBody>
          {bundled.length === 0 && enabled.length === 0 ? (
            <EmptyState>Pick a library from the left to add it to this project.</EmptyState>
          ) : (
            <>
              {bundled.map((lib) => (
                <LibraryRow key={lib.name} lib={lib} action='locked' actionTitle='Bundled — always available' />
              ))}
              {enabled.map((lib) => (
                <LibraryRow
                  key={lib.name}
                  lib={lib}
                  action='remove'
                  onAction={() => disableLibrary(lib.name)}
                  actionTitle='Remove from project'
                />
              ))}
            </>
          )}
        </ListBody>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className='flex min-h-0 w-1/2 min-w-[280px] flex-1 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950'>
      <div className='shrink-0 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700'>
        <h3 className='select-none font-caption text-sm font-semibold text-neutral-950 dark:text-white'>{title}</h3>
        {subtitle && <p className='mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400'>{subtitle}</p>}
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3'>{children}</div>
    </div>
  )
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className='flex shrink-0 items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900'>
      <MagnifierIcon className='h-4 w-4 shrink-0' />
      <input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='Search libraries…'
        className='w-full bg-transparent font-caption text-xs text-neutral-950 placeholder:text-neutral-400 focus:outline-none dark:text-white dark:placeholder:text-neutral-500'
      />
    </div>
  )
}

function ListBody({ children }: { children: React.ReactNode }) {
  return <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>{children}</div>
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-1 items-center justify-center px-3 py-6 text-center text-[11px] italic text-neutral-500 dark:text-neutral-400'>
      {children}
    </div>
  )
}

function LibraryRow({
  lib,
  action,
  onAction,
  actionTitle,
}: {
  lib: InstalledLibrary
  action: 'add' | 'remove' | 'locked'
  onAction?: () => void
  actionTitle?: string
}) {
  return (
    <div className='group flex items-center justify-between gap-2 border-b border-neutral-100 px-2 py-2 last:border-b-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900'>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>
          {lib.displayName ?? lib.name}
        </span>
        <span className='truncate text-[11px] text-neutral-500 dark:text-neutral-400'>
          v{lib.version}
          {lib.bundled ? ' · bundled' : lib.origin === 'codesys' ? ' · CODESYS' : ''}
        </span>
      </div>
      {action === 'add' && (
        <button
          type='button'
          aria-label={actionTitle ?? 'Add to project'}
          title={actionTitle ?? 'Add to project'}
          onClick={onAction}
          className='shrink-0 rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
        >
          <PlusIcon className='!stroke-brand' />
        </button>
      )}
      {action === 'remove' && (
        <button
          type='button'
          aria-label={actionTitle ?? 'Remove from project'}
          title={actionTitle ?? 'Remove from project'}
          onClick={onAction}
          className='shrink-0 rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
        >
          <MinusIcon className='!stroke-brand' />
        </button>
      )}
      {action === 'locked' && (
        <span
          title={actionTitle ?? 'Bundled — always available'}
          className='bg-brand/15 shrink-0 select-none rounded-full px-2 py-0.5 text-[10px] font-medium text-brand-medium dark:text-brand-light'
        >
          always on
        </span>
      )}
    </div>
  )
}

export { ProjectLibrariesTab }
