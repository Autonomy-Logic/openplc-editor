import * as Checkbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { LibraryCloseFolderIcon, LibraryFileIcon, MagnifierIcon } from '@root/renderer/assets'
import { InputWithRef } from '@root/renderer/components/_atoms'
import {
  LibraryFile,
  LibraryFolder,
  LibraryRoot,
  Modal,
  ModalContent,
  ModalTrigger,
} from '@root/renderer/components/_molecules'
import { useState } from 'react'

import imageMock from './mockImages/Group112.png'
import image1 from './mockImages/image1.png'
import image2 from './mockImages/image2.png'

const BlockElement = () => {
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ image: string; text: string } | null>(null)
  const [formState, setFormState] = useState({
    name: '',
    inputs: '',
    executionOrder: '',
  })

  const isFormValid = formState.name && formState.inputs && formState.executionOrder

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    setFormState((prevState) => ({ ...prevState, [id]: value }))
  }

  const lorem =
    ' Lorem ipsum dolor sit amet consectetur adipisicing elit. Autem blanditiis voluptates eius quasi quam illum deserunt perspiciatis magnam, corrupti vel! Nesciunt nostrum maxime aliquid amet asperiores quibusdam ipsam impedit corporis?'

  const treeData = [
    {
      key: '0',
      label: 'P1AM_Modules',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [
        {
          key: '0.1',
          label: 'P1AM_INIT',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: 1 + lorem,
          image: imageMock,
        },
        {
          key: '0.2',
          label: 'P1_16CDR',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: 2 + lorem,
          image: image1,
        },
        {
          key: '0.3',
          label: 'P1_08N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: 3 + lorem,
          image: image2,
        },
        {
          key: '0.4',
          label: 'P1_16N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: lorem,
          image: imageMock,
        },
        {
          key: '0.5',
          label: 'P1_16N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: lorem,
          image: image1,
        },
        {
          key: '0.6',
          label: 'P1_08T',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: lorem,
          image: image2,
        },
        {
          key: '0.7',
          label: 'P1_16TR',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: lorem,
          image: imageMock,
        },
        {
          key: '0.8',
          label: 'P1_04AD',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: lorem,
          image: image1,
        },
      ],
    },
    {
      key: '1',
      label: 'Jaguar',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [],
    },
    {
      key: '2',
      label: 'Arduino',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [],
    },
    {
      key: '3',
      label: 'Communication',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [],
    },
    {
      key: '4',
      label: 'Sequent Microsystems',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [
        { key: '0.1', label: 'P1AM_INIT', Icon: LibraryFileIcon, title: 'Module Leaf', children: [] },
        { key: '0.2', label: 'P1_16CDR', Icon: LibraryFileIcon, title: 'Module Leaf', children: [] },
      ],
    },
  ]

  const labelStyle = 'text-sm font-medium text-neutral-950 dark:text-white'
  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 p-[10px] text-cp-xs text-neutral-700 outline-none focus:border-brand'
  return (
    <Modal>
      <ModalTrigger>Open</ModalTrigger>
      <ModalContent className='h-[739px] w-[413px] flex-col gap-8 px-6 py-4'>
        <span className='text-xl font-medium text-neutral-950 dark:text-white'>Block Properties</span>
        <div className='flex h-[587px] w-full gap-6'>
          <div id='container-modifier-variable' className='h-full w-[178px]'>
            <div className='flex h-full w-full flex-col gap-2'>
              <label className={labelStyle}>Type:</label>
              <div className='flex h-[30px] w-full gap-2'>
                <InputWithRef className={inputStyle} placeholder='Search' type='text' />
                <div className='flex h-full w-10 items-center justify-center rounded-lg bg-brand'>
                  <MagnifierIcon />
                </div>
              </div>
              <div className='border-neural-100  h-[388px] w-full rounded-lg border px-1 py-4 dark:border-neutral-850'>
                <div className='h-full w-full overflow-y-auto'>
                  <LibraryRoot>
                    {treeData.map((data) => (
                      <LibraryFolder key={data.key} label={data.label} title={data.title}>
                        {data.children.map((child) => (
                          <LibraryFile
                            key={child.key}
                            label={child.label}
                            isSelected={selectedFileKey === child.key}
                            onSelect={() => setSelectedFileKey(child.key)}
                            onClick={() => {
                              setSelectedFileKey(child.key)
                              setSelectedFile({ image: child.image, text: child.children })
                            }}
                          />
                        ))}
                      </LibraryFolder>
                    ))}
                  </LibraryRoot>
                </div>
              </div>
              <div className='border-neural-100  h-full max-h-[119px] overflow-hidden rounded-lg border px-1 py-4 text-xs font-medium text-neutral-950 dark:border-neutral-850 dark:text-neutral-100'>
                <p className='h-full overflow-y-auto dark:text-neutral-100'>{selectedFile?.text}</p>
              </div>
            </div>
          </div>
          <div id='preview' className='flex h-full w-[163px] flex-col gap-2'>
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
            <InputWithRef
              id='inputs'
              className={inputStyle}
              placeholder=''
              type='number'
              value={formState.inputs}
              onChange={handleInputChange}
            />
            <label htmlFor='executionOrder' className={labelStyle}>
              Execution Order:
            </label>
            <InputWithRef
              id='executionOrder'
              className={inputStyle}
              placeholder=''
              type='number'
              value={formState.executionOrder}
              onChange={handleInputChange}
            />
            <label htmlFor='executionControl' className={labelStyle}>
              Execution Control:
            </label>
            <Checkbox.Root className='h-4 w-4 cursor-pointer rounded-[4px] border border-neutral-300 dark:border-neutral-850 text-brand'>
              <Checkbox.Indicator className='h-4 w-4'>
                <CheckIcon />
              </Checkbox.Indicator>
            </Checkbox.Root>
            <label htmlFor='block-preview' className={labelStyle}>
              Preview
            </label>
            <div
              id='block-preview'
              className='flex flex-grow items-center justify-center rounded-lg border-[2px] border-brand-dark dark:border-neutral-850 dark:bg-neutral-900'
            >
              {selectedFile?.image && (
                <img draggable='false' className='h-fit w-full select-none' src={selectedFile.image} alt='' />
              )}
            </div>
          </div>
        </div>
        <div className='flex !h-8 w-full gap-1'>
          <button
            className={`h-full w-full items-center rounded-lg text-center font-medium text-white ${isFormValid ? 'bg-brand' : 'cursor-not-allowed bg-brand opacity-50'}`}
            disabled={!isFormValid}
          >
            Ok
          </button>
          <button className='h-full w-full items-center rounded-lg  bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default BlockElement
