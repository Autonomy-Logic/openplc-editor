[GitHub stars](https://img.shields.io/github/stars/Autonomy-Logic/OpenPLC_Editor?color=fa6470)
[GitHub issues](https://img.shields.io/github/issues/Autonomy-Logic/OpenPLC_Editor?color=d8b22d)

## 📂 Directory structure

```tree
├── src                                 Source code folder
```

<!-- GETTING STARTED -->

## ⚡ Development Guide

This is what you need to work in this project!

### Prerequisites

Technologies required.

- Node 18.\* minimum<br>
  https://nodejs.org/en/download
- A package manager such as npm, yarn or pnpm.
- Corepack which is a built-in tool that comes with the latests version of Node, can be used to set or download a package manager for your preference.

- *Yarn is recommended as a choice that tries to preserve compatibility (such as **npm**) and performance (such as **pnpm**).*

### Configuration and usage

1. Clone the repo

   ```sh
   git clone https://github.com/Autonomy-Logic/OpenPLC_Editor.git
   ```

2. Install the packages

   ```sh
   npm install
   # or
   yarn
   # or
   pnpm install
   ```

3. Run the development server

   ```sh
   npm run start:dev
   # or
   yarn start:dev
   # or
   pnpm start:dev
   ```

<p align="right"><a href="#readme-top">Go back to top⬆️</a></p>

### Workflow guides

> 1.**Whenever you are going to develop a new functionality or fix, go to the branch _main_ and do a pull _(git pull)_ <br>
> to ensure that your version of code is up to date with regard to the Github repository, avoiding conflicts.**
>
> 2.**When developing a feature, make a branch for it.<br>
> Except in exceptional cases, avoid pushing directly to the _main_ branch.**
>
> 3.**Do periodic commits; don't wait until you've completed the task to do it.<br>
> This may make code rastreability difficult.**

### Naming Conventions :

> For branch names, use the group name in uppercase, followed by the branch's purpose in lowercase, and a hyphen as a separator.
>
> > Examples:
> >
> > > BUG-first-deployment-issues<br>
> > > FEAT-header-component
>
> Groups of branches:
>
> > BUG - A problem in the development environment;<br>
> > HOTFIX - A problem that has arisen in the production environment;<br>
> > FEATURE - A new feature that has been approved and is fully ready for development;<br>
> > WIP - A newly approved feature that is dependent on other functionality but is ready for development.
>
> Use camelCase for files:
>
> > Example:
> >
> > > homePage.tsx
>
> PascalCase should be used for components:
>
> > Example:
> >
> > > HomePage()
>
> Other naming conventions include camelCase for variables, constants, functions, and methods, and PascalCase for classes.

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[product-screenshot]: public/home.png
[next.js]: https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[react.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[nodejs.io]: https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white&
[tailwindcss]: https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white&
[typescript]: https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white&
[figma]: https://img.shields.io/badge/figma-%23F24E1E.svg?style=for-the-badge&logo=figma&logoColor=white
[figma-url]: https://www.figma.com/file/etiwmsjeevhgfsmqfyfaam/ethics-net-v2?node-id=119-1533&t=xjh1bguimpzgnllp-0
