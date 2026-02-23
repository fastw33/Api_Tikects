// src/modules/notifications/service.notification.js
import { Notification } from './model.notification.js'
import { sendPushToUser } from './service.push.js'

function parsePaging({ page, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)
  const skip = (safePage - 1) * safeLimit
  return { safePage, safeLimit, skip }
}

export async function listNotifications({ id_personal, page, limit, isRead }) {
  const { safePage, safeLimit, skip } = parsePaging({ page, limit })

  const filter = { to_id_personal: String(id_personal).trim() }

  if (isRead !== undefined) filter.isRead = String(isRead) === 'true'

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Notification.countDocuments(filter),
  ])

  return {
    items,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  }
}

export async function countNotifications({ id_personal }) {
  const pid = String(id_personal).trim()
  const [total, unread] = await Promise.all([
    Notification.countDocuments({ to_id_personal: pid }),
    Notification.countDocuments({ to_id_personal: pid, isRead: false }),
  ])
  return { total, unread }
}

export async function readOne({ notificationId, id_personal }) {
  const pid = String(id_personal).trim()

  const updated = await Notification.findOneAndUpdate(
    { _id: notificationId, to_id_personal: pid },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  ).lean()

  if (!updated) {
    const err = new Error('Notificación no encontrada o no autorizada.')
    err.status = 404
    throw err
  }
  return updated
}

export async function readAll({ id_personal }) {
  const pid = String(id_personal).trim()

  const r = await Notification.updateMany(
    { to_id_personal: pid, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  )

  return { modified: r.modifiedCount || 0 }
}

/**
 * ✅ NUEVO: marcar como leídas todas las notificaciones de un ticket para un usuario
 * Se usa cuando el usuario abre el desplegable del ticket.
 */
export async function readByTicketId({ id_personal, ticketId }) {
  const pid = String(id_personal).trim()
  const tid = String(ticketId).trim()

  if (!pid || !tid) {
    const err = new Error('id_personal y ticketId son requeridos.')
    err.status = 400
    throw err
  }

  const r = await Notification.updateMany(
    {
      to_id_personal: pid,
      isRead: false,
      'target.type': 'ticket',
      'target.params.ticketId': tid,
    },
    { $set: { isRead: true, readAt: new Date() } }
  )

  return { modified: r.modifiedCount || 0 }
}

/**
 * ✅ NUEVO (genérico): marcar leído por target
 * Por si mañana quieres targets distintos a "ticket".
 */
export async function readByTarget({ id_personal, targetType, params = {} }) {
  const pid = String(id_personal).trim()
  const ttype = String(targetType || '').trim()

  if (!pid || !ttype) {
    const err = new Error('id_personal y targetType son requeridos.')
    err.status = 400
    throw err
  }

  // armamos query dinámico de params
  const paramQuery = {}
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue
    paramQuery[`target.params.${k}`] = String(v).trim()
  }

  const r = await Notification.updateMany(
    {
      to_id_personal: pid,
      isRead: false,
      'target.type': ttype,
      ...paramQuery,
    },
    { $set: { isRead: true, readAt: new Date() } }
  )

  return { modified: r.modifiedCount || 0 }
}

/**
 * Dispatcher interno
 * - Guarda en DB
 * - Envía Web Push
 * - Excluye actor
 *
 * ✅ targetResolver(to_id_personal) opcional para definir target por receptor
 */
export async function dispatchNotifications({
  actor_id_personal,
  to_ids,
  type,
  title,
  body,
  target,
  meta = {},
  targetResolver,
}) {
  const actor = String(actor_id_personal).trim()

  const recipients = [...new Set((to_ids || []).map(x => String(x).trim()))]
    .filter(Boolean)
    .filter(x => x !== actor)

  if (!recipients.length) return { created: 0, pushed: 0 }

  const docs = recipients.map(to => {
    const resolvedTarget =
      typeof targetResolver === 'function' ? targetResolver(to) : target

    return {
      to_id_personal: to,
      type,
      title,
      body,
      target: resolvedTarget,
      meta,
      isRead: false,
      readAt: null,
      createdBy: actor,
    }
  })

  await Notification.insertMany(docs, { ordered: false })

  // Push (no bloqueante)
  let pushed = 0
  for (const to of recipients) {
    const resolvedTarget =
      typeof targetResolver === 'function' ? targetResolver(to) : target

    const payload = {
      title,
      body,
      data: {
        url: resolvedTarget?.url || '/',
        target: resolvedTarget,
        meta,
      },
    }

    sendPushToUser({ id_personal: to, payload })
      .then(r => {
        if (r?.sent) pushed += r.sent
      })
      .catch(() => {})
  }

  return { created: recipients.length, pushed }
}
