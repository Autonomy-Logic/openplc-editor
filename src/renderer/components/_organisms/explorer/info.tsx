type InfoProps = {
  selectedPouDocumentation: string | null
}

const Info = ({ selectedPouDocumentation }: InfoProps) => {
  return (
    <div id='info-panel-container' className='flex h-36 w-full flex-col p-2'>
      <p id='info-panel' className='h-full w-full rounded-lg border-[1.25px] border-brand bg-inherit p-1 font-display font-medium text-xs'>
        {selectedPouDocumentation ? `${selectedPouDocumentation}` : 'No file selected'}
      </p>
    </div>
  )
}

export { Info }
