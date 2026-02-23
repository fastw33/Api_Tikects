import { Catalog } from './model.catalog.js'

function norm(v) {
  return String(v).toLowerCase().trim()
}

// Hook de seguridad (placeholder)
export async function assertUserCanAccessOrg(_user, _orgId) {
  return true
}

function parsePaging({ page, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)
  const skip = (safePage - 1) * safeLimit
  return { safePage, safeLimit, skip }
}

// ===============================
// CREATE
// ===============================
export async function createCatalogItem({
  orgId,
  userId,
  type,
  code,
  name,
  description,
  color, // ✅ RECIBIR
  order,
  active,
  meta,
}) {
  const doc = await Catalog.create({
    orgId,
    type,
    code: code.trim(),
    name: name.trim(),
    description: (description ?? '').trim(),
    color: (color ?? '').trim(), // ✅ GUARDAR
    order: Number.isFinite(Number(order)) ? Number(order) : 0,
    active: active ?? true,
    meta: meta ?? {},
    createdBy: userId,
    updatedBy: userId,
    code_norm: norm(code),
    name_norm: norm(name),
  })

  return doc.toObject()
}

// ===============================
// LIST
// ===============================
export async function listCatalog({
  orgId,
  type,
  search,
  active,
  page,
  limit,
}) {
  const q = { orgId, type }

  if (typeof active === 'boolean') q.active = active

  if (search && String(search).trim()) {
    const s = String(search).trim()
    q.$or = [
      { name: { $regex: s, $options: 'i' } },
      { code: { $regex: s, $options: 'i' } },
    ]
  }

  const { safePage, safeLimit, skip } = parsePaging({ page, limit })

  const [items, total] = await Promise.all([
    Catalog.find(q).sort({ $natural: -1 }).skip(skip).limit(safeLimit).lean(),
    Catalog.countDocuments(q),
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

// ===============================
// GET BY ID
// ===============================
export async function getCatalogById({ orgId, id }) {
  const doc = await Catalog.findOne({ _id: id, orgId }).lean()
  if (!doc) {
    const err = new Error('Item de catálogo no encontrado.')
    err.status = 404
    throw err
  }
  return doc
}

// ===============================
// UPDATE
// ===============================
export async function updateCatalog({ orgId, id, userId, patch }) {
  const update = { updatedBy: userId }

  if (patch.code !== undefined) {
    update.code = patch.code.trim()
    update.code_norm = norm(patch.code)
  }

  if (patch.name !== undefined) {
    update.name = patch.name.trim()
    update.name_norm = norm(patch.name)
  }

  if (patch.description !== undefined)
    update.description = String(patch.description ?? '').trim()

  if (patch.color !== undefined) update.color = (patch.color ?? '').trim() // ✅ ACTUALIZAR

  if (patch.order !== undefined) update.order = Number(patch.order)
  if (patch.active !== undefined) update.active = patch.active
  if (patch.meta !== undefined) update.meta = patch.meta

  try {
    const updated = await Catalog.findOneAndUpdate({ _id: id, orgId }, update, {
      new: true,
      runValidators: true,
    }).lean()

    if (!updated) {
      const err = new Error('Item de catálogo no encontrado.')
      err.status = 404
      throw err
    }

    return updated
  } catch (e) {
    if (e?.code === 11000) {
      const err = new Error(
        'Ya existe un item con ese code o name en este tipo.'
      )
      err.status = 409
      throw err
    }
    throw e
  }
}

// ===============================
// DEACTIVATE
// ===============================
export async function deactivateCatalog({ orgId, id, userId }) {
  const updated = await Catalog.findOneAndUpdate(
    { _id: id, orgId },
    { active: false, updatedBy: userId },
    { new: true }
  ).lean()

  if (!updated) {
    const err = new Error('Item de catálogo no encontrado.')
    err.status = 404
    throw err
  }
  return updated
}
