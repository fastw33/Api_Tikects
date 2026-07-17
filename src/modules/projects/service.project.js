import mongoose from 'mongoose'
import { Ticket } from '../Ticket/model.ticket.js'
import { Area } from '../Areas/model.area.js'
import { Team } from '../teams/model.team.js'
import {
  Project,
  ProjectTask,
  ProjectRepositoryNode,
  ProjectComment,
  ProjectAccessGrant,
} from './model.project.js'
import { dispatchNotifications } from '../notifications/service.notification.js'

function assertObjectId(v, field = 'id') {
  if (!mongoose.Types.ObjectId.isValid(v)) {
    const err = new Error(`${field} inválido`)
    err.status = 400
    throw err
  }
  return new mongoose.Types.ObjectId(v)
}

function uniq(arr) {
  return [...new Set((arr || []).map(x => String(x).trim()).filter(Boolean))]
}

function parsePaging({ page, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)
  const skip = (safePage - 1) * safeLimit
  return { safePage, safeLimit, skip }
}

function projectTarget(project, extra = {}) {
  const projectId = String(project?._id || '')
  const params = {
    projectId,
    ticketsSection: 'proyectos',
    ...extra,
  }

  const qs = new URLSearchParams(
    Object.entries(params).reduce((acc, [k, v]) => {
      if (v === undefined || v === null || String(v).trim() === '') return acc
      acc[k] = String(v)
      return acc
    }, {})
  )

  return {
    type: 'ticket',
    params,
    url: `/tickets?${qs.toString()}`,
  }
}

function projectParticipants(project, extra = []) {
  return uniq([
    String(project?.creado_por || '').trim(),
    ...(project?.miembros || []),
    ...extra,
  ])
}

async function notifyProject({
  actor,
  project,
  to,
  type,
  title,
  body,
  extraTarget = {},
  meta = {},
}) {
  const recipients = uniq(to)
  if (!recipients.length) return

  try {
    await dispatchNotifications({
      actor_id_personal: actor,
      to_ids: recipients,
      type,
      title,
      body,
      target: projectTarget(project, extraTarget),
      meta: {
        projectId: String(project?._id || ''),
        projectCode: String(project?.code || ''),
        ...meta,
      },
    })
  } catch {
    // no bloquea el flujo principal
  }
}

function toProjectCode(ticket) {
  const seq = Number(ticket?.codeSeq || 0)
  if (Number.isFinite(seq) && seq > 0)
    return `PRO-${String(seq).padStart(3, '0')}`

  const fallback = String(ticket?.code || '').match(/(\d+)/)
  const n = Number(fallback?.[1] || 0)
  return `PRO-${String(n || 1).padStart(3, '0')}`
}

async function getProjectStrict(projectId) {
  const project = await Project.findById(projectId)
  if (!project) {
    const err = new Error('Proyecto no encontrado.')
    err.status = 404
    throw err
  }
  return project
}

function isMember(project, id_personal) {
  const pid = String(id_personal || '').trim()
  if (!pid) return false
  if (String(project.creado_por || '').trim() === pid) return true
  return (project.miembros || []).some(x => String(x).trim() === pid)
}

async function resolveAssignedPersonalIds(asignado_a) {
  const tipo = String(asignado_a?.tipo || '').trim()
  const id = String(asignado_a?.id || '').trim()
  if (!tipo || !id) return []
  if (tipo === 'personal') return [id]
  if (!mongoose.Types.ObjectId.isValid(id)) return []

  if (tipo === 'area') {
    const area = await Area.findById(id, { personal_ids: 1 }).lean()
    return uniq(area?.personal_ids || [])
  }

  if (tipo === 'team') {
    const team = await Team.findById(id, { personal_ids: 1 }).lean()
    return uniq(team?.personal_ids || [])
  }

  return []
}

async function buildProjectMembersFromTicket(ticket) {
  const assignedMembers = await resolveAssignedPersonalIds(ticket?.asignado_a)
  return uniq([
    ticket?.creado_por,
    ...(Array.isArray(ticket?.watchers) ? ticket.watchers : []),
    ...assignedMembers,
  ])
}

async function getUserAssignmentFilters(id_personal) {
  const pid = String(id_personal || '').trim()
  if (!pid) return []

  const [areas, teams] = await Promise.all([
    Area.find({ activo: true, personal_ids: pid }, { _id: 1 }).lean(),
    Team.find({ activo: true, personal_ids: pid }, { _id: 1 }).lean(),
  ])

  return [
    { 'asignado_a.tipo': 'personal', 'asignado_a.id': pid },
    ...areas.map(area => ({
      'asignado_a.tipo': 'area',
      'asignado_a.id': { $in: [area._id, String(area._id)] },
    })),
    ...teams.map(team => ({
      'asignado_a.tipo': 'team',
      'asignado_a.id': { $in: [team._id, String(team._id)] },
    })),
  ]
}

