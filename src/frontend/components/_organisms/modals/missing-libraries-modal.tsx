/**
 * Missing-libraries modal — surfaced after a project loads when its
 * `libraries` field references libraries the system pool can't
 * resolve.  The project remains usable; compile will fail
 * meaningfully later.  This modal just nudges the user toward the
 * Library Manager so they can install the missing pieces.
 *
 * Reuses the design system's Modal primitives (same as
 * DebuggerMessageModal).  No parallel components.
 */

import { useOpenPLCStore } from '@root/frontend/store'
import { CreateLibraryManagerEditor } from '@root/frontend/store/slices/tabs/utils'

import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

const MissingLibrariesModal = () => {
  const isOpen = useOpenPLCStore((s) => s.modals['missing-libraries']?.open ?? false)
  const missing = useOpenPLCStore((s) => s.missingLibraries)
  const closeModal = useOpenPLCStore((s) => s.modalActions.closeModal)
  const onOpenChange = useOpenPLCStore((s) => s.modalActions.onOpenChange)
  const updateTabs = useOpenPLCStore((s) => s.tabsActions.updateTabs)
  const setSelectedTab = useOpenPLCStore((s) => s.tabsActions.setSelectedTab)
  const addModel = useOpenPLCStore((s) => s.editorActions.addModel)
  const setEditor = useOpenPLCStore((s) => s.editorActions.setEditor)
  const getEditorFromEditors = useOpenPLCStore((s) => s.editorActions.getEditorFromEditors)

  const handleOpenManager = () => {
    const tabName = 'Library Manager'
    updateTabs({ name: tabName, elementType: { type: 'library-manager' } })
    let model = getEditorFromEditors(tabName)
    if (!model) {
      model = CreateLibraryManagerEditor(tabName)
      addModel(model)
    }
    setEditor(model)
    setSelectedTab(tabName)
    closeModal()
  }

  const handleSearchInternet = () => {
    // Placeholder for the future CDN flow — same disabled-stub
    // approach VPP uses for "Add from catalog…".
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal()
        onOpenChange('missing-libraries', open)
      }}
    >
      <ModalContent className='flex h-auto max-h-[80vh] w-[480px] select-none flex-col gap-4 p-6'>
        <div className='flex flex-col items-center gap-3'>
          <WarningIcon size='lg' className='h-12 w-12' />
          <ModalTitle className='text-xl font-semibold'>Missing libraries</ModalTitle>
        </div>

        <p className='text-center text-sm text-neutral-700 dark:text-neutral-300'>
          This project enables {missing.length} {missing.length === 1 ? 'library' : 'libraries'} that{' '}
          {missing.length === 1 ? 'is' : 'are'} not installed on this system. The project will load, but compilation
          will fail until {missing.length === 1 ? 'it is' : 'they are'} available.
        </p>

        <div className='flex max-h-48 flex-col overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700'>
          {missing.map((m) => (
            <div
              key={m.name}
              className='flex items-center justify-between border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-800'
            >
              <span className='font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>{m.name}</span>
              {m.version && <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>v{m.version}</span>}
            </div>
          ))}
        </div>

        <div className='mt-2 flex flex-col gap-2'>
          <button
            type='button'
            onClick={handleOpenManager}
            className='w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
          >
            Open Library Manager
          </button>
          <button
            type='button'
            disabled
            onClick={handleSearchInternet}
            title='Coming soon — online library search is not yet available.'
            className='w-full cursor-not-allowed rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 opacity-60 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Search the internet…
          </button>
          <button
            type='button'
            onClick={() => closeModal()}
            className='w-full rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-900'
          >
            Dismiss
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { MissingLibrariesModal }
