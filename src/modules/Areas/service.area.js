// service.area.js
import { Area } from './model.area.js'

function normalizeName(nombre) {
  return String(nombre).toLowerCase().trim()
}

function parsePaging({ page, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)
  const skip = (safePage - 1) * safeLimit
  return { safePage, safeLimit, skip }
}

export async function createArea({
  nombre,
  descripcion = '',
  personal_ids = [],
}) {
  const nombre_normalizado = normalizeName(nombre)

  const exists = await Area.findOne({ nombre_normalizado }).lean()
  if (exists) {
    const err = new Error('Ya existe un área con ese nombre.')
    err.status = 409
    throw err
  }

  const doc = await Area.create({
    nombre: nombre.trim(),
    nombre_normalizado,
    descripcion: (descripcion ?? '').trim(),
    personal_ids,
  })

  return doc
}

// GET list con paginación + orden por inserción (último primero)
export async function listAreas({ search, activo, page, limit }) {
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
    Area.find(q).sort({ $natural: -1 }).skip(skip).limit(safeLimit).lean(),
    Area.countDocuments(q),
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

export async function getAreaById(id) {
  const area = await Area.findById(id).lean()
  if (!area) {
    const err = new Error('Área no encontrada.')
    err.status = 404
    throw err
  }
  return area
}

export async function updateArea(id, payload) {
  const update = {}

  if (payload.nombre !== undefined) {
    update.nombre = payload.nombre.trim()
    update.nombre_normalizado = normalizeName(payload.nombre)
  }
  if (payload.descripcion !== undefined)
    update.descripcion = String(payload.descripcion ?? '').trim()
  if (payload.personal_ids !== undefined)
    update.personal_ids = payload.personal_ids
  if (payload.activo !== undefined) update.activo = payload.activo

  try {
    const updated = await Area.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).lean()
    if (!updated) {
      const err = new Error('Área no encontrada.')
      err.status = 404
      throw err
    }
    return updated
  } catch (e) {
    if (e?.code === 11000) {
      const err = new Error('Ya existe un área con ese nombre.')
      err.status = 409
      throw err
    }
    throw e
  }
}

export async function deactivateArea(id) {
  const updated = await Area.findByIdAndUpdate(
    id,
    { activo: false },
    { new: true }
  ).lean()
  if (!updated) {
    const err = new Error('Área no encontrada.')
    err.status = 404
    throw err
  }
  return updated
}
