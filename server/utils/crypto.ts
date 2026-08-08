const encoder = new TextEncoder()

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return bytesToBase64Url(value)
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return bytesToBase64Url(new Uint8Array(digest))
}

export async function hashPassword(password: string, iterations: number): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    256,
  )
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt: bytesToBase64Url(salt), iterations }
}

export async function verifyPassword(password: string, expectedHash: string, salt: string, iterations: number): Promise<boolean> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(salt), iterations },
    keyMaterial,
    256,
  )
  return timingSafeEqual(bytesToBase64Url(new Uint8Array(bits)), expectedHash)
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const max = Math.max(leftBytes.length, rightBytes.length)
  let mismatch = leftBytes.length ^ rightBytes.length
  for (let i = 0; i < max; i++) mismatch |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0)
  return mismatch === 0
}

async function importSettingsKey(secret: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(secret)
  if (raw.byteLength !== 32) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSetting(plaintext: string, secret: string): Promise<string> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const key = await importSettingsKey(secret)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`
}

export async function decryptSetting(value: string, secret: string): Promise<string> {
  const [ivPart, ciphertextPart] = value.split('.')
  if (!ivPart || !ciphertextPart) throw new Error('Invalid encrypted setting')
  const key = await importSettingsKey(secret)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(ivPart) },
    key,
    base64UrlToBytes(ciphertextPart),
  )
  return new TextDecoder().decode(plaintext)
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
}
