import {
  ElectronCompanionBridge,
  defaultElectronCompanionBridgeKey,
} from './renderer'

export interface ContextBridgeLike {
  exposeInMainWorld(key: string, api: unknown): void
}

declare global {
  interface Window {
    casdoorElectronCompanion?: ElectronCompanionBridge
  }
}

export function exposeElectronCompanionBridge(
  contextBridge: ContextBridgeLike,
  bridge: ElectronCompanionBridge,
  bridgeKey: string = defaultElectronCompanionBridgeKey,
): ElectronCompanionBridge {
  contextBridge.exposeInMainWorld(bridgeKey, bridge)
  return bridge
}
