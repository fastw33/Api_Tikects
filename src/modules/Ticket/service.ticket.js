import mongoose from 'mongoose'
import { Ticket } from './model.ticket.js'
import { TicketCounter } from './model.ticketCounter.js'

import { Area } from '../Areas/model.area.js'
import { Team } from '../teams/model.team.js'

import {
  ensureTicketChat,
  syncTicketChat,
  buildTicketParticipants,
} from '../chats/service.chat.js'

import { dispatchNotifications } from '../notifications/service.notification.js'

// ======================================================
// Helpers base
// ======================================================
function uniqTrim(arr) {
  return [...new Set(arr.map(x => String(x).trim()))].filter(Boolean)
}

function parsePaging({ page, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)
  const skip = (safePage - 1) * safeLimit
  return { safePage, safeLimit, skip }
}

function safeSort({ sortBy, sortDir }) {
  const allowed = new Set([
    'createdAt',
    'updatedAt',
    'codeSeq',
    'code',
    'fecha_estimada',
    'lastMoveAt', // ✅ NUEVO
  ])

  const by = allowed.has(String(sortBy)) ? String(sortBy) : 'updatedAt'
  const dir =
    String(sortDir).toLowerCase() === 'asc' || String(sortDir) === '1' ? 1 : -1

  return { by, dir }
}

function toObjectId(v, field = 'id') {
  if (!mongoose.Types.ObjectId.isValid(v)) {
    const err = new Error(`${field} inválido`)
    err.status = 400
    throw err
  }
  return new mongoose.Types.ObjectId(v)
}

function parseObjectIdList(value, fieldName = 'ids') {
  const raw = String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (!raw.length) return []

  const out = []
  for (const v of raw) {
    if (!mongoose.Types.ObjectId.isValid(v)) {
      const err = new Error(`${fieldName} inválido`)
      err.status = 400
      throw err
    }
    out.push(new mongoose.Types.ObjectId(v))
  }
  return out
}

// ======================================================
// Filtros
// ======================================================
function buildFilters(q) {
  const filter = {}

  if (q.activo !== undefined) filter.activo = String(q.activo) === 'true'
  if (q.orgId) filter.orgId = String(q.orgId).trim()
  if (q.tipo) filter.tipo = String(q.tipo)

  // ✅ Estado actual (campo directo)
  if (q.estado_id) filter.estado_id = toObjectId(q.estado_id, 'estado_id')

  // ✅ NUEVO: múltiples estados (in)
  // ejemplo: ?estado_ids=65ab...,65ac...
  if (q.estado_ids) {
    const ids = parseObjectIdList(q.estado_ids, 'estado_ids')
    if (ids.length) filter.estado_id = { $in: ids }
  }

  // ✅ NUEVO: excluir estados (not in)
  // ejemplo: ?exclude_estado_ids=65ab...,65ac...
  if (q.exclude_estado_ids) {
    const ids = parseObjectIdList(q.exclude_estado_ids, 'exclude_estado_ids')
    if (ids.length) {
      // si ya hay estado_id con $in, combinamos
      if (filter.estado_id && typeof filter.estado_id === 'object') {
        filter.estado_id = { ...filter.estado_id, $nin: ids }
      } else if (filter.estado_id) {
        // si era un ObjectId puntual, lo convertimos a $in
        filter.estado_id = { $in: [filter.estado_id], $nin: ids }
      } else {
        filter.estado_id = { $nin: ids }
      }
    }
  }

  if (q.prioridad_id)
    filter.prioridad_id = toObjectId(q.prioridad_id, 'prioridad_id')
  if (q.categoria_id)
    filter.categoria_id = toObjectId(q.categoria_id, 'categoria_id')

  if (q.operacion_subtipo) {
    filter['operacion.subtipo'] = String(q.operacion_subtipo)
  }

  if (q.fecha_estimada_desde || q.fecha_estimada_hasta) {
    filter.fecha_estimada = {}
    if (q.fecha_estimada_desde)
      filter.fecha_estimada.$gte = new Date(q.fecha_estimada_desde)
    if (q.fecha_estimada_hasta)
      filter.fecha_estimada.$lte = new Date(q.fecha_estimada_hasta)
  }

  if (q.area_id) {
    filter['asignado_a.tipo'] = 'area'
    filter['asignado_a.id'] = String(q.area_id).trim()
  }

  if (q.team_id) {
    filter['asignado_a.tipo'] = 'team'
    filter['asignado_a.id'] = String(q.team_id).trim()
  }

  // ✅ MEJOR: búsqueda en más campos
  if (q.search && String(q.search).trim()) {
    const s = String(q.search).trim()
    filter.$or = [
      { titulo: { $regex: s, $options: 'i' } },
      { descripcion: { $regex: s, $options: 'i' } },
      { 'operacion.cliente': { $regex: s, $options: 'i' } },
      { 'operacion.producto': { $regex: s, $options: 'i' } },
      { 'operacion.lote': { $regex: s, $options: 'i' } },
      { code: { $regex: s, $options: 'i' } },
    ]
  }

  //Filtro por createdAt (fecha real de creación)
  if (q.createdAt_desde || q.createdAt_hasta) {
    filter.createdAt = {}
    if (q.createdAt_desde) filter.createdAt.$gte = new Date(q.createdAt_desde)
    if (q.createdAt_hasta) filter.createdAt.$lte = new Date(q.createdAt_hasta)
  }

  return filter
}

