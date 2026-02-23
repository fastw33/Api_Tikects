// src/modules/notifications/routes.notification.js
import { Router } from 'express'

// DB notifications
import * as C from './controller.notification.js'
import {
  validatePaging,
  validateList,
  validateIdParam,
  validateReadOne,
  validateReadAll,
} from './validator.notification.js'

// Web Push
import * as PushController from './controller.push.js'
import {
  validateSubscribe,
  validateUnsubscribe,
  validateTestPush,
} from './validator.push.js'

const router = Router()

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: Notificaciones + Web Push (suscripciones)
 */

// =====================
// Notificaciones (DB)
// =====================
router.get('/', validatePaging, validateList, C.list)
router.get('/count', C.count)
router.patch('/:id/read', validateIdParam, validateReadOne, C.readOne)
router.patch('/read-all', validateReadAll, C.readAll)

// ✅ NUEVO: marcar notificaciones como leídas por ticket
router.patch('/read-by-ticket', C.readByTicket)
router.patch('/read-by-target', C.readByTarget)

// =====================
// Web Push (suscripción)
// =====================
router.get('/public-key', PushController.getPublicKey)
router.post('/subscribe', validateSubscribe, PushController.subscribe)
router.post('/unsubscribe', validateUnsubscribe, PushController.unsubscribe)
router.post('/test', validateTestPush, PushController.testPush)

export default router
