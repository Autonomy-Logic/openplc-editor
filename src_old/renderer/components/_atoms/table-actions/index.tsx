import { cn } from '@root/utils'
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
  className?: string
}

const TableActions: React.FC<TableActionsProps> = ({ actions, buttonProps, className }) => {
  return (
    <div className={cn(className, 'flex cursor-pointer gap-2')}>
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