function normalizeState(v) {
  return String(v || '').trim()
}

function normalizeStateKey(v) {
  return normalizeState(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isClosedLikeState(v) {
  const key = normalizeStateKey(v)
  if (!key) return false
  return (
    key.includes('cerrad') ||
    key.includes('resuelt') ||
    key.includes('finaliz') ||
    key.includes('complet') ||
    key.includes('done') ||
    key.includes('closed') ||
    key.includes('resolved')
  )
}

async function hasGrant({
  project_id,
  id_personal,
  resource_type,
  resource_id,
}) {
  const grant = await ProjectAccessGrant.findOne({
    project_id,
    id_personal: String(id_personal).trim(),
    resource_type,
    resource_id: String(resource_id).trim(),
    active: true,
  }).lean()
  return Boolean(grant)
}

async function ensureGrant({
  project_id,
  id_personal,
  resource_type,
  resource_id,
  source,
  actor,
}) {
  const pid = String(id_personal || '').trim()
  if (!pid) return

  await ProjectAccessGrant.findOneAndUpdate(
    {
      project_id,
      id_personal: pid,
      resource_type,
      resource_id: String(resource_id).trim(),
      source,
    },
    {
      $set: { active: true, updatedBy: actor },
      $setOnInsert: { createdBy: actor },
    },
    { upsert: true, new: true }
  )
}

async function syncProjectsFromTicketsForUser(id_personal) {
  const pid = String(id_personal || '').trim()
  if (!pid) return

  const assignmentFilters = await getUserAssignmentFilters(pid)

  const tickets = await Ticket.find({
    tipo: 'proyecto',
    codePrefix: 'PY_',
    activo: true,
    $or: [
      { creado_por: pid },
      { watchers: pid },
      ...assignmentFilters,
    ],
  })
    .select({
      _id: 1,
      code: 1,
      codeSeq: 1,
      orgId: 1,
      titulo: 1,
      descripcion: 1,
      creado_por: 1,
      watchers: 1,
      asignado_a: 1,
    })
    .lean()

  for (const ticket of tickets) {
    const miembros = await buildProjectMembersFromTicket(ticket)

    await Project.findOneAndUpdate(
      { ticket_id: ticket._id },
      {
        $set: {
          code: toProjectCode(ticket),
          orgId: String(ticket.orgId || '').trim(),
          titulo: String(ticket.titulo || '').trim(),
          descripcion: String(ticket.descripcion || '').trim(),
          creado_por: String(ticket.creado_por || '').trim(),
          miembros,
          updatedBy: pid,
        },
        $setOnInsert: {
          estado: 'abierto',
          nextTaskSeq: 1,
          activo: true,
          createdBy: pid,
        },
      },
      { upsert: true }
    )
  }
}

export async function createOrSyncProjectFromTicket({
  ticket_id,
  id_personal,
}) {
  const actor = String(id_personal || '').trim()
  if (!actor) {
    const err = new Error('id_personal es requerido.')
    err.status = 400
    throw err
  }

  const tid = assertObjectId(ticket_id, 'ticket_id')
  const ticket = await Ticket.findById(tid).lean()

  if (!ticket) {
    const err = new Error('Ticket no encontrado.')
    err.status = 404
    throw err
  }

  if (ticket.tipo !== 'proyecto') {
    const err = new Error('El ticket indicado no es tipo proyecto.')
    err.status = 400
    throw err
  }

  const miembros = await buildProjectMembersFromTicket(ticket)

  const doc = await Project.findOneAndUpdate(
    { ticket_id: ticket._id },
    {
      $set: {
        code: toProjectCode(ticket),
        orgId: String(ticket.orgId || '').trim(),
        titulo: String(ticket.titulo || '').trim(),
        descripcion: String(ticket.descripcion || '').trim(),
        creado_por: String(ticket.creado_por || '').trim(),
        miembros,
        updatedBy: actor,
      },
      $setOnInsert: {
        estado: 'abierto',
        nextTaskSeq: 1,
        activo: true,
        createdBy: actor,
      },
    },
    { new: true, upsert: true }
  ).lean()

  await notifyProject({
    actor,
    project: doc,
    to: projectParticipants(doc),
    type: 'project.synced_from_ticket',
    title: `Proyecto ${doc.code} actualizado`,
    body: `Sincronizado desde ticket tipo proyecto: ${doc.titulo}`,
  })

  return doc
}

export async function listProjects({
  id_personal,
  page,
  limit,
  search,
  orgId,
  estado,
}) {
  const pid = String(id_personal || '').trim()
  if (!pid) {
    const err = new Error('id_personal es requerido.')
    err.status = 400
    throw err
  }

  await syncProjectsFromTicketsForUser(pid)

  const { safePage, safeLimit, skip } = parsePaging({ page, limit })

  const filter = {
    activo: true,
    $or: [{ creado_por: pid }, { miembros: pid }],
  }

  if (orgId) filter.orgId = String(orgId).trim()
  if (estado) filter.estado = String(estado).trim()
  if (search && String(search).trim()) {
    const q = String(search).trim()
    filter.$and = [
      {
        $or: [
          { code: { $regex: q, $options: 'i' } },
          { titulo: { $regex: q, $options: 'i' } },
          { descripcion: { $regex: q, $options: 'i' } },
        ],
      },
    ]
  }

  const [items, total] = await Promise.all([
    Project.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Project.countDocuments(filter),
  ])

  const projectIds = items.map(x => x._id)

  const [tasksAgg, tasksClosed] = await Promise.all([
    ProjectTask.aggregate([
      { $match: { project_id: { $in: projectIds } } },
      { $group: { _id: '$project_id', total: { $sum: 1 } } },
    ]),
    ProjectTask.aggregate([
      {
        $match: {
          project_id: { $in: projectIds },
          closed_at: { $ne: null },
        },
      },
      { $group: { _id: '$project_id', done: { $sum: 1 } } },
    ]),
  ])

  const totalMap = new Map(
    tasksAgg.map(x => [String(x._id), Number(x.total || 0)])
  )
  const doneMap = new Map(
    tasksClosed.map(x => [String(x._id), Number(x.done || 0)])
  )

  const enriched = items.map(p => {
    const totalTasks = totalMap.get(String(p._id)) || 0
    const doneTasks = doneMap.get(String(p._id)) || 0
    return {
      ...p,
      metricas: {
        totalTasks,
        doneTasks,
        openTasks: Math.max(totalTasks - doneTasks, 0),
      },
    }
  })

  return {
    items: enriched,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  }
}

export async function getProjectById({ project_id, id_personal }) {
  const pid = String(id_personal || '').trim()
  await syncProjectsFromTicketsForUser(pid)

  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )

  if (!isMember(project, pid)) {
    const err = new Error('No autorizado para ver el proyecto completo.')
    err.status = 403
    throw err
  }

  const [tasks, repository, comments] = await Promise.all([
    ProjectTask.find({ project_id: project._id })
      .sort({ createdAt: -1 })
      .limit(40)
      .lean(),
    ProjectRepositoryNode.find({
      project_id: project._id,
      activo: true,
    })
      .sort({ type: 1, nombre: 1 })
      .lean(),
    ProjectComment.find({ project_id: project._id })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
  ])

  return {
    project: project.toObject(),
    tasks,
    repository,
    comments,
  }
}

export async function createProjectTask({ project_id, id_personal, payload, adjuntos = [] }) {
  const actor = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )

  if (!isMember(project, actor)) {
    const err = new Error('Solo miembros del proyecto pueden crear tareas.')
    err.status = 403
    throw err
  }

  const titulo = String(payload?.titulo || '').trim()
  if (!titulo) {
    const err = new Error('titulo es requerido.')
    err.status = 400
    throw err
  }

  const seq = Number(project.nextTaskSeq || 1)
  const code = `${project.code}#T-${String(seq).padStart(3, '0')}`

  const task = await ProjectTask.create({
    project_id: project._id,
    code,
    seq,
    titulo,
    descripcion: String(payload?.descripcion || '').trim(),
    prioridad_id: String(payload?.prioridad_id || '').trim(),
    prioridad_label: String(payload?.prioridad_label || '').trim(),
    prioridad_color: String(payload?.prioridad_color || '').trim(),
    estado: normalizeState(payload?.estado || 'abierta'),
    asignado_tipo: String(payload?.asignado_tipo || 'personal').trim(),
    assigned_to: String(payload?.assigned_to || '').trim(),
    assigned_label: String(payload?.assigned_label || '').trim(),
    due_date: payload?.due_date ? new Date(payload.due_date) : null,
    mentions: Array.isArray(payload?.mentions) ? payload.mentions : [],
    trazabilidad: [
      {
        estado: normalizeState(payload?.estado || 'abierta'),
        nota: 'Tarea creada',
        mentions: Array.isArray(payload?.mentions) ? payload.mentions : [],
        adjuntos: Array.isArray(adjuntos) ? adjuntos : [],
        changedBy: actor,
      },
    ],
    createdBy: actor,
    updatedBy: actor,
    closed_at: isClosedLikeState(payload?.estado) ? new Date() : null,
  })

  project.nextTaskSeq = seq + 1
  project.updatedBy = actor
  await project.save()

  if (task.assigned_to && !isMember(project, task.assigned_to)) {
    await ensureGrant({
      project_id: project._id,
      id_personal: task.assigned_to,
      resource_type: 'task',
      resource_id: String(task._id),
      source: 'assignment',
      actor,
    })
  }

  for (const m of task.mentions || []) {
    if (m?.id_personal && !isMember(project, m.id_personal)) {
      await ensureGrant({
        project_id: project._id,
        id_personal: m.id_personal,
        resource_type: 'task',
        resource_id: String(task._id),
        source: 'mention',
        actor,
      })
    }
  }

  const mentionIds = (task.mentions || []).map(m => m?.id_personal)
  const notifyTo = projectParticipants(project, [task.assigned_to, ...mentionIds])

  await notifyProject({
    actor,
    project,
    to: notifyTo,
    type: 'project.task_created',
    title: `Nueva tarea ${task.code}`,
    body: `${task.titulo}`,
    extraTarget: { taskId: String(task._id), taskCode: task.code },
    meta: { taskId: String(task._id), taskCode: task.code },
  })

  return task.toObject()
}

