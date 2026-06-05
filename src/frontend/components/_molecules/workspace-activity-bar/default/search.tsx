import { SearchIcon } from '../../../../assets/icons/interface/Search'
import { useIsNinetiesTheme } from '../../../../hooks/use-nineties-theme'
import { useOpenPLCStore } from '../../../../store'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { RetroSearch } from '../../../_atoms/retro-icons'
import SearchInProject from '../../../_features/[workspace]/editor/search-in-project'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '../../modal'

export const SearchButton = () => {
  const {
    workspaceActions: { setModalOpen },
    workspace: { isModalOpen },
    searchActions: { setSearchQuery },
  } = useOpenPLCStore()

  const handleModalClose = () => {
    setModalOpen('findInProject', false)
  }
  const handleOpenChange = (open: boolean) => {
    setSearchQuery('')
    setModalOpen('findInProject', open)
  }

  const isFindInProjectModalOpen = isModalOpen.some(
    (modal: { modalName: string; modalState: boolean }) => modal.modalName === 'findInProject' && modal.modalState,
  )

  const isNineties = useIsNinetiesTheme()

  return (
    <Modal onOpenChange={handleOpenChange} open={isFindInProjectModalOpen}>
      <ModalTrigger asChild>
        <ActivityBarButton aria-label='Search'>{isNineties ? <RetroSearch /> : <SearchIcon />}</ActivityBarButton>
      </ModalTrigger>
      <ModalContent className='h-[424px] w-[668px] select-none flex-col justify-between px-8 py-4'>
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Search in Project</ModalTitle>
        <SearchInProject onClose={handleModalClose} />
      </ModalContent>
    </Modal>
  )
}
