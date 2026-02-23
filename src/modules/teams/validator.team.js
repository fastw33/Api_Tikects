// validator.team.js
import mongoose from 'mongoose'

const isValidObjectId = v => mongoose.Types.ObjectId.isValid(v)

// id_personal viene del otro sistema: lo validamos como string no vacío.
// (si algún día quieres reglas estrictas, se ajusta aquí)
function isValidIdPersonal(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 80
}

function uniq(arr) {
  return [...new Set(arr)]
}

export function validateListTeams(req, res, next) {
  const errors = []

  const { page, limit, activo, search } = req.query

  if (page === undefined) errors.push('page (query) es requerido.')
  if (limit === undefined) errors.push('limit (query) es requerido.')

  const p = Number(page)
  const l = Number(limit)

  if (!Number.isInteger(p) || p < 1) errors.push('page debe ser entero >= 1.')
  if (!Number.isInteger(l) || l < 1) errors.push('limit debe ser entero >= 1.')
  if (Number.isInteger(l) && l > 100)
    errors.push('limit no puede ser mayor a 100.')

  if (activo !== undefined && !['true', 'false'].includes(String(activo))) {
    errors.push('activo (query) debe ser true o false.')
  }

  if (search !== undefined && typeof search !== 'string') {
    errors.push('search (query) debe ser string.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateIdParam(req, res, next) {
  const { id } = req.params
  if (!isValidObjectId(id))
    return res.status(400).json({ ok: false, error: 'id inválido' })
  next()
}

export function validateCreateTeam(req, res, next) {
  const errors = []
  const { nombre, descripcion, personal_ids, lider_ids, id_personal } = req.body

  if (!id_personal || !isValidIdPersonal(id_personal)) {
    errors.push('id_personal (actor) es requerido y debe ser string válido.')
  }

  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    errors.push('nombre es requerido y debe ser string.')
  } else if (nombre.trim().length < 2 || nombre.trim().length > 80) {
    errors.push('nombre debe tener entre 2 y 80 caracteres.')
  }

  if (descripcion !== undefined && typeof descripcion !== 'string') {
    errors.push('descripcion debe ser string.')
  } else if (typeof descripcion === 'string' && descripcion.length > 500) {
    errors.push('descripcion no puede superar 500 caracteres.')
  }

  if (!Array.isArray(personal_ids) || personal_ids.length < 1) {
    errors.push(
      'personal_ids es requerido y debe tener al menos 1 id_personal.'
    )
  } else {
    for (const pid of personal_ids) {
      if (!isValidIdPersonal(pid)) {
        errors.push(
          'Cada item de personal_ids debe ser un id_personal válido (string).'
        )
        break
      }
    }
    const u = uniq(personal_ids.map(x => x.trim()))
    if (u.length !== personal_ids.length)
      errors.push('personal_ids no puede tener duplicados.')
  }

  if (lider_ids !== undefined) {
    if (!Array.isArray(lider_ids)) {
      errors.push('lider_ids debe ser un array.')
    } else {
      for (const lid of lider_ids) {
        if (!isValidIdPersonal(lid)) {
          errors.push(
            'Cada item de lider_ids debe ser un id_personal válido (string).'
          )
          break
        }
      }
      const u = uniq(lider_ids.map(x => x.trim()))
      if (u.length !== lider_ids.length)
        errors.push('lider_ids no puede tener duplicados.')

      // líderes ⊆ miembros
      if (Array.isArray(personal_ids)) {
        const members = new Set(personal_ids.map(x => x.trim()))
        const bad = lider_ids.map(x => x.trim()).find(x => !members.has(x))
        if (bad)
          errors.push(
            'lider_ids debe ser subset de personal_ids (todo líder debe ser miembro).'
          )
      }
    }
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateUpdateTeam(req, res, next) {
  const errors = []
  const { nombre, descripcion, personal_ids, lider_ids, activo, id_personal } =
    req.body

  if (!id_personal || !isValidIdPersonal(id_personal)) {
    errors.push('id_personal (actor) es requerido y debe ser string válido.')
  }

  const hasAny =
    nombre !== undefined ||
    descripcion !== undefined ||
    personal_ids !== undefined ||
    lider_ids !== undefined ||
    activo !== undefined

  if (!hasAny) errors.push('Debes enviar al menos un campo para actualizar.')

  if (nombre !== undefined) {
    if (typeof nombre !== 'string' || !nombre.trim())
      errors.push('nombre debe ser string no vacío.')
    else if (nombre.trim().length < 2 || nombre.trim().length > 80)
      errors.push('nombre debe tener entre 2 y 80 caracteres.')
  }

  if (descripcion !== undefined && typeof descripcion !== 'string') {
    errors.push('descripcion debe ser string.')
  } else if (typeof descripcion === 'string' && descripcion.length > 500) {
    errors.push('descripcion no puede superar 500 caracteres.')
  }

  if (personal_ids !== undefined) {
    if (!Array.isArray(personal_ids) || personal_ids.length < 1) {
      errors.push(
        'personal_ids si se envía, debe tener al menos 1 id_personal.'
      )
    } else {
      for (const pid of personal_ids) {
        if (!isValidIdPersonal(pid)) {
          errors.push(
            'Cada item de personal_ids debe ser un id_personal válido (string).'
          )
          break
        }
      }
      const u = uniq(personal_ids.map(x => x.trim()))
      if (u.length !== personal_ids.length)
        errors.push('personal_ids no puede tener duplicados.')
    }
  }

  if (lider_ids !== undefined) {
    if (!Array.isArray(lider_ids)) {
      errors.push('lider_ids debe ser un array.')
    } else {
      for (const lid of lider_ids) {
        if (!isValidIdPersonal(lid)) {
          errors.push(
            'Cada item de lider_ids debe ser un id_personal válido (string).'
          )
          break
        }
      }
      const u = uniq(lider_ids.map(x => x.trim()))
      if (u.length !== lider_ids.length)
        errors.push('lider_ids no puede tener duplicados.')

      // Si viene personal_ids en el mismo request, validar subset fuerte aquí
      if (Array.isArray(personal_ids)) {
        const members = new Set(personal_ids.map(x => x.trim()))
        const bad = lider_ids.map(x => x.trim()).find(x => !members.has(x))
        if (bad) errors.push('lider_ids debe ser subset de personal_ids.')
      }
    }
  }

  if (activo !== undefined && typeof activo !== 'boolean') {
    errors.push('activo debe ser boolean.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}
