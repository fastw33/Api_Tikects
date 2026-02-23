import jwt from 'jsonwebtoken'
const { JWT_SECRET } = process.env

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET no está definido en el .env')
}

export const signToken = (payload, options = {}) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: '1h', ...options })

export const verifyToken = token => jwt.verify(token, JWT_SECRET)

export const authMiddleware = (req, res, next) => {
  const authHeader =
    req.headers.authorization || req.headers.Authorization || ''

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  if (!token) {
    return res.status(401).json({ error: 'No se proporcionó token' })
  }

  try {
    const decoded = verifyToken(token)
    req.user = decoded
    next()
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido o expirado' })
  }
}

export default {
  signToken,
  verifyToken,
  authMiddleware,
}
