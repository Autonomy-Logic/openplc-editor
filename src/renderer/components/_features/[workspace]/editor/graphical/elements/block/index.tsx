import * as Switch from '@radix-ui/react-switch'
import { InputWithRef } from '@root/renderer/components/_atoms'
import { BlockNode, DEFAULT_BLOCK_TYPES } from '@root/renderer/components/_atoms/react-flow/custom-nodes/block'
import {
  Modal,
  ModalContent,
  ModalTitle,
  // ModalTrigger,
} from '@root/renderer/components/_molecules'
import { Dispatch, SetStateAction, useState } from 'react'

import ArrowButtonGroup from '../arrow-button-group'
import { ModalBlockLibrary } from './library'

type BlockElementProps = {
  isOpen: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  onClose?: () => void
  node?: BlockNode
}

const BlockElement = ({ isOpen, onOpenChange, onClose, node }: BlockElementProps) => {
  const [selectedFile, setSelectedFile] = useState<{ image: string; text: string } | null>(null)
  const [formState, setFormState] = useState<{ name: string; inputs: string; executionOrder: string }>({
    name: DEFAULT_BLOCK_TYPES[node?.data.variant || 'default'].name,
    inputs: (node?.data.inputHandles.length || 0).toString(),
    executionOrder: '',
  })

  const isFormValid = Object.values(formState).every((value) => value !== '')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    setFormState((prevState) => ({ ...prevState, [id]: value }))
  }

  const handleClearForm = () => {
    setFormState({ name: '', inputs: '', executionOrder: '' })
    setSelectedFile(null)
  }

  const handleIncrement = (field: 'inputs' | 'executionOrder') => {
    setFormState((prevState) => ({
      ...prevState,
      [field]: String(Math.min(Number(prevState[field]) + 1, 20)),
    }))
  }

  const handleDecrement = (field: 'inputs' | 'executionOrder') => {
    setFormState((prevState) => ({
      ...prevState,
      [field]: String(Math.max(Number(prevState[field]) - 1, 0)),
    }))
  }

  const handleCloseModal = () => {
    handleClearForm()
    onClose && onClose()
  }

  const labelStyle = 'text-sm font-medium text-neutral-950 dark:text-white'
  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <Modal open={isOpen} onOpenChange={onOpenChange}>
      {/* <ModalTrigger>Open</ModalTrigger> */}
      <ModalContent
        onClose={handleCloseModal}
        onEscapeKeyDown={handleCloseModal}
        onInteractOutside={handleCloseModal}
        className='h-[739px] w-[625px] select-none flex-col gap-8 px-14 py-4'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Block Properties</ModalTitle>
        <div className='flex h-[587px] w-full justify-between'>
          <div id='container-modifier-variable' className='h-full w-[236px]'>
            <div className='flex h-full w-full flex-col gap-2'>
              <label className={labelStyle}>Type:</label>
              <ModalBlockLibrary />
              <div className='border-neural-100 h-full max-h-[119px] overflow-hidden rounded-lg border px-2 py-4 text-xs font-normal text-neutral-950 dark:border-neutral-850 dark:text-neutral-100'>
                <p className='h-full overflow-y-auto dark:text-neutral-100'>{selectedFile?.text}</p>
              </div>
            </div>
          </div>
          <div id='preview' className='flex h-full w-[236px] flex-col gap-2'>
            <label htmlFor='name' className={labelStyle}>
              Name:
            </label>
            <InputWithRef
              id='name'
              className={inputStyle}
              placeholder=''
              type='text'
              value={formState.name}
              onChange={handleInputChange}
            />
            <label htmlFor='inputs' className={labelStyle}>
              Inputs:
            </label>
            <div className='flex items-center gap-1'>
              <InputWithRef
                id='inputs'
                className={inputStyle}
                placeholder=''
                type='number'
                value={formState.inputs}
                onChange={handleInputChange}
              />
              <ArrowButtonGroup
                onIncrement={() => handleIncrement('inputs')}
                onDecrement={() => handleDecrement('inputs')}
              />
            </div>
            <label htmlFor='executionOrder' className={labelStyle}>
              Execution Order:
            </label>
            <div className='flex items-center gap-1'>
              <InputWithRef
                id='executionOrder'
                className={inputStyle}
                placeholder=''
                type='number'
                value={formState.executionOrder}
                onChange={handleInputChange}
              />
              <ArrowButtonGroup
                onIncrement={() => handleIncrement('executionOrder')}
                onDecrement={() => handleDecrement('executionOrder')}
              />
            </div>
            <div className='flex items-center gap-2'>
              <label htmlFor='executionControlSwitch' className={labelStyle}>
                Execution Control:
              </label>
              <Switch.Root
                className='relative h-4 w-[29px] cursor-pointer rounded-full bg-neutral-300 shadow-[0_4_4_1px] outline-none transition-all duration-150 data-[state=checked]:bg-brand dark:bg-neutral-850'
                id='executionControlSwitch'
              >
                <Switch.Thumb className='block h-[14px] w-[14px] translate-x-0.5 rounded-full bg-white shadow-[0_0_4_1px] transition-all duration-150 will-change-transform data-[state=checked]:translate-x-[14px]' />
              </Switch.Root>
            </div>
            <label htmlFor='block-preview' className={labelStyle}>
              Preview
            </label>
            <div
              id='block-preview'
              className='-center flex flex-grow items-center rounded-lg border-[2px] border-brand-dark dark:border-neutral-850 dark:bg-neutral-900'
            >
              {selectedFile?.image && (
                <img draggable='false' className='h-fit w-full select-none' src={selectedFile.image} alt='' />
              )}
            </div>
          </div>
        </div>
        <div className='flex !h-8 w-full justify-evenly gap-7'>
          <button
            className={`h-full w-[236px] items-center rounded-lg text-center font-medium text-white ${isFormValid ? 'bg-brand' : 'cursor-not-allowed bg-brand opacity-50'}`}
            disabled={!isFormValid}
          >
            Ok
          </button>
          <button className='h-full w-[236px] items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default BlockElement
