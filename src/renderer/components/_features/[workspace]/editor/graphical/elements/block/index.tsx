import * as Switch from '@radix-ui/react-switch'
import { InputWithRef } from '@root/renderer/components/_atoms'
import {
  BlockNode,
  BlockNodeData,
  BlockNodeElement,
  BlockVariant,
  buildBlockNode,
  DEFAULT_BLOCK_TYPE,
} from '@root/renderer/components/_atoms/react-flow/custom-nodes/block'
import {
  Modal,
  ModalContent,
  ModalTitle,
  // ModalTrigger,
} from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'
import { Dispatch, SetStateAction, useEffect, useState } from 'react'

import ArrowButtonGroup from '../arrow-button-group'
import { ModalBlockLibrary } from './library'

type BlockElementProps<T> = {
  isOpen: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  onClose?: () => void
  selectedNode: BlockNode<T>
}

const BlockElement = <T extends object>({ isOpen, onOpenChange, onClose, selectedNode }: BlockElementProps<T>) => {
  const { libraries } = useOpenPLCStore()

  const [node, setNode] = useState<BlockNode<T>>(selectedNode)
  const blockVariant = node.data.variant as BlockVariant

  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<T | null>(null)
  const [formState, setFormState] = useState<{ name: string; inputs: string; executionOrder: string }>({
    name: blockVariant?.name || DEFAULT_BLOCK_TYPE.name,
    inputs: blockVariant?.variables.filter((variable) => variable.class === 'input').length.toString() || '0',
    executionOrder: '',
  })

  const isFormValid = Object.values(formState).every((value) => value !== '')

  useEffect(() => {
    const [type, selectedLibrary, selectedPou] = selectedFileKey?.split('/') || []
    if (type === 'system' && selectedLibrary && selectedPou) {
      const library = libraries.system.find((library) => library.name === selectedLibrary)
      const pou = library?.pous.find((pou) => pou.name === selectedPou) as T
      setSelectedFile(pou)
      return
    }
    setSelectedFile(null)
  }, [selectedFileKey])

  useEffect(() => {
    if (selectedFile) {
      const newNode = buildBlockNode({
        id: node.id,
        posX: node.position.x,
        posY: node.position.y,
        handleX: node.data.inputConnector?.glbPosition.x || 0,
        handleY: node.data.inputConnector?.glbPosition.y || 0,
        variant: selectedFile,
      })
      setNode({ ...newNode, data: { ...newNode.data, variant: selectedFile } })
      const newNodeDataVariant = newNode.data.variant as BlockVariant
      const formName: string = newNodeDataVariant.name
      const formInputs: string = newNodeDataVariant.variables.filter((variable) => variable.class === 'input').length.toString()
      setFormState((prevState) => ({ ...prevState, name: formName, inputs: formInputs }))
    }
  }, [selectedFile])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    setFormState((prevState) => ({ ...prevState, [id]: value }))
  }

  const handleClearForm = () => {
    setFormState({ name: '', inputs: '', executionOrder: '' })
    setSelectedFileKey(null)
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
              <ModalBlockLibrary selectedFileKey={selectedFileKey} setSelectedFileKey={setSelectedFileKey} />
              <div className='border-neural-100 h-full max-h-[119px] overflow-hidden rounded-lg border px-2 py-4 text-xs font-normal text-neutral-950 dark:border-neutral-850 dark:text-neutral-100'>
                <p className='h-full overflow-y-auto dark:text-neutral-100'>
                  {
                    // @ts-expect-error - selectedFile is not null and it is a generic type of pous
                    selectedFile ? selectedFile.documentation : null
                  }
                </p>
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
              className='flex h-[330px] items-center justify-center rounded-lg border-[2px] border-brand-dark bg-transparent dark:border-neutral-850'
            >
              <BlockNodeElement
                data={node.data as BlockNodeData<object>}
                height={node.height || 0}
                selected={false}
                disabled={true}
                scale={310 / ((node.height || 310) <= 310 ? 310 : node.height || 310)}
              />
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
