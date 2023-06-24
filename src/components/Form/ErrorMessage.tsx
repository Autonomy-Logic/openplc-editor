import { FC } from 'react'
import { useFormContext } from 'react-hook-form'

interface ErrorMessageProps {
  field: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (obj: Record<any, any>, path: string) => {
  const travel = (regexp: RegExp) =>
    String.prototype.split
      .call(path, regexp)
      .filter(Boolean)
      .reduce(
        (res, key) => (res !== null && res !== undefined ? res[key] : res),
        obj,
      )

  const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/)

  return result
}

const ErrorMessage: FC<ErrorMessageProps> = ({ field }) => {
  const {
    formState: { errors },
  } = useFormContext()

  const fieldError = get(errors, field)

  if (!fieldError) {
    return <div className="mt-1 h-4" />
  }

  return (
    <span className="mt-1 text-xs text-red-500">
      {fieldError.message?.toString()}
    </span>
  )
}

export default ErrorMessage
