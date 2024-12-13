import { SearchIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'

import { ActivityBarButton } from '../../../_atoms/buttons'
import SearchInProject from '../../../_features/[workspace]/editor/search-in-project'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '../../modal'

export const SearchButton = () => {
  const {
    // workspaceActions: { setModalOpen },
    workspace: { isModalOpen },
    searchActions: { setSearchQuery },
  } = useOpenPLCStore()

  const handleModalClose = () => {
    // setModalOpen('findInProject',false)
  }
  const handleOpenChange = (_open: boolean) => {
    setSearchQuery('')
    // setModalOpen('findInProject', open)
  }

  const isFindInProjectModalOpen = isModalOpen.some(
    (modal: { modalName: string; modalState: boolean }) => modal.modalName === 'findInProject' && modal.modalState,
  )

  useEffect(() => {
    window.bridge.findInProjectAccelerator((_event) => {
      // setModalOpen('findInProject',true)
    })
  }, [])

  return (
    <Modal onOpenChange={handleOpenChange} open={isFindInProjectModalOpen}>
      <ModalTrigger>
        <ActivityBarButton aria-label='Search'>
          <SearchIcon />
        </ActivityBarButton>
      </ModalTrigger>
      <ModalContent className='h-[424px] w-[668px] select-none flex-col justify-between px-8 py-4'>
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Search in Project</ModalTitle>
        <SearchInProject onClose={handleModalClose} />
      </ModalContent>
    </Modal>
  )
}
