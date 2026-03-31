import { InputWithRef } from '@root/renderer/components/_atoms'
import { cn } from '@root/utils/cn'
import { CellContext } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'

type EditableCellProps = CellContext<{ dimension: string }, unknown> & {
  id: string
  selectedRow: number
  onBlur: () => void
  editable?: boolean
}

const DimensionCell = ({ getValue, row, id, selectedRow, onBlur, editable }: EditableCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowIndex = row.index

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    if (selectedRow === rowIndex) {
      inputRef.current?.focus()
    }
  }, [selectedRow, rowIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur()
    }
  }

  return (
    <InputWithRef
      id={id}
      ref={inputRef}
      value={cellValue}
      onChange={(e) => setCellValue(e.target.value)}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
      className={cn(
        `flex w-full flex-1 bg-transparent p-2 text-center outline-none ${!editable ? 'pointer-events-none' : ''}`,
      )}
    />
  )
}

export { DimensionCell }
