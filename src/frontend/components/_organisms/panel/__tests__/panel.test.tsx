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

import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../index'

/** The handle reads the editing lock, so it needs the store provider. */
const withStore = { wrapper: createStoreWrapper(createTestStore()) }

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
    const { queryByTestId } = render(<ResizableHandle />, withStore)
    expect(queryByTestId('drag-handle-icon')).toBeNull()
  })

  it('renders drag handle icon when withHandle is true', () => {
    const { getByTestId } = render(<ResizableHandle withHandle />, withStore)
    expect(getByTestId('drag-handle-icon')).toBeTruthy()
  })
})
