import { memo } from 'react'

import { CustomHandle } from './handle'
import { MockNodeProps } from './utils/types'

const MockNode = ({ data }: MockNodeProps) => {
  return (
    <>
      <div className='h-[40px] w-[150px] border border-red-600 bg-white'>
        <p>{data.label}</p>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

const exportMockNode = memo(MockNode)

export { exportMockNode as MockNode }
