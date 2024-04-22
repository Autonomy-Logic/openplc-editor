import { ComponentPropsWithoutRef } from 'react'

type IStartMainContentProps = ComponentPropsWithoutRef<'div'>
const StartMainContent = (props: IStartMainContentProps) => {
  const { children, ...res } = props
  return (
    <div
      className='w-full h-full mb-2 my-4 max-w-3xl xl:max-w-5xl 2xl:max-w-7xl xm:max-w-[1520px] 3xl:max-w-[1532px] 4xl:max-w-[1990px]'
      {...res}
    >
      {children}
    </div>
  )
}
export { StartMainContent }
