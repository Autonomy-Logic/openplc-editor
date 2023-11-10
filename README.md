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
  <https://nodejs.org/en/download>
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

> 1.**Whenever you are going to develop a new functionality or fix, go to the branch *main* and do a pull *(git pull)* <br>
> to ensure that your version of code is up to date with regard to the Github repository, avoiding conflicts.**
>
> 2.**When developing a feature, make a branch for it.<br>
> Except in exceptional cases, avoid pushing directly to the *main* branch.**
>
> 3.**Do periodic commits; don't wait until you've completed the task to do it.<br>
<!-- > This may make code rastreability difficult.** -->

### Naming Conventions

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
>
> Use kebab-case for files and folders:
>
> - ***(This approach is used to ensure compatibility between the various OS's, since systems like Windows and Mac the standard behavior is to be case insensitive.)***
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
