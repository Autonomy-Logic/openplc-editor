import { ComponentPropsWithRef, forwardRef } from 'react'

type IInputProps = ComponentPropsWithRef<'input'>

const InputWithRef = forwardRef<HTMLInputElement, IInputProps>((props: IInputProps, ref) => {
  return <input {...props} ref={ref} spellCheck={false} />
})

export { InputWithRef }
