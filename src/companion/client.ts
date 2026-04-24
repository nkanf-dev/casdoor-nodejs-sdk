import * as http from 'http'
import * as https from 'https'

export interface CompanionFetchResponse {
  ok?: boolean
  status?: number
  json(): Promise<any>
}

export type CompanionFetch = (
  url: string,
  options?: RequestInit,
) => Promise<CompanionFetchResponse>

export interface CompanionClientOptions {
  serverUrl: string
  clientId: string
  accessToken?: string | (() => string | null | undefined)
  fetchImpl?: CompanionFetch
}

export class CompanionClient {
  constructor(private readonly options: CompanionClientOptions) {}

  private getFetch(): CompanionFetch {
    if (this.options.fetchImpl) {
      return this.options.fetchImpl
    }
    if (typeof fetch === 'function') {
      return fetch as CompanionFetch
    }

    return nodeHttpFetch
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
    keyAlgorithm: 'Ed25519'
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
      `${this.options.serverUrl.trim()}/api/quick-login/discovery-token/inspect?discoveryToken=${encodeURIComponent(
        discoveryToken,
      )}&clientId=${encodeURIComponent(clientId)}`,
      this.getRequestOptions('POST'),
    ).then((res) => res.json())
  }
}

function nodeHttpFetch(
  requestUrl: string,
  options: RequestInit = {},
): Promise<CompanionFetchResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(requestUrl)
    const transport = parsedUrl.protocol === 'https:' ? https : http
    const body = typeof options.body === 'string' ? options.body : undefined
    const request = transport.request(
      parsedUrl,
      {
        method: options.method || 'GET',
        headers: {
          ...(options.headers as Record<string, string> | undefined),
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (response) => {
        let rawBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          rawBody += chunk
        })
        response.on('end', () => {
          resolve({
            ok:
              response.statusCode !== undefined &&
              response.statusCode >= 200 &&
              response.statusCode < 300,
            status: response.statusCode,
            async json(): Promise<any> {
              return rawBody === '' ? {} : JSON.parse(rawBody)
            },
          })
        })
      },
    )

    request.on('error', reject)
    if (body) {
      request.write(body)
    }
    request.end()
  })
}
