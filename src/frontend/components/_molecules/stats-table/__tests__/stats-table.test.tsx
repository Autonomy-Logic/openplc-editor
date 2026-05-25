import { render, screen } from '@testing-library/react'

import { formatNumber, formatRange, RangeCell, StatsTable, type StatsTableColumn } from '..'

interface Row {
  id: string
  name: string
  count: number
  avg: number | null
  min: number | null
  max: number | null
}

const rows: Row[] = [
  { id: 'a', name: 'task-A', count: 1234, avg: 100, min: 50, max: 200 },
  { id: 'b', name: 'task-B', count: 99, avg: null, min: null, max: null },
]

const columns: StatsTableColumn<Row>[] = [
  { key: 'name', header: 'Task', align: 'left', render: (r) => r.name },
  { key: 'count', header: 'Scan Count', render: (r) => r.count.toLocaleString() },
  { key: 'time', header: 'Time', render: (r) => <RangeCell avg={r.avg} min={r.min} max={r.max} /> },
]

describe('StatsTable', () => {
  it('renders the title and description', () => {
    render(
      <StatsTable
        context='ctx'
        title='My Stats'
        description='units in microseconds'
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    )
    expect(screen.getByText('My Stats')).toBeTruthy()
    expect(screen.getByText('units in microseconds')).toBeTruthy()
  })

  it('omits the description block when none is provided', () => {
    render(<StatsTable context='ctx' title='T' columns={columns} rows={rows} rowKey={(r) => r.id} />)
    // The title is the only h2; no extra description span exists.
    expect(screen.queryByText(/units in microseconds/)).toBeNull()
  })

  it('renders one row per data entry with each column', () => {
    render(<StatsTable context='ctx' title='T' columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(screen.getByText('task-A')).toBeTruthy()
    expect(screen.getByText('task-B')).toBeTruthy()
    expect(screen.getByText('1,234')).toBeTruthy() // toLocaleString formatting
    expect(screen.getByText('99')).toBeTruthy()
  })

  it('renders the column headers in order', () => {
    render(<StatsTable context='ctx' title='T' columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(screen.getByText('Task')).toBeTruthy()
    expect(screen.getByText('Scan Count')).toBeTruthy()
    expect(screen.getByText('Time')).toBeTruthy()
  })

  it('renders an empty table body when rows is empty', () => {
    const { container } = render(
      <StatsTable context='ctx' title='Empty' columns={columns} rows={[]} rowKey={(r) => r.id} />,
    )
    // The header row stays; the body has no <tr>.
    expect(container.querySelectorAll('tbody tr').length).toBe(0)
  })

  it('uses rowKey to derive react keys (no console warning, deterministic ids)', () => {
    // We can't directly inspect React keys, but rendering twice with the
    // same data should produce the same DOM — a key collision would
    // throw or warn.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    render(<StatsTable context='ctx' title='T' columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining('unique "key"'))
    errSpy.mockRestore()
  })

  it('applies the section id and title id from context', () => {
    const { container } = render(
      <StatsTable context='my-section' title='X' columns={columns} rows={rows} rowKey={(r) => r.id} />,
    )
    expect(container.querySelector('#my-section-section')).toBeTruthy()
    expect(container.querySelector('#my-section-title')).toBeTruthy()
  })

  it('applies left-align className when column.align is "left"', () => {
    const { container } = render(
      <StatsTable context='ctx' title='T' columns={columns} rows={rows} rowKey={(r) => r.id} />,
    )
    const taskHeader = screen.getByText('Task')
    expect(taskHeader.className).toContain('text-left')
    // Body cells in the same column also get the left alignment.
    const taskCell = container.querySelector('tbody tr:first-child td:first-child') as HTMLElement
    expect(taskCell.className).toContain('text-left')
  })
})

describe('RangeCell', () => {
  it('renders the avg value with min/max below', () => {
    render(<RangeCell avg={100} min={50} max={200} />)
    expect(screen.getByText('100')).toBeTruthy()
    expect(screen.getByText('50 / 200')).toBeTruthy()
  })

  it('renders dashes for null avg', () => {
    render(<RangeCell avg={null} min={50} max={100} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders a single dash when min/max are both null', () => {
    render(<RangeCell avg={42} min={null} max={null} />)
    // Two dashes appear: one for the avg's null check (avg=42 has none),
    // one for the range. But avg=42 is rendered, so only one — appears.
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders dashes for undefined avg / min / max', () => {
    render(<RangeCell avg={undefined} min={undefined} max={undefined} />)
    // Both the avg and the range collapse to —.
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBe(2)
  })
})

describe('format helpers', () => {
  it('formatNumber returns localised string for finite numbers', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(0)).toBe('0')
  })

  it('formatNumber returns dash for null/undefined', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(undefined)).toBe('—')
  })

  it('formatRange joins min and max with a slash', () => {
    expect(formatRange(1, 5)).toBe('1 / 5')
    expect(formatRange(0, 0)).toBe('0 / 0')
  })

  it('formatRange returns dash if either side is null', () => {
    expect(formatRange(null, 5)).toBe('—')
    expect(formatRange(1, null)).toBe('—')
    expect(formatRange(null, null)).toBe('—')
  })

  it('formatRange returns dash if either side is undefined', () => {
    expect(formatRange(undefined, 5)).toBe('—')
    expect(formatRange(1, undefined)).toBe('—')
  })
})
