import { recordAppError } from '../utils/monitoring.js'

export function errorHandler(err, req, res, next) {
  console.error('🛑', err)
  res.locals = res.locals || {}
  res.locals.monitoringAppErrorLogged = true
  recordAppError(err, req)
  res
    .status(err.status || 500)
    .json({ error: err.message || 'Internal Server Error' })
}
export default errorHandler
