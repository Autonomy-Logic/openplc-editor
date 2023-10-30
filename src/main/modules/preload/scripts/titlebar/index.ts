import { TitlebarColor, Titlebar } from 'custom-electron-titlebar';
import colors from 'tailwindcss/colors';

// class CustomTitlebar {
//   customTitlebar: InstanceType<typeof Titlebar>;
//   constructor(CustomTitleBar: typeof Titlebar) {
//     window.addEventListener('DOMContentLoaded', () => {
//       const tb = new CustomTitleBar({
//         containerOverflow: 'hidden',
//         backgroundColor: TitlebarColor?.fromHex(colors.gray['900']),
//       });
//       this.customTitlebar = tb;
//     });
//   }
//   sendTitleBarToRenderer(mainWindow: InstanceType<typeof BrowserWindow>) {
//     mainWindow.webContents.send('app:titlebar', this.customTitlebar);
//   }
// }

// const customTitlebarInstance = new CustomTitlebar(Titlebar);
// export default customTitlebarInstance;

// Wip: Should export the titlebar instance
window.addEventListener('DOMContentLoaded', () => {
  // eslint-disable-next-line no-new
  new Titlebar({
    containerOverflow: 'hidden',
    backgroundColor: TitlebarColor?.fromHex(colors.gray['900']),
  });
});
