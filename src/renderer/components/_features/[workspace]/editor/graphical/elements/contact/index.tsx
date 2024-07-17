import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'
import { useState } from 'react'
const ContactELement = () => {
  const FilterOptions = ['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp'] as const
  const [selectedOption, setSelectedOption] = useState(FilterOptions[0])

  const handleSelectChange = (value: string) => {
    setSelectedOption(value)
  }

  return (
    <Modal>
      <ModalTrigger>Open Contact</ModalTrigger>
      <ModalContent onClose={() => {}} className='h-[468px] w-[413px] flex-col gap-8 px-6 py-4'>
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Block Properties</ModalTitle>
        <div className='flex h-[316px] w-full gap-10'>
          <div className='relative h-full w-full text-sm font-medium text-neutral-950'>
            <span>Modifier</span>
            <ul className='mt-4 flex flex-col gap-4 '>
              {['Normal', 'Negated', 'Rising Edge', 'Falling Edge'].map((modifier, index) => (
                <li key={index} className='flex items-center'>
                  <input type='radio' name='modifier' id={modifier} className='mr-2' />
                  <label htmlFor={modifier}>{modifier}</label>
                </li>
              ))}
            </ul>

            <div className='absolute bottom-0 w-full'>
              <p>Variable</p>
              <div className='relative h-full w-full'>
                <Select value={selectedOption} onValueChange={handleSelectChange}>
                  <SelectTrigger
                    id='class-filter'
                    placeholder={selectedOption}
                    withIndicator
                    className='group flex h-8 w-44 items-center justify-between rounded-lg border border-neutral-500 px-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-neutral-850 dark:text-neutral-300'
                  />
                  <SelectContent
                    position='popper'
                    sideOffset={3}
                    align='center'
                    className='box z-[999] h-fit w-40 overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
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
          <div className='h-full w-full'></div>
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
