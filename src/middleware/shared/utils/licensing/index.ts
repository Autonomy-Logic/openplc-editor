export { DEMO_MODE_NOTICE, demoModeConsoleLines } from './demo-mode-notice'
export { type LicensingSkipReason, type LicensingTarget, resolveLicensingTarget } from './resolve-licensing-target'
export {
  isRuntimeHardwareId,
  parseRuntimeCommercialLicense,
  parseRuntimeHardwareId,
  type RuntimeCommercialLicense,
  type RuntimeHardwareId,
  type RuntimeHardwareIdSource,
} from './runtime-commercial-license'
export {
  lookupRuntimeLicenses,
  MAX_RUNTIME_LICENSE_BYTES,
  readRuntimeHardwareId,
  RUNTIME_HARDWARE_ID_PATH,
  RUNTIME_LICENSE_LOOKUP_PATH,
  RUNTIME_LICENSE_PRODUCT_ID,
  RUNTIME_LICENSE_UPLOAD_PATH,
  type RuntimeLicenseFile,
  type RuntimeLicenseLookupResult,
  selectRuntimeLicenseFiles,
  syncRuntimeLicenses,
  uploadRuntimeLicense,
} from './runtime-license-sync'
export {
  buildRuntimeLicenseBuyUrl,
  COMMERCIAL_LICENSE_DISCLAIMER,
  commercialLicenseConsoleLines,
  resolveTargetCommercialLicense,
  type TargetCommercialLicenseInput,
  type TargetCommercialLicenseStatus,
} from './target-commercial-license'
