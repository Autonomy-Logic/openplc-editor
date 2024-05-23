import ViewIcon from '@root/renderer/assets/icons/interface/View'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'

const variables = [
  { name: 'BOOL', value: 'FALSE' },
  { name: 'TOF0', value: 'TRUE' },
  { name: 'TOF1', value: 'TRUE' },
  { name: 'TOF2', value: 'TRUE' },
  { name: 'TOF3', value: 'FALSE' },
]

const additionalVariables = [
  { name: 'TOF0', value: 'TOF0' },
  { name: 'TON0', value: 'TON0' },
]

const VariableItem = ({ name, value } : { name: string; value: string }) => (
  <div className='flex h-4 w-full items-center justify-between gap-2'>
    <div className='flex items-center gap-2'>
      {name !== value && <ViewIcon />}
      <p>{name}</p>
    </div>
    <p className='text-neutral-400'>{value}</p>
  </div>
)

export default function VariablePanel() {
  return (
    <div className='flex h-auto w-[20%] min-w-52 flex-col gap-2 overflow-auto rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
      <div className='flex h-7 w-[90px] select-none items-center gap-1 rounded-lg bg-neutral-100 p-1 text-cp-sm dark:bg-brand-dark'>
        <ZapIcon className='h-4 w-4' />
        <p>Variables</p>
      </div>
      {variables.map((variable, index) => (
        <VariableItem key={index} name={variable.name} value={variable.value} />
      ))}
      <hr className='w-full stroke-neutral-200 stroke-[1.5px]' />
      <div className='flex h-full flex-col gap-2'>
        {additionalVariables.map((variable, index) => (
          <VariableItem key={index} name={variable.name} value={variable.value} />
        ))}
      </div>
    </div>
  )
}
