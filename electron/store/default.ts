export type DefaultStore = {
  theme: string;
  toolbar: {
    position: {
      x: number;
      y: number;
    };
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
      position: {
        x: 0,
        y: 0,
      },
    },
    window: {},
  };
};
