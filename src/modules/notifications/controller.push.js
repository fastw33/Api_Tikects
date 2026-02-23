import {
  upsertSubscription,
  removeSubscription,
  sendPushToUser,
  getVapidPublicKey,
} from './service.push.js'

export async function getPublicKey(_req, res, next) {
  try {
    return res.json({ ok: true, publicKey: getVapidPublicKey() })
  } catch (e) {
    next(e)
  }
}

export async function subscribe(req, res, next) {
  try {
    const { id_personal, subscription } = req.body
    const userAgent = req.headers['user-agent'] || ''

    const doc = await upsertSubscription({
      id_personal,
      subscription,
      userAgent,
    })
    return res.status(201).json({ ok: true, item: doc })
  } catch (e) {
    next(e)
  }
}

export async function unsubscribe(req, res, next) {
  try {
    const { id_personal, endpoint } = req.body
    const out = await removeSubscription({ id_personal, endpoint })
    return res.json({ ok: true, ...out })
  } catch (e) {
    next(e)
  }
}

export async function testPush(req, res, next) {
  try {
    const { id_personal, title, body, url } = req.body

    const payload = {
      title: title || 'Notificación de prueba',
      body: body || 'Esto es una prueba de Web Push',
      data: {
        url: url || '/tickets',
      },
    }

    const out = await sendPushToUser({ id_personal, payload })
    return res.json({ ok: true, ...out })
  } catch (e) {
    next(e)
  }
}
