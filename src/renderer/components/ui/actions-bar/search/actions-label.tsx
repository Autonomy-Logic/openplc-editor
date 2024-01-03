/* eslint-disable simple-import-sort/imports */
import { cn } from '@/utils';
import { ReactNode } from 'react';

type IconsForSeacrch = string;
type ActionsLabelProps = {
  icon: unknown;
  children: ReactNode;
  className?: string;
  htmlfor?: string;
};
export default function Label({ children, icon, ...props }: ActionsLabelProps) {
  const { className, htmlfor } = props;
  const searchIcon = icon as IconsForSeacrch;
  return (
    <label htmlFor={htmlfor} className={cn(className)}>
      {searchIcon}
      {children}
    </label>
  );
}
