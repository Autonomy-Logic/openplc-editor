import * as Switch from '@radix-ui/react-switch'
import { LibraryCloseFolderIcon, LibraryFileIcon, MagnifierIcon } from '@root/renderer/assets'
import { InputWithRef } from '@root/renderer/components/_atoms'
import {
  LibraryFile,
  LibraryFolder,
  LibraryRoot,
  Modal,
  ModalContent,
  ModalTitle,
  ModalTrigger,
} from '@root/renderer/components/_molecules'
import { ReactElement, useState } from 'react'

import ArrowButtonGroup from '../arrow-button-group'
import imageMock from '../mockImages/Group112.png'
import image1 from '../mockImages/image1.png'
import image2 from '../mockImages/image2.png'

type TreeDataChildren = {
  key: string
  label: string
  icon: ReactElement
  title: string
  children: string
  image: string
}

const lorem =
  ' Lorem ipsum dolor sit amet consectetur adipisicing elit. Autem blanditiis voluptates eius quasi quam illum deserunt perspiciatis magnam, corrupti vel! Nesciunt nostrum maxime aliquid amet asperiores quibusdam ipsam impedit corporis?'

const treeData: Array<{
  key: string
  label: string
  icon: ReactElement
  title: string
  children: TreeDataChildren[]
}> = [
  {
    key: '0',
    label: 'P1AM_Modules',
    icon: <LibraryCloseFolderIcon size='sm' />,
    title: 'Module Tree',
    children: [
      {
        key: '0.1',
        label: 'P1AM_INIT',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: 1 + lorem,
        image: imageMock,
      },
      {
        key: '0.2',
        label: 'P1_16CDR',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: 2 + lorem,
        image: image1,
      },
      {
        key: '0.3',
        label: 'P1_08N',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: 3 + lorem,
        image: image2,
      },
      {
        key: '0.4',
        label: 'P1_16N',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: lorem,
        image: imageMock,
      },
      {
        key: '0.5',
        label: 'P1_16N',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: lorem,
        image: image1,
      },
      {
        key: '0.6',
        label: 'P1_08T',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: lorem,
        image: image2,
      },
      {
        key: '0.7',
        label: 'P1_16TR',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: lorem,
        image: imageMock,
      },
      {
        key: '0.8',
        label: 'P1_04AD',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        children: lorem,
        image: image1,
      },
    ],
  },
  {
    key: '1',
    label: 'Jaguar',
    icon: <LibraryCloseFolderIcon size='sm' />,
    title: 'Module Tree',
    children: [],
  },
  {
    key: '2',
    label: 'Arduino',
    icon: <LibraryCloseFolderIcon size='sm' />,
    title: 'Module Tree',
    children: [],
  },
  {
    key: '3',
    label: 'Communication',
    icon: <LibraryCloseFolderIcon size='sm' />,
    title: 'Module Tree',
    children: [],
  },
  {
    key: '4',
    label: 'Sequent Microsystems',
    icon: <LibraryCloseFolderIcon size='sm' />,
    title: 'Module Tree',
    children: [
      {
        key: '0.1',
        label: 'P12AM_INIT',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        image: imageMock,
        children: '',
      },
      {
        key: '0.2',
        label: 'P13_16CDR',
        icon: <LibraryFileIcon />,
        title: 'Module Leaf',
        image: image1,
        children: '',
      },
    ],
  },
]
const filterTreeData = (filterText: string) => {
  return treeData.reduce(
    //acc - accumulator
    (acc, folder) => {
      const filteredChildren = folder.children.filter((child) => child.label.toLowerCase().includes(filterText))
      if (filteredChildren.length > 0 || folder.label.toLowerCase().includes(filterText)) {
        acc.push({
          ...folder,
          children: filteredChildren,
        })
      }
      return acc
    },
    [] as typeof treeData,
  )
}
const BlockElement = () => {
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ image: string; text: string } | null>(null)
  const [formState, setFormState] = useState({ name: '', inputs: '', executionOrder: '' })
  const [filterText, setFilterText] = useState('')

  const isFormValid = Object.values(formState).every((value) => value !== '')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    setFormState((prevState) => ({ ...prevState, [id]: value }))
  }

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value.toLowerCase())
  }

  const handleClearForm = () => {
    setFormState({ name: '', inputs: '', executionOrder: '' })
    setSelectedFileKey(null)
    setSelectedFile(null)
    setFilterText('')
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

  const filteredTreeData = filterTreeData(filterText)

  const labelStyle = 'text-sm font-medium text-neutral-950 dark:text-white'
  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <Modal>
      <ModalTrigger>Open</ModalTrigger>
      <ModalContent onClose={handleClearForm} className='h-[739px] w-[625px] select-none flex-col gap-8 px-14 py-4'>
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Block Properties</ModalTitle>
        <div className='flex h-[587px] w-full justify-between'>
          <div id='container-modifier-variable' className='h-full w-[236px]'>
            <div className='flex h-full w-full flex-col gap-2'>
              <label className={labelStyle}>Type:</label>
              <div className={`relative flex items-center focus-within:border-brand ${inputStyle}`}>
                <InputWithRef
                  className='h-full w-full bg-inherit outline-none'
                  id='Search-File'
                  placeholder='Search'
                  type='text'
                  value={filterText}
                  onChange={handleFilterChange}
                />
                <label className='relative right-0 stroke-brand' htmlFor='Search-File'>
                  <MagnifierIcon size='sm' className='stroke-brand' />
                </label>
              </div>
              <div className='border-neural-100 h-[388px] w-full rounded-lg border px-1 py-4 dark:border-neutral-850'>
                <div className='h-full w-full overflow-auto'>
                  <LibraryRoot>
                    {filteredTreeData.map((data) => (
                      <LibraryFolder
                        key={data.key}
                        label={data.label}
                        initiallyOpen={false}
                        shouldBeOpen={filterText.length > 0}
                      >
                        {data.children.map((child) => (
                          <LibraryFile
                            key={child.key}
                            label={child.label}
                            isSelected={selectedFileKey === `${data.key}-${child.key}`}
                            onSelect={() => setSelectedFileKey(`${data.key}-${child.key}`)}
                            onClick={() => {
                              setSelectedFileKey(`${data.key}-${child.key}`)
                              setSelectedFile({ image: child.image, text: child.children })
                            }}
                          />
                        ))}
                      </LibraryFolder>
                    ))}
                  </LibraryRoot>
                </div>
              </div>
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
              className='flex flex-grow items-center -center rounded-lg border-[2px] border-brand-dark dark:border-neutral-850 dark:bg-neutral-900'
            >
              {selectedFile?.image && (
                <img draggable='false' className='h-fit w-full select-none' src={selectedFile.image} alt='' />
              )}
            </div>
          </div>
        </div>
        <div className='flex !h-8 w-full gap-7 justify-evenly'>
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
