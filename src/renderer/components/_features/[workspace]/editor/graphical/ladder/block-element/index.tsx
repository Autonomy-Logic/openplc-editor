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

export default function BlockElement() {
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)

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
        },
        { key: '0.2', label: 'P1_16CDR', Icon: LibraryFileIcon, title: 'Module Leaf', children: 'ipsum' },
        { key: '0.3', label: 'P1_08N', Icon: LibraryFileIcon, title: 'Module Leaf', children: ' dolor' },
        { key: '0.4', label: 'P1_16N', Icon: LibraryFileIcon, title: 'Module Leaf', children: ' sit' },
        { key: '0.5', label: 'P1_16N', Icon: LibraryFileIcon, title: 'Module Leaf', children: ' amet' },
        { key: '0.6', label: 'P1_08T', Icon: LibraryFileIcon, title: 'Module Leaf', children: ' consectetur' },
        { key: '0.7', label: 'P1_16TR', Icon: LibraryFileIcon, title: 'Module Leaf', children: '  adipiscing' },
        { key: '0.8', label: 'P1_04AD', Icon: LibraryFileIcon, title: 'Module Leaf', children: '  elit' },
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
        <div className='flex h-[587px] w-full gap-6  '>
          <div id='container-modifier-variable' className='h-full w-[178px] '>
            <div className=' flex h-full w-full flex-col gap-2'>
              <label className={labelStyle}>Type:</label>
              <div className='flex h-[30px] w-full gap-2'>
                <InputWithRef
                  className='border-neural-100 h-full w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 '
                  placeholder='Search'
                  type='text'
                />
                <div className='flex h-full w-10 items-center justify-center rounded-lg bg-brand'>
                  <MagnifierIcon />
                </div>
              </div>
              <div className='border-neural-100 h-[388px] w-full rounded-lg  border px-1 py-4'>
                <div className=' h-full w-full overflow-y-auto '>
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
            <label htmlFor='block-name' className={labelStyle}>
              Name:
            </label>
            <InputWithRef
              id='block-name'
              className='border-neural-100 h-[30px] w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 '
              placeholder=''
              type='text'
            />
            <label htmlFor='block-inputs' className={labelStyle}>
              inputs:
            </label>
            <InputWithRef
              id='block-inputs'
              className='border-neural-100 h-[30px] w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 '
              placeholder=''
              type='number'
            />
            <label htmlFor='block-execution-order' className={labelStyle}>
              Execution Order:
            </label>
            <InputWithRef
              id='block-execution-order'
              className='border-neural-100 h-[30px] w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 '
              placeholder=''
              type='number'
            />
            <label htmlFor='block-execution-control' className={labelStyle}>
              Execution Control:
            </label>
            <div className='h-1 w-1 border border-neutral-100'></div>
            <label htmlFor='block-preview' className={labelStyle}>
              Preview
            </label>
            <input
              id='block-preview'
              className='flex flex-grow items-center justify-center rounded-lg border border-neutral-100'
            ></input>
          </div>
        </div>
        <div className='flex !h-8 w-full gap-1'>
          <button className=' h-full w-full items-center  rounded-lg bg-brand text-center text-white'>Ok</button>
          <button className=' h-full w-full items-center rounded-lg bg-neutral-100 text-center text-neutral-1000'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
