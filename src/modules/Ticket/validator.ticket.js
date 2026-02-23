import mongoose from 'mongoose'

const isObjectId = v => mongoose.Types.ObjectId.isValid(v)

// ======================================================
// Helpers base
// ======================================================
function isValidIdPersonal(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 80
}

function isValidOrgIdString(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 120
}

function uniqTrim(arr) {
  return [...new Set(arr.map(x => String(x).trim()))].filter(Boolean)
}

function isValidDate(v) {
  const d = new Date(v)
  return !isNaN(d.getTime())
}

function toArray(v) {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function readBracketObject(body, prefix) {
  // Ej: prefix="asignado_a" => asignado_a[tipo], asignado_a[id]
  const tipo = body?.[`${prefix}[tipo]`]
  const id = body?.[`${prefix}[id]`]
  if (tipo === undefined && id === undefined) return undefined
  return { tipo, id }
}

function readOperacionFromBracket(body) {
  const subtipo = body?.['operacion[subtipo]']
  const cliente = body?.['operacion[cliente]']
  const lote = body?.['operacion[lote]']
  const producto = body?.['operacion[producto]']

  const apoyo_ids = toArray(body?.['operacion[apoyo_ids][]'])
    .map(String)
    .filter(Boolean)
  const servicios_adicionales = toArray(
    body?.['operacion[servicios_adicionales][]']
  )
    .map(String)
    .filter(Boolean)

  if (
    subtipo === undefined &&
    cliente === undefined &&
    lote === undefined &&
    producto === undefined &&
    !apoyo_ids.length &&
    !servicios_adicionales.length
  ) {
    return undefined
  }

  const op = {}
  if (subtipo !== undefined) op.subtipo = subtipo
  if (cliente !== undefined) op.cliente = cliente
  if (lote !== undefined) op.lote = lote
  if (producto !== undefined) op.producto = producto
  if (apoyo_ids.length) op.apoyo_ids = apoyo_ids
  if (servicios_adicionales.length)
    op.servicios_adicionales = servicios_adicionales

  return op
}

function parseMaybeJSON(value) {
  // Soporta form-data donde mandan un objeto/array como string JSON
  if (typeof value !== 'string') return value
  const s = value.trim()
  if (!s) return value
  if (!(s.startsWith('{') || s.startsWith('['))) return value
  try {
    return JSON.parse(s)
  } catch {
    return value
  }
}

// ======================================================
// Validadores compuestos
// ======================================================
function validateAsignadoA(asignado_a, errors) {
  if (!asignado_a || typeof asignado_a !== 'object') {
    errors.push('asignado_a es requerido.')
    return
  }

  const tipo = String(asignado_a.tipo ?? '').trim()
  const id = asignado_a.id

  if (!['area', 'team', 'personal'].includes(tipo)) {
    errors.push('asignado_a.tipo debe ser area | team | personal.')
    return
  }

  if (tipo === 'personal') {
    if (!isValidIdPersonal(id)) {
      errors.push(
        'asignado_a.id debe ser id_personal válido cuando tipo=personal.'
      )
    }
  } else {
    if (typeof id !== 'string' || !isObjectId(id)) {
      errors.push(
        'asignado_a.id debe ser ObjectId válido cuando tipo=area|team.'
      )
    }
  }
}

function validateAttachmentsArray(adjuntos, errors) {
  if (!Array.isArray(adjuntos)) {
    errors.push('adjuntos debe ser un array.')
    return
  }

  const seen = new Set()
  for (const a of adjuntos) {
    if (!a || typeof a !== 'object') {
      errors.push('Cada adjunto debe ser un objeto.')
      break
    }
    if (!a.fileId || typeof a.fileId !== 'string' || !a.fileId.trim()) {
      errors.push('Cada adjunto requiere fileId (string).')
      break
    }
    const key = a.fileId.trim()
    if (seen.has(key)) {
      errors.push('adjuntos no puede tener fileId duplicados.')
      break
    }
    seen.add(key)
  }
}

function validateNota(nota, errors, fieldName = 'nota') {
  if (nota === undefined) return
  if (typeof nota !== 'string') errors.push(`${fieldName} debe ser string.`)
  else if (nota.trim().length > 25000)
    errors.push(`${fieldName} máximo 25000 caracteres.`)
}

// ======================================================
// LIST (GET) – SIEMPRE PAGINADO
// ======================================================
export function validateListTickets(req, res, next) {
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

  const {
    tipo,
    estado_id,
    prioridad_id,
    categoria_id,
    orgId,
    operacion_subtipo,
    fecha_estimada_desde,
    fecha_estimada_hasta,
    area_id,
    team_id,
  } = req.query

  if (
    tipo !== undefined &&
    !['tarea', 'proyecto', 'operacion'].includes(String(tipo))
  ) {
    errors.push('tipo (query) inválido.')
  }

  if (
    operacion_subtipo !== undefined &&
    !['comercio', 'bodega'].includes(String(operacion_subtipo))
  ) {
    errors.push('operacion_subtipo inválido (comercio|bodega).')
  }

  for (const [k, v] of Object.entries({
    estado_id,
    prioridad_id,
    categoria_id,
  })) {
    if (v !== undefined && !isObjectId(v))
      errors.push(`${k} (query) debe ser ObjectId válido.`)
  }

  if (orgId !== undefined && !isValidOrgIdString(String(orgId)))
    errors.push('orgId (query) debe ser string válido.')

  if (area_id !== undefined && !isObjectId(area_id))
    errors.push('area_id (query) debe ser ObjectId válido.')
  if (team_id !== undefined && !isObjectId(team_id))
    errors.push('team_id (query) debe ser ObjectId válido.')

  if (fecha_estimada_desde !== undefined && !isValidDate(fecha_estimada_desde))
    errors.push('fecha_estimada_desde debe ser fecha válida.')
  if (fecha_estimada_hasta !== undefined && !isValidDate(fecha_estimada_hasta))
    errors.push('fecha_estimada_hasta debe ser fecha válida.')

  if (
    req.query.activo !== undefined &&
    !['true', 'false'].includes(String(req.query.activo))
  ) {
    errors.push('activo (query) debe ser true o false.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

// ======================================================
// PARAM ID
// ======================================================
export function validateTicketIdParam(req, res, next) {
  const { id } = req.params
  if (!isObjectId(id))
    return res.status(400).json({ ok: false, error: 'id inválido' })
  next()
}

// ======================================================
// CREATE (form-data compatible)
// ======================================================
export function validateCreateTicket(req, res, next) {
  const errors = []

  // multer debe poner req.body siempre en multipart; si no, esto es un error de middleware
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      ok: false,
      errors: [
        'Body no disponible. Verifica que la ruta use multer (uploadAny.any()).',
      ],
    })
  }

  // Lee directo o desde JSON string o desde bracket keys
  let {
    orgId,
    tipo,
    titulo,
    descripcion,
    categoria_id,
    prioridad_id,
    estado_id,
    asignado_a,
    creado_por,
    watchers,
    adjuntos,
    operacion,
    fecha_estimada,
    nota_estado,
  } = req.body

  asignado_a =
    parseMaybeJSON(asignado_a) || readBracketObject(req.body, 'asignado_a')

  operacion = parseMaybeJSON(operacion) || readOperacionFromBracket(req.body)

  watchers = parseMaybeJSON(watchers)
  if (watchers === undefined) watchers = toArray(req.body['watchers[]'])
  if (!Array.isArray(watchers) && watchers !== undefined) watchers = [watchers]
  watchers = Array.isArray(watchers)
    ? watchers.map(String).filter(Boolean)
    : undefined

  // adjuntos normalmente los arma el controller desde req.files.
  // Pero si el cliente los manda (como JSON string), lo aceptamos y validamos.
  adjuntos = parseMaybeJSON(adjuntos)

  if (!orgId || !isValidOrgIdString(orgId))
    errors.push('orgId es requerido y debe ser string válido.')

  if (!tipo || !['tarea', 'proyecto', 'operacion'].includes(String(tipo))) {
    errors.push('tipo es requerido (tarea|proyecto|operacion).')
  }

  if (!titulo || typeof titulo !== 'string' || !titulo.trim())
    errors.push('titulo es requerido.')
  if (!descripcion || typeof descripcion !== 'string' || !descripcion.trim())
    errors.push('descripcion es requerido.')

  if (!categoria_id || !isObjectId(categoria_id))
    errors.push('categoria_id es requerido.')
  if (!prioridad_id || !isObjectId(prioridad_id))
    errors.push('prioridad_id es requerido.')
  if (!estado_id || !isObjectId(estado_id))
    errors.push('estado_id es requerido.')

  if (!creado_por || !isValidIdPersonal(creado_por))
    errors.push('creado_por es requerido (id_personal).')

  if (
    fecha_estimada !== undefined &&
    String(fecha_estimada).trim() !== '' &&
    !isValidDate(fecha_estimada)
  ) {
    errors.push('fecha_estimada debe ser fecha válida.')
  }

  validateAsignadoA(asignado_a, errors)
  validateNota(nota_estado, errors, 'nota_estado')

  if (watchers !== undefined) {
    if (!Array.isArray(watchers)) errors.push('watchers debe ser array.')
    else if (uniqTrim(watchers).some(x => !isValidIdPersonal(x)))
      errors.push('watchers debe contener id_personal válidos.')
  }

  if (adjuntos !== undefined && adjuntos !== null)
    validateAttachmentsArray(adjuntos, errors)

  if (String(tipo) === 'operacion') {
    if (!operacion || typeof operacion !== 'object')
      errors.push('operacion es requerida cuando tipo=operacion.')
    else {
      const subtipo = String(operacion.subtipo ?? '').trim()
      if (!['comercio', 'bodega'].includes(subtipo))
        errors.push('operacion.subtipo es requerido (comercio|bodega).')

      if (
        !operacion.cliente ||
        typeof operacion.cliente !== 'string' ||
        !operacion.cliente.trim()
      ) {
        errors.push('operacion.cliente es requerido.')
      }

      // opcionales con arrays
      if (operacion.apoyo_ids !== undefined) {
        const a = Array.isArray(operacion.apoyo_ids)
          ? operacion.apoyo_ids
          : [operacion.apoyo_ids]
        if (uniqTrim(a).some(x => !isValidIdPersonal(x)))
          errors.push('operacion.apoyo_ids debe contener id_personal válidos.')
      }
      if (operacion.servicios_adicionales !== undefined) {
        const s = Array.isArray(operacion.servicios_adicionales)
          ? operacion.servicios_adicionales
          : [operacion.servicios_adicionales]
        const ok = s.every(
          x =>
            typeof x === 'string' &&
            x.trim().length > 0 &&
            x.trim().length <= 120
        )
        if (!ok)
          errors.push(
            'operacion.servicios_adicionales debe ser array de strings válidos.'
          )
      }
    }
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

// ======================================================
// PUT (EXCEPCIONAL)
// ======================================================
export function validatePutTicket(req, res, next) {
  const errors = []

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      ok: false,
      errors: ['Body no disponible.'],
    })
  }

  let {
    id_personal,
    orgId,
    tipo,
    titulo,
    descripcion,
    categoria_id,
    prioridad_id,
    estado_id,
    asignado_a,
    watchers,
    adjuntos,
    operacion,
    activo,
    fecha_estimada,
    nota_estado,
  } = req.body

  asignado_a =
    parseMaybeJSON(asignado_a) || readBracketObject(req.body, 'asignado_a')
  operacion = parseMaybeJSON(operacion) || readOperacionFromBracket(req.body)

  watchers = parseMaybeJSON(watchers)
  if (watchers === undefined) watchers = toArray(req.body['watchers[]'])
  if (!Array.isArray(watchers) && watchers !== undefined) watchers = [watchers]
  watchers = Array.isArray(watchers)
    ? watchers.map(String).filter(Boolean)
    : undefined

  adjuntos = parseMaybeJSON(adjuntos)

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')

  if (orgId !== undefined && !isValidOrgIdString(String(orgId)))
    errors.push('orgId debe ser string válido.')

  if (
    tipo !== undefined &&
    !['tarea', 'proyecto', 'operacion'].includes(String(tipo))
  )
    errors.push('tipo inválido.')

  if (titulo !== undefined && (typeof titulo !== 'string' || !titulo.trim()))
    errors.push('titulo debe ser string no vacío.')
  if (
    descripcion !== undefined &&
    (typeof descripcion !== 'string' || !descripcion.trim())
  )
    errors.push('descripcion debe ser string no vacío.')

  for (const [k, v] of Object.entries({
    categoria_id,
    prioridad_id,
    estado_id,
  })) {
    if (v !== undefined && !isObjectId(v))
      errors.push(`${k} debe ser ObjectId válido.`)
  }

  if (asignado_a !== undefined && asignado_a !== null)
    validateAsignadoA(asignado_a, errors)

  if (watchers !== undefined) {
    if (!Array.isArray(watchers)) errors.push('watchers debe ser array.')
    else if (uniqTrim(watchers).some(x => !isValidIdPersonal(x)))
      errors.push('watchers debe contener id_personal válidos.')
  }

  if (adjuntos !== undefined && adjuntos !== null)
    validateAttachmentsArray(adjuntos, errors)

  if (String(tipo) === 'operacion' && operacion !== undefined) {
    if (!operacion || typeof operacion !== 'object')
      errors.push('operacion debe ser objeto.')
    else {
      if (
        operacion.subtipo !== undefined &&
        !['comercio', 'bodega'].includes(String(operacion.subtipo))
      ) {
        errors.push('operacion.subtipo inválido (comercio|bodega).')
      }
      if (
        operacion.cliente !== undefined &&
        (typeof operacion.cliente !== 'string' || !operacion.cliente.trim())
      ) {
        errors.push('operacion.cliente debe ser string no vacío.')
      }
    }
  }

  if (activo !== undefined && typeof activo !== 'boolean')
    errors.push('activo debe ser boolean.')

  if (
    fecha_estimada !== undefined &&
    String(fecha_estimada).trim() !== '' &&
    !isValidDate(fecha_estimada)
  ) {
    errors.push('fecha_estimada debe ser fecha válida.')
  }

  validateNota(nota_estado, errors, 'nota_estado')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

// ======================================================
// PATCH ESTADO (CORE) – form-data compatible
// ======================================================
export function validatePatchState(req, res, next) {
  const errors = []

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      ok: false,
      errors: [
        'Body no disponible. Verifica que la ruta use multer (uploadAny.any()).',
      ],
    })
  }

  let { id_personal, estado_id, nota, fecha_estimada, adjuntos } = req.body

  adjuntos = parseMaybeJSON(adjuntos)

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')
  if (!estado_id || !isObjectId(estado_id))
    errors.push('estado_id es requerido y debe ser ObjectId válido.')

  validateNota(nota, errors, 'nota')

  if (
    fecha_estimada !== undefined &&
    String(fecha_estimada).trim() !== '' &&
    !isValidDate(fecha_estimada)
  ) {
    errors.push('fecha_estimada debe ser fecha válida.')
  }

  // adjuntos por evento normalmente los arma el controller desde req.files.
  // Si el cliente los manda, validamos.
  if (adjuntos !== undefined && adjuntos !== null)
    validateAttachmentsArray(adjuntos, errors)

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

