import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@root/renderer/components/_molecules'
import React from 'react'

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ isOpen, onClose }) => {
  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent onClose={onClose}>
        <ModalHeader>
          <ModalTitle>New Project</ModalTitle>
        </ModalHeader>
        <ModalFooter>
          <button onClick={onClose}>Submit</button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
