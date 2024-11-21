import { InputWithRef } from '@root/renderer/components/_atoms'
import { ArrayDataType } from '@root/renderer/components/_molecules/data-types/array'
import { EnumeratorDataType } from '@root/renderer/components/_molecules/data-types/enumerated'
import { useOpenPLCStore } from '@root/renderer/store'
// import { useOpenPLCStore } from '@root/renderer/store'
import { PLCDataType } from '@root/types/PLC/open-plc'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'
// import { StructureDataType } from '@root/renderer/components/_molecules/data-types/structure'

type DatatypeEditorProps = ComponentPropsWithoutRef<'div'> & {
  dataTypeName: string
}

const DataTypeEditor = ({ dataTypeName, ...rest }: DatatypeEditorProps) => {
  const {
    project: {
      data: { dataTypes },
    },
    searchActions: { extractSearchQuery },
    searchQuery,
  } = useOpenPLCStore()
  const [editorContent, setEditorContent] = useState<PLCDataType>()
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    const dataTypeIndex = dataTypes.findIndex((dataType) => dataType.name === dataTypeName)
    if (dataTypeIndex !== -1) {
      const dataType = dataTypes[dataTypeIndex]
      setEditorContent(dataType)
    }
  }, [dataTypes, dataTypeName])

  const handleStartEditing = () => {
    setIsEditing(true)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target
    setEditorContent((prevContent) => ({
      ...prevContent,
      name: value,
    }))
  }

  return (
    <div
      aria-label='Data type editor container'
      className=' flex h-full w-full flex-col gap-4  overflow-hidden'
      {...rest}
    >
      <div
        aria-label='Data type metadata container'
        className='h-46  flex w-full items-center gap-4 rounded-md bg-neutral-50 p-2 shadow-md dark:border dark:border-neutral-800 dark:bg-neutral-1000'
      >
        <div aria-label='Data type name container' className='flex h-8 w-1/2 items-center gap-2'>
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
            {isEditing ? (
              <InputWithRef
                value={editorContent?.name}
                onChange={handleChange}
                onBlur={() => setIsEditing(false)}
                id='data-type-name'
                aria-label='data-type-name'
                className='h-full w-full bg-transparent px-3 text-start font-caption text-xs text-neutral-850 outline-none dark:text-neutral-100'
              />
            ) : (
              <div
                aria-label='data-type-name'
                className='flex items-center h-full w-full bg-transparent px-3 text-start font-caption text-xs text-neutral-850 outline-none dark:text-neutral-100'
                onClick={handleStartEditing}
                dangerouslySetInnerHTML={{ __html: extractSearchQuery(editorContent?.name || '', searchQuery) }}
              />
            )}
          </div>
        </div>
      </div>
      <div aria-label='Data type content container' className='h-full w-full overflow-hidden'>
        {editorContent?.derivation === 'array' && <ArrayDataType data={editorContent} />}
        {editorContent?.derivation === 'enumerated' && <EnumeratorDataType data={editorContent} />}
      </div>
    </div>
  )
}

export { DataTypeEditor }