export async function listProjectTasks({ project_id, id_personal }) {
  const pid = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )

  if (isMember(project, pid)) {
    return ProjectTask.find({ project_id: project._id })
      .sort({ createdAt: -1 })
      .lean()
  }

  const grants = await ProjectAccessGrant.find({
    project_id: project._id,
    id_personal: pid,
    resource_type: 'task',
    active: true,
  }).lean()

  const grantedIds = grants.map(g =>
    assertObjectId(g.resource_id, 'resource_id')
  )

  return ProjectTask.find({
    project_id: project._id,
    $or: [{ assigned_to: pid }, { _id: { $in: grantedIds } }],
  })
    .sort({ createdAt: -1 })
    .lean()
}

export async function patchProjectTask({
  project_id,
  task_id,
  id_personal,
  payload,
}) {
  const pid = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )
  const task = await ProjectTask.findOne({
    _id: assertObjectId(task_id, 'task_id'),
    project_id: project._id,
  })

  const prevState = {
    estado: String(task.estado || ''),
    assigned_to: String(task.assigned_to || ''),
  }

  if (!task) {
    const err = new Error('Tarea no encontrada.')
    err.status = 404
    throw err
  }

  const member = isMember(project, pid)
  const allowedByAssign = String(task.assigned_to || '').trim() === pid

  if (!member && !allowedByAssign) {
    const granted = await hasGrant({
      project_id: project._id,
      id_personal: pid,
      resource_type: 'task',
      resource_id: String(task._id),
    })
    if (!granted) {
      const err = new Error('No autorizado para editar esta tarea.')
      err.status = 403
      throw err
    }
  }

  const editable = [
    'titulo',
    'descripcion',
    'prioridad',
    'estado',
    'assigned_to',
    'due_date',
  ]
  for (const k of editable) {
    if (payload[k] !== undefined) {
      if (k === 'due_date') task[k] = payload[k] ? new Date(payload[k]) : null
      else if (k === 'estado') task[k] = normalizeState(payload[k])
      else task[k] = payload[k]
    }
  }

  task.closed_at = isClosedLikeState(task.estado) ? new Date() : null

  task.updatedBy = pid
  await task.save()

  if (task.assigned_to && !isMember(project, task.assigned_to)) {
    await ensureGrant({
      project_id: project._id,
      id_personal: task.assigned_to,
      resource_type: 'task',
      resource_id: String(task._id),
      source: 'assignment',
      actor: pid,
    })
  }

  const notifyTo = projectParticipants(project, [task.assigned_to, prevState.assigned_to])
  const changedState = prevState.estado !== String(task.estado || '')
  const changedAssignee = prevState.assigned_to !== String(task.assigned_to || '')

  await notifyProject({
    actor: pid,
    project,
    to: notifyTo,
    type: changedState
      ? 'project.task_status_updated'
      : changedAssignee
        ? 'project.task_assigned'
        : 'project.task_updated',
    title: `Actualización ${task.code}`,
    body: changedState
      ? `Estado: ${prevState.estado || '—'} → ${task.estado || '—'}`
      : changedAssignee
        ? `Asignación: ${prevState.assigned_to || '—'} → ${task.assigned_to || '—'}`
        : `Se actualizó la tarea ${task.code}`,
    extraTarget: { taskId: String(task._id), taskCode: task.code },
    meta: { taskId: String(task._id), taskCode: task.code },
  })

  return task.toObject()
}

