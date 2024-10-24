import { ArrayIcon, EnumIcon, StructureIcon } from '@root/renderer/assets'
import { startCase } from 'lodash'
import { ComponentPropsWithoutRef } from 'react'

type CreateDataTypeProps = ComponentPropsWithoutRef<'div'> & {
  derivation: 'enumerated' | 'structure' | 'array'
}

const CreateDataType = (props: CreateDataTypeProps) => {
  const { derivation, ...rest } = props
  return (
    <div
      className='relative flex h-7 w-full cursor-pointer select-none items-center justify-between gap-[6px] rounded-md px-[6px] py-[2px] hover:bg-neutral-100 dark:hover:bg-neutral-900'
      {...rest}
    >
      {derivation === 'enumerated' && <EnumIcon />}
      {derivation === 'structure' && <StructureIcon />}
      {derivation === 'array' && <ArrayIcon />}
      <p className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'>
        {startCase(derivation)}
      </p>
    </div>
  )
}

export { CreateDataType }
 