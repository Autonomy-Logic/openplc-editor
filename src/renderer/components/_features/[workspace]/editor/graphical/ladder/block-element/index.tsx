import { MagnifierIcon } from '@root/renderer/assets'
import { InputWithRef } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTrigger } from '@root/renderer/components/_molecules'
import { Library } from '@root/renderer/components/_organisms/explorer/library'

export default function BlockElement() {
  return (
    <Modal>
      <ModalTrigger>Open</ModalTrigger>
      <ModalContent className='h-[739px] w-[413px] flex-col gap-8 px-6 py-4'>
        <span className='text-xl font-medium text-neutral-950'>Block Properties</span>
        <div className='flex h-[587px] w-full gap-6  '>
          <div id='container-modifier-variable' className='h-full w-[178px] '>
            <div className=' flex h-full w-full flex-col gap-2'>
              <span className='text-sm font-medium text-neutral-950'>Type:</span>
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
              <div className='border-neural-100 h-[388px]  w-full overflow-y-auto rounded-lg border'>
                <Library />
              </div>
              <div className='border-neural-100 flex-grow rounded-lg border'></div>
            </div>
          </div>
          <div id='preview' className='flex h-full w-[163px] flex-col gap-2'>
            <span className='text-sm font-medium text-neutral-950'>Name:</span>
            <InputWithRef
              className='border-neural-100 h-[30px] w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 '
              placeholder=''
              type='text'
            />
            <span className='text-sm font-medium text-neutral-950'>inputs:</span>
            <InputWithRef
              className='border-neural-100 h-[30px] w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 '
              placeholder=''
              type='number'
            />
            <span className='text-sm font-medium text-neutral-950'>Execution Order:</span>
            <InputWithRef
              className='border-neural-100 h-[30px] w-full rounded-lg border p-[10px] text-cp-xs text-neutral-700 '
              placeholder=''
              type='number'
            />
            <span className='text-sm font-medium text-neutral-950'>Execution Control:</span>
            <div className='h-1 w-1 border border-neutral-100'></div>
            <span className='text-sm font-medium text-neutral-950'>Preview</span>
            <input className='flex flex-grow items-center justify-center rounded-lg border border-neutral-100'></input>
          </div>
        </div>
        <div className='flex !h-8 w-full gap-1'>
          <button className='flex h-full w-full flex-col justify-center rounded-lg bg-brand text-center text-white'>
            Ok
          </button>
          <button className='flex h-full w-full flex-col justify-center rounded-lg bg-neutral-100 text-center text-neutral-1000'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
