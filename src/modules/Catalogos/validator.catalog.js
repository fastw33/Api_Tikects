// src/modules/Catalogos/validator.catalog.js

const ALLOWED_TYPES = [
  'categoria',
  'prioridad',
  'estado',
  'servicio_operacion',
  'motivo_cancelacion',
]

function mustQuery(req, key) {
  return req.query?.[key] !== undefined && String(req.query[key]).trim() !== ''
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

function isHexColor(v) {
  return typeof v === 'string' && /^#([0-9A-Fa-f]{3}){1,2}$/.test(v.trim())
}

export function validateListCatalog(req, res, next) {
  const errors = []

  if (!mustQuery(req, 'orgId') || !isNonEmptyString(req.query.orgId))
    errors.push('orgId (query) es requerido y debe ser string.')

  if (!mustQuery(req, 'type') || !ALLOWED_TYPES.includes(req.query.type))
    errors.push(`type (query) inválido. Use: ${ALLOWED_TYPES.join(', ')}`)

  // paginación
  if (!mustQuery(req, 'page')) errors.push('page (query) es requerido.')
  if (!mustQuery(req, 'limit')) errors.push('limit (query) es requerido.')

  const page = Number(req.query.page)
  const limit = Number(req.query.limit)

  if (!Number.isInteger(page) || page < 1)
    errors.push('page debe ser entero >= 1.')
  if (!Number.isInteger(limit) || limit < 1)
    errors.push('limit debe ser entero >= 1.')
  if (limit > 100) errors.push('limit no puede ser mayor a 100.')

  if (
    req.query.active !== undefined &&
    !['true', 'false'].includes(String(req.query.active))
  ) {
    errors.push('active (query) debe ser true o false.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateCreateCatalog(req, res, next) {
  const { orgId, type, code, name, description, order, active, meta, color } =
    req.body

  const errors = []

  if (!isNonEmptyString(orgId))
    errors.push('orgId (body) es requerido y debe ser string.')

  if (!type || !ALLOWED_TYPES.includes(type))
    errors.push(`type (body) inválido. Use: ${ALLOWED_TYPES.join(', ')}`)

  if (!isNonEmptyString(code))
    errors.push('code es requerido y debe ser string.')
  if (code && code.trim().length > 40)
    errors.push('code no puede superar 40 caracteres.')

  if (!isNonEmptyString(name))
    errors.push('name es requerido y debe ser string.')
  if (name && name.trim().length > 80)
    errors.push('name no puede superar 80 caracteres.')

  if (description !== undefined && typeof description !== 'string')
    errors.push('description debe ser string.')
  if (typeof description === 'string' && description.length > 500)
    errors.push('description no puede superar 500 caracteres.')

  if (order !== undefined && !Number.isFinite(Number(order)))
    errors.push('order debe ser numérico.')
  if (active !== undefined && typeof active !== 'boolean')
    errors.push('active debe ser boolean.')
  if (meta !== undefined && typeof meta !== 'object')
    errors.push('meta debe ser un objeto.')

  // ✅ color opcional (HEX)
  if (color !== undefined && String(color).trim() !== '') {
    if (!isHexColor(color))
      errors.push('color debe ser HEX válido. Ej: #16a34a')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateUpdateCatalog(req, res, next) {
  const errors = []
  const { code, name, description, order, active, meta, color } = req.body

  const hasAny =
    code !== undefined ||
    name !== undefined ||
    description !== undefined ||
    order !== undefined ||
    active !== undefined ||
    meta !== undefined ||
    color !== undefined

  if (!hasAny) errors.push('Debes enviar al menos un campo para actualizar.')

  if (code !== undefined) {
    if (!isNonEmptyString(code)) errors.push('code debe ser string no vacío.')
    else if (code.trim().length > 40)
      errors.push('code no puede superar 40 caracteres.')
  }

  if (name !== undefined) {
    if (!isNonEmptyString(name)) errors.push('name debe ser string no vacío.')
    else if (name.trim().length > 80)
      errors.push('name no puede superar 80 caracteres.')
  }

  if (description !== undefined && typeof description !== 'string')
    errors.push('description debe ser string.')
  if (typeof description === 'string' && description.length > 500)
    errors.push('description no puede superar 500 caracteres.')

  if (order !== undefined && !Number.isFinite(Number(order)))
    errors.push('order debe ser numérico.')
  if (active !== undefined && typeof active !== 'boolean')
    errors.push('active debe ser boolean.')
  if (meta !== undefined && typeof meta !== 'object')
    errors.push('meta debe ser un objeto.')

  // ✅ color opcional (HEX)
  if (color !== undefined && String(color).trim() !== '') {
    if (!isHexColor(color))
      errors.push('color debe ser HEX válido. Ej: #16a34a')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateIdParam(req, res, next) {
  const { id } = req.params
  if (!id || typeof id !== 'string')
    return res.status(400).json({ ok: false, error: 'id inválido' })
  next()
}
