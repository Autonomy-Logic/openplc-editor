import React, { ButtonHTMLAttributes, ReactNode } from 'react'

import { TableActionButton } from '../buttons/tables-actions'

type TableAction = {
  ariaLabel: string
  onClick: () => void
  disabled?: boolean
  icon: ReactNode
  id?: string
}

type TableActionsProps = {
  actions: TableAction[]
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>
}

const TableActions: React.FC<TableActionsProps> = ({ actions, buttonProps }) => {
  return (
    <div className='flex cursor-pointer gap-2'>
      {actions.map((action, index) => (
        <TableActionButton
          key={index}
          aria-label={action.ariaLabel}
          onClick={action.onClick}
          disabled={action.disabled}
          id={action.id}
          {...buttonProps}
        >
          {action.icon}
        </TableActionButton>
      ))}
    </div>
  )
}

export default TableActions
