type InfoProps = {
  selectedPouDocumentation: string | null
}

const Info = ({ selectedPouDocumentation }: InfoProps) => {
  return (
    <div id='info-panel-container' className='flex h-36 w-full select-none flex-col overflow-hidden p-2'>
      <div className='h-full w-full overflow-hidden rounded-lg border-[1.25px] border-brand bg-inherit p-1'>
        <p id='info-panel' className='h-full w-full overflow-auto bg-inherit pr-2 font-display text-xs font-medium'>
          {selectedPouDocumentation ? `${selectedPouDocumentation}` : 'No file selected'}
        </p>
      </div>
    </div>
  )
}

export { Info }
