import { HTMLAttributes, JSX } from 'react';

import NextButton from './buttons/next-button';
import PrevButton from './buttons/prev-button';

type ExamplesHeaderProps = HTMLAttributes<HTMLElement> & {
  title: string;
  actions: {
    prev: () => void;
    next: () => void;
  };
};

/**
 * Render the header component with the given props.
 *
 * @param {ExamplesHeaderProps} props - The props for the header component.
 * @returns {JSX.Element} The rendered header component.
 */
export default function Header(props: ExamplesHeaderProps): JSX.Element {
  const { title, actions, ...restProps } = props;
  return (
    <header className='flex flex-1 w-full mb-6 justify-between' {...restProps}>
      <h1>{title}</h1>
      <div className='flex w-fit gap-6'>
        <PrevButton goPrev={actions.prev} />
        <NextButton goNext={actions.next} />
      </div>
    </header>
  );
}
