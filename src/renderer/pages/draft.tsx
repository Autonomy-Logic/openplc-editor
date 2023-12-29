/* eslint-disable jsx-a11y/control-has-associated-label */
import useEmblaCarousel from 'embla-carousel-react';
import { useCallback } from 'react';

import Examples from '../components/ui/presentations/projects/examples';

function Draft() {
  // It is imported on component implementation
  const [emblaRef, emblaApi] = useEmblaCarousel();

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  return (
    // <div className='w-full h-full flex justify-center items-center flex-col p-10'>

    <Examples.Container>
      <Examples.Header title='Examples' actions={{ prev: scrollPrev, next: scrollNext }} />
      <Examples.Viewport refProvider={emblaRef} />
    </Examples.Container>

    // </div>
  );
}

export default Draft;

/* <div className='relative flex flex-col items-start justify-start gap-6 text-left text-xl text-black w-full bg-white'>
        <div className='flex flex-row items-start self-stretch justify-between'>
          <h3 className='relative leading-6 font-medium'>Examples</h3>
          <div className='flex flex-row flex-shrink-0 items-start justify-start gap-6'>
            <img
              alt='icon for nav left'
              className='relative flex-shrink-0 w-6 h-6 overflow-hidden object-cover'
              src={LeftArrow}
            />
            <img
              alt='icon for nav right'
              className='relative flex-shrink-0 w-6 h-6 overflow-hidden object-contain'
              src={RightArrow}
            />
          </div>
        </div>
        <div className='flex flex-row self-stretch items-start justify-start gap-6 overflow-auto'>
          {DataForExamples.map((ex) => (
            <Card.Root key={ex.example_id}>
              <Card.Preview source={TestImage} />
              <Card.Label title={ex.example_name} description={ex.example_description} />
            </Card.Root>
          ))}
        </div>
      </div> */
