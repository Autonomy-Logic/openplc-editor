[GitHub stars](https://img.shields.io/github/stars/Autonomy-Logic/OpenPLC_Editor?color=fa6470)
[GitHub issues](https://img.shields.io/github/issues/Autonomy-Logic/OpenPLC_Editor?color=d8b22d)

<!-- Lines with a comment and a "@" within are used to mark a local where double white space was used to create a line break.-->

## Directory structure 📂

```tree
├── src                                 Source code folder
```

<!-- GETTING STARTED -->

## Development Guide 💻🛠️

This is what you need to work on this project!

### Requirements

Technologies.

- [Node](https://nodejs.org/en/download) *(18.0.0 as minor version).*

- A package manager such as [npm](https://www.npmjs.com), [yarn](https://yarnpkg.com) or [pnpm](https://pnpm.io).
  - *The most recent versions of Node come with a built-in utility called Corepack, which you may use to download or set your preferred package manager.*  <!-- @ -->
  - *[Bun](https://bun.sh) can also be used as package manager, although this is not advised as the Electron build, which only supports NodeJS, will be broken by the JS engine.*
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

### Workflow

Whenever you are going to develop a new functionality or fix, go to the branch *main* and do a pull *(git pull)* to ensure that your version of code is up to date with regard to the Github repository, avoiding conflicts.

When developing a feature, make a branch for it. Except in exceptional cases, avoid pushing directly to the *main* branch.

Make periodic commits. Don't wait to commit until the job is finished. This could make rastreability of code challenging.

## Patterns 📝

### Naming

#### For branch names, use the group name in uppercase, followed by the branch's purpose in lowercase, and a hyphen as a separator

 > Example:
 >
 > > BUG-first-deployment-issues  <!-- @ -->
 > > FEAT-header-component

 Groups of branches:

 > BUG - A problem in the development environment.<br> <!-- @ -->
 > HOTFIX - A problem that has arisen in the production environment.<br> <!-- @ -->
 > FEATURE - A new feature that has been approved and is fully ready for development.<br> <!-- @ -->
 > WIP - A newly approved feature that is dependent on other functionality but is ready for development.

#### Use kebab-case for files and folders

*This approach is used to ensure compatibility between the various OS's, since systems like Windows and Mac the standard behavior is to be case insensitive.*

> Example:
>
> > `Folder:` *text-editor*<br> <!-- @ -->
> > `File:` *editor-tools.tsx*

#### PascalCase should be used for components and classes

> Example:
>
> > `Components`: *HomePage()*<br> <!-- @ -->
> > `Classes:` *ProjectService*

#### camelCase must be used when working with variables, constants, functions and methods

> Example:
>
> > `Variables:` *let projectAsXml*<br> <!-- @ -->
> > `Constants:` *const pouToEdit*<br> <!-- @ -->
> > `Functions:` *function handleEditorInstance()*<br> <!-- @ -->
> > `Methods:` *createProject()*

### Namespaces
<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
