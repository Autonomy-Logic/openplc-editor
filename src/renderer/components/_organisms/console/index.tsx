import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useRef } from 'react'

import { LogComponent } from './log'

const Console = () => {
  const { logs } = useOpenPLCStore()
  const bottomLogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const scrollToBottomLog = () => {
      if (bottomLogRef.current) {
        bottomLogRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
          inline: 'end',
        })
      }
    }
    scrollToBottomLog()
  }, [logs])

  return (
    <div
      aria-label='Console'
      className='h-full w-full relative overflow-auto text-cp-base font-semibold text-brand-dark dark:text-neutral-50 focus:outline-none'
    >
      {logs.length > 0 && logs.map((log) => <LogComponent key={log.id} type={log.type} message={log.message} />)}
      <div ref={bottomLogRef} id='bottom-log' />
    </div>
  )
}
export { Console }
