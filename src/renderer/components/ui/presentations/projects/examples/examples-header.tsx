import { HTMLAttributes } from 'react';

type ExamplesHeaderProps = HTMLAttributes<HTMLElement> & unknown;

export default function Header(props: ExamplesHeaderProps) {
  const { ...restProps } = props;
  return (
    <header className='flex flex-1 w-full mb-6 justify-between' {...restProps}>
      <h1>Examples</h1>
      {/* Prev and next buttons */}
    </header>
  );
}
