import { ComponentPropsWithoutRef } from 'react'

type ITabListProps = ComponentPropsWithoutRef<'div'>
const TabList = (props: ITabListProps) => {
  return (
    <div role='tablist' className='isolate flex border-none outline-none' aria-label='Tabs list' {...props}>
      {props.children}
    </div>
  )
}

export { TabList }
