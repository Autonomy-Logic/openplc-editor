import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Table, TableBody } from '@root/renderer/components/_atoms'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCDataType } from '@root/types/PLC/open-plc'
import { useEffect, useState } from 'react'

import { DTBaseTypeContainer } from '../base-type'
import { ArrayDTInitialValueContainer } from './initial-value'

const ArrayTableActions = () => {

  const {
    workspace: {
      projectData: { dataTypes }
    }
  } = useOpenPLCStore()

  const [ dataTypesState, setDataTypesState ] = useState<PLCDataType>()

  useEffect(() => {
    const arrayDataType = dataTypes.find((dataType) => dataType.derivation.type === 'array')
    setDataTypesState(arrayDataType)
  }, [dataTypes])

  useEffect(() => {
    console.log(dataTypesState)
  }, [dataTypesState])

  return (
    <div className='flex h-fit w-full'>
      <div aria-label='Array data type first header container' className='flex h-full w-1/2 flex-col gap-3'>
        <DTBaseTypeContainer />
        <div
          aria-label='Array data type table actions container'
          className='flex h-full w-full items-center justify-between'
        >
          <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
            Dimensions
          </p>
          <div
            aria-label='Data type table actions buttons container'
            className='flex h-full w-fit items-center justify-evenly *:rounded-md *:p-1'
          >
            <TableActionButton aria-label='Add table row button' onClick={() => console.log('Button clicked')}>
              <PlusIcon className='!stroke-brand' />
            </TableActionButton>
            <TableActionButton aria-label='Remove table row button' onClick={() => console.log('Button clicked')}>
              <MinusIcon />
            </TableActionButton>
            <TableActionButton aria-label='Move table row up button' onClick={() => console.log('Button clicked')}>
              <StickArrowIcon direction='up' />
            </TableActionButton>
            <TableActionButton aria-label='Move table row down button' onClick={() => console.log('Button clicked')}>
              <StickArrowIcon direction='down' />
            </TableActionButton>
          </div>
          <Table>
            <TableBody>

            </TableBody>
          </Table>
        </div>
      </div>
      <ArrayDTInitialValueContainer />
    </div>
  )
}

export { ArrayTableActions }
