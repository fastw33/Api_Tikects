// src/modules/Ticket/routes.ticket.js
import { Router } from 'express'
import * as TicketController from './controller.ticket.js'
import { uploadAny } from '../../middlewares/uploadAny.js'
import {
  validateListTickets,
  validateTicketIdParam,
  validateCreateTicket,
  validatePutTicket,
  validatePatchState,
  validatePatchAssign,
  validatePatchAddRemoveIds,
  validatePatchServicios,
  validatePatchAttachments,
} from './validator.ticket.js'

const router = Router()

// LISTADOS (GET) – SIEMPRE PAGINADOS
router.get('/', validateListTickets, TicketController.list)
router.get('/mine', validateListTickets, TicketController.mine)
router.get('/assigned', validateListTickets, TicketController.assigned)
router.get('/count', validateListTickets, TicketController.count)

// CREATE (form-data + files)
router.post(
  '/',
  uploadAny.any(), // ✅ parsea multipart/form-data
  validateCreateTicket,
  TicketController.create
)

router.get('/:id', validateTicketIdParam, TicketController.getById)

// PUT excepcional (si lo usas con form-data también, puedes poner uploadAny.any())
// si lo usas con JSON, déjalo sin upload
router.put(
  '/:id',
  validateTicketIdParam,
  validatePutTicket,
  TicketController.put
)

// PATCH estado (form-data + evidencias)
router.patch(
  '/:id/state',
  validateTicketIdParam,
  uploadAny.any(), // ✅ evidencias en cambio de estado
  validatePatchState,
  TicketController.patchState
)

// Asignación
router.patch(
  '/:id/assign',
  validateTicketIdParam,
  validatePatchAssign,
  TicketController.patchAssign
)
router.delete(
  '/:id/assign',
  validateTicketIdParam,
  validatePatchAddRemoveIds,
  TicketController.deleteAssign
)

// Watchers
router.patch(
  '/:id/watchers',
  validateTicketIdParam,
  validatePatchAddRemoveIds,
  TicketController.patchWatchers
)

// Operación
router.patch(
  '/:id/operacion/servicios',
  validateTicketIdParam,
  validatePatchServicios,
  TicketController.patchServicios
)
router.patch(
  '/:id/operacion/apoyo',
  validateTicketIdParam,
  validatePatchAddRemoveIds,
  TicketController.patchApoyo
)

// Adjuntos globales (si quieres subir binarios aquí también)
router.patch(
  '/:id/attachments',
  validateTicketIdParam,
  uploadAny.any(), // ✅ permite subir archivos
  validatePatchAttachments,
  TicketController.patchAttachments
)

// Soft delete
router.patch(
  '/:id/deactivate',
  validateTicketIdParam,
  validatePatchAddRemoveIds,
  TicketController.deactivate
)

export default router