// ======================================================
// Helpers de agregación: lastMoveAt
// ======================================================
// lastMoveAt = max(estado_historial.changedAt) o updatedAt si no hay historial
function withLastMoveAtStage() {
  return {
    $addFields: {
      lastMoveAt: {
        $ifNull: [{ $max: '$estado_historial.changedAt' }, '$updatedAt'],
      },
    },
  }
}

function sortStage({ by, dir }) {
  if (by === 'lastMoveAt') return { $sort: { lastMoveAt: dir } }
  return { $sort: { [by]: dir } }
}

// ======================================================
// Código autoincremental
// ======================================================
const TYPE_PREFIX = { operacion: 'OP_', tarea: 'TK_', proyecto: 'PY_' }

async function nextTicketCodeByTipo(tipo) {
  const prefix = TYPE_PREFIX[tipo]
  if (!prefix) {
    const err = new Error('Tipo inválido.')
    err.status = 400
    throw err
  }

  const key = `ticket:${tipo}`
  const row = await TicketCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean()

  const seq = Number(row.seq)
  return {
    code: `${prefix}${String(seq).padStart(4, '0')}`,
    codePrefix: prefix,
    codeSeq: seq,
  }
}

// ======================================================
// Participantes (para notificaciones/chat)
// ======================================================
async function resolveAssignedPersonals(asignado_a) {
  if (!asignado_a) return []

  if (asignado_a.tipo === 'personal')
    return asignado_a.id ? [String(asignado_a.id).trim()] : []

  if (asignado_a.tipo === 'team') {
    const team = await Team.findById(asignado_a.id).lean()
    return uniqTrim(team?.personal_ids || [])
  }

  if (asignado_a.tipo === 'area') {
    const area = await Area.findById(asignado_a.id).lean()
    return uniqTrim(area?.personal_ids || [])
  }

  return []
}

async function computeTicketParticipants(ticket) {
  const assigned = await resolveAssignedPersonals(ticket.asignado_a)
  return buildTicketParticipants({
    creado_por: ticket.creado_por,
    watchers: ticket.watchers || [],
    assignedPersonals: assigned,
    apoyo_ids: ticket.operacion?.apoyo_ids || [],
  })
}

// ======================================================
// Targets (✅ rutas reales del Front)
// ======================================================
function ticketTargetBase(ticketId) {
  return {
    type: 'ticket',
    params: { ticketId: String(ticketId) },
    url: '/',
  }
}

function ticketTargetMisTareas(ticketId) {
  return {
    type: 'ticket',
    params: { ticketId: String(ticketId) },
    url: `/tickets?ticketsSection=misTareas&ticketId=${encodeURIComponent(
      String(ticketId)
    )}`,
  }
}

function ticketTargetMisCreaciones(ticketId) {
  const id = String(ticketId)
  return {
    type: 'ticket',
    params: { ticketId: id },
    url: `/tickets?ticketsSection=misCreaciones&ticketId=${encodeURIComponent(
      id
    )}`,
  }
}

