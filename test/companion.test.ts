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

  expect(options).toBeDefined()
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
