// src/modules/Ticket/controller.ticket.js
import * as TicketService from './service.ticket.js'
import path from 'path'

// ===============================
// Helpers para form-data
// ===============================
function toArray(v) {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

// Soporta claves tipo asignado_a[tipo] asignado_a[id]
function buildNestedFromBracketKeys(body, prefix) {
  const out = {}
  const tipoKey = `${prefix}[tipo]`
  const idKey = `${prefix}[id]`

  if (body[tipoKey] !== undefined) out.tipo = String(body[tipoKey])
  if (body[idKey] !== undefined) out.id = String(body[idKey])

  return Object.keys(out).length ? out : undefined
}

// Soporta operacion[subtipo], operacion[cliente], operacion[lote], etc.
function buildOperacionFromFormData(body) {
  const base = {}
  const fields = ['subtipo', 'cliente', 'lote', 'producto']
  for (const f of fields) {
    const k = `operacion[${f}]`
    if (body[k] !== undefined) base[f] = String(body[k])
  }

  // Arrays: operacion[apoyo_ids][], operacion[servicios_adicionales][]
  const apoyo = toArray(body['operacion[apoyo_ids][]']).map(String)
  const servicios = toArray(body['operacion[servicios_adicionales][]']).map(
    String
  )

  if (apoyo.length) base.apoyo_ids = apoyo
  if (servicios.length) base.servicios_adicionales = servicios

  return Object.keys(base).length ? base : undefined
}

// Convierte req.files -> adjuntos[]
function filesToAdjuntos(req, actorIdPersonal = '') {
  const files = Array.isArray(req.files) ? req.files : []
  if (!files.length) return []

  return files.map(f => {
    // multer.diskStorage da: filename, path, mimetype, size, originalname
    const relDir = path
      .relative(path.join(process.cwd(), 'uploads'), path.dirname(f.path))
      .replace(/\\/g, '/')

    const url = `/uploads/${relDir}/${f.filename}`.replace(/\/+/g, '/')

    return {
      fileId: f.filename,
      name: f.originalname || f.filename,
      url,
      mime: f.mimetype || '',
      size: Number(f.size) || 0,
      uploadedBy: actorIdPersonal || '',
      createdAt: new Date(),
    }
  })
}

function normalizeCreateBody(req) {
  const b = req.body || {}

  // watchers[] en form-data
  const watchers = toArray(b['watchers[]']).map(String).filter(Boolean)

  // asignado_a puede venir como JSON string o como bracket keys
  let asignado_a = b.asignado_a
  if (typeof asignado_a === 'string') {
    try {
      asignado_a = JSON.parse(asignado_a)
    } catch {
      asignado_a = undefined
    }
  }
  if (!asignado_a) {
    asignado_a = buildNestedFromBracketKeys(b, 'asignado_a')
  }

  // operacion puede venir JSON o bracket keys
  let operacion = b.operacion
  if (typeof operacion === 'string') {
    try {
      operacion = JSON.parse(operacion)
    } catch {
      operacion = undefined
    }
  }
  if (!operacion) {
    operacion = buildOperacionFromFormData(b)
  }

  const creado_por = b.creado_por ? String(b.creado_por) : ''
  const adjuntos = filesToAdjuntos(req, creado_por)

  return {
    ...b,
    watchers,
    asignado_a,
    operacion,
    adjuntos, // ✅ adjuntos salen de files
  }
}

function normalizePatchStateBody(req) {
  const b = req.body || {}
  const id_personal = b.id_personal ? String(b.id_personal) : ''
  const adjuntos = filesToAdjuntos(req, id_personal)

  return {
    ...b,
    adjuntos, // ✅ evidencias del evento
  }
}

function normalizePatchAttachmentsBody(req) {
  const b = req.body || {}
  const id_personal = b.id_personal ? String(b.id_personal) : ''
  const addFromFiles = filesToAdjuntos(req, id_personal)

  // si además mandas "remove" por form-data, puede ser remove[] o remove
  const remove = toArray(b['remove[]'] ?? b.remove)
    .map(String)
    .filter(Boolean)

  return {
    ...b,
    add: addFromFiles, // ✅ add se construye desde files
    remove,
  }
}

// ===============================
// Controller
// ===============================
export async function create(req, res) {
  try {
    const payload = normalizeCreateBody(req)
    const ticket = await TicketService.createTicket(payload)
    return res.status(201).json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error creando ticket' })
  }
}

export async function list(req, res) {
  try {
    const data = await TicketService.listTickets(req.query)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error listando tickets' })
  }
}

export async function getById(req, res) {
  try {
    const ticket = await TicketService.getTicketById(req.params.id)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error consultando ticket' })
  }
}

export async function put(req, res) {
  try {
    const ticket = await TicketService.updateTicketPut(req.params.id, req.body)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando ticket' })
  }
}

export async function patchState(req, res) {
  try {
    const payload = normalizePatchStateBody(req)
    const ticket = await TicketService.patchState(req.params.id, payload)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error cambiando estado' })
  }
}

export async function patchAssign(req, res) {
  try {
    const ticket = await TicketService.patchAssign(req.params.id, req.body)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error asignando ticket' })
  }
}

export async function deleteAssign(req, res) {
  try {
    const ticket = await TicketService.deleteAssign(req.params.id, req.body)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error quitando asignación' })
  }
}

export async function patchWatchers(req, res) {
  try {
    const ticket = await TicketService.patchWatchers(req.params.id, req.body)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando watchers' })
  }
}

export async function patchServicios(req, res) {
  try {
    const ticket = await TicketService.patchOperacionServicios(
      req.params.id,
      req.body
    )
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando servicios' })
  }
}

export async function patchApoyo(req, res) {
  try {
    const ticket = await TicketService.patchOperacionApoyo(
      req.params.id,
      req.body
    )
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando apoyo' })
  }
}

export async function patchAttachments(req, res) {
  try {
    const payload = normalizePatchAttachmentsBody(req)
    const ticket = await TicketService.patchAttachments(req.params.id, payload)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando adjuntos' })
  }
}

export async function deactivate(req, res) {
  try {
    const ticket = await TicketService.deactivateTicket(req.params.id, req.body)
    return res.json({ ok: true, ticket })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error desactivando ticket' })
  }
}

export async function mine(req, res) {
  try {
    const { id_personal, scope } = req.query
    const data = await TicketService.listMine({
      ...req.query,
      id_personal,
      scope,
    })
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error listando mine' })
  }
}

export async function assigned(req, res) {
  try {
    const { id_personal } = req.query
    const data = await TicketService.listAssignedToPersonal({
      ...req.query,
      id_personal,
    })
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error listando assigned' })
  }
}

export async function count(req, res) {
  try {
    const data = await TicketService.countTickets(req.query)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error contando tickets' })
  }
}
