import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64

function deriveKey(password: string, salt: Buffer | string, keylen: number, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r: SCRYPT_R, p: SCRYPT_P }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await deriveKey(password, salt, KEY_LENGTH, SCRYPT_N)
  return `scrypt:${SCRYPT_N}:${salt.toString('hex')}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = /^scrypt:(\d+):([0-9a-f]+):([0-9a-f]+)$/.exec(stored)
  if (!match) return false
  const [, n, saltHex, hashHex] = match
  const expected = Buffer.from(hashHex!, 'hex')
  const derived = await deriveKey(password, Buffer.from(saltHex!, 'hex'), expected.length, Number(n))
  return timingSafeEqual(expected, derived)
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required'
  if (password.length < 12) return 'Password must be at least 12 characters'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain a letter and a number'
  return null
}
