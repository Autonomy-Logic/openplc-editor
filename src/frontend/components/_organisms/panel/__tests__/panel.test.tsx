import { render } from '@testing-library/react'

// Mock react-resizable-panels
vi.mock('react-resizable-panels', () => ({
  Panel: ({ children, ...props }: { children?: React.ReactNode }) => (
    <div data-testid='panel' {...props}>
      {children}
    </div>
  ),
  PanelGroup: ({ children, ...props }: { children?: React.ReactNode }) => (
    <div data-testid='panel-group' {...props}>
      {children}
    </div>
  ),
  PanelResizeHandle: ({ children, ...props }: { children?: React.ReactNode }) => (
    <div data-testid='panel-resize-handle' {...props}>
      {children}
    </div>
  ),
}))

// Mock Radix icon
vi.mock('@radix-ui/react-icons', () => ({
  DragHandleDots2Icon: (props: Record<string, unknown>) => <svg data-testid='drag-handle-icon' {...props} />,
}))

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../index'

describe('ResizablePanel exports', () => {
  it('exports ResizablePanel', () => {
    expect(ResizablePanel).toBeDefined()
  })

  it('exports ResizablePanelGroup', () => {
    expect(ResizablePanelGroup).toBeDefined()
  })

  it('exports ResizableHandle', () => {
    expect(ResizableHandle).toBeDefined()
  })
})

describe('ResizablePanelGroup', () => {
  it('renders children', () => {
    const { getByText } = render(
      <ResizablePanelGroup direction='horizontal'>
        <div>Child content</div>
      </ResizablePanelGroup>,
    )
    expect(getByText('Child content')).toBeTruthy()
  })
})

describe('ResizableHandle', () => {
  it('renders without handle by default', () => {
    const { queryByTestId } = render(<ResizableHandle />)
    expect(queryByTestId('drag-handle-icon')).toBeNull()
  })

  it('renders drag handle icon when withHandle is true', () => {
    const { getByTestId } = render(<ResizableHandle withHandle />)
    expect(getByTestId('drag-handle-icon')).toBeTruthy()
  })
})
