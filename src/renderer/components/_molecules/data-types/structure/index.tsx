// import { useOpenPLCStore } from '@root/renderer/store'
import { PLCStructureDatatype } from '@root/types/PLC/open-plc'
import _ from 'lodash'
import { ComponentPropsWithoutRef } from 'react'


type EnumDatatypeProps = ComponentPropsWithoutRef<'div'> & {
  data: PLCStructureDatatype
}
const StructureDataType = ({ data, ...rest }: EnumDatatypeProps) => {
  return (
    <div
      aria-label='Enumerated data type container'
      className='flex h-full w-full flex-1 flex-col gap-4 overflow-hidden bg-transparent'
      {...rest}
    >
      <div aria-label='Data type content actions container' className='flex h-8 w-full gap-8'>
        <div aria-label='Enumerated base type container' className='flex w-1/2 flex-col gap-3'></div>
        <div aria-label='Enumerated initial value container' className='w-1/2'></div>
      </div>
    </div>
  )
}

export { StructureDataType }
