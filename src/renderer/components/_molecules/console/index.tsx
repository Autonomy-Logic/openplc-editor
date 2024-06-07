import { cn } from '@root/utils'

const Console = () => {
  /**
   * type 0: normal message
   * type 1: warning message
   * type 2: error message
   * type 3: success message
   */

  const message = [
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
  ]

  return (
    <div
      aria-label='Console'
      className='h-full w-full overflow-auto text-cp-base font-semibold text-brand-dark dark:text-neutral-50'
    >
      {message.map((msg) => (
        <p
          key={msg.message}
          className={cn('font-normal', {
            'text-[#011432] dark:text-white': msg.type === 0,
            'text-yellow-600': msg.type === 1,
            'text-red-700': msg.type === 2,
            'text-brand-medium dark:text-brand': msg.type === 3,
          })}
        >
          {msg.message}
        </p>
      ))}
    </div>
  )
}

export { Console }
