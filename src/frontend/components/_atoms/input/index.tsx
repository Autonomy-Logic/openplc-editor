import { ComponentPropsWithRef, forwardRef } from 'react'

type IInputProps = ComponentPropsWithRef<'input'>

const InputWithRef = forwardRef<HTMLInputElement, IInputProps>((props: IInputProps, ref) => {
  return <input autoComplete='off' spellCheck={false} {...props} ref={ref} />
})

export { InputWithRef }
