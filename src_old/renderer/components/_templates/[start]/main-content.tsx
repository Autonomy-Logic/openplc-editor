import { ComponentPropsWithoutRef } from 'react'

type IStartMainContentProps = ComponentPropsWithoutRef<'div'>
const StartMainContent = (props: IStartMainContentProps) => {
  const { children, ...res } = props
  return (
    <div
      className='my-4 mb-2 h-full w-full max-w-[778px] min-[1328px]:max-w-5xl min-[1575px]:max-w-7xl min-[1822px]:max-w-[1520px] 3xl:max-w-[1532px] 4xl:max-w-[1990px]'
      {...res}
    >
      {children}
    </div>
  )
}
export { StartMainContent }