export async function addTaskTrace({
  project_id,
  task_id,
  id_personal,
  payload,
  files = [],
}) {
  const actor = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )
  const task = await ProjectTask.findOne({
    _id: assertObjectId(task_id, 'task_id'),
    project_id: project._id,
  })

  if (!task) {
    const err = new Error('Tarea no encontrada.')
    err.status = 404
    throw err
  }

  const member = isMember(project, actor)
  const allowedByAssign = String(task.assigned_to || '').trim() === actor

  if (!member && !allowedByAssign) {
    const granted = await hasGrant({
      project_id: project._id,
      id_personal: actor,
      resource_type: 'task',
      resource_id: String(task._id),
    })
    if (!granted) {
      const err = new Error('No autorizado para agregar trazabilidad.')
      err.status = 403
      throw err
    }
  }

  const estado = normalizeState(payload?.estado || task.estado || 'abierta')
  const nota = String(payload?.nota || '').trim()
  const mentions = Array.isArray(payload?.mentions) ? payload.mentions : []
  const adjuntos = Array.isArray(files) ? files : []

  if (!nota) {
    const err = new Error('nota es requerida para trazabilidad.')
    err.status = 400
    throw err
  }

  // Los archivos ya vienen en el formato correcto desde filesToTraceAdjuntos
  const attachmentDocs = adjuntos.map(f => ({
    tipo: String(f?.tipo || 'archivo').trim(),
    fileId: String(f?.fileId || '').trim(),
    name: String(f?.name || '').trim(),
    url: String(f?.url || '').trim(),
    mime: String(f?.mime || '').trim(),
    size: Number(f?.size) || 0,
    uploadedBy: String(f?.uploadedBy || actor).trim(),
    createdAt: f?.createdAt || new Date(),
  }))

  task.estado = estado
  task.updatedBy = actor
  task.trazabilidad.push({
    estado,
    nota,
    mentions,
    adjuntos: attachmentDocs,
    changedBy: actor,
    changedAt: new Date(),
  })

  task.closed_at = isClosedLikeState(estado) ? new Date() : null

  await task.save()

  for (const m of mentions) {
    if (m?.id_personal && !isMember(project, m.id_personal)) {
      await ensureGrant({
        project_id: project._id,
        id_personal: m.id_personal,
        resource_type: 'task',
        resource_id: String(task._id),
        source: 'mention',
        actor,
      })
    }
  }

  const mentionIds = mentions.map(m => m?.id_personal)
  const notifyTo = projectParticipants(project, [task.assigned_to, ...mentionIds])

  await notifyProject({
    actor,
    project,
    to: notifyTo,
    type: mentionIds.length
      ? 'project.task_trace_mention'
      : 'project.task_trace_created',
    title: `Trazabilidad en ${task.code}`,
    body: nota.slice(0, 160),
    extraTarget: {
      taskId: String(task._id),
      taskCode: task.code,
    },
    meta: {
      taskId: String(task._id),
      taskCode: task.code,
      estado,
      mentions: mentionIds,
    },
  })

  return task.toObject()
}

