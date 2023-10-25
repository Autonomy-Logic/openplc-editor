import { TitlebarColor, Titlebar } from 'custom-electron-titlebar';
import colors from 'tailwindcss/colors';

const setupTitleBar = () => {
  window.addEventListener('DOMContentLoaded', () => {
    // eslint-disable-next-line no-new
    new Titlebar({
      containerOverflow: 'hidden',
      backgroundColor: TitlebarColor?.fromHex(colors.gray['900']),
    });
  });
};

setupTitleBar();
