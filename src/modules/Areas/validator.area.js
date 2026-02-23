// src/modules/areas/validator.area.js

export function validateCreateArea(req, res, next) {
  const { nombre, descripcion, personal_ids } = req.body
  const errors = []

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

  if (personal_ids !== undefined) {
    if (!Array.isArray(personal_ids)) {
      errors.push('personal_ids debe ser un array.')
    } else {
      const dupCheck = new Set()
      for (const id of personal_ids) {
        if (typeof id !== 'string' || !id.trim()) {
          errors.push(
            'Cada item de personal_ids debe ser string (id_personal).'
          )
          break
        }
        if (dupCheck.has(id)) {
          errors.push('personal_ids no puede tener IDs duplicados.')
          break
        }
        dupCheck.add(id)
      }
    }
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateUpdateArea(req, res, next) {
  const { nombre, descripcion, personal_ids, activo } = req.body
  const errors = []

  const hasAny =
    nombre !== undefined ||
    descripcion !== undefined ||
    personal_ids !== undefined ||
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
    if (!Array.isArray(personal_ids)) {
      errors.push('personal_ids debe ser un array.')
    } else {
      const dupCheck = new Set()
      for (const id of personal_ids) {
        if (typeof id !== 'string' || !id.trim()) {
          errors.push(
            'Cada item de personal_ids debe ser string (id_personal).'
          )
          break
        }
        if (dupCheck.has(id)) {
          errors.push('personal_ids no puede tener IDs duplicados.')
          break
        }
        dupCheck.add(id)
      }
    }
  }

  if (activo !== undefined && typeof activo !== 'boolean') {
    errors.push('activo debe ser boolean.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateIdParam(req, res, next) {
  const { id } = req.params
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ ok: false, error: 'id inválido' })
  }
  next()
}
