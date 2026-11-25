# Simulator test fixtures

`simulator-fixture.wasm` is the build of `simulator-project/`, and `simulator-fixture.leaves.json` the MD5 and the debug leaves of its debug map, without the array elements in between, for the
OpenPLC Simulator. Rebuild both after a change to the project, the Baremetal runtime, the `wasm-sim/` sources or the
simulator compile flags, from the openplc-editor root after `npm run build`:

```bash
P=src/backend/shared/simulator/__tests__/fixtures
./node_modules/.bin/electron release/app/dist/main/main.js --cli compile "$PWD/$P/simulator-project" \
  --target "OpenPLC Simulator" --user-data "$(mktemp -d)"
cp "$P/simulator-project/build/OpenPLC Simulator/simulator.wasm" "$P/simulator-fixture.wasm"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); keep=[l for l in d['leaves'] if not l['path'].startswith('INSTANCE0.BIG[') or l['path'] in ('INSTANCE0.BIG[0]','INSTANCE0.BIG[19999]')]; json.dump({'md5':d['md5'],'retainBlobSize':d['retainBlobSize'],'leaves':keep},open(sys.argv[2],'w'),indent=2)" "$P/simulator-project/build/OpenPLC Simulator/src/debug-map.json" "$P/simulator-fixture.leaves.json"
rm -rf "$P/simulator-project/build"
```

Copy the same files to openplc-web; the tests that read them are shared.
