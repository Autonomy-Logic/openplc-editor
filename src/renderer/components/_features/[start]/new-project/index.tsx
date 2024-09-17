import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalTitle,
  } from '@root/renderer/components/_molecules'
  import React from 'react'

  interface NewProjectModalProps {
    onClose: () => void
    isOpen: boolean
  }

  const NewProjectModal: React.FC<NewProjectModalProps> = ({ onClose, isOpen }) => {
    return (
      <Modal open={isOpen} onOpenChange={onClose}>
        <ModalContent onClose={onClose}>
          <ModalHeader>
            <ModalTitle>New Project</ModalTitle>
          </ModalHeader>
        </ModalContent>
      </Modal>
    )
  }

  export default NewProjectModal
