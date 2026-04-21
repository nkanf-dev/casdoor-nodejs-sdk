export {
  ElectronCompanionAdapter,
  defaultElectronCompanionBridgeKey,
  getElectronCompanionBridge,
} from './adapters/electron/renderer'
export type { ElectronCompanionBridge } from './adapters/electron/renderer'
export { exposeElectronCompanionBridge } from './adapters/electron/preload'
export type { ContextBridgeLike } from './adapters/electron/preload'
export {
  createElectronCompanionBridge,
  createElectronCompanionStores,
  createMemoryBindingStore,
  createMemoryKeyStore,
  resolveCompanionPaths,
} from './adapters/electron/main'
export type {
  ElectronBindingStore,
  ElectronCompanionPathOptions,
} from './adapters/electron/main'
