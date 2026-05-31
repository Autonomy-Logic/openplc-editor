/**
 * Browse the autonomy-edge public-library catalog.
 *
 * Single round-trip to `catalog:list` on open (sort=popular, limit=50);
 * search + alphabetical sort run client-side over the loaded page so
 * the UI stays responsive without re-firing requests on every
 * keystroke.  Selection is multi-select; clicking Install hands the
 * picked ids to the confirmation modal (chained on top, not chained
 * in-place) so users see exactly what they're about to commit to.
 *
 * For libraries already installed, the row shows a muted "installed"
 * badge and stays selectable — re-installing the same version is a
 * no-op overwrite, which is the right behaviour for "I think the
 * one I have is broken; reinstall."
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { PublicLibrary } from '../../../../middleware/shared/ports/public-catalog-types'
import { useLibrary } from '../../../../middleware/shared/providers/platform-context'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type SortMode = 'popular' | 'name'

const PublicCatalogBrowserModal = () => {
  const library = useLibrary()
  const modals = useOpenPLCStore((s) => s.modals)
  const modalActions = useOpenPLCStore((s) => s.modalActions)
  const isOpen = modals['public-catalog-browser']?.open ?? false

  // Names of currently-installed libraries (lower-cased for badge
  // lookup).  Pulled from the store so the modal reflects an install
  // that happened in a previous session without a fresh listInstalled
  // call.
  const installedNames = useMemo(() => {
    const set = new Set<string>()
    return set // populated by the effect below
  }, [])
  const [installedSet, setInstalledSet] = useState<Set<string>>(installedNames)

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [libraries, setLibraries] = useState<PublicLibrary[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('popular')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Latest-request token so a slow request that finishes after the
  // modal closes (or after a Reload click) doesn't overwrite fresher
  // state.
  const requestIdRef = useRef(0)

  // Fetch the catalog on open + on every Reload click.
  const runFetch = async () => {
    if (!library?.queryPublicCatalog) {
      setPhase('error')
      setError('Public catalog is not available on this platform build.')
      return
    }
    const myId = ++requestIdRef.current
    setPhase('loading')
    setError(null)
    const result = await library.queryPublicCatalog({ sort: 'popular', limit: 50 })
    if (myId !== requestIdRef.current) return
    if (!result.success) {
      setPhase('error')
      setError(result.error)
      return
    }
    setLibraries(result.data.libraries)
    setPhase('ready')
  }

  useEffect(() => {
    if (!isOpen) return
    // Reset transient state on every open so a previous run's
    // selection / search / error doesn't bleed in.
    setQuery('')
    setSort('popular')
    setSelectedIds(new Set())
    void runFetch()

    // Refresh the "already installed" set for the visual badge.
    if (library?.listInstalled) {
      void library.listInstalled().then((rows) => {
        const next = new Set<string>()
        for (const row of rows) next.add(row.name.toLowerCase())
        setInstalledSet(next)
      })
    }
    return () => {
      // Invalidate any in-flight request on close.
      requestIdRef.current++
    }
    // We intentionally re-run on every open; `library` is stable per
    // platform context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // ----- Derived view: search filter + client-side sort -----
  const visibleLibraries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let rows = libraries
    if (needle.length > 0) {
      rows = rows.filter((lib) => {
        return (
          lib.name.toLowerCase().includes(needle) ||
          lib.displayName.toLowerCase().includes(needle) ||
          (lib.description?.toLowerCase().includes(needle) ?? false) ||
          lib.authorHandle.toLowerCase().includes(needle)
        )
      })
    }
    if (sort === 'name') {
      rows = [...rows].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
    }
    // 'popular' is the server-side order — preserved as-is.
    return rows
  }, [libraries, query, sort])

  const handleClose = () => {
    modalActions.closeModal()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleInstall = () => {
    if (selectedIds.size === 0) return
    const picks = libraries.filter((l) => selectedIds.has(l.id))
    modalActions.openModal('confirm-install-libraries', { libraries: picks })
  }

  const selectionCount = selectedIds.size

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
        modalActions.onOpenChange('public-catalog-browser', open)
      }}
    >
      <ModalContent className='flex h-[600px] w-[680px] select-none flex-col rounded-lg p-6'>
        <ModalTitle className='mb-1 text-xl font-semibold'>Browse Public Libraries</ModalTitle>
        <p className='mb-4 text-sm text-neutral-600 dark:text-neutral-400'>
          Discover and install community-published OpenPLC libraries.
        </p>

        <div className='mb-3 flex items-center gap-2'>
          <input
            type='text'
            placeholder='Search by name, author, or description...'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={phase !== 'ready'}
            className='flex-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-1000 placeholder:text-neutral-400 focus:border-brand focus:outline-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-600'
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            disabled={phase !== 'ready'}
            className='rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-1000 focus:border-brand focus:outline-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
          >
            <option value='popular'>Sort: Popularity</option>
            <option value='name'>Sort: Name</option>
          </select>
        </div>

        <div className='flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
          {phase === 'loading' && (
            <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
              <span className='mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-brand' />
              Loading public catalog...
            </div>
          )}

          {phase === 'error' && (
            <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
              <span className='text-sm text-red-600 dark:text-red-400'>{error ?? 'Could not load catalog.'}</span>
              <button
                type='button'
                onClick={() => void runFetch()}
                className='cursor-pointer rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-medium-dark'
              >
                Retry
              </button>
            </div>
          )}

          {phase === 'ready' && visibleLibraries.length === 0 && (
            <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
              {libraries.length === 0 ? 'No libraries have been published yet.' : 'No results for your search.'}
            </div>
          )}

          {phase === 'ready' && visibleLibraries.length > 0 && (
            <ul className='divide-y divide-neutral-100 dark:divide-neutral-800'>
              {visibleLibraries.map((lib) => {
                const isSelected = selectedIds.has(lib.id)
                const isInstalled = installedSet.has(lib.name.toLowerCase())
                return (
                  <li key={lib.id}>
                    <button
                      type='button'
                      onClick={() => toggleSelect(lib.id)}
                      aria-pressed={isSelected}
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left',
                        isSelected
                          ? 'bg-brand/15 dark:bg-brand/25 shadow-[inset_3px_0_0_var(--primary-default)]'
                          : 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                          isSelected
                            ? 'border-brand bg-brand'
                            : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950',
                        )}
                        aria-hidden
                      >
                        {isSelected && (
                          <svg viewBox='0 0 12 12' className='h-3 w-3 stroke-white' fill='none' strokeWidth='2'>
                            <path d='M2.5 6.5L4.5 8.5L9 3.5' />
                          </svg>
                        )}
                      </span>
                      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                        <span className='flex items-baseline justify-between gap-3'>
                          <span className='truncate text-sm font-semibold text-neutral-950 dark:text-white'>
                            {lib.displayName}
                          </span>
                          <span className='flex flex-shrink-0 items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400'>
                            v{lib.version}
                            {isInstalled && (
                              <span className='rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'>
                                installed
                              </span>
                            )}
                          </span>
                        </span>
                        <span className='truncate text-xs text-neutral-600 dark:text-neutral-400'>
                          {lib.description ?? 'No description.'}
                        </span>
                        <span className='flex items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-500'>
                          <span>by {lib.authorHandle}</span>
                          <span>· {lib.downloadsCount.toLocaleString()} downloads</span>
                          {typeof lib.projectStarsCount === 'number' && (
                            <span>· {lib.projectStarsCount.toLocaleString()} stars</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className='mt-4 flex items-center justify-between gap-3'>
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>
            {selectionCount === 0 ? 'Select one or more libraries to install.' : `${selectionCount} selected.`}
          </span>
          <div className='flex gap-3'>
            <button
              type='button'
              onClick={handleClose}
              className='cursor-pointer rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={handleInstall}
              disabled={selectionCount === 0}
              className='cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
            >
              Install
              {selectionCount > 0 ? ` (${selectionCount})` : ''}
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { PublicCatalogBrowserModal }
