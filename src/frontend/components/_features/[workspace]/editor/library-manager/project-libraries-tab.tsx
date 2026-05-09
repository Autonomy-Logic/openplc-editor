/**
 * Project Libraries tab — the per-project enablement view.
 *
 * Shows three sections:
 *
 *   - **Bundled** — canonical / non-disableable libraries that ship
 *     with strucpp.  Read-only; no checkbox.
 *
 *   - **Enabled** — opt-in libraries the project is using.  Each
 *     row has a remove button.
 *
 *   - **Available to add** — opt-in libraries in the system pool
 *     the project hasn't opted into.  Each row has an add button.
 *
 * Below the list, missing libraries (in `project.libraries` but not
 * in the system pool) get a callout pointing back at the System
 * Libraries tab.  Right pane mirrors the System Libraries tab's
 * details for whichever row is selected.
 */

import { useEffect, useMemo, useState } from 'react'

import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { useOpenPLCStore } from '@root/frontend/store'
import { buildLibraryTree, type LibraryTreeNode } from '@root/frontend/utils/library-tree'
import type { InstalledLibrary, SystemLibrary } from '@root/middleware/shared/ports/library-types'

interface ProjectLibrariesTabProps {
  installed: InstalledLibrary[]
}

const ProjectLibrariesTab = ({ installed }: ProjectLibrariesTabProps) => {
  const systemPool = useOpenPLCStore((s) => s.libraries.system)
  const enabledNames = useOpenPLCStore((s) => s.enabledLibraries)
  const missingLibraries = useOpenPLCStore((s) => s.missingLibraries)
  const enableLibrary = useOpenPLCStore((s) => s.libraryActions.enableLibrary)
  const disableLibrary = useOpenPLCStore((s) => s.libraryActions.disableLibrary)

  const [selectedName, setSelectedName] = useState<string | null>(null)

  // Partition the catalogue into bundled / enabled / available.
  // Enabled is a derived view from the slice — driven by the
  // project's durable `libraries` field — so the UI reflects the
  // exact state the project will save.
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

  // Auto-select the first enabled row (or first bundled, or first
  // available) so the details pane has something to render.
  useEffect(() => {
    if (selectedName && installed.some((l) => l.name === selectedName)) return
    const first = enabled[0] ?? bundled[0] ?? available[0]
    setSelectedName(first?.name ?? null)
  }, [installed, selectedName, enabled, bundled, available])

  const selectedRow = selectedName ? installed.find((l) => l.name === selectedName) : null
  const selectedArchive = selectedName ? systemPool.find((l) => l.name === selectedName) : null

  return (
    <div className='flex min-h-0 flex-1 overflow-hidden'>
      {/* Left pane — sectioned project view */}
      <div className='flex w-1/2 min-w-[325px] flex-col gap-4 overflow-y-auto pr-4'>
        {missingLibraries.length > 0 && (
          <div className='rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs dark:border-yellow-700 dark:bg-yellow-950/40'>
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

        <Section
          title='Bundled with STruC++'
          subtitle='Always-on; cannot be disabled.'
          rows={bundled}
          selectedName={selectedName}
          onSelect={setSelectedName}
        />

        <Section
          title={`Enabled in this project (${enabled.length})`}
          subtitle={enabled.length === 0 ? 'No opt-in libraries enabled.' : undefined}
          rows={enabled}
          selectedName={selectedName}
          onSelect={setSelectedName}
          actionIcon='remove'
          onAction={(name) => disableLibrary(name)}
          actionTitle='Remove from project'
        />

        <Section
          title={`Available to add (${available.length})`}
          subtitle={
            available.length === 0
              ? 'Every installed library is already enabled. Install more on the System Libraries tab.'
              : undefined
          }
          rows={available}
          selectedName={selectedName}
          onSelect={setSelectedName}
          actionIcon='add'
          onAction={(name) => enableLibrary(name)}
          actionTitle='Enable in project'
        />
      </div>

      <div className='h-full w-[1px] bg-brand-light' />

      {/* Right pane — details */}
      <div className='flex w-1/2 min-w-[325px] flex-col gap-4 overflow-y-auto pl-4'>
        {selectedRow ? (
          <>
            <div className='flex items-center justify-between'>
              <h3 className='select-none text-base font-medium text-neutral-950 dark:text-white'>
                {selectedRow.displayName ?? selectedRow.name}
              </h3>
              {selectedRow.bundled && (
                <span className='rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-medium text-brand-medium dark:text-brand-light'>
                  bundled
                </span>
              )}
            </div>
            <div className='flex flex-col gap-3'>
              <DetailRow label='Identifier' value={selectedRow.name} />
              <DetailRow label='Version' value={selectedRow.version} />
              <DetailRow
                label='Status in project'
                value={
                  selectedRow.bundled
                    ? 'Always available (bundled)'
                    : enabledNames.includes(selectedRow.name)
                      ? 'Enabled'
                      : 'Available — not yet enabled'
                }
              />
              {selectedRow.description && <DetailRow label='Description' value={selectedRow.description} />}
            </div>
            {selectedArchive && <PouTreePreview library={selectedArchive} />}
          </>
        ) : (
          <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
            Select a library to view details
          </div>
        )}
      </div>
    </div>
  )
}

interface SectionProps {
  title: string
  subtitle?: string
  rows: InstalledLibrary[]
  selectedName: string | null
  onSelect: (name: string) => void
  actionIcon?: 'add' | 'remove'
  onAction?: (name: string) => void
  actionTitle?: string
}

function Section({ title, subtitle, rows, selectedName, onSelect, actionIcon, onAction, actionTitle }: SectionProps) {
  if (rows.length === 0 && !subtitle) return null
  return (
    <div className='flex flex-col gap-2'>
      <h4 className='select-none text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400'>
        {title}
      </h4>
      {rows.length === 0 ? (
        <span className='text-[11px] italic text-neutral-500 dark:text-neutral-400'>{subtitle}</span>
      ) : (
        <div className='flex flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
          {rows.map((lib) => (
            <div
              key={lib.name}
              className={`group flex items-center justify-between border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-800 ${
                selectedName === lib.name
                  ? 'bg-brand/10 dark:bg-brand/20'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
              }`}
            >
              <button type='button' onClick={() => onSelect(lib.name)} className='flex flex-1 flex-col gap-0.5 text-left'>
                <span className='font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>
                  {lib.displayName ?? lib.name}
                </span>
                <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>v{lib.version}</span>
              </button>
              {actionIcon === 'add' && onAction && (
                <button
                  type='button'
                  aria-label={actionTitle ?? 'Enable'}
                  title={actionTitle ?? 'Enable'}
                  onClick={() => onAction(lib.name)}
                  className='rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                >
                  <PlusIcon className='!stroke-brand' />
                </button>
              )}
              {actionIcon === 'remove' && onAction && (
                <button
                  type='button'
                  aria-label={actionTitle ?? 'Remove'}
                  title={actionTitle ?? 'Remove'}
                  onClick={() => onAction(lib.name)}
                  className='rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                >
                  <MinusIcon className='!stroke-brand' />
                </button>
              )}
              {!actionIcon && (
                <span
                  title='Always-on'
                  className='select-none rounded-md px-2 py-0.5 text-[10px] font-medium text-brand-medium dark:text-brand-light'
                >
                  ✓
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-xs font-medium text-neutral-500 dark:text-neutral-400'>{label}</span>
      <span className='break-words font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'>{value}</span>
    </div>
  )
}

function PouTreePreview({ library }: { library: SystemLibrary }) {
  const tree = buildLibraryTree(library)
  const totalPous = library.pous.length
  return (
    <div className='flex flex-col gap-2'>
      <span className='text-xs font-medium text-neutral-500 dark:text-neutral-400'>
        Contents ({totalPous} {totalPous === 1 ? 'POU' : 'POUs'})
      </span>
      <div className='flex flex-col gap-0.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-700'>
        {tree.children.length === 0 ? (
          <span className='px-2 py-1 text-[11px] italic text-neutral-500 dark:text-neutral-400'>(empty)</span>
        ) : (
          tree.children.map((child, idx) => <TreeNodeView key={idx} node={child} depth={0} />)
        )}
      </div>
    </div>
  )
}

function TreeNodeView({ node, depth }: { node: LibraryTreeNode; depth: number }) {
  if (node.kind === 'folder') {
    return (
      <div className='flex flex-col gap-0.5'>
        <span
          className='font-caption text-cp-sm font-medium text-neutral-700 dark:text-neutral-300'
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          {node.label}/
        </span>
        {node.children.map((child, idx) => (
          <TreeNodeView key={idx} node={child} depth={depth + 1} />
        ))}
      </div>
    )
  }
  return (
    <span
      className='font-caption text-[11px] text-neutral-600 dark:text-neutral-400'
      style={{ paddingLeft: `${depth * 12}px` }}
    >
      {node.pou.name}
      <span className='ml-1 text-neutral-400 dark:text-neutral-500'>· {node.pou.type}</span>
    </span>
  )
}

export { ProjectLibrariesTab }
