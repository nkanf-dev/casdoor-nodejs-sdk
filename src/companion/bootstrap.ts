import * as path from 'path'
import { CompanionFilePaths } from './nodeFileStore'
import { NodeCompanionOptions } from './nodeCompanion'
import {
  CompanionSession,
  createSessionCompanionFromPaths,
  SessionCompanion,
  SessionCompanionOptions,
} from './sessionCompanion'

export interface CompanionPathOptions {
  baseDir?: string
  bindingFile?: string
  keyFile?: string
  secretFile?: string
}

export type CreateNodeCompanionOptions = CompanionPathOptions &
  Omit<
    NodeCompanionOptions,
    'bindingStore' | 'keyStore' | 'getCurrentIdentity' | 'accessToken'
  > &
  Pick<SessionCompanionOptions, 'sdk'>

export type CreateElectronMainCompanionOptions = CreateNodeCompanionOptions

export function resolveNodeCompanionPaths(
  options: CompanionPathOptions,
): CompanionFilePaths {
  if (options.bindingFile && options.keyFile && options.secretFile) {
    return {
      bindingFile: options.bindingFile,
      keyFile: options.keyFile,
      secretFile: options.secretFile,
    }
  }

  if (!options.baseDir) {
    throw new Error(
      'host-provided baseDir or explicit companion file paths are required',
    )
  }

  const companionDir = path.join(options.baseDir, 'casdoor')
  return {
    bindingFile: path.join(companionDir, 'trusted-binding.json'),
    keyFile: path.join(companionDir, 'trusted-key.enc'),
    secretFile: path.join(companionDir, 'trusted-key.secret'),
  }
}

export function createNodeCompanion(
  options: CreateNodeCompanionOptions,
): SessionCompanion {
  return createSessionCompanionFromPaths(
    resolveNodeCompanionPaths(options),
    options,
  )
}

export async function enableNodeCompanion(
  options: CreateNodeCompanionOptions,
  session: CompanionSession,
): Promise<SessionCompanion> {
  const companion = createNodeCompanion(options)
  await companion.setSession(session)
  return companion
}

export function createElectronCompanion(
  options: CreateElectronMainCompanionOptions,
): SessionCompanion {
  return createNodeCompanion(options)
}

export async function enableElectronCompanion(
  options: CreateElectronMainCompanionOptions,
  session: CompanionSession,
): Promise<SessionCompanion> {
  return enableNodeCompanion(options, session)
}

export function createElectronMainCompanion(
  options: CreateElectronMainCompanionOptions,
): SessionCompanion {
  return createElectronCompanion(options)
}

export async function enableElectronMainCompanion(
  options: CreateElectronMainCompanionOptions,
  session: CompanionSession,
): Promise<SessionCompanion> {
  return enableElectronCompanion(options, session)
}
