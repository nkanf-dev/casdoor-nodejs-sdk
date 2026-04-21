import { CompanionFilePaths, createEncryptedFileStores } from './nodeFileStore'
import { NodeCompanion } from './nodeCompanion'
import { BindingStore, KeyStore } from './store'
import type { SDK } from '../sdk'

export interface CompanionSession {
  accessToken: string
  userName: string
  displayName?: string
  avatar?: string
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
  fetchImpl?: typeof fetch
}

export interface SessionCompanionRuntime {
  setSession(session: CompanionSession): Promise<void>
  setAccessToken(accessToken: string): Promise<void>
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
