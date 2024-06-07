import * as PrimitiveToast from '@radix-ui/react-toast'
import { CloseIcon } from '@root/renderer/assets'
import { cn } from '@utils/cn'
import { cva, type VariantProps } from 'cva'
import { ComponentPropsWithoutRef, ElementRef, forwardRef, ReactElement } from 'react'

const ToastProvider = PrimitiveToast.ToastProvider

const ToastViewport = forwardRef<
  ElementRef<typeof PrimitiveToast.ToastViewport>,
  ComponentPropsWithoutRef<typeof PrimitiveToast.ToastViewport>
>(({ className, ...props }, ref) => (
  <PrimitiveToast.ToastViewport
    ref={ref}
    className={cn('absolute bottom-4 right-0 z-[100] flex h-fit max-h-36 w-[292px] px-4 xl:w-[420px]', className)}
    //  -> For fail toasts to be on top
    {...props}
  />
))

ToastViewport.displayName = PrimitiveToast.ToastViewport.displayName

const toastVariants = cva(
  // 'group relative pointer-events-auto flex flex-col flex-1 w-full text-neutral-1000 dark:text-white items-start rounded-md shadow-lg px-4 py-3 font-display border border-neutral-200 bg-white dark:bg-neutral-950 dark:border-neutral-850 transition-all data-[swipe=cancel]:translate-y-0 data-[swipe=up]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=up]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-bottom-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  'group relative pointer-events-auto flex flex-col flex-1 w-full text-neutral-1000 dark:text-white items-start rounded-md shadow-lg px-4 py-3 font-display border border-neutral-200 bg-white dark:bg-neutral-950 dark:border-neutral-850 transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: '',
        fail: 'fail group border-rose-500 shadow-rose-500/10',
        warn: 'warn group border-amber-500 shadow-amber-500/10',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const Toast = forwardRef<
  ElementRef<typeof PrimitiveToast.Root>,
  ComponentPropsWithoutRef<typeof PrimitiveToast.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => (
  <PrimitiveToast.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />
))

Toast.displayName = PrimitiveToast.Root.displayName

const ToastAction = forwardRef<
  ElementRef<typeof PrimitiveToast.ToastAction>,
  ComponentPropsWithoutRef<typeof PrimitiveToast.ToastAction>
>(({ className, ...props }, ref) => (
  <PrimitiveToast.ToastAction ref={ref} className={cn('ring-offset-background', className)} {...props} />
))
ToastAction.displayName = PrimitiveToast.Action.displayName

const ToastClose = forwardRef<
  ElementRef<typeof PrimitiveToast.ToastClose>,
  ComponentPropsWithoutRef<typeof PrimitiveToast.ToastClose>
>(({ className, ...props }, ref) => (
  <PrimitiveToast.ToastClose
    ref={ref}
    className={cn('invisible absolute right-2 top-2 rounded-md p-1 group-hover:visible', className)}
    toast-close=''
    {...props}
  >
    <CloseIcon className='h-4 w-4 stroke-brand group-[.fail]:stroke-red-900 group-[.warn]:stroke-amber-500' />
  </PrimitiveToast.ToastClose>
))
ToastClose.displayName = PrimitiveToast.ToastClose.displayName

const ToastTitle = forwardRef<
  ElementRef<typeof PrimitiveToast.ToastTitle>,
  ComponentPropsWithoutRef<typeof PrimitiveToast.ToastTitle>
>(({ className, ...props }, ref) => (
  <PrimitiveToast.ToastTitle
    ref={ref}
    className={cn(
      'py-px text-sm font-medium text-brand group-[.fail]:text-red-900 group-[.warn]:text-amber-500',
      className,
    )}
    {...props}
  />
))
ToastTitle.displayName = PrimitiveToast.ToastTitle.displayName

const ToastDescription = forwardRef<
  ElementRef<typeof PrimitiveToast.ToastDescription>,
  ComponentPropsWithoutRef<typeof PrimitiveToast.ToastDescription>
>(({ className, ...props }, ref) => (
  <PrimitiveToast.ToastDescription
    ref={ref}
    className={cn('w-full overflow-y-auto text-xs opacity-90', className)}
    {...props}
  />
))
ToastDescription.displayName = PrimitiveToast.ToastDescription.displayName

type ToastProps = ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = ReactElement<typeof ToastAction>

export {
  Toast,
  ToastAction,
  type ToastActionElement,
  ToastClose,
  ToastDescription,
  type ToastProps,
  ToastProvider,
  ToastTitle,
  ToastViewport,
}
