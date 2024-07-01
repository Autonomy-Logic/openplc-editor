import * as PrimitiveDialog from '@radix-ui/react-dialog'
import { CloseIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

const Modal = PrimitiveDialog.Root

const ModalTrigger = PrimitiveDialog.Trigger

const ModalPortal = PrimitiveDialog.Portal

const ModalOverlay = forwardRef<
  ElementRef<typeof PrimitiveDialog.Overlay>,
  ComponentPropsWithoutRef<typeof PrimitiveDialog.Overlay>
>(({ className, ...props }, ref) => (
  <PrimitiveDialog.Overlay
    ref={ref}
    className={cn(
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity',
      className,
    )}
    {...props}
  />
))

ModalOverlay.displayName = PrimitiveDialog.Overlay.displayName

const ModalContent = forwardRef<
  ElementRef<typeof PrimitiveDialog.Content>,
  ComponentPropsWithoutRef<typeof PrimitiveDialog.Content>
>(({ className, ...props }, ref) => (
  <ModalPortal>
    <ModalOverlay />
    <PrimitiveDialog.Content
      ref={ref}
      className={cn(
        'box fixed inset-0 z-50 m-auto flex h-[500px] w-[525px] flex-col gap-4 rounded-lg bg-white p-4 outline-none dark:bg-neutral-950',
        className,
      )}
      {...props}
    >
      {props.children}
      <PrimitiveDialog.Close className='absolute right-4 top-4 disabled:pointer-events-none'>
        <CloseIcon className='h-4 w-4 stroke-brand hover:cursor-pointer' />
      </PrimitiveDialog.Close>
    </PrimitiveDialog.Content>
  </ModalPortal>
))

ModalContent.displayName = PrimitiveDialog.Content.displayName

type ModalHeaderProps = ComponentPropsWithoutRef<'div'>

const ModalHeader = ({ className, ...rest }: ModalHeaderProps) => (
  <div className={cn('flex flex-col text-center sm:text-left', className)} {...rest} />
)

ModalHeader.displayName = 'ModalHeader'

type ModalFooterProps = ComponentPropsWithoutRef<'div'>

const ModalFooter = ({ className, ...rest }: ModalFooterProps) => <div className={cn(className)} {...rest} />

ModalFooter.displayName = 'ModalFooter'

const ModalTitle = forwardRef<
  ElementRef<typeof PrimitiveDialog.Title>,
  ComponentPropsWithoutRef<typeof PrimitiveDialog.Title>
>(({ className, ...props }, ref) => (
  <PrimitiveDialog.Title
    ref={ref}
    className={cn('font-caption text-lg font-normal text-neutral-950 dark:text-neutral-100', className)}
    {...props}
  />
))

export { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle, ModalTrigger }
