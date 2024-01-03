/* eslint-disable simple-import-sort/imports */
/* eslint-disable react/jsx-props-no-spreading */
import { cn } from '@/utils';
import React from 'react';

type ActionsSearchProps = {
  children: React.ReactNode;
  className?: string;
};

export default function Search({ children, ...props }: ActionsSearchProps) {
  const { className } = props;
  return <div className={cn(className)}>{children}</div>;
}