// ======================================================
// CREATE
// ======================================================
export async function createTicket(payload) {
  const actor = String(payload.creado_por).trim()
  const { code, codePrefix, codeSeq } = await nextTicketCodeByTipo(payload.tipo)

  const base = {
    orgId: String(payload.orgId).trim(),
    code,
    codePrefix,
    codeSeq,

    tipo: payload.tipo,
    titulo: payload.titulo.trim(),
    descripcion: payload.descripcion.trim(),

    categoria_id: payload.categoria_id,
    prioridad_id: payload.prioridad_id,
    estado_id: payload.estado_id,

    fecha_estimada: payload.fecha_estimada
      ? new Date(payload.fecha_estimada)
      : null,
    fecha_cierre_real: null,
    cumplimiento: 'no_aplica',

    estado_historial: [
      {
        estado_id: payload.estado_id,
        nota: (payload.nota_estado || '').trim(),
        fecha_estimada: payload.fecha_estimada
          ? new Date(payload.fecha_estimada)
          : null,
        adjuntos: payload.adjuntos ?? [],
        changedBy: actor,
      },
    ],

    asignado_a: payload.asignado_a ?? null,
    creado_por: actor,
    watchers: uniqTrim(payload.watchers ?? []),
    adjuntos: payload.adjuntos ?? [],

    activo: true,
    createdBy: actor,
    updatedBy: actor,
  }

  if (payload.tipo === 'operacion') {
    base.operacion = {
      subtipo: payload.operacion?.subtipo,
      cliente: payload.operacion?.cliente?.trim(),
      lote: (payload.operacion?.lote ?? '').trim(),
      producto: (payload.operacion?.producto ?? '').trim(),
      servicios_adicionales: uniqTrim(
        payload.operacion?.servicios_adicionales ?? []
      ),
      apoyo_ids: uniqTrim(payload.operacion?.apoyo_ids ?? []),
    }
  }

  const ticket = (await Ticket.create(base)).toObject()

  try {
    const participants = await computeTicketParticipants(ticket)

    const chat = await ensureTicketChat({
      ticketId: ticket._id,
      participants,
      actor_id_personal: actor,
    })
    await Ticket.findByIdAndUpdate(ticket._id, { chatId: chat._id })
    ticket.chatId = chat._id

    await dispatchNotifications({
      actor_id_personal: actor,
      to_ids: participants,
      type: 'ticket.created',
      title: `Nuevo ticket ${ticket.code}`,
      body: ticket.titulo,
      target: ticketTargetBase(ticket._id),
      targetResolver: () => ticketTargetMisTareas(ticket._id),
    })
  } catch {
    // no rompe creación
  }

  return ticket
}

// ======================================================
// GET by ID
// ======================================================
export async function getTicketById(id) {
  const ticket = await Ticket.findById(id).lean()
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }
  return ticket
}

// ======================================================
// LIST (general) - AGG (lastMoveAt)
// ======================================================
export async function listTickets(query) {
  const { safePage, safeLimit, skip } = parsePaging(query)
  const filter = buildFilters(query)
  const sort = safeSort(query)

  const [items, total] = await Promise.all([
    Ticket.aggregate([
      { $match: filter },
      withLastMoveAtStage(),
      sortStage(sort),
      { $skip: skip },
      { $limit: safeLimit },
    ]),
    Ticket.countDocuments(filter),
  ])

  return {
    items,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
      sort: { [sort.by]: sort.dir },
    },
  }
}

// ======================================================
// LIST mine (scope opcional)
// ======================================================
export async function listMine(query) {
  const { id_personal, scope = 'all' } = query
  if (!id_personal) {
    const err = new Error('id_personal (query) es requerido.')
    err.status = 400
    throw err
  }

  const base = buildFilters(query)
  const pid = String(id_personal).trim()

  const conditions = {
    created: { creado_por: pid },
    watching: { watchers: pid },
    support: { 'operacion.apoyo_ids': pid },
  }

  if (scope === 'created') Object.assign(base, conditions.created)
  else if (scope === 'watching') Object.assign(base, conditions.watching)
  else if (scope === 'support') Object.assign(base, conditions.support)
  else if (scope === 'all') {
    base.$or = [
      conditions.created,
      conditions.watching,
      conditions.support,
      { 'asignado_a.tipo': 'personal', 'asignado_a.id': pid },
    ]
  } else {
    const err = new Error('scope inválido.')
    err.status = 400
    throw err
  }

  return listTickets({ ...query, ...base })
}

