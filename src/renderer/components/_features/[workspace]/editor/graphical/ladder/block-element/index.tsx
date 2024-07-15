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
export default function BlockElement() {
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [imageToDisplay, setImageToDisplay] = useState(null)
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
          children: 'loren ipsum ipsum ipsum ',
          image: imageMock,
        },
        {
          key: '0.2',
          label: 'P1_16CDR',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: 'ipsum',
          image: image1,
        },
        {
          key: '0.3',
          label: 'P1_08N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: ' dolor',
          image: image2,
        },
        {
          key: '0.4',
          label: 'P1_16N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: ' sit',
          image: imageMock,
        },
        {
          key: '0.5',
          label: 'P1_16N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: ' amet',
          image: image1,
        },
        {
          key: '0.6',
          label: 'P1_08T',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: ' consectetur',
          image: image2,
        },
        {
          key: '0.7',
          label: 'P1_16TR',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: '  adipiscing',
          image: imageMock,
        },
        {
          key: '0.8',
          label: 'P1_04AD',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: '  elit',
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

  const labelStyle = 'text-sm font-medium text-neutral-950'

  return (
    <Modal>
      <ModalTrigger>Open</ModalTrigger>
      <ModalContent className='h-[739px] w-[413px] flex-col gap-8 px-6 py-4'>
        <span className='text-xl font-medium text-neutral-950'>Block Properties</span>
        <div className='flex h-[587px] w-full gap-6'>
          <div id='container-modifier-variable' className='h-full w-[178px]'>
            <div className='flex h-full w-full flex-col gap-2'>
              <label className={labelStyle}>Type:</label>
              <div className='flex h-[30px] w-full gap-2'>
                <InputWithRef
                  className='border-neural-100 h-full  w-full  rounded-lg border p-[10px] text-cp-xs text-neutral-700 outline-none focus:border-brand'
                  placeholder='Search'
                  type='text'
                />
                <div className='flex h-full w-10 items-center justify-center rounded-lg bg-brand'>
                  <MagnifierIcon />
                </div>
              </div>
              <div className='border-neural-100 h-[388px] w-full rounded-lg border px-1 py-4'>
                <div className='h-full w-full overflow-y-auto'>
                  <LibraryRoot>
                    {treeData.map((data) => (
                      <LibraryFolder key={data.key} label={data.label} title={data.title}>
                        {data.children.map((child) => (
                          <LibraryFile
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', child.children)
                            }}
                            key={child.key}
                            label={child.label}
                            isSelected={selectedFileKey === child.key}
                            onSelect={() => setSelectedFileKey(child.key)}
                            onClick={() => {
                              setSelectedFileKey(child.key)
                              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                              setImageToDisplay(child.image)
                            }}
                          />
                        ))}
                      </LibraryFolder>
                    ))}
                  </LibraryRoot>
                </div>
              </div>
              <div className='border-neural-100 flex-grow rounded-lg border'></div>
            </div>
          </div>
          <div id='preview' className='flex h-full w-[163px] flex-col gap-2'>
            <label htmlFor='name' className={labelStyle}>
              Name:
            </label>
            <InputWithRef
              id='name'
              className='border-neural-100 h-[30px] w-full select-none rounded-lg border p-[10px] text-cp-xs text-neutral-700 outline-none focus:border-brand'
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
              className='border-neural-100 h-[30px] w-full select-none rounded-lg border p-[10px] text-cp-xs text-neutral-700 outline-none focus:border-brand'
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
              className='border-neural-100 h-[30px] w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 outline-none focus:border-brand'
              placeholder=''
              type='number'
              value={formState.executionOrder}
              onChange={handleInputChange}
            />
            <label htmlFor='block-preview' className={labelStyle}>
              Preview
            </label>
            <div
              id='block-preview'
              className='flex flex-grow items-center justify-center rounded-lg border-[2px] border-brand-dark'
            >
              {imageToDisplay && <img className='h-fit w-full' src={imageToDisplay} alt='' />}
            </div>
          </div>
        </div>
        <div className='flex !h-8 w-full gap-1'>
          <button
            className={`h-full w-full items-center rounded-lg text-center text-white ${isFormValid ? 'bg-brand' : 'cursor-not-allowed bg-brand opacity-50'}`}
            disabled={!isFormValid}
          >
            Ok
          </button>
          <button className='h-full w-full items-center rounded-lg bg-neutral-100 text-center text-neutral-1000'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
