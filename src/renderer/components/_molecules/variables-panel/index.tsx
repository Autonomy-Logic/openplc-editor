import ViewIcon from '@root/renderer/assets/icons/interface/View'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'
type Variable = {
  name: string
  type: string
}

type VariablePanelProps = {
  variables: Variable[]
  graphList?: string[]
  setGraphList: React.Dispatch<React.SetStateAction<string[]>>
}
const VariablesPanel = ({ variables, setGraphList, graphList }: VariablePanelProps) => {
  const toggleGraphVisibility = (variableName: string) => {
    setGraphList((prevGraphList) => {
      if (prevGraphList.includes(variableName)) {
        return prevGraphList.filter((name) => name !== variableName)
      } else {
        return [...prevGraphList, variableName]
      }
    })
  }

  return (
    <div className='flex h-full w-full min-w-52 flex-col gap-2 overflow-hidden rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
      <div className='flex h-7 w-[90px] select-none items-center gap-1 rounded-lg bg-neutral-100 p-1 text-cp-sm dark:bg-brand-dark'>
        <ZapIcon className='h-4 w-4' />
        <p>Variables</p>
      </div>
      <div className='flex h-auto max-h-[60%] min-h-[50%] flex-col gap-2 overflow-auto whitespace-nowrap'>
        {variables.map((variable) => (
          <div key={variable.name} className='flex h-4 w-full items-center justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <ViewIcon
                type='button'
                className='cursor-pointer'
                stroke={graphList?.includes(variable.name) ? '' : '#B4D0FE'}
                onClick={() => toggleGraphVisibility(variable.name)}
              />
              <p className='text-neutral-1000 dark:text-white '>{variable.name}</p>
            </div>
            <p className='uppercase text-neutral-400 dark:text-neutral-700'>{variable.type}</p>
          </div>
        ))}
      </div>
      <hr className='w-full stroke-neutral-200 stroke-[1.5px]' />
      <div className='flex h-auto flex-col gap-2 overflow-auto whitespace-nowrap pb-2'>
        <div className='flex justify-between'>
          <p className='text-cp-sm font-medium text-neutral-1000 dark:text-white'>TON0</p>
          <p className='text-cp-sm font-medium text-neutral-400 dark:text-neutral-700'>TON</p>
        </div>
        <div className='flex justify-between'>
          <p className='text-cp-sm font-medium text-neutral-1000 dark:text-white'>TOF0</p>
          <p className='text-cp-sm font-medium text-neutral-400 dark:text-neutral-700'>TOF</p>
        </div>
      </div>
    </div>
  )
}

export { VariablesPanel }
