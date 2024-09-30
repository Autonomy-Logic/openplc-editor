import { InputWithRef } from '@root/renderer/components/_atoms'
import { cn } from '@root/utils/cn'
import { CellContext } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

type EditableCellProps = CellContext<{dimension: string}, unknown> & { editable?: boolean }  & {onInputChange?: (value: string) => void}

const DimensionCell = ({ getValue, editable = true, onInputChange  }: EditableCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)

  useEffect((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setCellValue(newValue)
    onInputChange(newValue)
  }, [cellValue])

  return (
    <InputWithRef
      value={cellValue}
      onChange={handleChange}
      className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
        'pointer-events-none': !editable,
      })}
    />
  )
}

export { DimensionCell }
