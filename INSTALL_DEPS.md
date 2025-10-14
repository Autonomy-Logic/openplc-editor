# Installing Dependencies for Modbus RTU Support

The Modbus RTU implementation requires the `serialport` native module. After pulling this branch, follow these steps to install it properly:

## Installation Steps

1. Install root dependencies (if you haven't already):
   ```bash
   npm install
   ```

2. Install and build the native serialport module:
   ```bash
   cd release/app
   npm install
   npm run rebuild
   cd ../..
   ```

3. Start the development server:
   ```bash
   npm run start:dev
   ```

## Why These Steps Are Needed

The `serialport` module is a native Node.js addon that needs to be compiled specifically for Electron's Node.js runtime. The steps above:
- Install the serialport package in the Electron app directory (`release/app`)
- Rebuild it for the correct Electron version using `electron-rebuild`

## Troubleshooting

If you still see "Cannot find module 'serialport'" errors:
- Ensure you ran `npm install` inside the `release/app` directory
- Check that the rebuild completed successfully without errors
- Try removing `release/app/node_modules` and running the installation steps again
