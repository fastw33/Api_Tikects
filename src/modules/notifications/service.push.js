import webpush from 'web-push'
import { PushSubscription } from './model.pushSubscription.js'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
} else {
  // No truena el server: solo no enviará push hasta que configures .env
  console.warn(
    '⚠️  Falta VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en .env (Web Push deshabilitado)'
  )
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY || ''
}

export async function upsertSubscription({
  id_personal,
  subscription,
  userAgent,
}) {
  const now = new Date()

  const doc = await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        id_personal: String(id_personal).trim(),
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        userAgent: String(userAgent || ''),
        active: true,
        lastSeenAt: now,
      },
    },
    { upsert: true, new: true }
  ).lean()

  return doc
}

export async function removeSubscription({ id_personal, endpoint }) {
  const res = await PushSubscription.deleteOne({
    id_personal: String(id_personal).trim(),
    endpoint: String(endpoint).trim(),
  })
  return { deletedCount: res.deletedCount || 0 }
}

/**
 * Enviar push a todas las suscripciones activas del usuario
 */
export async function sendPushToUser({ id_personal, payload }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { sent: 0, failed: 0 }

  const pid = String(id_personal).trim()
  const subs = await PushSubscription.find({
    id_personal: pid,
    active: true,
  }).lean()

  let sent = 0
  let failed = 0

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: s.keys,
        },
        JSON.stringify(payload)
      )
      sent++
    } catch (err) {
      failed++

      // 410/404 => subscription inválida (borrarla)
      const status = err?.statusCode
      if (status === 410 || status === 404) {
        await PushSubscription.deleteOne({ endpoint: s.endpoint })
      }
    }
  }

  return { sent, failed }
}
