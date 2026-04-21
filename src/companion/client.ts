export interface CompanionClientOptions {
  serverUrl: string
  clientId: string
  accessToken?: string | (() => string | null | undefined)
  fetchImpl?: typeof fetch
}

export class CompanionClient {
  constructor(private readonly options: CompanionClientOptions) {}

  private getFetch(): typeof fetch {
    return this.options.fetchImpl || fetch
  }

  private getAccessToken(): string {
    const accessToken = this.options.accessToken
    if (typeof accessToken === 'function') {
      return accessToken() || ''
    }
    return accessToken || ''
  }

  private getRequestOptions(
    method: string,
    headers: Record<string, string> = {},
    body?: string,
  ): RequestInit {
    const accessToken = this.getAccessToken()
    const requestHeaders: Record<string, string> = {
      ...headers,
    }

    if (accessToken !== '') {
      requestHeaders.Authorization = `Bearer ${accessToken}`
    }

    return {
      method,
      credentials: 'include',
      headers: requestHeaders,
      body,
    }
  }

  public async registerTrustedDeviceBinding(input: {
    clientId: string
    deviceId: string
    deviceName: string
    publicKey: string
    keyAlgorithm: string
  }): Promise<{ status?: string; bindingId?: string; msg?: string }> {
    const params = new URLSearchParams({
      clientId: input.clientId,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      publicKey: input.publicKey,
      keyAlgorithm: input.keyAlgorithm,
    })

    return this.getFetch()(
      `${this.options.serverUrl.trim()}/api/device-auth/trusted-binding/register`,
      this.getRequestOptions(
        'POST',
        {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        params.toString(),
      ),
    ).then((res) => res.json())
  }

  public async inspectDiscoveryToken(
    discoveryToken: string,
    clientId: string,
  ): Promise<{ status?: string; msg?: string }> {
    return this.getFetch()(
      `${this.options.serverUrl.trim()}/api/device-auth/discovery-token/inspect?discoveryToken=${encodeURIComponent(
        discoveryToken,
      )}&clientId=${encodeURIComponent(clientId)}`,
      this.getRequestOptions('POST'),
    ).then((res) => res.json())
  }
}
