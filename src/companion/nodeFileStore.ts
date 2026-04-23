import { promises as fs } from 'fs'
import * as path from 'path'
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'crypto'
import { BindingStore, KeyStore, TrustedBindingRecord } from './store'

export interface CompanionFilePaths {
  bindingFile: string
  keyFile: string
  secretFile: string
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return JSON.parse(text) as T
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath)
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function decodeSecretFile(secretFile: string, encoded: string): Buffer {
  const normalized = encoded.trim()
  const secret = Buffer.from(normalized, 'base64')

  if (
    normalized === '' ||
    secret.length !== 32 ||
    secret.toString('base64') !== normalized
  ) {
    throw new Error(
      `invalid companion secret file "${secretFile}": expected a base64-encoded 32-byte key`,
    )
  }

  return secret
}

async function readOrCreateSecret(secretFile: string): Promise<Buffer> {
  try {
    const encoded = await fs.readFile(secretFile, 'utf8')
    return decodeSecretFile(secretFile, encoded)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error
    }

    const secret = randomBytes(32)
    await ensureParentDir(secretFile)
    await fs.writeFile(secretFile, secret.toString('base64'), {
      encoding: 'utf8',
      mode: 0o600,
    })
    return secret
  }
}

function encryptPrivateKey(privateKeyPem: string, secret: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret, iv)
  const encrypted = Buffer.concat([
    cipher.update(privateKeyPem, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  })
}

function decryptPrivateKey(payload: string, secret: Buffer): string {
  const parsed = JSON.parse(payload) as {
    iv: string
    tag: string
    ciphertext: string
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    secret,
    Buffer.from(parsed.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

function isRecoverableKeyStoreError(error: any): boolean {
  return (
    error instanceof SyntaxError ||
    error?.code === 'ERR_OSSL_BAD_DECRYPT' ||
    error?.code === 'ERR_OSSL_EVP_BAD_DECRYPT' ||
    error?.code === 'ERR_CRYPTO_INVALID_AUTH_TAG' ||
    error?.message?.includes('unable to authenticate data') ||
    error?.message?.startsWith('invalid companion secret file')
  )
}

export function createEncryptedFileStores(paths: CompanionFilePaths): {
  bindingStore: BindingStore
  keyStore: KeyStore
} {
  const bindingStore: BindingStore = {
    async loadBinding(): Promise<TrustedBindingRecord | null> {
      return readJsonFile<TrustedBindingRecord>(paths.bindingFile)
    },
    async saveBinding(binding: TrustedBindingRecord): Promise<void> {
      await writeJsonFile(paths.bindingFile, binding)
    },
    async clearBinding(): Promise<void> {
      await fs.rm(paths.bindingFile, { force: true })
    },
  }

  const keyStore: KeyStore = {
    async ensureKeyPair(): Promise<{
      publicKey: string
      keyAlgorithm: 'Ed25519'
    }> {
      let secret: Buffer
      try {
        secret = await readOrCreateSecret(paths.secretFile)
        const encryptedPayload = await fs.readFile(paths.keyFile, 'utf8')
        const privateKeyPem = decryptPrivateKey(encryptedPayload, secret)
        const publicKey = createPublicKey(createPrivateKey(privateKeyPem))
          .export({
            type: 'spki',
            format: 'pem',
          })
          .toString()

        return { publicKey, keyAlgorithm: 'Ed25519' }
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          if (!isRecoverableKeyStoreError(error)) {
            throw error
          }
          await fs.rm(paths.keyFile, { force: true })
          await fs.rm(paths.secretFile, { force: true })
          await fs.rm(paths.bindingFile, { force: true })
          return keyStore.ensureKeyPair()
        }
        secret = await readOrCreateSecret(paths.secretFile)
      }

      const { publicKey, privateKey } = generateKeyPairSync('ed25519')
      const publicKeyPem = publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString()
      const privateKeyPem = privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString()
      const encryptedPayload = encryptPrivateKey(privateKeyPem, secret)

      await ensureParentDir(paths.keyFile)
      await fs.writeFile(paths.keyFile, encryptedPayload, {
        encoding: 'utf8',
        mode: 0o600,
      })

      return { publicKey: publicKeyPem, keyAlgorithm: 'Ed25519' }
    },
    async signChallenge(challenge: string): Promise<string> {
      const secret = await readOrCreateSecret(paths.secretFile)
      const encryptedPayload = await fs.readFile(paths.keyFile, 'utf8')
      const privateKeyPem = decryptPrivateKey(encryptedPayload, secret)
      const signature = sign(
        null,
        Buffer.from(challenge, 'utf8'),
        createPrivateKey(privateKeyPem),
      )

      return signature.toString('base64url')
    },
    async clearKeyPair(): Promise<void> {
      await fs.rm(paths.keyFile, { force: true })
      await fs.rm(paths.secretFile, { force: true })
    },
  }

  return { bindingStore, keyStore }
}