export async function addProjectTrace({
  project_id,
  id_personal,
  payload,
  files = [],
}) {
  const actor = String(id_personal || '').trim()
  const projectOid = assertObjectId(project_id, 'project_id')
  const project = await getProjectStrict(projectOid)

  if (!isMember(project, actor)) {
    const err = new Error('Solo miembros pueden agregar trazabilidad al proyecto')
    err.status = 403
    throw err
  }

  const tipo = String(payload?.tipo || 'comentario').trim()
  const validTipos = ['estado', 'comentario', 'hito', 'decision']
  if (!validTipos.includes(tipo)) {
    const err = new Error(`tipo debe ser uno de: ${validTipos.join(', ')}`)
    err.status = 400
    throw err
  }

  const titulo = String(payload?.titulo || '').trim()
  const nota = String(payload?.nota || '').trim()
  const estado = payload?.estado ? normalizeState(payload.estado) : undefined
  const mentions = Array.isArray(payload?.mentions) ? payload.mentions : []

  // Los archivos ya vienen en el formato correcto desde filesToTraceAdjuntos
  const attachmentDocs = files.map(f => ({
    tipo: String(f?.tipo || 'archivo').trim(),
    fileId: String(f?.fileId || '').trim(),
    name: String(f?.name || '').trim(),
    url: String(f?.url || '').trim(),
    mime: String(f?.mime || '').trim(),
    size: Number(f?.size) || 0,
    uploadedBy: String(f?.uploadedBy || actor).trim(),
    createdAt: f?.createdAt || new Date(),
  }))

  const traceEntry = {
    tipo,
    titulo,
    nota,
    mentions: mentions.map(m => ({
      id_personal: String(m?.id_personal || '').trim(),
      nombre: String(m?.nombre || '').trim(),
    })),
    adjuntos: attachmentDocs,
    changedBy: actor,
    changedAt: new Date(),
  }

  if (tipo === 'estado' && estado) {
    traceEntry.estado = estado
    project.estado = estado
  }

  project.trazabilidad.push(traceEntry)
  project.updatedBy = actor
  await project.save()

  const mentionIds = uniq(
    mentions.map(m => String(m?.id_personal || '').trim()).filter(Boolean)
  )
  if (mentionIds.length) {
    await Promise.all(
      mentionIds.map(mid =>
        ensureGrant({
          project_id: projectOid,
          id_personal: mid,
          resource_type: 'project',
          resource_id: String(projectOid),
          source: 'mention',
          actor,
        })
      )
    )
  }

  await notifyProject({
    actor,
    project,
    to: projectParticipants(project, mentionIds),
    type: 'project.trace_added',
    title: `Actualización en proyecto ${project.code}`,
    body: tipo === 'estado' 
      ? `Estado cambiado a ${estado}` 
      : tipo === 'hito'
        ? `Hito: ${titulo}`
        : `Actualización: ${nota.substring(0, 60)}${nota.length > 60 ? '...' : ''}`,
    meta: {
      projectId: String(project._id),
      projectCode: project.code,
      tipo,
      mentions: mentionIds,
    },
  })

  return project.toObject()
}

