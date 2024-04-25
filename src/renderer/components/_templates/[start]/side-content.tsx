import { ComponentPropsWithoutRef } from 'react'

type IStartSideContentProps = ComponentPropsWithoutRef<'div'>
const StartSideContent = (props: IStartSideContentProps) => {
  const { children, ...res } = props
  return (
    <div className='relative top-[63%] ml-16 min-w-[240px] 2xl:top-2/3' {...res}>
      {children}
    </div>
  )
}

export { StartSideContent }
