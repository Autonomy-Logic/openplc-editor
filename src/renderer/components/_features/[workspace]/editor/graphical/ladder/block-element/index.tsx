import { Modal, ModalContent, ModalTrigger } from '@root/renderer/components/_molecules'

export default function BlockElement() {
  return (
    <Modal>
      <ModalTrigger>Open</ModalTrigger>
      <ModalContent className='h-[739px] w-[413px] py-4 px-6 '>
        <div className='flex h-full w-full '>

        </div>
      </ModalContent>
    </Modal>
  )
}
