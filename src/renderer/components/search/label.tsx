/* eslint-disable simple-import-sort/imports */
import { cn } from '@/utils';
import { LabelHTMLAttributes, ReactNode } from 'react';

type IconsForSearch = string;
type ActionsLabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  icon: unknown;
  forProp?: string;
};
export default function Label({
  forProp,
  className,
  icon,
  ...props
}: ActionsLabelProps): ReactNode {
  const searchIcon = icon as IconsForSearch;
  return (
    <label htmlFor={forProp} className={cn(className)} {...props}>
      {searchIcon}
    </label>
  );
}
