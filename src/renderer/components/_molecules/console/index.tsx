import { TrashIcon } from '@radix-ui/react-icons'
import { cn } from '@root/utils'
import { useState } from 'react'

export default function ConsolePanel() {
  /**
   * type 0: normal message
   * type 1: warning message
   * type 2: error message
   * type 3: success message
   */

  const [message, setMessage] = useState([
    {
      message: 'Start build in C:UsersPichauOpenPLC_EditoreditorexamplesBlink/build Generating SoftPLC',
      type: 0,
    },

    {
      message: 'IEC-61131 ST/IL/SFC code...',
      type: 3,
    },

    {
      message: 'Collecting data types',
      type: 0,
    },

    {
      message: 'Generating code...',
      type: 0,
    },

    {
      message: 'warning: cannot find POU "blink"',
      type: 1,
    },
    {
      message: 'Error: POU not found',
      type: 2,
    },
  ])
  //className='text-brand-medium

  return (
    <div className=' h-full w-full overflow-auto text-cp-base font-semibold text-brand-dark dark:text-neutral-50'>
      <button className='rounded-lg border border-neutral-200 bg-brand-light p-2' onClick={() => setMessage([])}>
        <TrashIcon className='stroke-neutral-medium h-4 w-4' />
      </button>{' '}
      {message.map((msg) => (
        <p
          key={msg.message}
          className={cn({
            'text-[#011432]': msg.type === 0,
            'text-yellow-600': msg.type === 1,
            'text-red-700': msg.type === 2,
            'text-brand-medium': msg.type === 3,
          })}
        >
          {msg.message}
        </p>
      ))}
    </div>
  )
}
