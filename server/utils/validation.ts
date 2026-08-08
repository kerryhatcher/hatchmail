import { createError } from 'h3'

export function normalizeUsername(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export function validateUsername(username: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(username)) {
    throw createError({ statusCode: 400, statusMessage: 'Username must be 3-64 characters using letters, numbers, dot, underscore, or hyphen' })
  }
}

export function normalizeDomain(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '')
}

export function validateDomain(domain: string): void {
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid mail domain is required' })
  }
}

export function normalizeLocalPart(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export function validateLocalPart(localPart: string): void {
  if (!/^[a-z0-9](?:[a-z0-9.!#$%&'*+/=?^_`{|}~-]{0,62}[a-z0-9])?$/.test(localPart)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email local part' })
  }
}

export function validatePassword(password: string): void {
  if (password.length < 12) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 12 characters' })
  if (password.length > 1024) throw createError({ statusCode: 400, statusMessage: 'Password is too long' })
}
