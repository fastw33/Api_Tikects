// src/modules/chats/validator.chat.js
import mongoose from 'mongoose'

const isObjectId = v => mongoose.Types.ObjectId.isValid(v)

function isValidIdPersonal(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 80
}

function uniqTrim(arr) {
  return [...new Set(arr.map(x => String(x).trim()))].filter(Boolean)
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

export function validateChatIdParam(req, res, next) {
  const { chatId } = req.params
  if (!isObjectId(chatId))
    return res.status(400).json({ ok: false, error: 'chatId inválido' })
  next()
}

export function validateListMyChats(req, res, next) {
  const errors = []
  const { id_personal, contextType } = req.query

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (query) es requerido.')

  if (
    contextType !== undefined &&
    !['ticket', 'free'].includes(String(contextType))
  ) {
    errors.push('contextType debe ser ticket|free.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateCreateFreeChat(req, res, next) {
  const errors = []
  const { id_personal, title, participants } = req.body

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')
  if (title !== undefined && typeof title !== 'string')
    errors.push('title debe ser string.')

  if (!Array.isArray(participants) || participants.length < 2) {
    errors.push('participants es requerido y debe tener mínimo 2 id_personal.')
  } else {
    const u = uniqTrim(participants)
    if (u.length !== participants.length)
      errors.push('participants no puede tener duplicados.')
    if (u.some(x => !isValidIdPersonal(x)))
      errors.push('participants contiene id_personal inválidos.')
    if (!u.includes(String(id_personal).trim()))
      errors.push('El actor (id_personal) debe estar incluido en participants.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateGetMessages(req, res, next) {
  const errors = []
  const { id_personal } = req.query

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (query) es requerido.')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateSendMessage(req, res, next) {
  const errors = []
  const { id_personal, text, attachments } = req.body

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')

  const hasText = typeof text === 'string' && text.trim().length > 0
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0

  if (!hasText && !hasAttachments)
    errors.push('Debes enviar text o attachments (mínimo uno).')

  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) errors.push('attachments debe ser array.')
    else {
      for (const a of attachments) {
        if (!a?.fileId || typeof a.fileId !== 'string' || !a.fileId.trim()) {
          errors.push('Cada attachment requiere fileId.')
          break
        }
      }
    }
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validatePatchRead(req, res, next) {
  const errors = []
  const { id_personal, at } = req.body

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')

  if (at !== undefined) {
    const d = new Date(at)
    if (Number.isNaN(d.getTime()))
      errors.push('at debe ser una fecha ISO válida.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validatePatchParticipants(req, res, next) {
  const errors = []
  const { id_personal, add, remove } = req.body

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')

  if (add !== undefined && !Array.isArray(add))
    errors.push('add debe ser array.')
  if (remove !== undefined && !Array.isArray(remove))
    errors.push('remove debe ser array.')

  if (Array.isArray(add) && add.some(x => !isValidIdPersonal(x)))
    errors.push('add contiene id_personal inválidos.')
  if (Array.isArray(remove) && remove.some(x => !isValidIdPersonal(x)))
    errors.push('remove contiene id_personal inválidos.')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateDeactivate(req, res, next) {
  const { id_personal } = req.body
  if (!id_personal || !isValidIdPersonal(id_personal)) {
    return res
      .status(400)
      .json({ ok: false, error: 'id_personal (actor) es requerido.' })
  }
  next()
}
