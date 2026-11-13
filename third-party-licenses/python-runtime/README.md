# Python runtime licences

The editor ships the Python runtime that runs Python function blocks in the simulator. The files are pinned by
sha256 in `python-runtime.json` and fetched at install time by `scripts/download-python-runtime.ts`.

| Component | Licence | Text | Source |
| --- | --- | --- | --- |
| CPython 3.13.15 (WASIX build, Wasmer package `python/python@3.13.19`) | PSF License Version 2 | `LICENSE-CPython.txt`, read from `lib/python3.13/LICENSE.txt` inside the package | https://cdn.wasmer.io/webcimages/a016e626e56a2f08c17804df26d58e2d45170d07bfca1770f1a1bb844d9d4693.webc |
| numpy 2.3.2 (WASIX wheel) | BSD-3-Clause | `LICENSE-numpy.txt`, from `numpy-2.3.2.dist-info/LICENSE.txt` in the wheel; the licences of the parts numpy bundles stay inside the wheel (`numpy/random/LICENSE.md`, `numpy/ma/LICENSE`, `numpy/_core/include/numpy/random/LICENSE.txt`) | https://pythonindex.wasix.org/packages/numpy-2.3.2-cp313-cp313-wasix_wasm32.whl |

The Wasmer SDK (`@wasmer/sdk`, which runs the package) ships with its own `LICENSE` file next to it.

To update: change the pins in `python-runtime.json` in both repositories, run `npm run setup:python -- --force`
(editor) or `pnpm run setup:python -- --force` (web), and refresh both texts from the new files the same way.
