# Open PLC Editor - IDE

![GitHub stars](https://img.shields.io/github/stars/Autonomy-Logic/openplc-editor?color=fa6470)
![GitHub issues](https://img.shields.io/github/issues/Autonomy-Logic/openplc-editor?color=d8b22d)

<p align="center">
<img alt="draft-cover" src="assets/images/github-background.png">
</p>

## Running a preview version

In order to run the development version, clone the repository, and install dependencies via `npm`, you need network access.

You'll need the following tools:

- [Git](https://git-scm.com/)
- [NodeJS](https://nodejs.org/en/download/), **x64**, version `>=20`

### Step by step

- Clone the repository locally and go to the project folder.

```bash
git clone https://github.com/Autonomy-Logic/openplc-editor.git

cd openplc-editor
```

- Install the dependencies

```bash
npm install
```

- Run the development script

```bash
npm run start:dev
```

### Not required but necessary if you intend to use the compiler

You'll need the following:

- [Python](https://www.python.org/downloads/), version `>3.x`
    - [lxml](https://lxml.de/installation.html)

Step by step

- Install required Python package

On Windows
```bash
py -m pip install lxml
```

On MacOS
```bash
python3 -m pip install lxml
```

*Note that each operating system has its own way to handle the Python package manager; those are only a suggestion and may work in most of the cases.*

## Documentation

Please go to the repository [wiki](https://github.com/Autonomy-Logic/openplc-editor/wiki) page to get instruction about the project.

## Project Management

Go to [project](https://github.com/orgs/Autonomy-Logic/projects/4) management page to see the current state of the project.

## Issues

Go to [issues](https://github.com/Autonomy-Logic/openplc-editor/issues) page to view the current state of issues in the project.