// ======================================================
// LIST assigned (a personal) - AGG (lastMoveAt)
// ======================================================
export async function listAssignedToPersonal(query) {
  const { id_personal } = query
  if (!id_personal) {
    const err = new Error('id_personal (query) es requerido.')
    err.status = 400
    throw err
  }

  const pid = String(id_personal).trim()
  const base = buildFilters(query)
  const sort = safeSort(query)
  const { safePage, safeLimit, skip } = parsePaging(query)

  const [teams, areas] = await Promise.all([
    Team.find({ personal_ids: pid }, { _id: 1 }).limit(500).lean(),
    Area.find({ personal_ids: pid }, { _id: 1 }).limit(500).lean(),
  ])

  const teamIds = teams.map(t => String(t._id))
  const areaIds = areas.map(a => String(a._id))

  base.$or = [
    { 'asignado_a.tipo': 'personal', 'asignado_a.id': pid },
    ...(teamIds.length
      ? [{ 'asignado_a.tipo': 'team', 'asignado_a.id': { $in: teamIds } }]
      : []),
    ...(areaIds.length
      ? [{ 'asignado_a.tipo': 'area', 'asignado_a.id': { $in: areaIds } }]
      : []),
  ]

  const [items, total] = await Promise.all([
    Ticket.aggregate([
      { $match: base },
      withLastMoveAtStage(),
      sortStage(sort),
      { $skip: skip },
      { $limit: safeLimit },
    ]),
    Ticket.countDocuments(base),
  ])

  return {
    items,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
      sort: { [sort.by]: sort.dir },
    },
  }
}

// ======================================================
// COUNT
// ======================================================
export async function countTickets(query) {
  const filter = buildFilters(query)

  const [total, activos, cerradosConFecha, sinFecha] = await Promise.all([
    Ticket.countDocuments(filter),
    Ticket.countDocuments({ ...filter, activo: true }),
    Ticket.countDocuments({
      ...filter,
      fecha_estimada: { $ne: null },
      fecha_cierre_real: { $ne: null },
    }),
    Ticket.countDocuments({ ...filter, fecha_estimada: null }),
  ])

  return { total, activos, cerradosConFecha, sinFecha }
}

// ======================================================
// PUT excepcional
// ======================================================
export async function updateTicketPut(id, payload) {
  const actor = String(payload.id_personal || payload.updatedBy || '').trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }

  const allowed = [
    'orgId',
    'tipo',
    'titulo',
    'descripcion',
    'categoria_id',
    'prioridad_id',
    'estado_id',
    'asignado_a',
    'watchers',
    'adjuntos',
    'activo',
    'fecha_estimada',
  ]

  for (const k of allowed) {
    if (payload[k] !== undefined) ticket[k] = payload[k]
  }

  if (payload.fecha_estimada !== undefined) {
    ticket.fecha_estimada = payload.fecha_estimada
      ? new Date(payload.fecha_estimada)
      : null
  }

  ticket.updatedBy = actor || ticket.updatedBy
  await ticket.save()
  return ticket.toObject()
}

// ======================================================
// PATCH estado (core)
// ======================================================
export async function patchState(
  id,
  { id_personal, estado_id, nota, fecha_estimada, adjuntos = [] }
) {
  const actor = String(id_personal).trim()
  const now = new Date()

  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }

  ticket.estado_id = estado_id
  ticket.updatedBy = actor

  if (fecha_estimada !== undefined) {
    ticket.fecha_estimada = fecha_estimada ? new Date(fecha_estimada) : null
  }

  ticket.estado_historial.push({
    estado_id,
    nota: (nota || '').trim(),
    fecha_estimada:
      fecha_estimada !== undefined
        ? fecha_estimada
          ? new Date(fecha_estimada)
          : null
        : ticket.fecha_estimada,
    adjuntos,
    changedBy: actor,
    changedAt: now,
  })

  // ⚠️ tu payloadHasCloseFlag está en false.
  // Esto está bien si el frontend solo filtra por estado_id "Cerrado".
  // Si quieres que "cerrado" sea por fecha_cierre_real, aquí deberías detectar cierre.
  if (payloadHasCloseFlag({ estado_id })) {
    ticket.fecha_cierre_real = now
    if (ticket.fecha_estimada) {
      ticket.cumplimiento =
        now <= ticket.fecha_estimada ? 'cumplido' : 'incumplido'
    } else {
      ticket.cumplimiento = 'no_aplica'
    }
  }

  await ticket.save()

  try {
    const participants = await computeTicketParticipants(ticket)
    const creador = String(ticket.creado_por || '').trim()

    await dispatchNotifications({
      actor_id_personal: actor,
      to_ids: participants,
      type: 'ticket.state_changed',
      title: 'Estado actualizado',
      body: `Estado actualizado en ${ticket.code}`,
      target: ticketTargetBase(ticket._id),
      targetResolver: to => {
        const pid = String(to).trim()
        return pid && pid === creador
          ? ticketTargetMisCreaciones(ticket._id)
          : ticketTargetMisTareas(ticket._id)
      },
    })
  } catch {}

  return ticket.toObject()
}

// helper opcional para cierre
function payloadHasCloseFlag({ estado_id }) {
  return false
}

