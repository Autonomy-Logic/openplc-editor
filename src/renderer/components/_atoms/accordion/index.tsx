import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import { cn } from '@root/utils'
import { forwardRef, useEffect, useRef, useState } from 'react'

interface AccordionItemProps {
  title: React.ReactNode
  content: React.ReactNode
  searchID: string
}

interface AccordionProps {
  items: AccordionItemProps[]
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
          'group flex w-full items-center justify-between overflow-hidden bg-slate-100 p-2 text-left transition-all duration-300 hover:bg-slate-200 dark:bg-neutral-900 dark:hover:bg-neutral-850',
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
        'overflow-hidden border-t border-slate-200 bg-slate-100 transition-all duration-300 ease-in-out data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown dark:border-neutral-950 dark:bg-neutral-900',
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

const Accordion = ({ items }: AccordionProps) => {
  const [openItems, setOpenItems] = useState<string[]>([])
  const prevItemsLength = useRef<number>(items.length)

  useEffect(() => {
    if (items.length > prevItemsLength.current) {
      setOpenItems([items[items.length - 1].searchID])
    } else if (prevItemsLength.current === 1) {
      setOpenItems([items[0].searchID])
    }
    prevItemsLength.current = items.length
  }, [items.length])

  const handleValueChange = (value: string[]) => {
    setOpenItems(value)
  }

  return (
    <AccordionPrimitive.Root
      type='multiple'
      value={openItems}
      onValueChange={handleValueChange}
      className='flex w-full flex-col gap-1'
    >
      {items.map((item) => (
        <AccordionItem key={item.searchID} value={item.searchID}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </AccordionPrimitive.Root>
  )
}

export { Accordion }