export async function createRepositoryNode({
  project_id,
  id_personal,
  payload,
}) {
  const actor = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )

  if (!isMember(project, actor)) {
    const err = new Error(
      'Solo miembros del proyecto pueden crear en repositorio.'
    )
    err.status = 403
    throw err
  }

  const type = String(payload?.type || '').trim()
  const nombre = String(payload?.nombre || '').trim()

  if (!['folder', 'file', 'url'].includes(type)) {
    const err = new Error('type inválido. Use folder|file|url.')
    err.status = 400
    throw err
  }
  if (!nombre) {
    const err = new Error('nombre es requerido.')
    err.status = 400
    throw err
  }

  const node = await ProjectRepositoryNode.create({
    project_id: project._id,
    parent_id: payload?.parent_id
      ? assertObjectId(payload.parent_id, 'parent_id')
      : null,
    type,
    nombre,
    url: String(payload?.url || '').trim(),
    file: payload?.file || undefined,
    createdBy: actor,
    updatedBy: actor,
  })

  await notifyProject({
    actor,
    project,
    to: projectParticipants(project),
    type: 'project.repository_updated',
    title: `Repositorio actualizado en ${project.code}`,
    body:
      node.type === 'url'
        ? `Se agregó URL: ${node.nombre}`
        : node.type === 'folder'
          ? `Se creó carpeta: ${node.nombre}`
          : `Se agregó archivo: ${node.nombre}`,
    extraTarget: {
      repositoryNodeId: String(node._id),
      repositoryNodeType: node.type,
    },
    meta: { repositoryNodeId: String(node._id), repositoryNodeType: node.type },
  })

  return node.toObject()
}

export async function listRepositoryNodes({
  project_id,
  id_personal,
  parent_id,
}) {
  const pid = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )

  if (!isMember(project, pid)) {
    const err = new Error('No autorizado para ver repositorio completo.')
    err.status = 403
    throw err
  }

  const filter = {
    project_id: project._id,
    activo: true,
    parent_id: parent_id ? assertObjectId(parent_id, 'parent_id') : null,
  }

  return ProjectRepositoryNode.find(filter).sort({ type: 1, nombre: 1 }).lean()
}

