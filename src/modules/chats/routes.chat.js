import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import * as ChatController from './controller.chat.js'
import {
  validatePaging,
  validateListMyChats,
  validateCreateFreeChat,
  validateChatIdParam,
  validateMessageIdParam,
  validateGetMessages,
  validateSendMessage,
  validateEditMessage,
  validateDeleteMessage,
  validateToggleReaction,
  validatePatchRead,
  validatePatchParticipants,
  validateDeactivate,
} from './validator.chat.js'
import { uploadAny } from '../../middlewares/uploadAny.js'
import { assertChatParticipant } from './service.chat.js'
import cleanupChatUploads from './cleanup.chatUploads.js'

const router = Router()

function getTokenIdPersonal(req) {
  const candidates = [
    req.user?.id_personal,
    req.user?.Id_personal,
    req.user?.idPersonal,
    req.user?.IdPersonal,
    req.user?.id_usuario,
    req.user?.userId,
    req.auth?.id_personal,
    req.auth?.Id_personal,
    req.auth?.idPersonal,
    req.auth?.IdPersonal,
    req.auth?.id_usuario,
    req.auth?.userId,
    req.usuario?.id_personal,
    req.usuario?.Id_personal,
    req.usuario?.idPersonal,
    req.usuario?.IdPersonal,
    req.usuario?.id_usuario,
    req.usuario?.userId,
    req.decoded?.id_personal,
    req.decoded?.Id_personal,
    req.decoded?.idPersonal,
    req.decoded?.IdPersonal,
    req.decoded?.id_usuario,
    req.decoded?.userId,
    req.jwt?.id_personal,
    req.jwt?.Id_personal,
    req.jwt?.idPersonal,
    req.jwt?.IdPersonal,
    req.jwt?.id_usuario,
    req.jwt?.userId,
  ]
  for (const c of candidates) {
    if (c === undefined || c === null) continue
    const s = String(c).trim()
    if (s) return s
  }
  return ''
}

function assertActorMatchesToken(req, res, next) {
  const tokenPid = getTokenIdPersonal(req)
  if (!tokenPid) {
    return res.status(401).json({ ok: false, error: 'No autenticado.' })
  }

  const qPid =
    req.query?.id_personal !== undefined
      ? String(req.query.id_personal).trim()
      : ''
  const bPid =
    req.body?.id_personal !== undefined
      ? String(req.body.id_personal).trim()
      : ''

  const provided = bPid || qPid
  if (provided && provided !== tokenPid) {
    return res.status(403).json({ ok: false, error: 'No autorizado.' })
  }

  if (req.query) req.query.id_personal = tokenPid
  if (req.body) req.body.id_personal = tokenPid

  next()
}

router.use(assertActorMatchesToken)

router.get('/', validatePaging, validateListMyChats, ChatController.listMyChats)

router.post('/', validateCreateFreeChat, ChatController.createFreeChat)

router.get(
  '/:chatId/messages',
  validateChatIdParam,
  validatePaging,
  validateGetMessages,
  ChatController.getMessages
)

router.post(
  '/:chatId/messages',
  validateChatIdParam,
  validateSendMessage,
  ChatController.sendMessage
)

router.patch(
  '/:chatId/messages/:messageId',
  validateChatIdParam,
  validateMessageIdParam,
  validateEditMessage,
  ChatController.editMessage
)

router.patch(
  '/:chatId/messages/:messageId/reaction',
  validateChatIdParam,
  validateMessageIdParam,
  validateToggleReaction,
  ChatController.toggleReaction
)

router.delete(
  '/:chatId/messages/:messageId',
  validateChatIdParam,
  validateMessageIdParam,
  validateDeleteMessage,
  ChatController.deleteMessage
)

router.patch(
  '/:chatId/read',
  validateChatIdParam,
  validatePatchRead,
  ChatController.markRead
)

router.patch(
  '/:chatId/participants',
  validateChatIdParam,
  validatePatchParticipants,
  ChatController.patchParticipants
)

