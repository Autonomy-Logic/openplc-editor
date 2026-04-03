export enum ModbusFunctionCode {
  DEBUG_INFO = 0x41,
  DEBUG_SET = 0x42,
  DEBUG_GET = 0x43,
  DEBUG_GET_LIST = 0x44,
  DEBUG_GET_MD5 = 0x45,
}

export enum ModbusDebugResponse {
  SUCCESS = 0x7e,
  ERROR_OUT_OF_BOUNDS = 0x81,
  ERROR_OUT_OF_MEMORY = 0x82,
}
