type InfoProps = {
  selectedPouDocumentation: string | null
}

const Info = ({ selectedPouDocumentation }: InfoProps) => {
  return (
    <div id='info-panel-container' className='flex h-36 w-full flex-col p-2 overflow-hidden'>
      <div className="h-full w-full overflow-hidden rounded-lg border-[1.25px] border-brand bg-inherit p-1">
      <p
        id='info-panel'
        className='h-full w-full overflow-auto bg-inherit font-display text-xs font-medium pr-2'
      >
        {selectedPouDocumentation ? `${selectedPouDocumentation}` : 'No file selected'}
      </p>
      </div>
    </div>
  )
}

export { Info }
