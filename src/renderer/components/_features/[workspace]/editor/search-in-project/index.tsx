import * as Checkbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { SearchIcon } from '@root/renderer/assets'
import { InputWithRef } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'

type OptionProps = {
  id: string
  label: string
}

const scopeElements = [{ value: 'whole project' }, { value: 'only elements' }]

const scopeElementsOptions = [
  { value: 'data type' },
  { value: 'function' },
  { value: 'function block' },
  { value: 'program' },
  { value: 'configuration' },
]

const CheckboxOption = ({ id, label }: OptionProps) => (
  <div className='flex items-center gap-2'>
    <Checkbox.Root
      className='flex h-4 w-4 appearance-none items-center justify-center rounded-sm border border-neutral-300 outline-none dark:border-neutral-850 dark:bg-neutral-700'
      id={id}
    >
      <Checkbox.Indicator className='text-brand'>
        <CheckIcon />
      </Checkbox.Indicator>
    </Checkbox.Root>
    <label
      htmlFor={id}
      className='cursor-pointer whitespace-nowrap text-sm font-medium text-neutral-950 dark:text-white'
    >
      {label}
    </label>
  </div>
)

const RadioOption = ({ id, label }: OptionProps) => (
  <div className='flex items-center gap-2'>
    <input
      type='radio'
      id={id}
      className='border-1 h-4 w-4 cursor-pointer appearance-none rounded-full border border-[#D1D5DB] ring-0 checked:border-[5px] checked:border-brand dark:border-neutral-850 dark:bg-neutral-300'
    />
    <label htmlFor={id} className='cursor-pointer text-sm font-medium capitalize text-neutral-950 dark:text-white'>
      {label}
    </label>
  </div>
)

export default function SearchInProject() {
  return (
    <Modal>
      <ModalTrigger>
        <SearchIcon />
      </ModalTrigger>
      <ModalContent className='h-[424px] w-[668px] select-none flex-col justify-between px-8 py-4'>
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Search in Project</ModalTitle>
        <div className='flex h-full w-full flex-col gap-8'>
          <div className='flex h-[57px] w-full gap-6'>
            <div className='flex w-full flex-col justify-between'>
              <p className='text-cp-base font-medium text-neutral-950 dark:text-white'>Pattern to Search</p>
              <InputWithRef className='h-[30px] w-full rounded-lg border border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-100' />
            </div>
            <div className='flex flex-col justify-between'>
              <CheckboxOption id='sensitive-case' label='Sensitive case' />
              <CheckboxOption id='regular-expression' label='Regular Expression' />
            </div>
          </div>
          <div className='h-[183px] w-full px-2 py-4'>
            <div className='flex h-full w-full gap-4'>
              <div className='flex flex-col gap-4'>
                <span className='text-base font-medium text-neutral-950 dark:text-white'>Scope:</span>
                {scopeElements.map((element) => (
                  <RadioOption key={element.value} id={element.value} label={element.value} />
                ))}
              </div>
              <div className='flex h-[153px] flex-1 items-center rounded-md border-2 border-brand-dark p-2 dark:border-neutral-850'>
                <div className='flex w-full flex-col gap-[7px]'>
                  {scopeElementsOptions.map((element) => (
                    <CheckboxOption key={element.value} id={element.value} label={element.value} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className='flex !h-8 w-full gap-6'>
            <button className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'>
              Locate
            </button>
            <button className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
              Close
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
