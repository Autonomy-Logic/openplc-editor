import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { ArrayDataType } from '@root/renderer/components/_molecules/data-types/array'
import { EnumeratorDataType } from '@root/renderer/components/_molecules/data-types/enumerated'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCArrayDatatype, PLCDataType } from '@root/types/PLC/open-plc'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'
// import { StructureDataType } from '@root/renderer/components/_molecules/data-types/structure'

type DatatypeEditorProps = ComponentPropsWithoutRef<'div'> & {
  data: {
    type: 'plc-datatype'
    meta: {
      name: string
      derivation: 'enumerated' | 'structure' | 'array'
    }
  }
}

const DataTypeEditor = ({ data, ...rest }: DatatypeEditorProps) => {
  const {
    workspace: {
      projectData: { dataTypes },
    },
  } = useOpenPLCStore()
  const [editorContent, setEditorContent] = useState<PLCDataType>()

  useEffect(() => {
    const res = dataTypes.find((dataToEdit) => dataToEdit.name === data.meta.name)
    setEditorContent(res)
  }),
    [dataTypes]

  return (
    <div aria-label='Data type editor container' className='flex h-full w-full flex-col items-center p-2' {...rest}>
      <div
        aria-label='Data type metadata container'
        className='h-46 mb-4 flex w-full items-center gap-4 rounded-md bg-neutral-50 p-2 shadow-md dark:border dark:border-neutral-800 dark:bg-neutral-1000'
      >
        <div aria-label='Data type name container' className='flex h-fit w-1/2 items-center gap-2'>
          <label
            htmlFor='data-type-name'
            className='mb-1 text-start font-caption text-xs font-medium text-neutral-950 dark:text-white'
          >
            Name
          </label>
          <div
            aria-label='Data type name input container'
            className='h-[30px] w-full max-w-[385px] rounded-lg border border-neutral-400 bg-white focus-within:border-brand dark:border-neutral-800 dark:bg-neutral-950'
          >
            <InputWithRef
              value={data.meta.name}
              id='data-type-name'
              aria-label='data-type-name'
              className='h-full w-full bg-transparent px-3 text-start font-caption text-xs text-neutral-850 outline-none dark:text-neutral-100'
            />
          </div>
        </div>
        <div aria-label='Data type derivation container' className='flex h-full w-1/2 items-center gap-2'>
          <label
            aria-label='label for data-type-derivation'
            className='mb-1 text-start font-caption text-xs font-medium text-neutral-950 dark:text-white'
          >
            Derivation Type
          </label>
          <Select aria-label='data-type-derivation'>
            <SelectTrigger
              withIndicator
              placeholder={data.meta.derivation}
              className='flex h-[30px] w-full max-w-[385px] items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
            />
            <SelectContent
              position='popper'
              side='bottom'
              sideOffset={-30}
              className='box h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
            >
              <SelectItem
                value='Array'
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  Array
                </span>
              </SelectItem>
              <SelectItem
                value='Enumerated'
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  Enumerated
                </span>
              </SelectItem>
              <SelectItem
                value='Structure'
                className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  Structure
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div aria-label='Data type content container' className='h-full w-full'>
        {data.meta.derivation === 'array' && <ArrayDataType data={editorContent as PLCArrayDatatype} />}
        {data.meta.derivation === 'enumerated' && <EnumeratorDataType />}
      </div>
    </div>
  )
}

export { DataTypeEditor }
