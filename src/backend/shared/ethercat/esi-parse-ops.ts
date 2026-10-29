/**
 * The one entry point every ESI parsing thread runs (the web's Web Worker, the
 * desktop's main process). It forwards the parser's result as-is: a thread
 * must never pick fields out of it, or a field added to the parser would be
 * dropped on that platform.
 */

import type { EsiParseOp, EsiParseResult } from '@root/middleware/shared/ports/esi-repository-mechanisms'

import { parseESIDeviceFull, parseESILight, parseESIModuleFull } from './esi-parser-main'

export function runEsiParseOp<T extends EsiParseOp>(request: T): EsiParseResult<T> {
  switch (request.op) {
    case 'light':
      return parseESILight(request.xml, request.filename) as EsiParseResult<T>
    case 'deviceFull':
      return parseESIDeviceFull(request.xml, request.deviceIndex) as EsiParseResult<T>
    case 'modules':
      return parseESIModuleFull(request.xml) as EsiParseResult<T>
  }
}
