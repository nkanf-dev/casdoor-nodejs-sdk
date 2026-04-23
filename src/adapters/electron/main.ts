import * as path from 'path'
import { generateKeyPairSync, KeyObject, sign } from 'crypto'
import { KeyStore, TrustedBindingRecord } from '../../companion/store'
import {
  CompanionFilePaths,
  createEncryptedFileStores,
} from '../../companion/nodeFileStore'
import { ElectronCompanionBridge } from './renderer'

export interface ElectronBindingStore {
  loadBinding(): Promise<TrustedBindingRecord | null>
  saveBinding(binding: TrustedBindingRecord): Promise<void>
  clearBinding(): Promise<void>
}

export interface ElectronCompanionPathOptions {
  baseDir?: string
  bindingFile?: string
  keyFile?: string
  secretFile?: string
}

export function resolveCompanionPaths(
  options: ElectronCompanionPathOptions,
): CompanionFilePaths {
  if (options.bindingFile && options.keyFile && options.secretFile) {
    return {
      bindingFile: options.bindingFile,
      keyFile: options.keyFile,
      secretFile: options.secretFile,
    }
  }

  if (!options.baseDir) {
    throw new Error(
      'host-provided baseDir or explicit companion file paths are required',
    )
  }

  const companionDir = path.join(options.baseDir, 'casdoor')
  return {
    bindingFile: path.join(companionDir, 'trusted-binding.json'),
    keyFile: path.join(companionDir, 'trusted-key.enc'),
    secretFile: path.join(companionDir, 'trusted-key.secret'),
  }
}

export function createElectronCompanionStores(
  options: ElectronCompanionPathOptions,
): {
  bindingStore: ElectronBindingStore
  keyStore: KeyStore
} {
  const stores = createEncryptedFileStores(resolveCompanionPaths(options))
  return {
    bindingStore: stores.bindingStore,
    keyStore: stores.keyStore,
  }
}

export function createMemoryBindingStore(
  initialBinding: TrustedBindingRecord | null = null,
): ElectronBindingStore {
  let binding = initialBinding

  return {
    async loadBinding(): Promise<TrustedBindingRecord | null> {
      return binding
    },
    async saveBinding(nextBinding: TrustedBindingRecord): Promise<void> {
      binding = nextBinding
    },
    async clearBinding(): Promise<void> {
      binding = null
    },
  }
}

export function createMemoryKeyStore(): KeyStore {
  let keyPair = createMemoryKeyPair()

  return {
    async ensureKeyPair(): Promise<{
      publicKey: string
      keyAlgorithm: 'Ed25519'
    }> {
      return { publicKey: keyPair.publicKeyPem, keyAlgorithm: 'Ed25519' }
    },
    async signChallenge(challenge: string): Promise<string> {
      const signature = sign(
        null,
        Buffer.from(challenge, 'utf8'),
        keyPair.privateKey,
      )
      return signature.toString('base64url')
    },
    async clearKeyPair(): Promise<void> {
      keyPair = createMemoryKeyPair()
    },
  }
}

function createMemoryKeyPair(): {
  publicKeyPem: string
  privateKey: KeyObject
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  }
}

export function createElectronCompanionBridge(
  bridge: ElectronCompanionBridge,
): ElectronCompanionBridge {
  return bridge
}
