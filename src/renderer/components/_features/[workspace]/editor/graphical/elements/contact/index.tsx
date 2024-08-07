import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'
import { useState } from 'react'

import imageMock from '../mockImages/Group112.png'
import image1 from '../mockImages/image1.png'
import image2 from '../mockImages/image2.png'

const ContactElement = () => {
  const [selectedModifier, setSelectedModifier] = useState<string | null>(null)
  const contactModifiers = [
    { label: 'normal', contact: imageMock },
    { label: 'negated', contact: image1 },
    { label: 'rising edge', contact: image2 },
    { label: 'falling edge', contact: imageMock },
  ]
  const getModifierContact = (label: string) => {
    const modifier = contactModifiers.find((modifier) => modifier.label === label)
    return modifier ? modifier.contact : ''
  }

  const handleCloseModal = () => {
    setSelectedModifier(null)
  }

  return (
    <Modal>
      <ModalTrigger>Open Contact</ModalTrigger>
      <ModalContent
        onClose={handleCloseModal}
        className='h-[498px] w-[468px] select-none flex-col justify-between px-8 py-4'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Edit Contact Values</ModalTitle>
        <div className='flex h-[316px] w-full gap-10'>
          <div className='relative h-full w-full text-base font-medium text-neutral-950'>
            <span className='dark:text-neutral-300'>Modifier</span>
            <ul className='mt-4 flex flex-col gap-4 dark:text-neutral-300'>
              {contactModifiers.map((modifier, index) => (
                <li
                  key={index}
                  className='flex cursor-pointer items-center gap-2'
                  onClick={() => setSelectedModifier(modifier.label)}
                >
                  <input
                    type='radio'
                    name='modifier'
                    className={`border-1 h-4 w-4 cursor-pointer appearance-none rounded-full border border-[#D1D5DB] ring-0 checked:border-[5px] checked:border-brand dark:border-neutral-850 dark:bg-neutral-300`}
                    id={modifier.label}
                    checked={selectedModifier === modifier.label}
                    onChange={() => setSelectedModifier(modifier.label)}
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
              {selectedModifier && (
                <img
                  draggable='false'
                  className='h-fit w-full select-none'
                  src={getModifierContact(selectedModifier)}
                  alt='Modifier Preview'
                />
              )}
            </div>
          </div>
        </div>
        <div className='flex !h-8 w-full gap-6 '>
          <button
            className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'
            disabled={!selectedModifier}
          >
            Confirm
          </button>
          <button className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default ContactElement