// ======================================================
// PATCH ASSIGN – form-data compatible
// ======================================================
export function validatePatchAssign(req, res, next) {
  const errors = []

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ ok: false, errors: ['Body no disponible.'] })
  }

  let { id_personal, asignado_a } = req.body
  asignado_a =
    parseMaybeJSON(asignado_a) || readBracketObject(req.body, 'asignado_a')

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal es requerido.')
  validateAsignadoA(asignado_a, errors)

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

// ======================================================
// PATCH Add/Remove (watchers, apoyo, etc.)
// - id_personal requerido
// - add/remove opcionales
// - soporta add[], remove[] en form-data
// ======================================================
export function validatePatchAddRemoveIds(req, res, next) {
  const errors = []

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ ok: false, errors: ['Body no disponible.'] })
  }

  let { id_personal, add, remove } = req.body

  if (add === undefined) add = req.body['add[]']
  if (remove === undefined) remove = req.body['remove[]']

  add = parseMaybeJSON(add)
  remove = parseMaybeJSON(remove)

  if (add !== undefined && !Array.isArray(add)) add = toArray(add)
  if (remove !== undefined && !Array.isArray(remove)) remove = toArray(remove)

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')

  if (Array.isArray(add) && uniqTrim(add).some(x => !isValidIdPersonal(x)))
    errors.push('add debe contener id_personal válidos.')
  if (
    Array.isArray(remove) &&
    uniqTrim(remove).some(x => !isValidIdPersonal(x))
  )
    errors.push('remove debe contener id_personal válidos.')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

