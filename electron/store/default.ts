export type DefaultStore = {
  theme: string;
  toolbar: {
    position: number;
  };
  window: {
    bounds?: {
      width: number;
      height: number;
      x: number;
      y: number;
    };
  };
};

export const getDefaultStore = (): DefaultStore => {
  return {
    theme: 'light',
    toolbar: {
      position: 0,
    },
    window: {},
  };
};
