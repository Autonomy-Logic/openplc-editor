import '@testing-library/jest-dom'

import { cleanup, render } from '@testing-library/react'

import File from './index'

// afterEach(cleanup);w

describe('file component tests suite', () => {
  it('should render root', () => {
    const { getByTitle } = render(<File.Root />)
    expect(getByTitle('file-root')).toBeInTheDocument()
  })

  it('should render label element', () => {
    const { getByText } = render(<File.Label projectName='Test project name' lastModified='Within 30 minutes' />)
    expect(getByText('Test project name')).toBeInTheDocument()
    expect(getByText('Within 30 minutes')).toBeInTheDocument()
  })

  it('should render svg shape for file', () => {
    const { getByRole } = render(<File.Shape />)
    expect(getByRole('figure')).toBeInTheDocument()
  })
})
