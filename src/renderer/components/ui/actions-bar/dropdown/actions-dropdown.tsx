import { ReactNode } from 'react';

type ActionsDropDownProps = {
  children: ReactNode;
};
export default function DropDown({ children }: ActionsDropDownProps) {
  return <div className='relative'>{children}</div>;
}