// ======================================================
// PATCH Servicios (strings)
// - soporta add[], remove[] en form-data
// ======================================================
export function validatePatchServicios(req, res, next) {
  const errors = []

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ ok: false, errors: ['Body no disponible.'] })
  }

  let { id_personal, add, remove } = req.body

  if (add === undefined) add = req.body['add[]']
  if (remove === undefined) remove = req.body['remove[]']

  add = parseMaybeJSON(add)
  remove = parseMaybeJSON(remove)

  if (add !== undefined && !Array.isArray(add)) add = toArray(add)
  if (remove !== undefined && !Array.isArray(remove)) remove = toArray(remove)

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')

  const isValidText = v =>
    typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 120

  if (Array.isArray(add) && uniqTrim(add).some(x => !isValidText(x)))
    errors.push('add contiene servicios inválidos (string).')
  if (Array.isArray(remove) && uniqTrim(remove).some(x => !isValidText(x)))
    errors.push('remove contiene servicios inválidos (string).')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

// ======================================================
// PATCH Adjuntos globales
// - si add viene como JSON, se valida
// - si subes archivos, el controller debería construir add desde req.files
// ======================================================
export function validatePatchAttachments(req, res, next) {
  const errors = []

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      ok: false,
      errors: [
        'Body no disponible. Verifica que la ruta use multer (uploadAny.any()).',
      ],
    })
  }

  let { id_personal, add, remove } = req.body

  if (remove === undefined) remove = req.body['remove[]']

  add = parseMaybeJSON(add)
  remove = parseMaybeJSON(remove)

  if (remove !== undefined && !Array.isArray(remove)) remove = toArray(remove)

  if (!id_personal || !isValidIdPersonal(id_personal))
    errors.push('id_personal (actor) es requerido.')

  if (add !== undefined && add !== null) validateAttachmentsArray(add, errors)

  if (remove !== undefined) {
    if (!Array.isArray(remove)) errors.push('remove debe ser array de fileId.')
    else if (remove.some(x => typeof x !== 'string' || !String(x).trim()))
      errors.push('remove debe contener fileId strings.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}
