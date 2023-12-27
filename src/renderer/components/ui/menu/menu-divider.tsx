/* eslint-disable react/jsx-props-no-spreading */
import { HTMLAttributes } from 'react';

type MenuDividerProps = HTMLAttributes<HTMLHRElement> & Record<string, never>;

export default function Divider({ ...props }: MenuDividerProps) {
  return <hr className='bg-[#DDE2E8] w-full my-4' {...props} />;
}
