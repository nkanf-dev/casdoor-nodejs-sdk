import * as http from 'http'
import * as os from 'os'
import { CompanionManager } from './CompanionManager'
import { CompanionClient, CompanionFetch } from './client'
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
  approveQuickLogin?(input: {
    applicationName?: string
    userName: string
    displayName?: string
  }): Promise<boolean>
  deviceId?: string
  deviceName?: string
  port?: number
  allowedOrigins?: string[]
  fetchImpl?: CompanionFetch
}

const maxDiscoveryBodyBytes = 4096

class DiscoveryHttpError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let rawBody = ''
    req.on('data', (chunk) => {
      rawBody += chunk.toString('utf8')
      if (Buffer.byteLength(rawBody, 'utf8') > maxDiscoveryBodyBytes) {
        reject(new DiscoveryHttpError('request body too large', 413))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (rawBody === '') {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(rawBody))
      } catch (error) {
        reject(new DiscoveryHttpError('invalid JSON request body', 400))
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

function getServerPort(server: http.Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('unable to resolve node companion server port')
  }
  return address.port
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(getServerPort(server))
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
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
      approveQuickLogin: this.options.approveQuickLogin,
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

    const preferredPort = this.options.port ?? 47321
    const server = http.createServer(async (req, res) => {
      try {
        const origin = req.headers.origin
        if (!origin || !this.allowedOrigins.has(origin)) {
          writeJson(res, 403, {
            available: false,
            msg: 'origin not allowed',
          })
          return
        }

        setCorsHeaders(origin, res)

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
            applicationName: body.applicationName,
          })
          writeJson(res, 200, result)
          return
        }

        writeJson(res, 404, { available: false })
      } catch (error: any) {
        this.writeRequestError(error, res)
      }
    })

    try {
      this.port = await listen(server, preferredPort)
    } catch (error: any) {
      if (preferredPort !== 0 && error?.code === 'EADDRINUSE') {
        this.port = await listen(server, 0)
      } else {
        throw error
      }
    }

    this.server = server
    return { port: this.port }
  }

  private writeRequestError(error: any, res: http.ServerResponse): void {
    if (error instanceof DiscoveryHttpError) {
      writeJson(res, error.statusCode, {
        available: false,
        msg: error.message,
      })
      return
    }

    writeJson(res, 500, {
      available: false,
      msg: error?.message || 'node companion request failed',
    })
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
