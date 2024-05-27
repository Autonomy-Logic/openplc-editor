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

export default function VariablePanel({ variables, setGraphList }: VariablePanelProps) {
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
    <div className='flex h-auto w-[20%] min-w-52 flex-col gap-2 overflow-auto rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
      <div className='flex h-7 w-[90px] select-none items-center gap-1 rounded-lg bg-neutral-100 p-1 text-cp-sm dark:bg-brand-dark'>
        <ZapIcon className='h-4 w-4' />
        <p>Variables</p>
      </div>
      <div className='flex h-auto flex-col gap-2 whitespace-nowrap'>
        {variables.map((variable) => (
          <div key={variable.name} className='flex h-4 w-full items-center justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <ViewIcon type='button' className='cursor-pointer' onClick={() => toggleGraphVisibility(variable.name)} />
              {variable.name}
            </div>
            <p className='text-neutral-400'>{variable.type}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
