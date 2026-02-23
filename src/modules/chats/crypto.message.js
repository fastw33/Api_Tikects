// src/modules/chats/crypto.message.js
import crypto from 'crypto'

function loadKey() {
  const raw = process.env.MESSAGE_ENCRYPTION_KEY
  if (!raw) throw new Error('Falta MESSAGE_ENCRYPTION_KEY en .env')

  // Permite hex o base64
  let key
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    key = Buffer.from(raw, 'hex')
  } else {
    key = Buffer.from(raw, 'base64')
  }

  if (key.length !== 32)
    throw new Error('MESSAGE_ENCRYPTION_KEY debe ser 32 bytes (base64 o hex).')
  return key
}

const KEY = loadKey()

export function encryptText(plainText) {
  const text = String(plainText ?? '')
  if (!text.trim()) return { text_enc: '', iv: '', tag: '' }

  const iv = crypto.randomBytes(12) // recomendado para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    text_enc: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  }
}

export function decryptText({ text_enc, iv, tag }) {
  if (!text_enc || !iv || !tag) return ''

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    KEY,
    Buffer.from(iv, 'base64')
  )

  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(text_enc, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}
