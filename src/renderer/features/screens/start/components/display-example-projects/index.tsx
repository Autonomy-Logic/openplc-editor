import useEmblaCarousel from 'embla-carousel-react';
import { useCallback } from 'react';
// TODO: Remove mock data
import MockImage from '~renderer/assets/images/example.png';

import Card from '~renderer/components/elements/card';

// TODO: Remove mock data
import Mock from '../../../../../../shared/data/mock/examples.json';
import { Carousel, Header, NextButton, PrevButton, Wrapper } from './elements';

export default function DisplayExampleProjects() {
  const [emblaRef, emblaApi] = useEmblaCarousel();

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);
  return (
    <Wrapper>
      <Header title='Examples'>
        <PrevButton onClick={scrollPrev} />
        <NextButton onClick={scrollNext} />
      </Header>
      <Carousel.Container refProvider={emblaRef}>
        <Carousel.Viewport>
          {Mock.map((project) => (
            <Card.Root key={project.id}>
              <Card.Preview source={MockImage} />
              <Card.Label title={project.name} description={project.description} />
            </Card.Root>
          ))}
        </Carousel.Viewport>
      </Carousel.Container>
    </Wrapper>
  );
}

export type DisplayExampleProjectsComponent = typeof DisplayExampleProjects;
