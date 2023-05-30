# Open PLC Editor

[![Required Node.JS >= 14.18.0 || >=16.0.0](https://img.shields.io/static/v1?label=node&message=14.18.0%20||%20%3E=16.0.0&logo=node.js&color=3f893e)](https://nodejs.org/about/releases)
![GitHub stars](https://img.shields.io/github/stars/Autonomy-Logic/OpenPLC_Editor?color=fa6470)
![GitHub issues](https://img.shields.io/github/issues/Autonomy-Logic/OpenPLC_Editor?color=d8b22d)
![GitHub license](https://img.shields.io/github/license/caoxiemeihao/vite-react-electron)

## 🛫 Quick start

### Run development environment

```sh
npm run dev
```

### Generate production version

```sh
npm run build
```

## 📂 Directory structure

Familiar React application structure, just with `electron` folder on the top :wink:  
_Files in this folder will be separated from your React application and built into `dist-electron`_

```tree
├── electron                                 Electron-related code
│   ├── main                                 Main-process source code
│   └── preload                              Preload-scripts source code
│
├── release                                  Generated after production build, contains executables
│   └── {version}
│       ├── {os}-{os_arch}                   Contains unpacked application executable
│       └── {app_name}_{version}.{ext}       Installer for the application
│
├── public                                   Static assets
└── src                                      Renderer source code, your React application
```
