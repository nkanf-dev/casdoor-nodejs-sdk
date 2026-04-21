import * as http from 'http'
import * as os from 'os'
import { CompanionManager } from './CompanionManager'
import { CompanionClient } from './client'
import { BindingStore, KeyStore } from './store'
import { CompanionAdapter, DiscoveryHandler } from './types'

export interface NodeCompanionOptions {
  serverUrl: string
  clientId: string
  accessToken?: string | (() => string | null | undefined)
  bindingStore: BindingStore
  keyStore: KeyStore
  getCurrentIdentity(): Promise<{
    userName: string
    displayName?: string
    avatar?: string
  }>
  deviceId?: string
  deviceName?: string
  port?: number
  allowedOrigins?: string[]
  fetchImpl?: typeof fetch
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let rawBody = ''
    req.on('data', (chunk) => {
      rawBody += chunk.toString('utf8')
    })
    req.on('end', () => {
      if (rawBody === '') {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(rawBody))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function setCorsHeaders(origin: string, res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')
}

function resolveAllowedOrigins(
  serverUrl: string,
  allowedOrigins: string[] = [],
): Set<string> {
  const origins = new Set<string>()
  origins.add(new URL(serverUrl).origin)
  for (const origin of allowedOrigins) {
    origins.add(new URL(origin).origin)
  }
  return origins
}

export class NodeCompanion {
  private readonly client: CompanionClient
  private readonly allowedOrigins: Set<string>
  private server?: http.Server
  private port?: number
  private discoveryHandler?: DiscoveryHandler

  constructor(private readonly options: NodeCompanionOptions) {
    this.client = new CompanionClient({
      serverUrl: options.serverUrl,
      clientId: options.clientId,
      accessToken: options.accessToken,
      fetchImpl: options.fetchImpl,
    })
    this.allowedOrigins = resolveAllowedOrigins(
      options.serverUrl,
      options.allowedOrigins,
    )
  }

  public async enable(): Promise<void> {
    const adapter: CompanionAdapter = {
      bindingStore: this.options.bindingStore,
      keyStore: this.options.keyStore,
      getRuntimeInfo: async () => ({
        platform: os.platform(),
        deviceId: this.options.deviceId || os.hostname(),
        deviceName: this.options.deviceName || os.hostname(),
        canCompanion: true,
      }),
      getCurrentIdentity: this.options.getCurrentIdentity,
      startLocalDiscoveryServer: async (handler) =>
        this.startLocalDiscoveryServer(handler),
      stopLocalDiscoveryServer: async () => this.stopLocalDiscoveryServer(),
    }

    const manager = new CompanionManager(adapter, {
      clientId: this.options.clientId,
      registerTrustedBinding: async (input) =>
        this.client.registerTrustedDeviceBinding(input),
      inspectDiscoveryToken: async (input) =>
        this.client.inspectDiscoveryToken(input.discoveryToken, input.clientId),
    })

    await manager.enable()
  }

  public async close(): Promise<void> {
    await this.stopLocalDiscoveryServer()
  }

  private async startLocalDiscoveryServer(
    handler: DiscoveryHandler,
  ): Promise<{ port: number }> {
    this.discoveryHandler = handler
    if (this.server && this.port) {
      return { port: this.port }
    }

    const preferredPort = this.options.port || 47321
    this.server = http.createServer(async (req, res) => {
      try {
        const origin = req.headers.origin
        if (origin) {
          if (!this.allowedOrigins.has(origin)) {
            writeJson(res, 403, {
              available: false,
              msg: 'origin not allowed',
            })
            return
          }

          setCorsHeaders(origin, res)
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method !== 'POST' || !req.url) {
          writeJson(res, 404, { available: false })
          return
        }

        const currentHandler = this.discoveryHandler
        if (!currentHandler) {
          writeJson(res, 503, { available: false })
          return
        }

        const body = await readJsonBody(req)
        if (req.url === '/discover') {
          const result = await currentHandler.getIdentity({
            discoveryToken: body.discoveryToken,
            clientId: body.clientId,
          })
          writeJson(res, 200, result)
          return
        }

        if (req.url === '/sign-challenge') {
          const result = await currentHandler.signChallenge({
            challenge: body.challenge,
            bindingId: body.bindingId,
          })
          writeJson(res, 200, result)
          return
        }

        writeJson(res, 404, { available: false })
      } catch (error: any) {
        writeJson(res, 500, {
          available: false,
          msg: error?.message || 'node companion request failed',
        })
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(preferredPort, '127.0.0.1', () => {
        this.server!.off('error', reject)
        resolve()
      })
    })

    this.port = preferredPort
    return { port: preferredPort }
  }

  private async stopLocalDiscoveryServer(): Promise<void> {
    if (!this.server) {
      return
    }

    const server = this.server
    this.server = undefined
    this.port = undefined
    this.discoveryHandler = undefined

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}
