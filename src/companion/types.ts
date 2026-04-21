import { BindingStore, KeyStore, TrustedBindingRecord } from './store'

export interface DiscoveryIdentity {
  available: boolean
  userName?: string
  displayName?: string
  avatar?: string
  bindingId?: string
}

export interface DiscoveryHandler {
  getIdentity(input: {
    discoveryToken: string
    clientId: string
  }): Promise<DiscoveryIdentity>
  signChallenge(input: {
    challenge: string
    bindingId: string
  }): Promise<{ signature: string }>
}

export interface CompanionAdapter {
  bindingStore: BindingStore
  keyStore: KeyStore
  getRuntimeInfo(): Promise<{
    platform: string
    deviceId: string
    deviceName: string
    canCompanion: boolean
  }>
  getCurrentIdentity(): Promise<{
    userName: string
    displayName?: string
    avatar?: string
  }>
  startLocalDiscoveryServer(
    handler: DiscoveryHandler,
  ): Promise<{ port: number }>
  stopLocalDiscoveryServer(): Promise<void>
}

export type TrustedBinding = TrustedBindingRecord
