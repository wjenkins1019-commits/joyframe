import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const PREFIX = 'enc:v1:'

let keyFile = ''
let key: Buffer | null = null

/**
 * Point the secret store at its key file before any settings are read. The key
 * lives next to the database but never inside it, so a copied database or a
 * backup does not carry the provider credentials.
 */
export function configureSecrets(file: string): void {
  keyFile = file
  key = null
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX)
}

function keyBytes(): Buffer {
  if (key) return key
  if (!keyFile) throw new Error('Secret storage is not configured')
  try {
    const existing = fs.readFileSync(keyFile)
    if (existing.length >= 32) {
      key = existing.subarray(0, 32)
      return key
    }
  } catch {
    /* first run: create the key below */
  }
  const created = crypto.randomBytes(32)
  fs.mkdirSync(path.dirname(keyFile), { recursive: true })
  fs.writeFileSync(keyFile, created, { mode: 0o600 })
  key = created
  return key
}

/** Encrypt a non-empty secret for storage; an empty value clears the field. */
export function sealSecret(value: string): string {
  if (!value) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`
}

/** Decrypt a stored secret; legacy plaintext values pass through unchanged. */
export function openSecret(stored: string): string {
  if (!stored || !isSealed(stored)) return stored
  if (!keyFile) return ''
  try {
    const payload = Buffer.from(stored.slice(PREFIX.length), 'base64')
    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
