import { CreateRung } from '@root/renderer/components/_molecules/rung/create-rung'
import { Rung } from '@root/renderer/components/_organisms/rung'
import { useState } from 'react'

import BlockElement from '../elements/block'
import ContactELement from '../elements/contact'

export default function LadderEditor() {
  const [rungs, setRungs] = useState<string[]>([])
  return (
    <div className='h-full w-full overflow-y-auto' style={{ scrollbarGutter: 'stable' }}>
      <div className='flex flex-1 flex-col gap-4 p-1'>
        {rungs.map((_rung, index) => (
          <Rung key={index} />
        ))}
        <CreateRung
          onClick={() => {
            setRungs([...rungs, ''])
          }}
        />
        <BlockElement />
        <ContactELement />
      </div>
    </div>
  )
}
