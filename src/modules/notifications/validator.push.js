function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

export function validateSubscribe(req, res, next) {
  const errors = []
  const { id_personal, subscription } = req.body

  if (!isNonEmptyString(id_personal))
    errors.push('id_personal es requerido y debe ser string.')

  if (!subscription || typeof subscription !== 'object')
    errors.push('subscription es requerido y debe ser objeto.')
  else {
    if (!isNonEmptyString(subscription.endpoint))
      errors.push('subscription.endpoint es requerido.')

    const keys = subscription.keys || {}
    if (!isNonEmptyString(keys.p256dh))
      errors.push('subscription.keys.p256dh es requerido.')
    if (!isNonEmptyString(keys.auth))
      errors.push('subscription.keys.auth es requerido.')
  }

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateUnsubscribe(req, res, next) {
  const errors = []
  const { id_personal, endpoint } = req.body

  if (!isNonEmptyString(id_personal))
    errors.push('id_personal es requerido y debe ser string.')

  if (!isNonEmptyString(endpoint))
    errors.push('endpoint es requerido y debe ser string.')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}

export function validateTestPush(req, res, next) {
  const errors = []
  const { id_personal, title, body, url } = req.body

  if (!isNonEmptyString(id_personal))
    errors.push('id_personal es requerido y debe ser string.')
  if (title !== undefined && typeof title !== 'string')
    errors.push('title debe ser string.')
  if (body !== undefined && typeof body !== 'string')
    errors.push('body debe ser string.')
  if (url !== undefined && typeof url !== 'string')
    errors.push('url debe ser string.')

  if (errors.length) return res.status(400).json({ ok: false, errors })
  next()
}
