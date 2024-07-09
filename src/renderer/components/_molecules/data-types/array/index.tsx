import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Table, TableBody, TableCell, TableRow } from '@root/renderer/components/_atoms'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCDataType } from '@root/types/PLC/open-plc'
import { useEffect, useState } from 'react'

import { DTBaseTypeContainer } from '../base-type'
import { ArrayDTInitialValueContainer } from './initial-value'

const ArrayDataType = () => {
  const {
    workspace: {
      projectData: { dataTypes },
    },
  } = useOpenPLCStore()

  const [dataTypesState, setDataTypesState] = useState<PLCDataType>()

  useEffect(() => {
    const arrayDataType = dataTypes.find((dataType) => dataType.derivation.type === 'array')
    setDataTypesState(arrayDataType)
  }, [dataTypes])

  useEffect(() => {
    console.log(dataTypesState)
  }, [dataTypesState])

  return (
    <div aria-label='Array data type container' className='flex h-full w-full flex-col gap-4 bg-transparent'>
      <div aria-label='Data type content actions container' className='flex h-fit w-full gap-8'>
        <div aria-label='Array data type first header container' className='flex w-1/2 flex-col gap-3'>
          <DTBaseTypeContainer />
          <div
            aria-label='Array data type table actions container'
            className='flex h-fit w-full items-center justify-between'
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
                <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
              </TableActionButton>
              <TableActionButton aria-label='Move table row down button' onClick={() => console.log('Button clicked')}>
                <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
              </TableActionButton>
            </div>
          </div>
        </div>
        <div className='w-1/2'>
        <ArrayDTInitialValueContainer />
        </div>
      </div>

      <Table aria-label='Array data type table' className='w-1/2'>
        <TableBody>
          {dataTypesState?.derivation.type === 'array' &&
            dataTypesState.derivation.data.dimensions.map((dimension, index) => (
              <TableRow
                key={index}
                className='[&:first-child>*]:rounded-t-md [&:first-child>*]:border-t [&:first-child>*]:border-t-neutral-500'
              >
                <TableCell className='p-2'>{dimension}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { ArrayDataType }
