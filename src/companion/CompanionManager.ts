import { CompanionAdapter, DiscoveryHandler } from './types'
import { TrustedBindingRecord } from './store'

export class CompanionManager {
  constructor(
    private readonly adapter: CompanionAdapter,
    private readonly options: {
      clientId: string
      registerTrustedBinding: (input: {
        clientId: string
        deviceId: string
        deviceName: string
        publicKey: string
        keyAlgorithm: 'Ed25519'
      }) => Promise<{ status?: string; bindingId?: string; msg?: string }>
      inspectDiscoveryToken: (input: {
        discoveryToken: string
        clientId: string
      }) => Promise<{ status?: string; msg?: string }>
    },
  ) {}

  public async enable(): Promise<void> {
    const runtime = await this.adapter.getRuntimeInfo()
    if (!runtime.canCompanion) {
      throw new Error('companion runtime unavailable')
    }

    const identity = await this.adapter.getCurrentIdentity()
    let binding = await this.adapter.bindingStore.loadBinding()

    if (
      binding &&
      (binding.clientId !== this.options.clientId ||
        binding.userName !== identity.userName)
    ) {
      await this.adapter.bindingStore.clearBinding()
      binding = null
    }

    if (!binding) {
      const keyPair = await this.adapter.keyStore.ensureKeyPair()
      const response = await this.options.registerTrustedBinding({
        clientId: this.options.clientId,
        deviceId: runtime.deviceId,
        deviceName: runtime.deviceName,
        publicKey: keyPair.publicKey,
        keyAlgorithm: keyPair.keyAlgorithm,
      })

      if (response.status !== 'ok' || !response.bindingId) {
        throw new Error(response.msg || 'failed to register trusted binding')
      }

      binding = {
        bindingId: response.bindingId,
        clientId: this.options.clientId,
        userName: identity.userName,
        deviceId: runtime.deviceId,
        deviceName: runtime.deviceName,
        publicKey: keyPair.publicKey,
        keyAlgorithm: keyPair.keyAlgorithm,
      }
      await this.adapter.bindingStore.saveBinding(binding)
    }

    await this.adapter.stopLocalDiscoveryServer()
    await this.adapter.startLocalDiscoveryServer(
      this.buildDiscoveryHandler(binding),
    )
  }

  private buildDiscoveryHandler(
    binding: TrustedBindingRecord,
  ): DiscoveryHandler {
    return {
      getIdentity: async (
        input,
      ): Promise<{
        available: boolean
        bindingId?: string
        userName?: string
        displayName?: string
        avatar?: string
      }> => {
        if (!input.discoveryToken || input.clientId !== binding.clientId) {
          return { available: false }
        }

        const inspection = await this.options.inspectDiscoveryToken({
          discoveryToken: input.discoveryToken,
          clientId: input.clientId,
        })
        if (inspection.status !== 'ok') {
          return { available: false }
        }

        const identity = await this.adapter.getCurrentIdentity()
        if (!identity.userName || identity.userName !== binding.userName) {
          return { available: false }
        }

        return {
          available: true,
          bindingId: binding.bindingId,
          userName: identity.userName,
          displayName: identity.displayName,
          avatar: identity.avatar,
        }
      },
      signChallenge: async (input: {
        challenge: string
        bindingId: string
        applicationName?: string
      }): Promise<{ signature: string }> => {
        if (input.bindingId !== binding.bindingId) {
          throw new Error('binding mismatch')
        }

        const identity = await this.adapter.getCurrentIdentity()
        const approved = await this.adapter.approveQuickLogin?.({
          applicationName: input.applicationName,
          userName: identity.userName,
          displayName: identity.displayName,
        })
        if (!approved) {
          throw new Error('quick login was denied')
        }

        return {
          signature: await this.adapter.keyStore.signChallenge(input.challenge),
        }
      },
    }
  }
}
