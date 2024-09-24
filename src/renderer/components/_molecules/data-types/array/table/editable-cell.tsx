import { InputWithRef } from '@root/renderer/components/_atoms'
import { cn } from '@root/utils/cn'
import { CellContext } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

type EditableCellProps = CellContext<{dimension: string}, unknown> & { editable?: boolean }
const DimensionCell = ({ getValue, editable = true }: EditableCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)

  const onBlur = () => {
    if (cellValue === initialValue) return
    setCellValue(initialValue)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <InputWithRef
      value={cellValue}
      onChange={(e) => setCellValue(e.target.value)}
      onBlur={onBlur}
      className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
        'pointer-events-none': !editable,
      })}
    />
  )
}

export { DimensionCell }
