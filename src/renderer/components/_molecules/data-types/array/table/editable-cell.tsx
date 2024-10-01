import { InputWithRef } from '@root/renderer/components/_atoms'
import { cn } from '@root/utils/cn'
import { CellContext } from '@tanstack/react-table'
import { Ref, useImperativeHandle, useRef, useState } from 'react'

type EditableCellProps = CellContext<{dimension: string}, unknown> & { editable?: boolean }  & {onInputChange: (value: string) => void} & {onBlur: () => void;} & { ref: Ref<unknown> | undefined}

const DimensionCell = ({ getValue, editable = true, onInputChange, onBlur, ref }: EditableCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)

  const inputRef = useRef<HTMLInputElement>(null);


  useImperativeHandle(ref, () => ({
    focus: () => {
      if (inputRef.current) {
        console.log("inputRef.current -->", inputRef.current);
        inputRef.current.focus();
      }
    }
  }));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setCellValue(newValue);
    onInputChange(newValue);
  };

  const handleBlur = () => {
    if (cellValue.trim() === '') {
      onBlur();
    }
  };

  return (
    <InputWithRef
      value={cellValue}
      onChange={handleChange}
      className={cn(`flex w-full flex-1 bg-transparent p-2 text-center outline-none ${!editable ? 'pointer-events-none' : ''}`)}
      onBlur={handleBlur}
      id='dimension-input'
      ref={inputRef}  
          />
  )
}

export { DimensionCell }
