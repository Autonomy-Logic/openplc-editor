/**
 * Local development mock for the VPP catalog port methods.
 *
 * Mirrors the real packages currently shipped in github.com/Autonomy-Logic/
 * openplc-packages so the Browse Catalog UI can be exercised against a
 * plausible inventory while the OpenPLC CDN backend (EDGE-482) is still
 * pending. Each entry exposes 1–3 versions (newest-first); one — the STM32
 * community package — deliberately ships a future 0.3.0 with
 * `minEditorVersion: '5.0.0'` so the UI's "Editor outdated" path can be
 * exercised without faking APP_VERSION at runtime.
 *
 * To activate the mock during dev, flip `USE_LOCAL_MOCK` in
 * `package-adapter.ts` to `true`. Do NOT commit that flip — the committed
 * baseline is the stub adapter that returns a "backend not yet available"
 * error so the Browse Catalog tab degrades gracefully.
 *
 * When the CDN backend lands, this file can be deleted (or repurposed as a
 * test fixture) and the adapter wired to real `fetch()` calls. Wire shape
 * is documented in EDGE-483 / EDGE-484.
 */

import type { ImportResult, RemoteCatalog, RemoteCatalogEntry } from '../../shared/ports/types'

const MOCK_REMOTE_CATALOG: RemoteCatalogEntry[] = [
  {
    packageId: 'com.openplc.arduino',
    name: 'OpenPLC — Arduino boards',
    vendor: { name: 'Arduino', url: 'https://www.arduino.cc' },
    description:
      'OpenPLC HAL support for Arduino-family (maker line) boards: Uno, Mega, Nano, Leonardo, Due, Giga, Micro, Nano ESP32, Uno R4 / R4 WiFi / Q, Zero, Mkr WiFi / Zero, Nano 33 BLE / IoT / Every / RP2040 Connect.',
    license: 'GPL-3.0',
    tags: ['arduino', 'avr', 'samd', 'esp32', 'mbed', 'official'],
    versions: [
      {
        version: '0.2.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.arduino-0.2.0.vpp',
        publishedAt: '2026-05-20T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 19,
      },
      {
        version: '0.1.5',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.arduino-0.1.5.vpp',
        publishedAt: '2026-03-10T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 17,
      },
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.arduino-0.1.0.vpp',
        publishedAt: '2026-01-22T00:00:00Z',
        minEditorVersion: '3.5.0',
        deviceCount: 15,
      },
    ],
  },
  {
    packageId: 'com.openplc.arduino-industrial',
    name: 'OpenPLC — Arduino industrial boards',
    vendor: { name: 'Arduino', url: 'https://www.arduino.cc/pro' },
    description:
      'OpenPLC HAL support for the Arduino Pro industrial line: Edge Control, Opta, and the Portenta H7 family.',
    license: 'GPL-3.0',
    tags: ['arduino', 'industrial', 'mbed', 'official'],
    versions: [
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.arduino-industrial-0.1.0.vpp',
        publishedAt: '2026-04-12T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 3,
      },
      {
        version: '0.0.9',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.arduino-industrial-0.0.9.vpp',
        publishedAt: '2026-02-28T00:00:00Z',
        minEditorVersion: '3.8.0',
        deviceCount: 2,
      },
    ],
  },
  {
    packageId: 'com.openplc.espressif',
    name: 'OpenPLC — Espressif boards',
    vendor: { name: 'Espressif', url: 'https://www.espressif.com' },
    description:
      'OpenPLC HAL support for the ESP32 family (Generic, WROOM, WROVER, C3, C6, S2, S3) and the ESP8266 (D1 mini, NodeMCU).',
    license: 'GPL-3.0',
    tags: ['espressif', 'esp32', 'esp8266', 'wifi', 'official'],
    versions: [
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.espressif-0.1.0.vpp',
        publishedAt: '2026-04-08T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 9,
      },
      {
        version: '0.0.8',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.espressif-0.0.8.vpp',
        publishedAt: '2026-02-15T00:00:00Z',
        minEditorVersion: '3.8.0',
        deviceCount: 7,
      },
    ],
  },
  {
    packageId: 'com.openplc.stm32-community',
    name: 'OpenPLC — STM32 community boards',
    vendor: { name: 'STM32 community', url: 'https://github.com/stm32duino' },
    description:
      'OpenPLC HAL support for community STM32 boards: Blackpill F411CE and Bluepill F103CB (each with DFU, HID, SWD, and Serial upload variants), plus the NUCLEO F446ZET.',
    license: 'GPL-3.0',
    tags: ['stm32', 'arm', 'cortex-m', 'community'],
    versions: [
      // Future 0.3.0 requires an editor we don't ship yet — exercises the
      // "Editor outdated" disabled state without faking APP_VERSION at
      // runtime. 0.2.0 stays compatible so the card's "latestCompatible"
      // path can be observed too.
      {
        version: '0.3.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.stm32-community-0.3.0.vpp',
        publishedAt: '2026-06-15T00:00:00Z',
        minEditorVersion: '5.0.0',
        deviceCount: 12,
      },
      {
        version: '0.2.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.stm32-community-0.2.0.vpp',
        publishedAt: '2026-05-28T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 9,
      },
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.stm32-community-0.1.0.vpp',
        publishedAt: '2026-01-30T00:00:00Z',
        minEditorVersion: '3.5.0',
        deviceCount: 3,
      },
    ],
  },
  {
    packageId: 'com.openplc.raspberry-pi',
    name: 'OpenPLC — Raspberry Pi',
    vendor: { name: 'Raspberry Pi', url: 'https://www.raspberrypi.com' },
    description:
      'OpenPLC HAL support for Raspberry Pi hardware: the Raspberry Pi SBC running OpenPLC Runtime v4 (Linux), and the four Pico microcontroller variants (Pico, Pico 2, Pico 2 RISCV, Pico W) compiled via arduino-cli.',
    license: 'GPL-3.0',
    tags: ['raspberry-pi', 'rp2040', 'linux', 'sbc', 'official'],
    versions: [
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.raspberry-pi-0.1.0.vpp',
        publishedAt: '2026-04-15T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 5,
      },
      {
        version: '0.0.7',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.raspberry-pi-0.0.7.vpp',
        publishedAt: '2026-02-04T00:00:00Z',
        minEditorVersion: '3.5.0',
        deviceCount: 4,
      },
    ],
  },
  {
    packageId: 'com.openplc.fx3u-compatible',
    name: 'OpenPLC — FX3U-compatible boards',
    vendor: { name: 'OpenPLC' },
    description:
      'OpenPLC HAL support for FX3U-compatible STM32 F103 boards (generic clones using the serial bootloader programming flow).',
    license: 'GPL-3.0',
    tags: ['fx3u', 'stm32', 'mitsubishi-clone', 'community'],
    // Single-version entry — exercises the dropdown's "1-item" rendering.
    versions: [
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.fx3u-compatible-0.1.0.vpp',
        publishedAt: '2026-04-22T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 3,
      },
    ],
  },
  {
    packageId: 'com.openplc.sequent-microsystems',
    name: 'OpenPLC — Sequent Microsystems',
    vendor: { name: 'Sequent Microsystems', url: 'https://sequentmicrosystems.com' },
    description: 'OpenPLC HAL support for Sequent Microsystems HATs and the RP1-based industrial controller.',
    license: 'GPL-3.0',
    tags: ['sequent-microsystems', 'rp1', 'industrial'],
    versions: [
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.openplc.sequent-microsystems-0.1.0.vpp',
        publishedAt: '2026-05-02T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 1,
      },
    ],
  },
  {
    packageId: 'com.facts-engineering.p1am',
    name: 'OpenPLC — Facts Engineering P1AM',
    vendor: { name: 'Facts Engineering', url: 'https://facts-engineering.com' },
    description:
      'OpenPLC HAL support for the Facts Engineering P1AM-200 industrial controller and its Productivity1000-series I/O modules.',
    license: 'GPL-3.0',
    tags: ['facts-engineering', 'p1am', 'samd', 'industrial', 'partner'],
    versions: [
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.facts-engineering.p1am-0.1.0.vpp',
        publishedAt: '2026-05-10T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 1,
      },
    ],
  },
  {
    packageId: 'com.synergy-logic.slm-rp4',
    name: 'OpenPLC — Synergy Logic SLM-RP4',
    vendor: { name: 'Synergy Logic', url: 'https://synergylogic.com' },
    description: 'OpenPLC HAL support for the Synergy Logic SLM-RP4 industrial controller (ARM64 Linux runtime).',
    license: 'GPL-3.0',
    tags: ['synergy-logic', 'arm64', 'linux', 'industrial', 'partner'],
    versions: [
      {
        version: '0.1.0',
        downloadUrl: 'https://cdn.openplcproject.com/packages/com.synergy-logic.slm-rp4-0.1.0.vpp',
        publishedAt: '2026-05-15T00:00:00Z',
        minEditorVersion: '4.0.0',
        deviceCount: 1,
      },
    ],
  },
]

/**
 * Mock implementation of `PackagePort.listRemoteCatalog` — adds a 200ms
 * delay so the CatalogBrowser's loading state is briefly visible during
 * dev, then returns the canned catalog above.
 */
export async function mockListRemoteCatalog(): Promise<RemoteCatalog> {
  await new Promise((resolve) => setTimeout(resolve, 200))
  return { entries: MOCK_REMOTE_CATALOG, fetchedAt: new Date().toISOString() }
}

/**
 * Mock implementation of `PackagePort.installFromRemote` — never actually
 * installs anything (the local install pipeline is intentionally out of
 * scope for the mock), but resolves with a "backend not wired" error that
 * names the requested `packageId@version` plus the `downloadUrl` so the
 * UI's modal renders the full request the way it would in production.
 */
export async function mockInstallFromRemote(
  packageId: string,
  version: string,
  downloadUrl: string,
): Promise<ImportResult> {
  await new Promise((resolve) => setTimeout(resolve, 150))
  return {
    success: false,
    error: `[mock] Remote install for "${packageId}@${version}" (${downloadUrl}) is not wired — flip USE_LOCAL_MOCK off to hit the real backend.`,
  }
}
