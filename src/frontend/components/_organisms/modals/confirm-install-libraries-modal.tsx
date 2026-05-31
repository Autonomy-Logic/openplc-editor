/**
 * Confirm-install step chained off `public-catalog-browser`.
 *
 * The browser hands its selection through `modalActions.openModal(
 * 'confirm-install-libraries', { libraries: [...] })`; this modal
 * renders the list verbatim, runs the install on Confirm, and shows
 * a per-row pass/fail summary while keeping itself open just long
 * enough for the user to read the result.  On a clean success it
 * closes the whole modal chain (catalog browser too) and lets the
 * Library Manager refresh through the existing `libraries:changed`
 * event the IPC handler fires.
 */

import { useState } from 'react'

import type { CatalogInstallItem } from '../../../../middleware/shared/ports/library-port'
import type { PublicLibrary } from '../../../../middleware/shared/ports/public-catalog-types'
import { useLibrary } from '../../../../middleware/shared/providers/platform-context'
import { useOpenPLCStore } from '../../../store'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type ModalData = { libraries: PublicLibrary[] } | null

const ConfirmInstallLibrariesModal = () => {
  const library = useLibrary()
  const modals = useOpenPLCStore((s) => s.modals)
  const modalActions = useOpenPLCStore((s) => s.modalActions)
  const isOpen = modals['confirm-install-libraries']?.open ?? false
  const data = (modals['confirm-install-libraries']?.data ?? null) as ModalData
  const selection = data?.libraries ?? []

  const [phase, setPhase] = useState<'ready' | 'installing' | 'done'>('ready')
  const [results, setResults] = useState<CatalogInstallItem[]>([])

  const handleCancel = () => {
    // Close only this modal — return the user to the catalog browser
    // with their selection preserved.
    modalActions.onOpenChange('confirm-install-libraries', false)
    setPhase('ready')
    setResults([])
  }

  const handleConfirm = async () => {
    if (selection.length === 0) return
    if (!library?.installFromCatalog) return
    setPhase('installing')
    const batch = await library.installFromCatalog(selection.map((l) => l.id))
    setResults(batch.results)
    setPhase('done')
  }

  const handleClose = () => {
    // Closes BOTH this modal and the catalog browser underneath.
    modalActions.closeModal()
    setPhase('ready')
    setResults([])
  }

  const successCount = results.filter((r) => r.success).length
  const failureCount = results.length - successCount

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        // Closing via Escape / overlay click should drop just this
        // modal, not the catalog browser below.
        if (!open && phase !== 'done') handleCancel()
        if (!open && phase === 'done') handleClose()
        modalActions.onOpenChange('confirm-install-libraries', open)
      }}
    >
      <ModalContent className='flex max-h-[600px] w-[520px] select-none flex-col rounded-lg p-6'>
        {phase === 'ready' && (
          <>
            <ModalTitle className='mb-2 text-xl font-semibold'>Install libraries</ModalTitle>
            <p className='mb-4 text-sm text-neutral-600 dark:text-neutral-400'>
              {selection.length === 1
                ? 'The following library will be downloaded and installed:'
                : `${selection.length} libraries will be downloaded and installed:`}
            </p>
            <ul className='mb-4 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
              {selection.map((lib) => (
                <li
                  key={lib.id}
                  className='flex items-center justify-between border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-800'
                >
                  <span className='flex flex-col gap-0.5'>
                    <span className='font-caption text-sm font-medium text-neutral-950 dark:text-white'>
                      {lib.displayName}
                    </span>
                    <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>by {lib.authorHandle}</span>
                  </span>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>v{lib.version}</span>
                </li>
              ))}
            </ul>
            <div className='flex justify-end gap-3'>
              <button
                type='button'
                onClick={handleCancel}
                className='cursor-pointer rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void handleConfirm()}
                className='cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
              >
                Confirm install
              </button>
            </div>
          </>
        )}

        {phase === 'installing' && (
          <div className='flex flex-1 flex-col items-center justify-center gap-3 py-6'>
            <span className='inline-block h-3 w-3 animate-pulse rounded-full bg-brand' />
            <span className='text-sm text-neutral-700 dark:text-neutral-300'>
              Installing {selection.length} {selection.length === 1 ? 'library' : 'libraries'}...
            </span>
          </div>
        )}

        {phase === 'done' && (
          <>
            <ModalTitle className='mb-2 text-xl font-semibold'>
              {failureCount === 0 ? 'Install complete' : 'Install finished with errors'}
            </ModalTitle>
            <p className='mb-4 text-sm text-neutral-600 dark:text-neutral-400'>
              {successCount} succeeded
              {failureCount > 0 ? `, ${failureCount} failed` : ''}.
            </p>
            <ul className='mb-4 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
              {results.map((r) => {
                const matchedSelection = selection.find((l) => l.id === r.publishedLibraryId)
                const displayName = r.name ?? matchedSelection?.displayName ?? r.publishedLibraryId
                return (
                  <li
                    key={r.publishedLibraryId}
                    className='flex flex-col gap-0.5 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-800'
                  >
                    <span className='flex items-baseline justify-between gap-3'>
                      <span className='truncate text-sm font-medium text-neutral-950 dark:text-white'>
                        {displayName}
                      </span>
                      <span
                        className={
                          r.success
                            ? 'text-xs font-medium text-green-600 dark:text-green-400'
                            : 'text-xs font-medium text-red-600 dark:text-red-400'
                        }
                      >
                        {r.success ? 'installed' : 'failed'}
                      </span>
                    </span>
                    {!r.success && r.error && (
                      <span className='text-[11px] text-red-600 dark:text-red-400'>{r.error}</span>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className='flex justify-end'>
              <button
                type='button'
                onClick={handleClose}
                className='cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
              >
                Done
              </button>
            </div>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export { ConfirmInstallLibrariesModal }
