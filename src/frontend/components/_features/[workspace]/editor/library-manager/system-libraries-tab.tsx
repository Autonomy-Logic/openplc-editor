/**
 * System Libraries tab — the system-wide pool.
 *
 * Left pane: every installed library with version + bundled badge
 * + add/uninstall buttons.  Right pane: manifest details +
 * hierarchical POU preview.
 *
 * Mirrors the package-manager editor's two-pane shape so users move
 * between the two managers without relearning the surface.  Reuses
 * the existing `buildLibraryTree` helper for the right-pane
 * hierarchy — no parallel tree primitive.
 */

import * as Popover from '@radix-ui/react-popover'
import { MinusIcon } from '@root/frontend/assets/icons/interface/Minus'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { useOpenPLCStore } from '@root/frontend/store'
import { buildLibraryTree, type LibraryTreeNode } from '@root/frontend/utils/library-tree'
import type { InstalledLibrary, SystemLibrary } from '@root/middleware/shared/ports/library-types'
import { useLibrary } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useState } from 'react'

interface SystemLibrariesTabProps {
  installed: InstalledLibrary[]
  onRefresh: () => void
}

const SystemLibrariesTab = ({ installed, onRefresh }: SystemLibrariesTabProps) => {
  const library = useLibrary()
  const systemPool = useOpenPLCStore((s) => s.libraries.system)
  const openModal = useOpenPLCStore((s) => s.modalActions.openModal)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

  // Auto-select the first row when the catalogue first arrives so the
  // details pane has something to render — mirrors the package
  // manager's UX where an empty right-pane invites the user to click
  // an entry but a pre-selected one shows what details look like.
  useEffect(() => {
    if (!selectedName && installed.length > 0) {
      setSelectedName(installed[0].name)
    }
    if (selectedName && !installed.some((l) => l.name === selectedName)) {
      // Selected library was uninstalled — fall back to the first row.
      setSelectedName(installed[0]?.name ?? null)
    }
  }, [installed, selectedName])

  const handleImportFromFile = useCallback(async () => {
    if (!library) return
    setIsPopoverOpen(false)
    const result = await library.installFromFile()
    if (result.success && !result.canceled) {
      setSelectedName(result.name)
      onRefresh()
    } else if (!result.success) {
      openModal('debugger-message', {
        type: 'error',
        title: 'Library install failed',
        message: result.error,
        buttons: ['OK'],
        onResponse: () => {},
      })
    }
  }, [library, onRefresh, openModal])

  const handleImportFromInternet = useCallback(() => {
    setIsPopoverOpen(false)
    openModal('public-catalog-browser')
  }, [openModal])

  const handleUninstall = useCallback(async () => {
    if (!library || !selectedName) return
    const target = installed.find((l) => l.name === selectedName)
    if (!target || target.bundled) return // bundled is non-disableable
    const result = await library.uninstall(selectedName)
    if (result.success) {
      onRefresh()
    } else {
      openModal('debugger-message', {
        type: 'error',
        title: 'Uninstall failed',
        message: result.error ?? 'Unknown error',
        buttons: ['OK'],
        onResponse: () => {},
      })
    }
  }, [library, selectedName, installed, onRefresh, openModal])

  const selectedRow = selectedName ? installed.find((l) => l.name === selectedName) : null
  const selectedArchive = selectedName ? systemPool.find((l) => l.name === selectedName) : null
  const canUninstall = !!selectedRow && !selectedRow.bundled

  return (
    <div className='flex min-h-0 flex-1 overflow-hidden'>
      {/* Left pane — pool list */}
      <div className='flex w-1/2 min-w-[325px] flex-col gap-4 overflow-y-auto pr-4'>
        <div className='flex items-center justify-between'>
          <h3 className='select-none text-base font-medium text-neutral-950 dark:text-white'>Installed Libraries</h3>
          <div className='flex gap-1'>
            <Popover.Root open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <Popover.Trigger asChild>
                <button
                  type='button'
                  aria-label='Add library'
                  className='rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                >
                  <PlusIcon className='!stroke-brand' />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  sideOffset={5}
                  align='end'
                  className='flex w-[220px] flex-col gap-1 rounded-lg border border-neutral-100 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-950'
                >
                  <button
                    type='button'
                    onClick={() => void handleImportFromFile()}
                    className='flex w-full items-center rounded-md px-3 py-2 text-left font-caption text-cp-sm font-medium text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-850'
                  >
                    Add from file...
                  </button>
                  <button
                    type='button'
                    onClick={handleImportFromInternet}
                    className='flex w-full items-center rounded-md px-3 py-2 text-left font-caption text-cp-sm font-medium text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-850'
                  >
                    Add from catalog...
                  </button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            <button
              type='button'
              aria-label='Uninstall library'
              onClick={() => void handleUninstall()}
              disabled={!canUninstall}
              title={
                selectedRow?.bundled
                  ? 'Bundled libraries ship with strucpp and cannot be uninstalled'
                  : 'Uninstall selected library'
              }
              className='rounded-md p-1 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-900'
            >
              <MinusIcon className='!stroke-brand' />
            </button>
          </div>
        </div>

        <div className='flex flex-col overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700'>
          {installed.length === 0 ? (
            <div className='flex items-center justify-center p-8 text-sm text-neutral-500 dark:text-neutral-400'>
              No libraries installed. Click + to add a library.
            </div>
          ) : (
            installed.map((lib) => (
              <button
                key={lib.name}
                type='button'
                onClick={() => setSelectedName(lib.name)}
                aria-selected={selectedName === lib.name}
                className={`flex w-full items-center justify-between border-b border-neutral-100 px-3 py-2 text-left last:border-b-0 dark:border-neutral-800 ${
                  selectedName === lib.name
                    ? 'bg-brand/20 dark:bg-brand/30 font-medium shadow-[inset_3px_0_0_var(--primary-default)]'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
                }`}
              >
                <div className='flex flex-col gap-0.5'>
                  <span className='font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>
                    {lib.displayName ?? lib.name}
                  </span>
                  <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                    v{lib.version}
                    {lib.bundled ? ' · bundled' : lib.origin === 'codesys' ? ' · CODESYS import' : ''}
                  </span>
                </div>
                {lib.bundled && (
                  <span className='bg-brand/15 rounded-full px-2 py-0.5 text-[10px] font-medium text-brand-medium dark:text-brand-light'>
                    bundled
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      <div className='h-full w-[1px] bg-brand-light' />

      {/* Right pane — manifest details + POU preview */}
      <div className='flex w-1/2 min-w-[325px] flex-col gap-4 overflow-y-auto pl-4'>
        {selectedRow ? (
          <>
            <h3 className='select-none text-base font-medium text-neutral-950 dark:text-white'>
              {selectedRow.displayName ?? selectedRow.name}
            </h3>
            <div className='flex flex-col gap-3'>
              <DetailRow label='Identifier' value={selectedRow.name} />
              <DetailRow label='Version' value={selectedRow.version} />
              <DetailRow
                label='Source'
                value={
                  selectedRow.bundled
                    ? 'Bundled with strucpp'
                    : selectedRow.origin === 'codesys'
                      ? 'CODESYS import (.lib / .library)'
                      : 'STruC++ archive (.stlib)'
                }
              />
              {selectedRow.installedAt && (
                <DetailRow label='Installed' value={new Date(selectedRow.installedAt).toLocaleString()} />
              )}
              {selectedRow.author && <DetailRow label='Author' value={selectedRow.author} />}
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-xs font-medium text-neutral-500 dark:text-neutral-400'>{label}</span>
      <span className='break-words font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'>{value}</span>
    </div>
  )
}

/**
 * Hierarchical preview of the library's POUs, grouped by category.
 * Read-only — drag/drop and selection are handled by the explorer
 * library tree elsewhere.  Reuses `buildLibraryTree` so the
 * preview matches what the user sees in the left-panel library tree.
 */
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

export { SystemLibrariesTab }