export async function addComment({ project_id, id_personal, payload }) {
  const actor = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )

  const resource_type = String(payload?.resource_type || '').trim()
  const resource_id = String(payload?.resource_id || '').trim()
  const text = String(payload?.text || '').trim()
  const mentions = Array.isArray(payload?.mentions) ? payload.mentions : []

  if (
    !['project', 'task', 'repository_node', 'comment'].includes(resource_type)
  ) {
    const err = new Error('resource_type inválido.')
    err.status = 400
    throw err
  }
  if (!resource_id) {
    const err = new Error('resource_id es requerido.')
    err.status = 400
    throw err
  }
  if (!text) {
    const err = new Error('text es requerido.')
    err.status = 400
    throw err
  }

  const member = isMember(project, actor)
  if (!member) {
    const granted = await hasGrant({
      project_id: project._id,
      id_personal: actor,
      resource_type,
      resource_id,
    })
    if (!granted) {
      const err = new Error('No autorizado para comentar este componente.')
      err.status = 403
      throw err
    }
  }

  const comment = await ProjectComment.create({
    project_id: project._id,
    resource_type,
    resource_id,
    parent_comment_id: payload?.parent_comment_id
      ? assertObjectId(payload.parent_comment_id, 'parent_comment_id')
      : null,
    text,
    mentions,
    estado_mencion: 'pendiente',
    createdBy: actor,
    updatedBy: actor,
  })

  for (const m of mentions) {
    if (m?.id_personal && !isMember(project, m.id_personal)) {
      await ensureGrant({
        project_id: project._id,
        id_personal: m.id_personal,
        resource_type,
        resource_id,
        source: 'mention',
        actor,
      })
    }
  }

  const mentionIds = mentions.map(m => m?.id_personal)
  const notifyTo = projectParticipants(project, mentionIds)

  await notifyProject({
    actor,
    project,
    to: notifyTo,
    type: mentionIds.length
      ? 'project.comment_mention'
      : 'project.comment_created',
    title: mentionIds.length
      ? `Nueva mención en ${project.code}`
      : `Nuevo comentario en ${project.code}`,
    body: text.slice(0, 140),
    extraTarget: {
      commentId: String(comment._id),
      resourceType: resource_type,
      resourceId: resource_id,
    },
    meta: {
      commentId: String(comment._id),
      resourceType: resource_type,
      resourceId: resource_id,
      mentions: mentionIds,
    },
  })

  return comment.toObject()
}

export async function patchCommentStatus({
  project_id,
  comment_id,
  id_personal,
  estado_mencion,
}) {
  const actor = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )
  const comment = await ProjectComment.findOne({
    _id: assertObjectId(comment_id, 'comment_id'),
    project_id: project._id,
  })

  if (!comment) {
    const err = new Error('Comentario no encontrado.')
    err.status = 404
    throw err
  }

  const member = isMember(project, actor)
  const mentioned = (comment.mentions || []).some(
    m => String(m.id_personal).trim() === actor
  )

  if (
    !member &&
    !mentioned &&
    String(comment.createdBy || '').trim() !== actor
  ) {
    const err = new Error('No autorizado para actualizar este comentario.')
    err.status = 403
    throw err
  }

  comment.estado_mencion = estado_mencion
  comment.updatedBy = actor
  await comment.save()

  const mentionedIds = (comment.mentions || []).map(m => m?.id_personal)
  const notifyTo = projectParticipants(project, [
    String(comment.createdBy || '').trim(),
    ...mentionedIds,
  ])

  await notifyProject({
    actor,
    project,
    to: notifyTo,
    type: 'project.comment_status_updated',
    title: `Estado de mención actualizado`,
    body: `Comentario en ${project.code}: ${estado_mencion}`,
    extraTarget: {
      commentId: String(comment._id),
      resourceType: comment.resource_type,
      resourceId: comment.resource_id,
    },
    meta: {
      commentId: String(comment._id),
      resourceType: comment.resource_type,
      resourceId: comment.resource_id,
      estado_mencion,
    },
  })

  return comment.toObject()
}

