import { CompanionFilePaths, createEncryptedFileStores } from './nodeFileStore'
import { NodeCompanion } from './nodeCompanion'
import { BindingStore, KeyStore } from './store'
import type { SDK } from '../sdk'
import { CompanionFetch } from './client'

export interface CompanionSession {
  accessToken: string
  userName: string
  displayName?: string
  avatar?: string
}

export interface CompanionUserInfo {
  accessToken?: string
  name?: string
  preferred_username?: string
  displayName?: string
  display_name?: string
  avatar?: string
  picture?: string
}

export interface CompanionSessionStore {
  get(key: string): any
  set(key: string, value: any): void
  delete(key: string): void
}

export interface PersistedCompanionSessionRuntime {
  setSession(session: CompanionSession): Promise<void>
  setUserInfo(userInfo: CompanionUserInfo): Promise<void>
  clearSession(): Promise<void>
  close(): Promise<void>
}

export interface PersistedCompanionSessionOptions {
  companion: PersistedCompanionSessionRuntime
  store: CompanionSessionStore
  userInfoKey?: string
  accessTokenKey?: string
  codeKey?: string
}

export interface SessionCompanionOptions {
  serverUrl: string
  clientId: string
  bindingStore: BindingStore
  keyStore: KeyStore
  sdk?: Pick<SDK, 'parseJwtToken'>
  deviceId?: string
  deviceName?: string
  port?: number
  allowedOrigins?: string[]
  fetchImpl?: CompanionFetch
  approveQuickLogin?: (input: {
    applicationName?: string
    userName: string
    displayName?: string
  }) => Promise<boolean>
}

export interface SessionCompanionRuntime {
  setSession(session: CompanionSession): Promise<void>
  setAccessToken(accessToken: string): Promise<void>
  setUserInfo(userInfo: CompanionUserInfo): Promise<void>
  clearSession(): Promise<void>
  close(): Promise<void>
}

export class SessionCompanion implements SessionCompanionRuntime {
  private session: CompanionSession | null = null
  private enabled = false
  private readonly companion: NodeCompanion

  constructor(private readonly options: SessionCompanionOptions) {
    this.companion = new NodeCompanion({
      serverUrl: options.serverUrl,
      clientId: options.clientId,
      accessToken: () => this.session?.accessToken || '',
      bindingStore: options.bindingStore,
      keyStore: options.keyStore,
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      port: options.port,
      allowedOrigins: options.allowedOrigins,
      fetchImpl: options.fetchImpl,
      approveQuickLogin: options.approveQuickLogin,
      getCurrentIdentity: async () => {
        if (!this.session) {
          throw new Error('companion session unavailable')
        }

        return {
          userName: this.session.userName,
          displayName: this.session.displayName || this.session.userName,
          avatar: this.session.avatar || '',
        }
      },
    })
  }

  public async setSession(session: CompanionSession): Promise<void> {
    const previousUser = this.session?.userName
    const nextUser = session.userName
    const userChanged = previousUser !== undefined && previousUser !== nextUser

    if (userChanged) {
      await this.resetBindingState()
    }

    this.session = session
    if (!this.enabled) {
      await this.companion.enable()
      this.enabled = true
    }
  }

  public async setUserInfo(userInfo: CompanionUserInfo): Promise<void> {
    const session = companionSessionFromUserInfo(userInfo)
    await this.setSession(session)
  }

  public async setAccessToken(accessToken: string): Promise<void> {
    if (!this.options.sdk) {
      throw new Error(
        'companion sdk.parseJwtToken() is required for setAccessToken()',
      )
    }

    const user = this.options.sdk.parseJwtToken(accessToken) as {
      name?: string
      displayName?: string
      avatar?: string
    }
    if (!user?.name) {
      throw new Error('unable to derive companion identity from access token')
    }

    await this.setSession({
      accessToken,
      userName: user.name,
      displayName: user.displayName || user.name,
      avatar: user.avatar || '',
    })
  }

  public async clearSession(): Promise<void> {
    this.session = null
    if (!this.enabled) {
      return
    }

    await this.companion.close()
    this.enabled = false
  }

  public async close(): Promise<void> {
    await this.clearSession()
  }

  private async resetBindingState(): Promise<void> {
    if (this.enabled) {
      await this.companion.close()
      this.enabled = false
    }

    await this.options.bindingStore.clearBinding()
    await this.options.keyStore.clearKeyPair()
  }
}

export class PersistedCompanionSession {
  private readonly userInfoKey: string
  private readonly accessTokenKey: string
  private readonly codeKey: string

  constructor(private readonly options: PersistedCompanionSessionOptions) {
    this.userInfoKey = options.userInfoKey || 'userInfo'
    this.accessTokenKey = options.accessTokenKey || 'casdoor_access_token'
    this.codeKey = options.codeKey || 'casdoor_code'
  }

  public async restore(): Promise<void> {
    const userInfo = this.options.store.get(this.userInfoKey) as
      | CompanionUserInfo
      | undefined
    const storedAccessToken = this.options.store.get(this.accessTokenKey) as
      | string
      | undefined
    if (!userInfo) {
      return
    }

    const accessToken = userInfo.accessToken || storedAccessToken
    if (!accessToken) {
      return
    }

    await this.options.companion.setUserInfo({
      ...userInfo,
      accessToken,
    })
  }

  public async setUserInfo(userInfo: CompanionUserInfo): Promise<void> {
    const session = companionSessionFromUserInfo(userInfo)
    this.options.store.set(this.userInfoKey, userInfo)
    this.options.store.set(this.accessTokenKey, session.accessToken)
    await this.options.companion.setSession(session)
  }

  public async clear(): Promise<void> {
    await this.options.companion.clearSession()
    this.options.store.delete(this.accessTokenKey)
    this.options.store.delete(this.userInfoKey)
    this.options.store.delete(this.codeKey)
  }

  public async close(): Promise<void> {
    await this.options.companion.close()
  }
}

export function companionSessionFromUserInfo(
  userInfo: CompanionUserInfo,
): CompanionSession {
  if (!userInfo.accessToken) {
    throw new Error('companion userInfo.accessToken is required')
  }

  const userName = userInfo.preferred_username || userInfo.name
  if (!userName) {
    throw new Error('companion userInfo name is required')
  }

  return {
    accessToken: userInfo.accessToken,
    userName,
    displayName:
      userInfo.displayName ||
      userInfo.display_name ||
      userInfo.name ||
      userInfo.preferred_username,
    avatar: userInfo.avatar || userInfo.picture || '',
  }
}

export function createSessionCompanionFromPaths(
  paths: CompanionFilePaths,
  options: Omit<SessionCompanionOptions, 'bindingStore' | 'keyStore'>,
): SessionCompanion {
  const { bindingStore, keyStore } = createEncryptedFileStores(paths)
  return new SessionCompanion({
    ...options,
    bindingStore,
    keyStore,
  })
}

export function createPersistedCompanionSession(
  options: PersistedCompanionSessionOptions,
): PersistedCompanionSession {
  return new PersistedCompanionSession(options)
}
