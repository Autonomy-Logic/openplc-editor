import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'
import { useState } from 'react'

import imageMock from '../mockImages/Group112.png'
import image1 from '../mockImages/image1.png'
import image2 from '../mockImages/image2.png'
const ContactELement = () => {
  const FilterOptions = ['option 1', 'option 2', 'option 3'] as const
  const [selectedOption, setSelectedOption] = useState(FilterOptions[0])
  const [selectedModifier, setSelectedModifier] = useState<string | null>(null)
  const handleSelectChange = (value: string) => {
    setSelectedOption(value)
  }

  const modifierOptions: { label: string; contact: string }[] = [
    {
      label: 'normal',
      contact: imageMock,
    },
    {
      label: 'negated',
      contact: image1,
    },
    {
      label: 'rising edge',
      contact: image2,
    },
    {
      label: 'falling edge',
      contact: imageMock,
    },
  ]
  const getModifierContact = (label: string) => {
    const modifier = modifierOptions.find((modifier) => modifier.label === label)
    return modifier ? modifier.contact : ''
  }

  const handleCloseModal = () => {
    setSelectedModifier(null)
  }

  return (
    <Modal>
      <ModalTrigger>Open Contact</ModalTrigger>
      <ModalContent
        onClose={() => {
          handleCloseModal()
        }}
        className='h-[468px] w-[413px] flex-col gap-8 px-6 py-4'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Block Properties</ModalTitle>
        <div className='flex h-[316px] w-full gap-10 '>
          <div className='relative h-full w-full text-sm font-medium text-neutral-950'>
            <span className='dark:text-neutral-100'>Modifier</span>
            <ul className='mt-4 flex flex-col gap-4 dark:text-neutral-100'>
              {modifierOptions.map((modifier, index) => (
                <li
                  key={index}
                  className='flex cursor-pointer  items-center gap-2'
                  onClick={() => setSelectedModifier(modifier.label)}
                >
                  <input
                    type='radio'
                    name='modifier'
                    id={modifier.label}
                    checked={selectedModifier === modifier.label}
                    onChange={() => setSelectedModifier(modifier.label)}
                  />
                  <label className='cursor-pointer' htmlFor={modifier.label}>{modifier.label}</label>
                </li>
              ))}
            </ul>

            <div className='absolute bottom-0 w-full'>
              <p>Variable</p>
              <div className='relative h-full w-full'>
                <Select value={selectedOption} onValueChange={handleSelectChange}>
                  <SelectTrigger
                    id='select-trigger-modifier'
                    placeholder={selectedOption}
                    withIndicator
                    className='group flex h-8 w-44 items-center justify-between rounded-lg border border-neutral-500 px-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-neutral-850 dark:text-neutral-300'
                  />
                  <SelectContent
                    position='popper'
                    sideOffset={3}
                    align='center'
                    className='box z-[999] h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                  >
                    {FilterOptions.map((filter) => (
                      <SelectItem
                        key={filter}
                        value={filter}
                        className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                          {filter}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className='flex h-full w-full flex-col gap-2'>
            <label htmlFor='block-preview' className='text-sm font-medium text-neutral-950 dark:text-white'>
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
        <div className='flex !h-8 w-full gap-1'>
          <button className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white'>
            Ok
          </button>
          <button className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default ContactELement