router.patch(
  '/:chatId/avatar',
  validateChatIdParam,
  uploadAny.single('avatar'),
  async (req, res) => {
    const { chatId } = req.params
    const id_personal = getTokenIdPersonal(req)
    const file = req.file

    const removeUploaded = async () => {
      if (!file?.path) return
      try {
        await fs.promises.unlink(file.path)
      } catch {
        // Si el archivo ya no existe, no hay nada que limpiar.
      }
    }

    if (!file) {
      return res.status(400).json({ ok: false, error: 'avatar es requerido.' })
    }

    const isImage = String(file.mimetype || '').startsWith('image/')
    if (!isImage || file.size > 5 * 1024 * 1024) {
      await removeUploaded()
      return res.status(400).json({
        ok: false,
        error: 'La foto debe ser una imagen de máximo 5MB.',
      })
    }

    try {
      const chat = await ChatController.updateGroupAvatar({
        chatId,
        id_personal,
        file,
      })
      return res.json({ ok: true, chat })
    } catch (e) {
      await removeUploaded()
      return res
        .status(e.status || 500)
        .json({ ok: false, error: e.message || 'Error guardando foto.' })
    }
  }
)

router.patch(
  '/:chatId/deactivate',
  validateChatIdParam,
  validateDeactivate,
  ChatController.deactivateChat
)

router.post(
  '/:chatId/attachments',
  validateChatIdParam,
  uploadAny.array('files', 10),
  async (req, res) => {
    const { chatId } = req.params
    const id_personal = req.body?.id_personal || req.query?.id_personal
    await assertChatParticipant(chatId, id_personal)

    await cleanupChatUploads()

    const MAX_AUDIO = 10 * 1024 * 1024

    const allowed = mime => {
      if (!mime) return false
      if (mime.startsWith('video/')) return false
      if (mime.startsWith('audio/')) return true
      if (mime.startsWith('image/')) return true
      return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
      ].includes(mime)
    }

    const errors = []

    for (const f of req.files || []) {
      if (!allowed(f.mimetype)) {
        errors.push(`Tipo no permitido: ${f.originalname}`)
      }
      if (f.mimetype?.startsWith('audio/') && f.size > MAX_AUDIO) {
        errors.push(`Audio supera 10MB: ${f.originalname}`)
      }
    }

    if (errors.length) {
      for (const f of req.files || []) {
        try {
          await fs.promises.unlink(f.path)
        } catch {}
      }
      return res.status(400).json({ ok: false, errors })
    }

    const files = (req.files || []).map(f => ({
      fileId: f.filename,
      name: f.originalname,
      url: `/tikets/chats/${chatId}/attachments/${encodeURIComponent(f.filename)}`,
      mime: f.mimetype,
      size: f.size,
    }))

    return res.status(201).json({ ok: true, files })
  }
)

router.get(
  '/:chatId/attachments/:fileId',
  validateChatIdParam,
  async (req, res) => {
    const { chatId, fileId } = req.params
    const id_personal = req.body?.id_personal || req.query?.id_personal
    await assertChatParticipant(chatId, id_personal)

    const safeName = path.basename(String(fileId))
    if (safeName !== String(fileId)) {
      return res.status(400).json({ ok: false, error: 'fileId inválido.' })
    }

    const abs = path.resolve(
      process.cwd(),
      'uploads',
      'chats',
      chatId,
      safeName
    )

    try {
      await fs.promises.stat(abs)
    } catch {
      return res
        .status(404)
        .json({ ok: false, error: 'Archivo no encontrado.' })
    }

    return res.sendFile(abs)
  }
)

router.get(
  '/:chatId/avatar/:fileId',
  validateChatIdParam,
  async (req, res) => {
    const { chatId, fileId } = req.params
    const id_personal = req.body?.id_personal || req.query?.id_personal
    await assertChatParticipant(chatId, id_personal)

    const safeName = path.basename(String(fileId))
    if (safeName !== String(fileId)) {
      return res.status(400).json({ ok: false, error: 'fileId inválido.' })
    }

    const abs = path.resolve(
      process.cwd(),
      'uploads',
      'chats',
      chatId,
      safeName
    )

    try {
      await fs.promises.stat(abs)
    } catch {
      return res
        .status(404)
        .json({ ok: false, error: 'Archivo no encontrado.' })
    }

    return res.sendFile(abs)
  }
)

export default router
