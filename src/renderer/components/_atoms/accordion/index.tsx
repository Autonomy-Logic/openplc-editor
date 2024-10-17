import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import { cn } from '@root/utils'
import { forwardRef, useState } from 'react'

interface AccordionItemProps {
  title: React.ReactNode
  content: React.ReactNode
}

interface AccordionProps {
  items: AccordionItemProps[]
  defaultValue?: string
  type?: 'single' | 'multiple'
  onOpenChange?: (value: string) => void
  collapsible?: boolean
}

const AccordionItem = forwardRef<HTMLDivElement, AccordionPrimitive.AccordionItemProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <AccordionPrimitive.Item
      className={cn('overflow-hidden rounded-md border-transparent first:border-t last:border-b', className)}
      {...props}
      ref={forwardedRef}
    >
      {children}
    </AccordionPrimitive.Item>
  ),
)

AccordionItem.displayName = 'AccordionItem'

const AccordionTrigger = forwardRef<HTMLButtonElement, AccordionPrimitive.AccordionTriggerProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <AccordionPrimitive.Header className='flex'>
      <AccordionPrimitive.Trigger
        className={cn(
          'group flex w-full items-center justify-between overflow-hidden p-2 text-left transition-all duration-300 hover:bg-neutral-950',
          className,
        )}
        {...props}
        ref={forwardedRef}
      >
        {children}
        <ChevronDownIcon
          className='ml-2 h-5 w-5 transition-transform duration-300 ease-in-out group-data-[state=open]:rotate-180'
          aria-hidden
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  ),
)

AccordionTrigger.displayName = 'AccordionTrigger'

const AccordionContent = forwardRef<HTMLDivElement, AccordionPrimitive.AccordionContentProps>(
  ({ children, className, ...props }, forwardedRef) => (
    <AccordionPrimitive.Content
      className={cn(
        'data-[state=open]:animate-slideDown data-[state=closed]:animate-slideUp overflow-hidden bg-neutral-950 transition-all duration-300 ease-in-out',
        className,
      )}
      {...props}
      ref={forwardedRef}
    >
      <div className='p-1'>{children}</div>
    </AccordionPrimitive.Content>
  ),
)

AccordionContent.displayName = 'AccordionContent'

const Accordion = ({ items, defaultValue, type = 'single', collapsible = true }: AccordionProps) => {
  const [openItem, setOpenItem] = useState<string | null>(defaultValue || null)

  const handleOpenChange = (value: string) => {
    setOpenItem(value === openItem ? null : value); // Alterna o estado do Accordion
  }

  return (
    <AccordionPrimitive.Root type={type} collapsible={collapsible} className='w-full'>
      {items.map((item, index) => (
        <AccordionItem key={index} value={item.title as string}>
          <AccordionTrigger
            onClick={() => handleOpenChange(item.title as string)}
            className={openItem === item.title ? 'bg-neutral-950' : ''}
          >
            {item.title}
          </AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </AccordionPrimitive.Root>
  )
}

export { Accordion }
