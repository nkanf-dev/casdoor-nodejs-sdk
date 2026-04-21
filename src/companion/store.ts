export interface TrustedBindingRecord {
  bindingId: string
  clientId: string
  userName: string
  deviceId: string
  deviceName: string
  publicKey: string
  keyAlgorithm: 'Ed25519'
}

export interface BindingStore {
  loadBinding(): Promise<TrustedBindingRecord | null>
  saveBinding(binding: TrustedBindingRecord): Promise<void>
  clearBinding(): Promise<void>
}

export interface KeyStore {
  ensureKeyPair(): Promise<{ publicKey: string; keyAlgorithm: 'Ed25519' }>
  signChallenge(challenge: string): Promise<string>
  clearKeyPair(): Promise<void>
}
