import * as PrimitiveToast from '@radix-ui/react-toast'

type IToastProps = PrimitiveToast.ToastProps & {
  titleText?: string
  descriptionText?: string
}
const Toast = (props: IToastProps) => {
  return (
    <PrimitiveToast.Root className='flex h-28 w-60 bg-white' {...props}>
      <PrimitiveToast.Title>{props.titleText}</PrimitiveToast.Title>
      <PrimitiveToast.Description>{props.descriptionText}</PrimitiveToast.Description>
    </PrimitiveToast.Root>
  )
}

export { Toast }
