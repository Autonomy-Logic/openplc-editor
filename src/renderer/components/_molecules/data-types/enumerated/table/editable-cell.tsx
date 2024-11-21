import { InputWithRef } from '@root/renderer/components/_atoms'
import { cn } from '@root/utils/cn'
import { CellContext } from '@tanstack/react-table'
import { useEffect, useRef, useState } from 'react'

type EditableCellProps = CellContext<{ description: string }, unknown> & {
  editable?: boolean;
  onInputChange: (value: string) => void;
  onBlur: () => void;
  id: string;
  autoFocus: boolean;
  selectedRow: number;
}

const DescriptionCell = ({ getValue, editable = true, onInputChange, onBlur, id, autoFocus, selectedRow}: EditableCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current?.id === selectedRow.toString() && autoFocus) inputRef.current.focus()
  }, [autoFocus])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setCellValue(newValue)
    onInputChange(newValue)
  }

  return (
    <InputWithRef
      value={cellValue || ''}
      onChange={handleChange}
      className={cn(
        `flex w-full flex-1 bg-transparent p-2 text-center outline-none ${!editable ? 'pointer-events-none' : ''}`,
      )}
      onBlur={onBlur}
      id={id}
      ref={inputRef}
    />
  )
}

export { DescriptionCell }
