import express from 'express'
import morgan from 'morgan'
import helmet from 'helmet'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import swaggerUi from 'swagger-ui-express'

import areasRouter from './modules/Areas/routes.area.js'
import catalogRouter from './modules/Catalogos/routes.catalog.js'
import teamsRouter from './modules/teams/routes.team.js'
import ticketsRouter from './modules/Ticket/routes.ticket.js'
import chatsRouter from './modules/chats/routes.chat.js'
import notificationsRouter from './modules/notifications/routes.notification.js'

import notFound from './middlewares/notFound.js'
import errorHandler from './middlewares/errorHandler.js'

import './modules/Areas/model.area.js'
import './modules/teams/model.team.js'
import './modules/Catalogos/model.catalog.js'
import './modules/Ticket/model.ticket.js'
import './modules/chats/model.conversation.js'
import './modules/chats/model.message.js'
import './modules/notifications/model.notification.js'
import './modules/notifications/model.pushSubscription.js'

import { authMiddleware } from './config/jwt.js'
import { buildCors } from './config/corsOptions.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let swaggerFile = {}
try {
  const p = path.join(__dirname, 'swagger_output.json')
  if (fs.existsSync(p)) {
    swaggerFile = JSON.parse(fs.readFileSync(p, 'utf8'))
  } else {
    console.warn('⚠️  Falta swagger_output.json. Ejecuta: npm run swagger')
  }
} catch (e) {
  console.warn('⚠️  No se pudo cargar swagger_output.json.', e)
}

export function createApp() {
  const app = express()

  app.set('etag', false)

  const corsMw = buildCors()
  app.use(corsMw)
  app.options(/.*/, corsMw)

  app.use(helmet())
  app.use(express.json({ limit: '10mb' }))
  app.use(morgan('dev'))

  app.use('/uploads/chats', (req, res) =>
    res.status(404).json({ ok: false, error: 'Not found' })
  )
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerFile))

  const API_PREFIX = '/tikets'

  app.use(API_PREFIX, (req, res, next) => {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    )
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.setHeader('Surrogate-Control', 'no-store')
    next()
  })

  app.use(API_PREFIX, (req, res, next) => {
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  app.use(API_PREFIX, authMiddleware)

  app.use(`${API_PREFIX}/areas`, areasRouter)
  app.use(`${API_PREFIX}/catalog`, catalogRouter)
  app.use(`${API_PREFIX}/teams`, teamsRouter)
  app.use(`${API_PREFIX}/tickets`, ticketsRouter)
  app.use(`${API_PREFIX}/chats`, chatsRouter)
  app.use(`${API_PREFIX}/notifications`, notificationsRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}

export default { createApp }
