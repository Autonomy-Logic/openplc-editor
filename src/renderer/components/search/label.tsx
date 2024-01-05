import { LabelHTMLAttributes, ReactNode } from 'react';

type IconsForSearch = string;
type ActionsLabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  icon: unknown;
};
export default function Label({ icon, ...props }: ActionsLabelProps): ReactNode {
  const searchIcon = icon as IconsForSearch;
  return (
    <label htmlFor={props.htmlFor} {...props}>
      {searchIcon}
    </label>
  );
}
