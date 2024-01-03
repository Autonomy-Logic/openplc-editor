/* eslint-disable simple-import-sort/imports */
/* eslint-disable react/jsx-props-no-spreading */
import { cn } from '@/utils';
import { HTMLAttributes, ReactNode } from 'react';

type ActionsRootProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export default function ActionsRoot({ children, ...props }: ActionsRootProps) {
  const { className } = props;
  return (
    <div className={cn(className)} {...props}>
      {children}
    </div>
  );
}
