// src/modules/notifications/controller.notification.js
import * as Svc from './service.notification.js'

export async function list(req, res) {
  try {
    const data = await Svc.listNotifications(req.query)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error listando notificaciones' })
  }
}

export async function count(req, res) {
  try {
    const data = await Svc.countNotifications(req.query)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error contando notificaciones' })
  }
}

export async function readOne(req, res) {
  try {
    const notif = await Svc.readOne({
      notificationId: req.params.id,
      ...req.body,
    })
    return res.json({ ok: true, notification: notif })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error marcando leído' })
  }
}

export async function readAll(req, res) {
  try {
    const data = await Svc.readAll(req.body)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error marcando todo leído' })
  }
}

/**
 * ✅ NUEVO
 * Marca como leídas todas las notificaciones de un ticket
 * Se usa cuando el usuario abre el desplegable del ticket
 */
export async function readByTicket(req, res) {
  try {
    const data = await Svc.readByTicketId(req.body)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res.status(e.status || 500).json({
      ok: false,
      error: e.message || 'Error marcando notificaciones del ticket',
    })
  }
}

export async function readByTarget(req, res) {
  try {
    const data = await Svc.readByTarget(req.body)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res.status(e.status || 500).json({
      ok: false,
      error: e.message || 'Error marcando notificaciones por target',
    })
  }
}
