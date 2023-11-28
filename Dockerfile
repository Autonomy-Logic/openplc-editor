# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/engine/reference/builder/

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine3.17

# stuff needed to get Electron to run
# RUN apk update \
#  apk upgrade \
#  apk add --no-cache git libx11-xcb1 libxcb-dri3-0 libxtst6 libnss3 libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2

# Use production node environment by default.
# ENV npm_config_platform="linux"
# ENV npm_config_arch="x64"

WORKDIR /usr/src/app

# Download dependencies as a separate step to take advantage of Docker's caching.
# Leverage a cache mount to /root/.npm to speed up subsequent builds.
# Leverage a bind mounts to package.json and package-lock.json to avoid having to copy them into
# into this layer.
COPY release/app/package.json /usr/src/app/
COPY release/app/package-lock.json /usr/src/app/
COPY package.json /usr/src/app/
COPY package-lock.json /usr/src/app/

RUN --network=none npm i
# RUN --mount=type=bind,source=release/app/package.json,target=release/app/package.json \
#   --mount=type=bind,source=release/app/package-lock.json,target=release/app/package-lock.json \
#   --mount=type=bind,source=package.json,target=package.json \
#   --mount=type=bind,source=package-lock.json,target=package-lock.json \
#   npm i \
#   npx @electron/rebuild
# Run the application as a non-root user.
USER node

# Copy the rest of the source files into the image.
COPY . .

# Expose the port that the application listens on.
EXPOSE 1212

# Run the application.
CMD npm run start:dev
