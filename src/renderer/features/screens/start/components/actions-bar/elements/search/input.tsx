import { cn } from '@utils/cn'
import { InputHTMLAttributes } from 'react'

type SearchInputProps = InputHTMLAttributes<HTMLInputElement>
// Refactor: Doesn't need to explicit apply props that are default from this element
export default function Input({ className, placeholder, type, id, ...props }: SearchInputProps) {
  return <input placeholder={placeholder} type={type} id={id} className={cn(className)} {...props} />
}
