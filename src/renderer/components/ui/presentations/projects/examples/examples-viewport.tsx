import { HTMLAttributes } from 'react';
// TODO: Remove mock data
import MockImage from 'renderer/assets/images/example.png';

import Card from '@/renderer/components/elements/card';
// TODO: Remove mock data
import Mock from '@/shared/data/mock/examples.json';

type EmblaViewportRefType = <ViewportElement extends HTMLElement>(
  instance: ViewportElement | null
) => void;
type ExamplesViewportProps = HTMLAttributes<HTMLDivElement> & {
  exampleProjects?: object[];
  refProvider: EmblaViewportRefType;
};
export default function Viewport(props: ExamplesViewportProps) {
  const { refProvider, ...restProps } = props;
  return (
    <div className='overflow-hidden' ref={refProvider} {...restProps}>
      <div className='flex gap-4'>
        {Mock.map((project) => (
          <Card.Root key={project.example_id}>
            <Card.Label title={project.example_name} description={project.example_description} />
            <Card.Preview source={MockImage} />
          </Card.Root>
        ))}
      </div>
    </div>
  );
}
