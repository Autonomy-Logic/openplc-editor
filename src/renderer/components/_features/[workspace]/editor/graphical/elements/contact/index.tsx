import { ContactNode, DEFAULT_CONTACT_TYPES } from '@root/renderer/components/_atoms/react-flow/custom-nodes/contact'
import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'
import { Dispatch, SetStateAction, useState } from 'react'

type ContactElementProps = {
  isOpen: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  onClose?: () => void
  node: ContactNode
  rungId: string
}

const ContactElement = ({ isOpen, onOpenChange, onClose, node, rungId }: ContactElementProps) => {
  const {
    editor,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const [selectedModifier, setSelectedModifier] = useState<string | null>(node?.data.variant as string)
  const contactModifiers = Object.entries(DEFAULT_CONTACT_TYPES).map(([label, contact]) => ({
    label: label.replace(/([a-z])([A-Z])/g, '$1 $2'),
    value: label,
    contact,
  }))

  const getModifierContact = (value: string) => {
    const modifier = contactModifiers.find((modifier) => modifier.value === value)
    return modifier ? modifier.contact.svg(false) : ''
  }

  const handleCloseModal = () => {
    setSelectedModifier(null)
    onClose && onClose()
  }

  const handleConfirmAlteration = () => {
    updateNode({
      node: {
        ...node,
        data: {
          ...node.data,
          variant: selectedModifier,
        },
      },
      rungId,
      editorName: editor.meta.name,
    })
    handleCloseModal()
  }

  return (
    <Modal open={isOpen} onOpenChange={onOpenChange}>
      {/* <ModalTrigger>Open Contact</ModalTrigger> */}
      <ModalContent
        onEscapeKeyDown={handleCloseModal}
        onInteractOutside={handleCloseModal}
        className='h-[400px] w-[468px] select-none flex-col justify-between px-8 py-4'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Edit Contact Values</ModalTitle>
        <div className='flex h-[260px] w-full gap-10'>
          <div className='relative h-full w-full text-base font-medium text-neutral-950'>
            <span className='dark:text-neutral-300'>Modifier</span>
            <ul className='mt-4 flex flex-col gap-3 dark:text-neutral-300'>
              {contactModifiers.map((modifier, index) => (
                <li
                  key={index}
                  className='flex cursor-pointer items-center gap-2 rounded-md border-0 p-1 hover:bg-slate-100 dark:hover:bg-neutral-900'
                  onClick={() => setSelectedModifier(modifier.value)}
                >
                  <input
                    type='radio'
                    name='modifier'
                    className={`border-1 h-4 w-4 cursor-pointer appearance-none rounded-full border border-[#D1D5DB] ring-0 checked:border-[5px] checked:border-brand dark:border-neutral-850 dark:bg-neutral-300`}
                    id={modifier.label}
                    checked={selectedModifier === modifier.value}
                    onChange={() => setSelectedModifier(modifier.value)}
                  />
                  <label className='cursor-pointer text-xs font-normal capitalize' htmlFor={modifier.label}>
                    {modifier.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className='flex h-full w-full flex-col gap-4'>
            <label htmlFor='block-preview' className='text-base font-medium text-neutral-950 dark:text-neutral-300'>
              Preview
            </label>
            <div className='flex h-full w-full items-center justify-center rounded-lg border-[2px] border-brand-dark dark:border-neutral-850 dark:bg-neutral-900'>
              <div className='scale-150'>{selectedModifier && getModifierContact(selectedModifier)}</div>
            </div>
          </div>
        </div>
        <div className='flex !h-8 w-full gap-6 '>
          <button
            className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 hover:bg-neutral-300 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            onClick={handleCloseModal}
          >
            Cancel
          </button>
          <button
            className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white enabled:hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
            disabled={!selectedModifier || selectedModifier === node?.data.variant}
            onClick={handleConfirmAlteration}
          >
            Confirm
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default ContactElement
