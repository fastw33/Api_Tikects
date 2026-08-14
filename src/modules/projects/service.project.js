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

function uniqObjectIds(arr) {
  return uniq(arr).filter(x => mongoose.Types.ObjectId.isValid(x))
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

async function getProjectStrict(projectId, { includeHidden = false } = {}) {
  const project = await Project.findById(projectId)
  if (!project || (!includeHidden && isHiddenProjectState(project.estado))) {
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

async function resolveGroupPersonalIds({ areaIds = [], teamIds = [] } = {}) {
  const [areas, teams] = await Promise.all([
    areaIds.length
      ? Area.find({ _id: { $in: areaIds } }, { personal_ids: 1 }).lean()
      : Promise.resolve([]),
    teamIds.length
      ? Team.find({ _id: { $in: teamIds } }, { personal_ids: 1 }).lean()
      : Promise.resolve([]),
  ])

  return uniq([
    ...areas.flatMap(area => area?.personal_ids || []),
    ...teams.flatMap(team => team?.personal_ids || []),
  ])
}

function getProjectManualAccess(project) {
  return {
    miembros_personal: uniq(project?.miembros_personal || []),
    miembros_areas: uniqObjectIds(project?.miembros_areas || []),
    miembros_teams: uniqObjectIds(project?.miembros_teams || []),
  }
}

async function buildProjectMembersFromTicket(ticket, manualAccess = {}) {
  const assignedMembers = await resolveAssignedPersonalIds(ticket?.asignado_a)
  const manualPersonal = uniq(manualAccess.miembros_personal || [])
  const manualGroupMembers = await resolveGroupPersonalIds({
    areaIds: uniqObjectIds(manualAccess.miembros_areas || []),
    teamIds: uniqObjectIds(manualAccess.miembros_teams || []),
  })

  return uniq([
    ticket?.creado_por,
    ...(Array.isArray(ticket?.watchers) ? ticket.watchers : []),
    ...assignedMembers,
    ...manualPersonal,
    ...manualGroupMembers,
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

async function getUserProjectTaskAssignmentFilters(id_personal) {
  const pid = String(id_personal || '').trim()
  if (!pid) return []

  const [areas, teams] = await Promise.all([
    Area.find({ activo: true, personal_ids: pid }, { _id: 1 }).lean(),
    Team.find({ activo: true, personal_ids: pid }, { _id: 1 }).lean(),
  ])

  return [
    { asignado_tipo: 'personal', assigned_to: pid },
    ...areas.map(area => ({
      asignado_tipo: 'area',
      assigned_to: String(area._id),
    })),
    ...teams.map(team => ({
      asignado_tipo: 'team',
      assigned_to: String(team._id),
    })),
  ]
}

async function resolveProjectTaskAssigneePersonalIds(task) {
  const tipo = String(task?.asignado_tipo || 'personal').trim()
  const id = String(task?.assigned_to || '').trim()
  if (!id) return []
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

async function canAccessTaskByAssignment(task, id_personal) {
  const pid = String(id_personal || '').trim()
  if (!pid) return false
  const assignees = await resolveProjectTaskAssigneePersonalIds(task)
  return assignees.some(x => String(x).trim() === pid)
}

function projectPreview(project) {
  if (!project) return null
  return {
    _id: project._id,
    code: project.code,
    titulo: project.titulo,
    orgId: project.orgId,
    estado: project.estado,
  }
}

async function ensureTaskAccessGrants({ project, task, actor }) {
  const assigneeIds = await resolveProjectTaskAssigneePersonalIds(task)
  const mentionIds = (task?.mentions || []).map(m => m?.id_personal)

  await Promise.all(
    uniq([...assigneeIds, ...mentionIds])
      .filter(id => id && !isMember(project, id))
      .map(id =>
        ensureGrant({
          project_id: project._id,
          id_personal: id,
          resource_type: 'task',
          resource_id: String(task._id),
          source: assigneeIds.some(x => String(x).trim() === String(id).trim())
            ? 'assignment'
            : 'mention',
          actor,
        })
      )
  )
}

async function buildProjectAccessSummary(project, tasks = []) {
  const insideIds = projectParticipants(project)
  const insideSet = new Set(insideIds.map(String))
  const manualAccess = getProjectManualAccess(project)
  const personSources = new Map()
  const addPersonSource = (id, source) => {
    const key = String(id || '').trim()
    if (!key) return
    const current = personSources.get(key) || new Set()
    current.add(source)
    personSources.set(key, current)
  }

  const ticket = project?.ticket_id
    ? await Ticket.findById(project.ticket_id, { asignado_a: 1 }).lean()
    : null

  const areas = new Map()
  const teams = new Map()
  const addAssignmentRef = (tipo, id, access, source, editable = false) => {
    const key = String(id || '').trim()
    if (!key || !mongoose.Types.ObjectId.isValid(key)) return
    const item = { id: key, access, sources: [source].filter(Boolean), editable }
    const target = tipo === 'area' ? areas : tipo === 'team' ? teams : null
    if (!target) return
    const prev = target.get(key)
    if (prev) {
      prev.access = prev.access === 'inside' ? 'inside' : access
      prev.sources = uniq([...(prev.sources || []), source])
      prev.editable = Boolean(prev.editable || editable)
    } else {
      target.set(key, item)
    }
  }

  addPersonSource(project?.creado_por, 'creador')
  for (const id of manualAccess.miembros_personal) addPersonSource(id, 'id_personal')

  for (const areaId of manualAccess.miembros_areas) {
    addAssignmentRef('area', areaId, 'inside', 'area', true)
  }

  for (const teamId of manualAccess.miembros_teams) {
    addAssignmentRef('team', teamId, 'inside', 'team', true)
  }

  addAssignmentRef(
    ticket?.asignado_a?.tipo,
    ticket?.asignado_a?.id,
    'inside',
    'project_assignment'
  )

  for (const task of tasks) {
    addAssignmentRef(
      task?.asignado_tipo,
      task?.assigned_to,
      'visualizing',
      'task_assignment'
    )
  }

  const grants = await ProjectAccessGrant.find({
    project_id: project._id,
    active: true,
  }).lean()

  const grantIds = uniq(grants.map(g => g.id_personal))
  const grantObjectIds = grantIds.filter(id => mongoose.Types.ObjectId.isValid(id))
  const [grantAreas, grantTeams] = await Promise.all([
    grantObjectIds.length
      ? Area.find({ _id: { $in: grantObjectIds } }, { _id: 1 }).lean()
      : Promise.resolve([]),
    grantObjectIds.length
      ? Team.find({ _id: { $in: grantObjectIds } }, { _id: 1 }).lean()
      : Promise.resolve([]),
  ])

  const grantGroupIds = new Set()
  for (const area of grantAreas) {
    const id = String(area._id)
    grantGroupIds.add(id)
    addAssignmentRef('area', id, 'visualizing', 'grant_area')
  }
  for (const team of grantTeams) {
    const id = String(team._id)
    grantGroupIds.add(id)
    addAssignmentRef('team', id, 'visualizing', 'grant_team')
  }

  const grantPersonalIds = grantIds.filter(id => {
    const key = String(id || '').trim()
    if (!key || grantGroupIds.has(key)) return false
    return !mongoose.Types.ObjectId.isValid(key)
  })

  const taskAssigneeIds = (
    await Promise.all(tasks.map(task => resolveProjectTaskAssigneePersonalIds(task)))
  ).flat()

  const visualizingIds = uniq([
    ...grantPersonalIds,
    ...taskAssigneeIds,
  ]).filter(id => id && !insideSet.has(String(id)))

  const [areaDocs, teamDocs] = await Promise.all([
    areas.size
      ? Area.find({ _id: { $in: [...areas.keys()] } }).lean()
      : Promise.resolve([]),
    teams.size
      ? Team.find({ _id: { $in: [...teams.keys()] } }).lean()
      : Promise.resolve([]),
  ])

  for (const area of areaDocs) {
    const source = manualAccess.miembros_areas.includes(String(area._id))
      ? 'area'
      : 'area_tarea'
    for (const id of area.personal_ids || []) addPersonSource(id, source)
  }

  for (const team of teamDocs) {
    const source = manualAccess.miembros_teams.includes(String(team._id))
      ? 'team'
      : 'team_tarea'
    for (const id of team.personal_ids || []) addPersonSource(id, source)
  }

  for (const id of insideIds) {
    if (!personSources.has(String(id))) addPersonSource(id, 'proyecto')
  }

  for (const id of visualizingIds) {
    if (!personSources.has(String(id))) addPersonSource(id, 'visualizando')
  }

  return {
    personas: [
      ...insideIds.map(id => ({
        id_personal: String(id),
        access: 'inside',
        sources: [...(personSources.get(String(id)) || new Set(['proyecto']))],
        editable: manualAccess.miembros_personal.includes(String(id)),
      })),
      ...visualizingIds.map(id => ({
        id_personal: String(id),
        access: 'visualizing',
        sources: [...(personSources.get(String(id)) || new Set(['visualizando']))],
        editable: false,
      })),
    ],
    areas: areaDocs.map(area => ({
      _id: String(area._id),
      nombre: area.nombre || area.name || '',
      personal_ids: area.personal_ids || [],
      access: areas.get(String(area._id))?.access || 'visualizing',
      sources: areas.get(String(area._id))?.sources || [],
      editable: Boolean(areas.get(String(area._id))?.editable),
    })),
    teams: teamDocs.map(team => ({
      _id: String(team._id),
      nombre: team.nombre || team.name || '',
      personal_ids: team.personal_ids || [],
      access: teams.get(String(team._id))?.access || 'visualizing',
      sources: teams.get(String(team._id))?.sources || [],
      editable: Boolean(teams.get(String(team._id))?.editable),
    })),
    manual: manualAccess,
    counts: {
      inside_personas: insideIds.length,
      visualizing_personas: visualizingIds.length,
      areas: areas.size,
      teams: teams.size,
    },
  }
}

function normalizeState(v) {
  return String(v || '').trim()
}

function normalizeRequestKey(v) {
  const key = String(v || '').trim()
  return key || null
}

function isDuplicateKeyError(err) {
  return Number(err?.code) === 11000
}

const HIDDEN_PROJECT_STATES = ['cerrado', 'Cerrado']

function isHiddenProjectState(v) {
  return HIDDEN_PROJECT_STATES.includes(normalizeState(v))
}

function parseTraceIndex(value, traces, field = 'traceIndex') {
  const index = Number(value)
  if (!Number.isInteger(index) || index < 0 || index >= traces.length) {
    const err = new Error(`${field} inválido.`)
    err.status = 400
    throw err
  }
  return index
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
    const existingProject = await Project.findOne({ ticket_id: ticket._id })
      .select({ miembros_personal: 1, miembros_areas: 1, miembros_teams: 1 })
      .lean()
    const manualAccess = getProjectManualAccess(existingProject)
    const miembros = await buildProjectMembersFromTicket(ticket, manualAccess)

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
          miembros_personal: [],
          miembros_areas: [],
          miembros_teams: [],
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

  const existingProject = await Project.findOne({ ticket_id: ticket._id })
    .select({ miembros_personal: 1, miembros_areas: 1, miembros_teams: 1 })
    .lean()
  const manualAccess = getProjectManualAccess(existingProject)
  const miembros = await buildProjectMembersFromTicket(ticket, manualAccess)

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
        miembros_personal: [],
        miembros_areas: [],
        miembros_teams: [],
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
  include_closed,
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

  const showClosed = String(include_closed || '').toLowerCase() === 'true'
  if (orgId) filter.orgId = String(orgId).trim()
  if (estado) {
    const requestedState = String(estado).trim()
    filter.estado =
      isHiddenProjectState(requestedState) && !showClosed
        ? { $in: [] }
        : requestedState
  } else {
    filter.estado = showClosed
      ? { $in: HIDDEN_PROJECT_STATES }
      : { $nin: HIDDEN_PROJECT_STATES }
  }
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
    assertObjectId(project_id, 'project_id'),
    { includeHidden: true }
  )

  if (!isMember(project, pid)) {
    const err = new Error('No autorizado para ver el proyecto completo.')
    err.status = 403
    throw err
  }

  const [tasks, repository, comments, accessTasks] = await Promise.all([
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
    ProjectTask.find({ project_id: project._id })
      .select({
        _id: 1,
        asignado_tipo: 1,
        assigned_to: 1,
        mentions: 1,
      })
      .lean(),
  ])
  const accessSummary = await buildProjectAccessSummary(project, accessTasks)

  return {
    project: project.toObject(),
    tasks,
    repository,
    comments,
    accessSummary,
  }
}

export async function patchProject({ project_id, id_personal, payload }) {
  const actor = String(id_personal || '').trim()
  if (!actor) {
    const err = new Error('id_personal es requerido.')
    err.status = 400
    throw err
  }

  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id')
  )

  if (!isMember(project, actor)) {
    const err = new Error('Solo miembros pueden editar el proyecto.')
    err.status = 403
    throw err
  }

  const prev = {
    titulo: String(project.titulo || ''),
    descripcion: String(project.descripcion || ''),
    estado: String(project.estado || ''),
  }

  const updates = {}

  if (payload?.titulo !== undefined) {
    const titulo = String(payload.titulo || '').trim()
    if (!titulo) {
      const err = new Error('titulo es requerido.')
      err.status = 400
      throw err
    }
    project.titulo = titulo
    updates.titulo = titulo
  }

  if (payload?.descripcion !== undefined) {
    const descripcion = String(payload.descripcion || '').trim()
    project.descripcion = descripcion
    updates.descripcion = descripcion
  }

  if (payload?.estado !== undefined) {
    project.estado = normalizeState(payload.estado)
  }

  const changed =
    prev.titulo !== String(project.titulo || '') ||
    prev.descripcion !== String(project.descripcion || '') ||
    prev.estado !== String(project.estado || '')

  if (!changed) return project.toObject()

  project.trazabilidad.push({
    tipo: prev.estado !== String(project.estado || '') ? 'estado' : 'comentario',
    estado: String(project.estado || ''),
    titulo: 'Proyecto editado',
    nota: String(payload?.nota || 'Se actualizaron datos generales del proyecto.').trim(),
    mentions: [],
    adjuntos: [],
    changedBy: actor,
    changedAt: new Date(),
  })

  project.updatedBy = actor
  await project.save()

  if (Object.keys(updates).length) {
    await Ticket.findByIdAndUpdate(project.ticket_id, {
      $set: {
        ...updates,
        updatedBy: actor,
      },
    })
  }

  await notifyProject({
    actor,
    project,
    to: projectParticipants(project),
    type: 'project.updated',
    title: `Proyecto ${project.code} editado`,
    body: `Se actualizaron datos generales de ${project.titulo}`,
  })

  return project.toObject()
}

export async function patchProjectAccess({ project_id, id_personal, payload }) {
  const actor = String(id_personal || '').trim()
  if (!actor) {
    const err = new Error('id_personal es requerido.')
    err.status = 400
    throw err
  }

  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id'),
    { includeHidden: true }
  )

  if (!isMember(project, actor)) {
    const err = new Error('Solo miembros pueden editar el acceso del proyecto.')
    err.status = 403
    throw err
  }

  const miembros_personal = uniq(payload?.miembros_personal || [])
  const miembros_areas = uniqObjectIds(payload?.miembros_areas || [])
  const miembros_teams = uniqObjectIds(payload?.miembros_teams || [])

  const [areaCount, teamCount, ticket] = await Promise.all([
    miembros_areas.length
      ? Area.countDocuments({ _id: { $in: miembros_areas } })
      : Promise.resolve(0),
    miembros_teams.length
      ? Team.countDocuments({ _id: { $in: miembros_teams } })
      : Promise.resolve(0),
    Ticket.findById(project.ticket_id).lean(),
  ])

  if (areaCount !== miembros_areas.length) {
    const err = new Error('Una o más áreas no existen.')
    err.status = 400
    throw err
  }

  if (teamCount !== miembros_teams.length) {
    const err = new Error('Uno o más teams no existen.')
    err.status = 400
    throw err
  }

  if (!ticket) {
    const err = new Error('Ticket del proyecto no encontrado.')
    err.status = 404
    throw err
  }

  project.miembros_personal = miembros_personal
  project.miembros_areas = miembros_areas
  project.miembros_teams = miembros_teams
  project.miembros = await buildProjectMembersFromTicket(ticket, {
    miembros_personal,
    miembros_areas,
    miembros_teams,
  })
  project.updatedBy = actor

  project.trazabilidad.push({
    tipo: 'comentario',
    titulo: 'Acceso actualizado',
    nota: String(payload?.nota || 'Se actualizó el acceso del proyecto.').trim(),
    mentions: [],
    adjuntos: [],
    changedBy: actor,
    changedAt: new Date(),
  })

  await project.save()

  await notifyProject({
    actor,
    project,
    to: projectParticipants(project),
    type: 'project.access_updated',
    title: `Acceso actualizado en ${project.code}`,
    body: `Se actualizó quién puede ver el proyecto ${project.titulo}`,
  })

  return getProjectById({ project_id: project._id, id_personal: actor })
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

  const asignado_tipo = String(payload?.asignado_tipo || 'personal').trim()
  const assigned_to = String(payload?.assigned_to || '').trim()
  const prioridad_id = String(payload?.prioridad_id || '').trim()
  const request_key = normalizeRequestKey(
    payload?.request_key || payload?.idempotency_key
  )
  const descripcion = String(payload?.descripcion || '').trim()
  const estado = normalizeState(payload?.estado || 'abierta')
  const due_date = payload?.due_date ? new Date(payload.due_date) : null

  if (!['personal', 'area', 'team'].includes(asignado_tipo)) {
    const err = new Error('asignado_tipo debe ser personal, area o team.')
    err.status = 400
    throw err
  }

  if (!assigned_to) {
    const err = new Error('assigned_to es requerido.')
    err.status = 400
    throw err
  }

  if (!prioridad_id) {
    const err = new Error('prioridad_id es requerido.')
    err.status = 400
    throw err
  }

  if (request_key) {
    const existingTask = await ProjectTask.findOne({
      project_id: project._id,
      request_key,
    }).lean()
    if (existingTask) return existingTask
  }

  if (!request_key) {
    const recentDuplicate = await ProjectTask.findOne({
      project_id: project._id,
      createdBy: actor,
      titulo,
      descripcion,
      prioridad_id,
      estado,
      asignado_tipo,
      assigned_to,
      due_date,
      createdAt: { $gte: new Date(Date.now() - 5000) },
    })
      .sort({ createdAt: -1 })
      .lean()

    if (recentDuplicate) return recentDuplicate
  }

  const reservedProject = await Project.findOneAndUpdate(
    { _id: project._id },
    {
      $inc: { nextTaskSeq: 1 },
      $set: { updatedBy: actor },
    },
    { new: false }
  )

  if (!reservedProject) {
    const err = new Error('Proyecto no encontrado.')
    err.status = 404
    throw err
  }

  const seq = Number(reservedProject.nextTaskSeq || 1)
  const code = `${reservedProject.code}#T-${String(seq).padStart(3, '0')}`

  let task
  try {
    task = await ProjectTask.create({
      project_id: reservedProject._id,
      code,
      seq,
      titulo,
      descripcion,
      prioridad_id,
      prioridad_label: String(payload?.prioridad_label || '').trim(),
      prioridad_color: String(payload?.prioridad_color || '').trim(),
      estado,
      asignado_tipo,
      assigned_to,
      assigned_label: String(payload?.assigned_label || '').trim(),
      due_date,
      mentions: Array.isArray(payload?.mentions) ? payload.mentions : [],
      trazabilidad: [
        {
          estado,
          nota: 'Tarea creada',
          mentions: Array.isArray(payload?.mentions) ? payload.mentions : [],
          adjuntos: Array.isArray(adjuntos) ? adjuntos : [],
          changedBy: actor,
        },
      ],
      ...(request_key ? { request_key } : {}),
      createdBy: actor,
      updatedBy: actor,
      closed_at: isClosedLikeState(payload?.estado) ? new Date() : null,
    })
  } catch (err) {
    if (request_key && isDuplicateKeyError(err)) {
      const existingTask = await ProjectTask.findOne({
        project_id: reservedProject._id,
        request_key,
      }).lean()
      if (existingTask) return existingTask
    }
    throw err
  }

  await ensureTaskAccessGrants({ project: reservedProject, task, actor })

  const mentionIds = (task.mentions || []).map(m => m?.id_personal)
  const assigneeIds = await resolveProjectTaskAssigneePersonalIds(task)
  const notifyTo = projectParticipants(reservedProject, [
    ...assigneeIds,
    ...mentionIds,
  ])

  await notifyProject({
    actor,
    project: reservedProject,
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

  const [grants, assignmentFilters] = await Promise.all([
    ProjectAccessGrant.find({
      project_id: project._id,
      id_personal: pid,
      resource_type: 'task',
      active: true,
    }).lean(),
    getUserProjectTaskAssignmentFilters(pid),
  ])

  const grantedIds = grants
    .map(g => String(g.resource_id || '').trim())
    .filter(x => mongoose.Types.ObjectId.isValid(x))
    .map(x => new mongoose.Types.ObjectId(x))

  return ProjectTask.find({
    project_id: project._id,
    $or: [...assignmentFilters, { _id: { $in: grantedIds } }],
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

  if (!task) {
    const err = new Error('Tarea no encontrada.')
    err.status = 404
    throw err
  }

  const prevState = {
    estado: String(task.estado || ''),
    asignado_tipo: String(task.asignado_tipo || 'personal'),
    assigned_to: String(task.assigned_to || ''),
  }

  const member = isMember(project, pid)
  const allowedByAssign = await canAccessTaskByAssignment(task, pid)

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
    'prioridad_id',
    'prioridad_label',
    'prioridad_color',
    'estado',
    'asignado_tipo',
    'assigned_to',
    'assigned_label',
    'due_date',
  ]
  for (const k of editable) {
    if (payload[k] !== undefined) {
      if (k === 'due_date') task[k] = payload[k] ? new Date(payload[k]) : null
      else if (k === 'estado') task[k] = normalizeState(payload[k])
      else task[k] = String(payload[k] || '').trim()
    }
  }

  task.closed_at = isClosedLikeState(task.estado) ? new Date() : null

  task.updatedBy = pid
  await task.save()

  await ensureTaskAccessGrants({ project, task, actor: pid })

  const assigneeIds = await resolveProjectTaskAssigneePersonalIds(task)
  const prevAssigneeIds = await resolveProjectTaskAssigneePersonalIds({
    asignado_tipo: prevState.asignado_tipo,
    assigned_to: prevState.assigned_to,
  })
  const notifyTo = projectParticipants(project, [
    ...assigneeIds,
    ...prevAssigneeIds,
  ])
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
  const allowedByAssign = await canAccessTaskByAssignment(task, actor)

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

  await ensureTaskAccessGrants({ project, task, actor })
  await Promise.all(
    uniq(mentions.map(m => m?.id_personal))
      .filter(id => id && !isMember(project, id))
      .map(id =>
        ensureGrant({
          project_id: project._id,
          id_personal: id,
          resource_type: 'task',
          resource_id: String(task._id),
          source: 'mention',
          actor,
        })
      )
  )

  const mentionIds = mentions.map(m => m?.id_personal)
  const assigneeIds = await resolveProjectTaskAssigneePersonalIds(task)
  const notifyTo = projectParticipants(project, [...assigneeIds, ...mentionIds])

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

export async function patchTaskTrace({
  project_id,
  task_id,
  trace_index,
  id_personal,
  payload,
}) {
  const actor = String(id_personal || '').trim()
  const project = await getProjectStrict(
    assertObjectId(project_id, 'project_id'),
    { includeHidden: true }
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

  if (!isMember(project, actor)) {
    const err = new Error('Solo miembros pueden editar trazabilidad de la tarea.')
    err.status = 403
    throw err
  }

  const traces = Array.isArray(task.trazabilidad) ? task.trazabilidad : []
  const index = parseTraceIndex(trace_index, traces)
  const current = traces[index]
  const tipo = String(payload?.tipo || current?.tipo || 'estado').trim()
  const validTipos = ['estado', 'comentario', 'bloqueador', 'progreso']

  if (!validTipos.includes(tipo)) {
    const err = new Error(`tipo debe ser uno de: ${validTipos.join(', ')}`)
    err.status = 400
    throw err
  }

  const estado = normalizeState(
    payload?.estado !== undefined ? payload.estado : current?.estado
  )
  const nota = String(
    payload?.nota !== undefined ? payload.nota : current?.nota || ''
  ).trim()

  if (!nota) {
    const err = new Error('nota es requerida para trazabilidad.')
    err.status = 400
    throw err
  }

  current.tipo = tipo
  current.estado = estado
  current.nota = nota
  current.changedBy = actor
  current.changedAt = new Date()
  task.trazabilidad[index] = current

  if (estado) {
    task.estado = estado
    task.closed_at = isClosedLikeState(estado) ? new Date() : null
  }

  task.updatedBy = actor
  task.markModified('trazabilidad')
  await task.save()

  await notifyProject({
    actor,
    project,
    to: projectParticipants(project, [task.assigned_to]),
    type: 'project.task_trace_updated',
    title: `Trazabilidad editada en ${task.code}`,
    body: nota.slice(0, 160),
    extraTarget: { taskId: String(task._id), taskCode: task.code },
    meta: {
      taskId: String(task._id),
      taskCode: task.code,
      traceIndex: index,
      estado,
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

export async function patchProjectTrace({
  project_id,
  trace_index,
  id_personal,
  payload,
}) {
  const actor = String(id_personal || '').trim()
  const projectOid = assertObjectId(project_id, 'project_id')
  const project = await getProjectStrict(projectOid, { includeHidden: true })

  if (!isMember(project, actor)) {
    const err = new Error('Solo miembros pueden editar trazabilidad del proyecto.')
    err.status = 403
    throw err
  }

  const traces = Array.isArray(project.trazabilidad) ? project.trazabilidad : []
  const index = parseTraceIndex(trace_index, traces)
  const current = traces[index]
  const tipo = String(payload?.tipo || current?.tipo || 'comentario').trim()
  const validTipos = ['estado', 'comentario', 'hito', 'decision']

  if (!validTipos.includes(tipo)) {
    const err = new Error(`tipo debe ser uno de: ${validTipos.join(', ')}`)
    err.status = 400
    throw err
  }

  const titulo = String(
    payload?.titulo !== undefined ? payload.titulo : current?.titulo || ''
  ).trim()
  const nota = String(
    payload?.nota !== undefined ? payload.nota : current?.nota || ''
  ).trim()
  const estado = normalizeState(
    payload?.estado !== undefined ? payload.estado : current?.estado
  )

  if (!nota && !titulo) {
    const err = new Error('nota o titulo es requerido para trazabilidad.')
    err.status = 400
    throw err
  }

  current.tipo = tipo
  current.titulo = titulo
  current.nota = nota
  current.estado = tipo === 'estado' ? estado : ''
  current.changedBy = actor
  current.changedAt = new Date()
  project.trazabilidad[index] = current

  if (tipo === 'estado' && estado) {
    project.estado = estado
  }

  project.updatedBy = actor
  project.markModified('trazabilidad')
  await project.save()

  await notifyProject({
    actor,
    project,
    to: projectParticipants(project),
    type: 'project.trace_updated',
    title: `Trazabilidad editada en proyecto ${project.code}`,
    body: nota.slice(0, 160) || titulo,
    meta: {
      projectId: String(project._id),
      projectCode: project.code,
      traceIndex: index,
      tipo,
      estado,
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
  const [assignmentFilters, taskGrants] = await Promise.all([
    getUserProjectTaskAssignmentFilters(pid),
    ProjectAccessGrant.find({
      id_personal: pid,
      resource_type: 'task',
      active: true,
    }).lean(),
  ])
  const grantedTaskIds = taskGrants
    .map(g => String(g.resource_id || '').trim())
    .filter(x => mongoose.Types.ObjectId.isValid(x))
    .map(x => new mongoose.Types.ObjectId(x))

  const [tasks, mentions] = await Promise.all([
    ProjectTask.find({
      $or: [...assignmentFilters, { _id: { $in: grantedTaskIds } }],
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
    activo: true,
    estado: { $nin: HIDDEN_PROJECT_STATES },
    _id: {
      $in: uniq(
        tasks
          .map(t => String(t.project_id))
          .concat(mentions.map(m => String(m.project_id)))
      )
        .filter(x => mongoose.Types.ObjectId.isValid(x))
        .map(x => new mongoose.Types.ObjectId(x)),
    },
  })
    .select({ _id: 1, code: 1, titulo: 1, orgId: 1, estado: 1 })
    .lean()

  const projectMap = Object.fromEntries(
    projects.map(p => [String(p._id), projectPreview(p)])
  )

  return {
    assigned_tasks: tasks
      .filter(t => projectMap[String(t.project_id)])
      .map(t => ({
        ...t,
        project: projectMap[String(t.project_id)],
      })),
    mentions: mentions
      .filter(m => projectMap[String(m.project_id)])
      .map(m => ({
        ...m,
        project: projectMap[String(m.project_id)],
      })),
  }
}

export async function listRepoNodes({ project_id }) {
  const pid = assertObjectId(project_id, 'project_id')
  await getProjectStrict(pid)

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

  const isConsolidableAttachment = a => {
    const tipo = String(a?.tipo || '').trim().toLowerCase()
    const url = String(a?.url || '').trim()
    if (!url) return false
    return tipo === 'url' || tipo === 'archivo' || !!a?.fileId
  }

  // Obtener proyecto con su trazabilidad
  const project = await Project.findById(pid).lean()
  if (!project || isHiddenProjectState(project.estado)) return []

  const projectFiles = (project.trazabilidad || []).flatMap(t =>
    (t.adjuntos || [])
      .filter(isConsolidableAttachment)
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
        .filter(isConsolidableAttachment)
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
  const actor = String(id_personal || '').trim()

  const project = await getProjectStrict(pid)

  if (!isMember(project, actor)) {
    const err = new Error('Solo miembros del proyecto pueden crear en repositorio.')
    err.status = 403
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
    if (
      !parentNode ||
      parentNode.type !== 'folder' ||
      String(parentNode.project_id) !== String(pid)
    ) {
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
