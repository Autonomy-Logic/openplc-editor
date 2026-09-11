/**
 * Library updates modal — offered when the open project pins a library to a
 * version older than one already installed.
 *
 * Each row proposes the newest installed version; setting a row back to the
 * version the project already pins keeps it. Applying repins the project and
 * re-stamps the placed blocks, so one update reaches every call at once.
 */

import { useMemo, useState } from 'react'

import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms/select'
import { reconcilePlacedBlocks } from '../../_features/[workspace]/editor/library-manager/reconcile-placed-blocks'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const LibraryUpdatesModal = () => {
  const isOpen = useOpenPLCStore((state) => state.modals['library-updates']?.open ?? false)
  const outdated = useOpenPLCStore((state) => state.outdatedLibraries)
  const setLibraryVersion = useOpenPLCStore((state) => state.libraryActions.setLibraryVersion)
  const closeModal = useOpenPLCStore((state) => state.modalActions.closeModal)
  const onOpenChange = useOpenPLCStore((state) => state.modalActions.onOpenChange)

  /** Newest first, so index 0 is the proposed action for every row. */
  const newest = useMemo(
    () => Object.fromEntries(outdated.map((library) => [library.name, library.available[0]])),
    [outdated],
  )
  const [choices, setChoices] = useState<Record<string, string>>(newest)

  const selected = (name: string) => choices[name] ?? newest[name]
  const pending = outdated.filter((library) => selected(library.name) !== library.pinned)

  const handleApply = () => {
    for (const library of pending) setLibraryVersion(library.name, selected(library.name))
    if (pending.length > 0) reconcilePlacedBlocks()
    closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal()
        onOpenChange('library-updates', open)
      }}
    >
      <ModalContent className='flex h-auto max-h-[80vh] w-[520px] select-none flex-col p-6'>
        <ModalTitle className='mb-2 text-xl font-semibold'>Library updates</ModalTitle>

        <p className='mb-4 text-sm text-neutral-600 dark:text-neutral-400'>
          {outdated.length === 1
            ? 'This project uses a library with a newer version installed.'
            : `This project uses ${outdated.length} libraries with newer versions installed.`}{' '}
          Choose the version each one should use; leaving a row on the version it already uses keeps it.
        </p>

        <ul className='mb-4 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
          {outdated.map((library) => (
            <li
              key={library.name}
              className='flex items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-800'
            >
              <span className='flex min-w-0 flex-col gap-0.5'>
                <span className='truncate font-caption text-sm font-medium text-neutral-950 dark:text-white'>
                  {library.name}
                </span>
                <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>in use: v{library.pinned}</span>
              </span>
              <Select
                value={selected(library.name)}
                onValueChange={(version) => setChoices((prev) => ({ ...prev, [library.name]: version }))}
              >
                <SelectTrigger
                  aria-label={`Version for ${library.name}`}
                  placeholder={`v${selected(library.name)}`}
                  withIndicator
                  className='group flex h-[30px] w-36 shrink-0 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <SelectContent
                  className='max-h-[220px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                  position='popper'
                  align='center'
                  side='bottom'
                  sideOffset={5}
                >
                  {library.available.map((version) => (
                    <SelectItem
                      key={version}
                      value={version}
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center justify-start px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {version === library.pinned ? `Keep v${version}` : `Use v${version}`}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>

        <div className='flex items-center justify-between gap-3'>
          <button
            type='button'
            onClick={() => setChoices(newest)}
            className='cursor-pointer rounded-md px-2 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white'
          >
            Set all to newest
          </button>
          <div className='flex justify-end gap-3'>
            <button
              type='button'
              onClick={() => closeModal()}
              className='cursor-pointer rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              Not now
            </button>
            <button
              type='button'
              onClick={handleApply}
              disabled={pending.length === 0}
              className='cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
            >
              {pending.length === 0 ? 'Nothing to change' : `Update ${pending.length}`}
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { LibraryUpdatesModal }
