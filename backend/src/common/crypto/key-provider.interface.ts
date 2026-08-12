import * as crypto from 'crypto'

export interface KeyProvider {
  currentKekVersion(): Promise<number>
  getKek(version: number): Promise<Buffer>
  availableVersions(): Promise<number[]>
  keyCheckValue(version: number): Promise<string>
}

export const KEY_PROVIDER = Symbol('KEY_PROVIDER')

export const KEK_LENGTH_BYTES = 32

export const MAX_KEY_VERSION = 65535

export function computeKeyCheckValue(kek: Buffer): string {
  return crypto
    .createHmac('sha256', kek)
    .update('kcv:v1', 'utf8')
    .digest()
    .subarray(0, 4)
    .toString('hex')
}

export const ENVELOPE_VERSION = 1

export enum EnvelopeScope {
  Platform = 1,
  Store = 2,
}

export const IV_LENGTH = 12
export const TAG_LENGTH = 16
export const DERIVED_KEY_LENGTH = 32
export const CIPHER_ALGORITHM = 'aes-256-gcm'

export const OFFSET_ENVELOPE_VERSION = 0
export const OFFSET_SCOPE = 1
export const OFFSET_KEK_VERSION = 2
export const OFFSET_DERIVED_KEY_VERSION = 4

/** F5: explicit named constant instead of implicit arithmetic */
export const ENVELOPE_PREFIX_LENGTH = 6

export const OFFSET_IV = ENVELOPE_PREFIX_LENGTH
export const OFFSET_TAG = OFFSET_IV + IV_LENGTH
export const OFFSET_CIPHERTEXT = OFFSET_TAG + TAG_LENGTH
export const ENVELOPE_HEADER_LENGTH = OFFSET_CIPHERTEXT

export interface EnvelopeHeader {
  envelopeVersion: number
  scope: EnvelopeScope
  kekVersion: number
  derivedKeyVersion: number
}

export function packEnvelopeHeader(header: EnvelopeHeader): Buffer {
  const buffer = Buffer.alloc(ENVELOPE_PREFIX_LENGTH)

  buffer.writeUInt8(header.envelopeVersion, OFFSET_ENVELOPE_VERSION)
  buffer.writeUInt8(header.scope, OFFSET_SCOPE)
  buffer.writeUInt16BE(header.kekVersion, OFFSET_KEK_VERSION)
  buffer.writeUInt16BE(header.derivedKeyVersion, OFFSET_DERIVED_KEY_VERSION)

  return buffer
}

export type DecryptionFailureReason =
  | 'malformed'
  | 'unsupported_version'
  | 'key_unavailable'
  | 'integrity'

export class DecryptionError extends Error {
  /** F4: own property, not a prototype getter, so toMatchObject sees it */
  readonly isSecurityRelevant: boolean

  constructor(
    readonly reason: DecryptionFailureReason,
    message: string,
  ) {
    super(message)

    this.name = 'DecryptionError'
    this.isSecurityRelevant = reason === 'integrity'

    /** F4: restore prototype chain for instanceof under older targets */
    Object.setPrototypeOf(this, DecryptionError.prototype)
  }
}

export type CryptoMode = 'test' | 'live'

export interface EncryptionContext {
  mode: CryptoMode
  recordType: string
  recordId: string
  field: string
}

const AAD_MAGIC = 'aad:v1'

function writeLengthPrefixed(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')

  if (bytes.length > 0xffff) {
    throw new Error(`عنصر AAD أطول من المسموح (${bytes.length} byte).`)
  }

  const length = Buffer.alloc(2)
  length.writeUInt16BE(bytes.length, 0)

  return Buffer.concat([length, bytes])
}

export function buildAad(
  scope: EnvelopeScope,
  storeId: string | null,
  context: EncryptionContext,
): Buffer {
  validateContext(context)

  return Buffer.concat([
    writeLengthPrefixed(AAD_MAGIC),
    writeLengthPrefixed(String(scope)),
    writeLengthPrefixed(storeId ?? ''),
    writeLengthPrefixed(context.mode),
    writeLengthPrefixed(context.recordType),
    writeLengthPrefixed(context.recordId),
    writeLengthPrefixed(context.field),
  ])
}

function validateContext(context: EncryptionContext): void {
  if (!context) {
    throw new Error('سياق التشفير مطلوب.')
  }

  if (context.mode !== 'test' && context.mode !== 'live') {
    throw new Error(
      `mode لازم يكون 'test' أو 'live' (استلمنا: ${String(context.mode)}).`,
    )
  }

  const required: Array<[string, string]> = [
    ['recordType', context.recordType],
    ['recordId', context.recordId],
    ['field', context.field],
  ]

  for (const [name, value] of required) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${name} مطلوب في سياق التشفير ومش ممكن يكون فاضي.`)
    }
  }
}

export function wipe(buffer: Buffer): void {
  buffer.fill(0)
}

export function assertKeyVersion(name: string, version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > MAX_KEY_VERSION) {
    throw new Error(
      `${name} لازم يكون رقم صحيح بين 1 و ${MAX_KEY_VERSION} (استلمنا: ${version}).`,
    )
  }
}
