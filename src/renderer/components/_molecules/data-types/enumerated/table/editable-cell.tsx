import { InputWithRef } from '@root/renderer/components/_atoms'
import { cn } from '@root/utils/cn'
import { CellContext } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'

type EditableCellProps = CellContext<{ description: string }, unknown> & {
  editable?: boolean
  onBlur: () => void
  id: string
  selectedRow: number
}

const DescriptionCell = ({ getValue, editable = true, onBlur, id, selectedRow }: EditableCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectedRow !== -1) inputRef.current?.focus()
  }, [selectedRow])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setCellValue(newValue)
  }

  return (
    <InputWithRef
      value={cellValue || ''}
      onChange={handleChange}
      className={cn(
        `flex w-full flex-1 bg-transparent p-2 text-center outline-none ${!editable ? 'pointer-events-none' : ''}`,
      )}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onBlur()
        }
      }}
      id={id}
      ref={inputRef}
    />
  )
}

export { DescriptionCell }
