// src/modules/notifications/validator.notification.js
import mongoose from 'mongoose'

const isObjectId = v => mongoose.Types.ObjectId.isValid(v)

function isValidIdPersonal(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 80
}

export function validatePaging(req, res, next) {
  const errors = []
  const { page, limit } = req.query

  if (page === undefined) errors.push('page (query) es requerido.')
  if (limit === undefined) errors.push('limit (query) es requerido.')

  const p = Number(page)
  const l = Number(limit)

  if (!Number.isInteger(p) || p < 1) errors.push('page debe ser entero >= 1.')
  if (!Number.isInteger(l) || l < 1) errors.push('limit debe ser entero >= 1.')
  if (Number.isInteger(l) && l > 100)
    errors.push('limit no puede ser mayor a 100.')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateList(req, res, next) {
  const errors = []
  const { id_personal, isRead } = req.query

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (query) es requerido.')

  if (isRead !== undefined && !['true', 'false'].includes(String(isRead))) {
    errors.push('isRead debe ser true|false.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateIdParam(req, res, next) {
  const { id } = req.params
  if (!isObjectId(id))
    return res.status(400).json({ ok: false, error: 'id inválido' })
  next()
}

export function validateReadOne(req, res, next) {
  const { id_personal } = req.body
  if (!id_personal || !isValidIdPersonal(id_personal)) {
    return res
      .status(400)
      .json({ ok: false, error: 'id_personal (actor) es requerido.' })
  }
  next()
}

export function validateReadAll(req, res, next) {
  const { id_personal } = req.body
  if (!id_personal || !isValidIdPersonal(id_personal)) {
    return res
      .status(400)
      .json({ ok: false, error: 'id_personal (actor) es requerido.' })
  }
  next()
}
