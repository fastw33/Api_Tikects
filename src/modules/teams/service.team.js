// service.team.js
import { Team } from './model.team.js'

function norm(v) {
  return String(v).toLowerCase().trim()
}

function parsePaging({ page, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)
  const skip = (safePage - 1) * safeLimit
  return { safePage, safeLimit, skip }
}

function trimUniq(arr) {
  return [...new Set(arr.map(x => String(x).trim()))].filter(x => x.length > 0)
}

export async function createTeam({
  nombre,
  descripcion = '',
  personal_ids,
  lider_ids = [],
  id_personal,
}) {
  const members = trimUniq(personal_ids)
  if (members.length < 1) {
    const err = new Error('personal_ids debe tener al menos 1 miembro.')
    err.status = 400
    throw err
  }

  // líderes: limpiar y forzar subset
  const leaders = trimUniq(lider_ids).filter(x => members.includes(x))

  try {
    const doc = await Team.create({
      nombre: nombre.trim(),
      nombre_norm: norm(nombre),
      descripcion: (descripcion ?? '').trim(),
      personal_ids: members,
      lider_ids: leaders,
      activo: true,
      createdBy: String(id_personal).trim(),
      updatedBy: String(id_personal).trim(),
    })
    return doc.toObject()
  } catch (e) {
    if (e?.code === 11000) {
      const err = new Error('Ya existe un team con ese nombre.')
      err.status = 409
      throw err
    }
    throw e
  }
}

export async function listTeams({ search, activo, page, limit }) {
  const q = {}

  if (typeof activo === 'boolean') q.activo = activo

  if (search && String(search).trim()) {
    const s = String(search).trim()
    q.$or = [
      { nombre: { $regex: s, $options: 'i' } },
      { descripcion: { $regex: s, $options: 'i' } },
    ]
  }

  const { safePage, safeLimit, skip } = parsePaging({ page, limit })

  const [items, total] = await Promise.all([
    Team.find(q)
      .sort({ $natural: -1 }) // último insertado primero
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Team.countDocuments(q),
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

export async function getTeamById(id) {
  const team = await Team.findById(id).lean()
  if (!team) {
    const err = new Error('Team no encontrado.')
    err.status = 404
    throw err
  }
  return team
}

export async function updateTeam(id, patch) {
  const update = {
    updatedBy: String(patch.id_personal).trim(),
  }

  if (patch.nombre !== undefined) {
    update.nombre = patch.nombre.trim()
    update.nombre_norm = norm(patch.nombre)
  }

  if (patch.descripcion !== undefined)
    update.descripcion = String(patch.descripcion ?? '').trim()
  if (patch.activo !== undefined) update.activo = patch.activo

  // Si actualizan miembros, deben quedar >= 1 y limpiar líderes inválidos
  let newMembers = null
  if (patch.personal_ids !== undefined) {
    newMembers = trimUniq(patch.personal_ids)
    if (newMembers.length < 1) {
      const err = new Error('personal_ids debe tener al menos 1 miembro.')
      err.status = 400
      throw err
    }
    update.personal_ids = newMembers
  }

  // Si envían lider_ids, se ajusta a miembros (del payload si viene, o del documento actual)
  if (patch.lider_ids !== undefined) {
    const wantedLeaders = trimUniq(patch.lider_ids)

    if (newMembers) {
      update.lider_ids = wantedLeaders.filter(x => newMembers.includes(x))
    } else {
      // si no viene personal_ids, necesitamos el team actual para validar subset
      const current = await Team.findById(id).lean()
      if (!current) {
        const err = new Error('Team no encontrado.')
        err.status = 404
        throw err
      }
      const members = current.personal_ids || []
      update.lider_ids = wantedLeaders.filter(x => members.includes(x))
    }
  } else if (newMembers) {
    // Si NO enviaron lider_ids pero sí cambiaron miembros: limpiar líderes actuales que ya no estén
    const current = await Team.findById(id).lean()
    if (!current) {
      const err = new Error('Team no encontrado.')
      err.status = 404
      throw err
    }
    update.lider_ids = (current.lider_ids || []).filter(x =>
      newMembers.includes(x)
    )
  }

  try {
    const updated = await Team.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).lean()
    if (!updated) {
      const err = new Error('Team no encontrado.')
      err.status = 404
      throw err
    }
    return updated
  } catch (e) {
    if (e?.code === 11000) {
      const err = new Error('Ya existe un team con ese nombre.')
      err.status = 409
      throw err
    }
    throw e
  }
}

export async function deactivateTeam(id, id_personal) {
  const updated = await Team.findByIdAndUpdate(
    id,
    { activo: false, updatedBy: String(id_personal).trim() },
    { new: true }
  ).lean()

  if (!updated) {
    const err = new Error('Team no encontrado.')
    err.status = 404
    throw err
  }
  return updated
}
