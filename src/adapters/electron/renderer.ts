import { CompanionAdapter, DiscoveryHandler } from '../../companion/types'

export const defaultElectronCompanionBridgeKey = 'casdoorElectronCompanion'

export type ElectronCompanionBridge = CompanionAdapter

export function getElectronCompanionBridge(
  bridgeKey: string = defaultElectronCompanionBridgeKey,
): ElectronCompanionBridge {
  const bridge = (globalThis as unknown as Record<string, unknown>)[
    bridgeKey
  ] as ElectronCompanionBridge | undefined
  if (!bridge) {
    throw new Error(
      `Electron companion bridge "${bridgeKey}" was not found on globalThis`,
    )
  }

  return bridge
}

export class ElectronCompanionAdapter implements CompanionAdapter {
  constructor(
    private readonly bridge: ElectronCompanionBridge = getElectronCompanionBridge(),
  ) {}

  public get bindingStore() {
    return this.bridge.bindingStore
  }

  public get keyStore() {
    return this.bridge.keyStore
  }

  public getRuntimeInfo(): Promise<{
    platform: string
    deviceId: string
    deviceName: string
    canCompanion: boolean
  }> {
    return this.bridge.getRuntimeInfo()
  }

  public getCurrentIdentity(): Promise<{
    userName: string
    displayName?: string
    avatar?: string
  }> {
    return this.bridge.getCurrentIdentity()
  }

  public startLocalDiscoveryServer(
    handler: DiscoveryHandler,
  ): Promise<{ port: number }> {
    return this.bridge.startLocalDiscoveryServer(handler)
  }

  public stopLocalDiscoveryServer(): Promise<void> {
    return this.bridge.stopLocalDiscoveryServer()
  }
}