// ======================================================
// PATCH asignación / watchers / operación / adjuntos
// ======================================================
export async function patchAssign(id, { id_personal, asignado_a }) {
  const actor = String(id_personal).trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }
  ticket.asignado_a = asignado_a
  ticket.updatedBy = actor
  await ticket.save()
  return ticket.toObject()
}

export async function deleteAssign(id, { id_personal }) {
  const actor = String(id_personal).trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }
  ticket.asignado_a = null
  ticket.updatedBy = actor
  await ticket.save()
  return ticket.toObject()
}

export async function patchWatchers(
  id,
  { id_personal, add = [], remove = [] }
) {
  const actor = String(id_personal).trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }

  const set = new Set((ticket.watchers || []).map(String))
  for (const x of add || []) set.add(String(x))
  for (const x of remove || []) set.delete(String(x))

  ticket.watchers = [...set]
  ticket.updatedBy = actor
  await ticket.save()
  return ticket.toObject()
}

export async function patchOperacionServicios(
  id,
  { id_personal, add = [], remove = [] }
) {
  const actor = String(id_personal).trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }
  if (ticket.tipo !== 'operacion') {
    const err = new Error('Este ticket no es de tipo operacion.')
    err.status = 400
    throw err
  }

  const set = new Set(
    (ticket.operacion?.servicios_adicionales || []).map(String)
  )
  for (const x of add || []) set.add(String(x))
  for (const x of remove || []) set.delete(String(x))

  ticket.operacion.servicios_adicionales = [...set]
  ticket.updatedBy = actor
  await ticket.save()
  return ticket.toObject()
}

export async function patchOperacionApoyo(
  id,
  { id_personal, add = [], remove = [] }
) {
  const actor = String(id_personal).trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }
  if (ticket.tipo !== 'operacion') {
    const err = new Error('Este ticket no es de tipo operacion.')
    err.status = 400
    throw err
  }

  const set = new Set((ticket.operacion?.apoyo_ids || []).map(String))
  for (const x of add || []) set.add(String(x))
  for (const x of remove || []) set.delete(String(x))

  ticket.operacion.apoyo_ids = [...set]
  ticket.updatedBy = actor
  await ticket.save()
  return ticket.toObject()
}

export async function patchAttachments(
  id,
  { id_personal, add = [], remove = [] }
) {
  const actor = String(id_personal).trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }

  const current = ticket.adjuntos || []
  const byId = new Map(current.map(a => [String(a.fileId), a]))

  for (const a of add || []) {
    if (a?.fileId) byId.set(String(a.fileId), a)
  }

  for (const fileId of remove || []) {
    byId.delete(String(fileId))
  }

  ticket.adjuntos = [...byId.values()]
  ticket.updatedBy = actor
  await ticket.save()
  return ticket.toObject()
}

export async function deactivateTicket(id, { id_personal }) {
  const actor = String(id_personal).trim()
  const ticket = await Ticket.findById(id)
  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }
  ticket.activo = false
  ticket.updatedBy = actor
  await ticket.save()
  return ticket.toObject()
}
// ======================================================
// LIST by target (personal/team/area) + rango createdAt
// ======================================================
export async function listByTargetCreatedRange(query) {
  const { targetType, targetId } = query

  if (!targetType || !targetId) {
    const err = new Error('targetType y targetId son requeridos.')
    err.status = 400
    throw err
  }

  const type = String(targetType).trim().toLowerCase()
  const id = String(targetId).trim()

  if (!['personal', 'team', 'area'].includes(type)) {
    const err = new Error('targetType inválido. Use: personal | team | area.')
    err.status = 400
    throw err
  }

  // team/area deberían ser ObjectId válidos (porque vienen de Mongo)
  if (
    (type === 'team' || type === 'area') &&
    !mongoose.Types.ObjectId.isValid(id)
  ) {
    const err = new Error('targetId inválido para team/area.')
    err.status = 400
    throw err
  }

  // Reutiliza tus filtros base (incluye createdAt_desde/hasta que agregaste)
  const base = buildFilters(query)

  // Match por asignación directa al target
  base['asignado_a.tipo'] = type
  base['asignado_a.id'] = id

  const sort = safeSort(query)
  const { safePage, safeLimit, skip } = parsePaging(query)

  const [items, total] = await Promise.all([
    Ticket.aggregate([
      { $match: base },
      withLastMoveAtStage(),
      sortStage(sort),
      { $skip: skip },
      { $limit: safeLimit },
    ]),
    Ticket.countDocuments(base),
  ])

  return {
    items,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
      sort: { [sort.by]: sort.dir },
    },
  }
}