export async function myItems({ id_personal, page, limit }) {
  const pid = String(id_personal || '').trim()
  if (!pid) {
    const err = new Error('id_personal es requerido.')
    err.status = 400
    throw err
  }

  const { safePage, safeLimit, skip } = parsePaging({ page, limit })

  const [tasks, mentions] = await Promise.all([
    ProjectTask.find({
      assigned_to: pid,
      estado: { $nin: ['resuelta', 'cerrada'] },
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ProjectComment.find({
      'mentions.id_personal': pid,
      estado_mencion: { $ne: 'cerrada' },
    })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ])

  const projects = await Project.find({
    _id: {
      $in: uniq(
        tasks
          .map(t => String(t.project_id))
          .concat(mentions.map(m => String(m.project_id)))
      )
        .filter(x => mongoose.Types.ObjectId.isValid(x))
        .map(x => new mongoose.Types.ObjectId(x)),
    },
  }).lean()

  const projectMap = Object.fromEntries(projects.map(p => [String(p._id), p]))

  return {
    assigned_tasks: tasks.map(t => ({
      ...t,
      project: projectMap[String(t.project_id)] || null,
    })),
    mentions: mentions.map(m => ({
      ...m,
      project: projectMap[String(m.project_id)] || null,
    })),
  }
}

export async function listRepoNodes({ project_id }) {
  const pid = assertObjectId(project_id, 'project_id')
  const project = await Project.findById(pid).lean()
  if (!project) {
    const err = new Error('Proyecto no encontrado')
    err.status = 404
    throw err
  }

  const nodes = await ProjectRepositoryNode.find({
    project_id: pid,
    activo: true,
  })
    .sort({ type: -1, nombre: 1 })
    .lean()

  // Construir árbol jerárquico
  const nodeMap = Object.fromEntries(nodes.map(n => [String(n._id), n]))
  const rootNodes = []
  const childrenMap = {}

  nodes.forEach(node => {
    const nid = String(node._id)
    const parentId = node.parent_id ? String(node.parent_id) : null

    if (!parentId) {
      rootNodes.push(node)
    } else {
      if (!childrenMap[parentId]) childrenMap[parentId] = []
      childrenMap[parentId].push(node)
    }
  })

  function buildTree(node) {
    const nid = String(node._id)
    return {
      ...node,
      children: (childrenMap[nid] || []).map(buildTree),
    }
  }

  const tree = rootNodes.map(buildTree)

  // Agregar carpeta virtual "Consolidado" con todos los archivos de trazabilidad
  const consolidatedFiles = await getConsolidatedFiles(pid)

  return {
    nodes: tree,
    consolidated: consolidatedFiles,
  }
}

async function getConsolidatedFiles(project_id) {
  const pid = assertObjectId(project_id, 'project_id')

  // Obtener proyecto con su trazabilidad
  const project = await Project.findById(pid).lean()
  if (!project) return []

  const projectFiles = (project.trazabilidad || []).flatMap(t =>
    (t.adjuntos || [])
      .filter(a => a.tipo === 'archivo' && a.fileId)
      .map(a => ({
        ...a,
        source: 'project',
        sourceId: String(project._id),
        sourceLabel: project.code,
        eventDate: t.changedAt || project.createdAt,
        eventNota: t.nota || '',
      }))
  )

  // Obtener tareas con su trazabilidad
  const tasks = await ProjectTask.find({ project_id: pid }).lean()

  const taskFiles = tasks.flatMap(task =>
    (task.trazabilidad || []).flatMap(t =>
      (t.adjuntos || [])
        .filter(a => a.tipo === 'archivo' && a.fileId)
        .map(a => ({
          ...a,
          source: 'task',
          sourceId: String(task._id),
          sourceLabel: task.code,
          eventDate: t.changedAt || task.createdAt,
          eventNota: t.nota || '',
        }))
    )
  )

  return [...projectFiles, ...taskFiles].sort(
    (a, b) => new Date(b.eventDate) - new Date(a.eventDate)
  )
}

export async function createRepoNode({
  project_id,
  id_personal,
  payload,
  file,
}) {
  const pid = assertObjectId(project_id, 'project_id')
  const actor = String(id_personal || '').trim() || 'sistema'

  const project = await Project.findById(pid)
  if (!project) {
    const err = new Error('Proyecto no encontrado')
    err.status = 404
    throw err
  }

  const {
    parent_id,
    type,
    nombre,
    url: urlInput,
  } = payload

  if (!type || !['folder', 'file', 'url'].includes(type)) {
    const err = new Error('Tipo inválido. Debe ser folder, file o url.')
    err.status = 400
    throw err
  }

  if (!nombre || String(nombre).trim() === '') {
    const err = new Error('El nombre es requerido.')
    err.status = 400
    throw err
  }

  // Validar parent_id si existe
  let parentOid = null
  if (parent_id) {
    parentOid = assertObjectId(parent_id, 'parent_id')
    const parentNode = await ProjectRepositoryNode.findById(parentOid)
    if (!parentNode || parentNode.type !== 'folder') {
      const err = new Error('El parent_id debe ser una carpeta válida')
      err.status = 400
      throw err
    }
  }

  const nodeData = {
    project_id: pid,
    parent_id: parentOid,
    type,
    nombre: String(nombre).trim(),
    createdBy: actor,
    updatedBy: actor,
  }

  if (type === 'url') {
    if (!urlInput || String(urlInput).trim() === '') {
      const err = new Error('La URL es requerida para tipo url.')
      err.status = 400
      throw err
    }
    nodeData.url = String(urlInput).trim()
  }

  if (type === 'file') {
    if (!file) {
      const err = new Error('Archivo requerido para tipo file.')
      err.status = 400
      throw err
    }
    nodeData.file = file
    nodeData.url = file.path || ''
  }

  const node = await ProjectRepositoryNode.create(nodeData)

  // Notificar a participantes
  const notifyTo = projectParticipants(project)
  await notifyProject({
    actor,
    project,
    to: notifyTo,
    type: 'project.repository_node_created',
    title: `Nuevo ${type} en repositorio`,
    body: `${nombre} agregado al repositorio de ${project.code}`,
    extraTarget: { repositoryNodeId: String(node._id) },
    meta: { repositoryNodeId: String(node._id), nodeType: type },
  })

  return node.toObject()
}
