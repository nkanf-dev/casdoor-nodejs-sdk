import * as http from 'http'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createPublicKey, verify } from 'crypto'
import {
  createMemoryBindingStore,
  createMemoryKeyStore,
} from '../src/adapters/electron/main'
import { createEncryptedFileStores } from '../src/companion/nodeFileStore'
import { NodeCompanion } from '../src/companion/nodeCompanion'
import {
  CompanionSession,
  CompanionUserInfo,
  createPersistedCompanionSession,
  PersistedCompanionSessionRuntime,
} from '../src/companion/sessionCompanion'
import type { CreateNodeCompanionOptions } from '../src/companion/bootstrap'

class MemoryStore {
  private readonly values = new Map<string, any>()

  get(key: string) {
    return this.values.get(key)
  }

  set(key: string, value: any) {
    this.values.set(key, value)
  }

  delete(key: string) {
    this.values.delete(key)
  }
}

class FakeCompanion implements PersistedCompanionSessionRuntime {
  public session: CompanionSession | null = null
  public cleared = false

  async setSession(session: CompanionSession): Promise<void> {
    this.session = session
  }

  async setUserInfo(userInfo: CompanionUserInfo): Promise<void> {
    await this.setSession({
      accessToken: userInfo.accessToken || '',
      userName: userInfo.name || '',
      displayName: userInfo.displayName,
      avatar: userInfo.avatar,
    })
  }

  async clearSession(): Promise<void> {
    this.cleared = true
    this.session = null
  }

  async close(): Promise<void> {
    await this.clearSession()
  }
}

test('CreateNodeCompanionOptions keeps the high-level companion API minimal', () => {
  const options: CreateNodeCompanionOptions = {
    baseDir: '/tmp/casdoor',
    serverUrl: 'http://localhost:8000',
    clientId: 'client-id',
  }

  void options
})

test('persisted companion session restores and clears stored login state', async () => {
  const store = new MemoryStore()
  const companion = new FakeCompanion()
  const persistedSession = createPersistedCompanionSession({
    companion,
    store,
  })

  await persistedSession.setUserInfo({
    accessToken: 'token-1',
    name: 'alice',
    displayName: 'Alice',
    avatar: 'https://example.com/avatar.png',
  })

  expect(store.get('casdoor_access_token')).toBe('token-1')
  expect(store.get('userInfo').name).toBe('alice')

  const restoredCompanion = new FakeCompanion()
  const restoredSession = createPersistedCompanionSession({
    companion: restoredCompanion,
    store,
  })
  await restoredSession.restore()
  expect(restoredCompanion.session?.userName).toBe('alice')

  await restoredSession.clear()
  expect(restoredCompanion.cleared).toBe(true)
  expect(store.get('casdoor_access_token')).toBeUndefined()
  expect(store.get('userInfo')).toBeUndefined()
})

test('persisted companion session restores when userInfo already has access token', async () => {
  const store = new MemoryStore()
  const restoredCompanion = new FakeCompanion()
  const restoredSession = createPersistedCompanionSession({
    companion: restoredCompanion,
    store,
  })

  store.set('userInfo', {
    accessToken: 'token-from-user-info',
    name: 'bob',
    displayName: 'Bob',
  })

  await restoredSession.restore()

  expect(restoredCompanion.session?.accessToken).toBe('token-from-user-info')
  expect(restoredCompanion.session?.userName).toBe('bob')
})

test('memory key store signs challenges with Ed25519', async () => {
  const keyStore = createMemoryKeyStore()
  const { publicKey, keyAlgorithm } = await keyStore.ensureKeyPair()
  const signature = await keyStore.signChallenge('challenge-1')

  expect(keyAlgorithm).toBe('Ed25519')
  expect(
    verify(
      null,
      Buffer.from('challenge-1', 'utf8'),
      createPublicKey(publicKey),
      Buffer.from(signature, 'base64url'),
    ),
  ).toBe(true)
})

test('encrypted file store persists, reloads, signs, and clears key pairs', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'casdoor-sdk-'))
  const paths = {
    bindingFile: path.join(tempDir, 'trusted-binding.json'),
    keyFile: path.join(tempDir, 'trusted-key.enc'),
    secretFile: path.join(tempDir, 'trusted-key.secret'),
  }

  try {
    const stores = createEncryptedFileStores(paths)
    const firstKeyPair = await stores.keyStore.ensureKeyPair()
    const reloadedStores = createEncryptedFileStores(paths)
    const secondKeyPair = await reloadedStores.keyStore.ensureKeyPair()
    const signature = await reloadedStores.keyStore.signChallenge('challenge-2')

    expect(secondKeyPair.publicKey).toBe(firstKeyPair.publicKey)
    expect(
      verify(
        null,
        Buffer.from('challenge-2', 'utf8'),
        createPublicKey(firstKeyPair.publicKey),
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true)

    await reloadedStores.keyStore.clearKeyPair()
    const regeneratedKeyPair = await reloadedStores.keyStore.ensureKeyPair()
    expect(regeneratedKeyPair.publicKey).not.toBe(firstKeyPair.publicKey)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('encrypted file store recovers corrupted key material before registering again', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'casdoor-sdk-'))
  const paths = {
    bindingFile: path.join(tempDir, 'trusted-binding.json'),
    keyFile: path.join(tempDir, 'trusted-key.enc'),
    secretFile: path.join(tempDir, 'trusted-key.secret'),
  }

  try {
    const stores = createEncryptedFileStores(paths)
    const firstKeyPair = await stores.keyStore.ensureKeyPair()
    await stores.bindingStore.saveBinding({
      bindingId: 'binding-1',
      clientId: 'client-id',
      userName: 'alice',
      deviceId: 'device-1',
      deviceName: 'Device 1',
      publicKey: firstKeyPair.publicKey,
      keyAlgorithm: 'Ed25519',
    })
    await fs.writeFile(paths.keyFile, 'not-json', 'utf8')

    const recoveredKeyPair = await stores.keyStore.ensureKeyPair()

    expect(recoveredKeyPair.publicKey).not.toBe(firstKeyPair.publicKey)
    expect(await stores.bindingStore.loadBinding()).toBeNull()
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})

test('node companion falls back when the default discovery port is busy', async () => {
  const busyServer = http.createServer()
  const portAvailable = await new Promise<boolean>((resolve, reject) => {
    busyServer.once('error', (error: any) => {
      if (error?.code === 'EADDRINUSE') {
        resolve(false)
        return
      }
      reject(error)
    })
    busyServer.listen(47321, '127.0.0.1', () => resolve(true))
  })

  if (!portAvailable) {
    return
  }

  const companion = new NodeCompanion({
    serverUrl: 'http://localhost:8000',
    clientId: 'client-id',
    bindingStore: createMemoryBindingStore(),
    keyStore: createMemoryKeyStore(),
    getCurrentIdentity: async () => ({ userName: 'alice' }),
    fetchImpl: async () => ({
      async json() {
        return { status: 'ok', bindingId: 'binding-1' }
      },
    }),
  })

  try {
    await expect(companion.enable()).resolves.toBeUndefined()
  } finally {
    await companion.close()
    await new Promise<void>((resolve, reject) => {
      busyServer.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
