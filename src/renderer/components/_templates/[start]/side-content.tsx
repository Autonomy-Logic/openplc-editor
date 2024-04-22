import { ComponentPropsWithoutRef } from 'react'

type IStartSideContentProps = ComponentPropsWithoutRef<'aside'>
const StartSideContent = (props: IStartSideContentProps) => {
  const { children, ...res } = props
  return (
    <aside className='relative top-[63%] 2xl:top-2/3  min-w-[240px] ml-16' {...res}>
      {children}
    </aside>
  )
}

export { StartSideContent }
