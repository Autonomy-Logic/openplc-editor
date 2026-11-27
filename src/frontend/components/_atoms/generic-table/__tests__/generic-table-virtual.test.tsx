import { createColumnHelper } from '@tanstack/react-table'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { GenericTable } from '../index'

type Item = { name: string }

const HEADER = 32
const ROW = 32
const VIEWPORT = 320

const columnHelper = createColumnHelper<Item>()
const columns = [columnHelper.accessor('name', { header: 'Name', cell: (props) => props.getValue() })]

const items = (count: number): Item[] => Array.from({ length: count }, (_, index) => ({ name: `item${index}` }))

/** Lays out the scroll container and the rows as a browser would, since jsdom has no layout. */
const layout = (rowHeight = ROW) => {
  const scroller = screen.getByLabelText('Scroller')
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: VIEWPORT })
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const position = this.dataset.rowPosition
    const top = position === undefined ? 0 : HEADER + Number(position) * rowHeight - scroller.scrollTop
    return {
      top,
      bottom: top + rowHeight,
      left: 0,
      right: 0,
      width: 0,
      height: rowHeight,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }
  })
  return scroller
}

const scrollTo = (scroller: HTMLElement, scrollTop: number) => {
  act(() => {
    scroller.scrollTop = scrollTop
    fireEvent.scroll(scroller)
  })
}

const dataRows = () => screen.getAllByRole('row').filter((row) => row.querySelectorAll('td').length > 0)

const hiddenRowsHeight = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLTableRowElement>('tr[aria-hidden="true"]')).reduce(
    (sum, row) => sum + parseFloat(row.style.height),
    0,
  )

const Table = ({
  count,
  selectedRow = -1,
  onRowClick = () => undefined,
}: {
  count: number
  selectedRow?: number
  onRowClick?: (row: HTMLTableRowElement) => void
}) => (
  <div aria-label='Scroller' style={{ overflowY: 'auto', height: VIEWPORT }}>
    <GenericTable<Item>
      columns={columns}
      tableData={items(count)}
      selectedRow={selectedRow}
      handleRowClick={onRowClick}
      updateData={() => ({ ok: true })}
      tableContext='Test'
      virtualization={{}}
    />
  </div>
)

afterEach(() => {
  jest.restoreAllMocks()
})

describe('GenericTable virtualization', () => {
  it('mounts only the rows near the viewport of a long table', () => {
    const { container, rerender } = render(<Table count={1000} />)
    const scroller = layout()
    scrollTo(scroller, 0)
    rerender(<Table count={1000} />)
    const mounted = dataRows().length
    expect({
      fewRows: mounted <= VIEWPORT / ROW + 2 * 20 + 1,
      first: dataRows()[0].id,
      heightKept: mounted * ROW + hiddenRowsHeight(container),
    }).toEqual({ fewRows: true, first: '0', heightKept: 1000 * ROW })
  })

  it('mounts the last rows once scrolled to the end', () => {
    const { container } = render(<Table count={1000} />)
    const scroller = layout()
    scrollTo(scroller, HEADER + 1000 * ROW - VIEWPORT)
    const ids = dataRows().map((row) => row.id)
    expect({
      last: ids.at(-1),
      hasFirst: ids.includes('0'),
      heightKept: ids.length * ROW + hiddenRowsHeight(container),
    }).toEqual({ last: '999', hasFirst: false, heightKept: 1000 * ROW })
  })

  it('sizes the hidden rows with the measured row height', () => {
    const tall = 35
    const { container } = render(<Table count={1000} />)
    const scroller = layout(tall)
    scrollTo(scroller, 0)
    scrollTo(scroller, HEADER + 1000 * tall - VIEWPORT)
    const ids = dataRows().map((row) => row.id)
    expect({ last: ids.at(-1), heightKept: ids.length * tall + hiddenRowsHeight(container) }).toEqual({
      last: '999',
      heightKept: 1000 * tall,
    })
  })

  it('mounts every row of a table under the threshold', () => {
    const { container } = render(<Table count={150} />)
    const scroller = layout()
    scrollTo(scroller, 0)
    expect({ rows: dataRows().length, spacers: container.querySelectorAll('tr[aria-hidden="true"]').length }).toEqual({
      rows: 150,
      spacers: 0,
    })
  })

  it('scrolls a newly selected row that is out of view into view', () => {
    const { rerender } = render(<Table count={1000} selectedRow={0} />)
    const scroller = layout()
    scrollTo(scroller, 0)
    act(() => {
      rerender(<Table count={1000} selectedRow={500} />)
    })
    const rowTop = HEADER + 500 * ROW
    expect({
      inView: rowTop >= scroller.scrollTop && rowTop + ROW <= scroller.scrollTop + VIEWPORT,
      mounted: dataRows().some((row) => row.id === '500'),
    }).toEqual({ inView: true, mounted: true })
  })

  it('passes a clicked row of the window to the row click handler', () => {
    const clicked: string[] = []
    render(<Table count={1000} onRowClick={(row) => clicked.push(row.id)} />)
    const scroller = layout()
    scrollTo(scroller, 400 * ROW)
    const row = dataRows()[5]
    fireEvent.click(row)
    expect(clicked).toEqual([row.id])
  })
})
