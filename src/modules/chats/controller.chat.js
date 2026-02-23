// src/modules/chats/controller.chat.js
import * as ChatService from './service.chat.js'

export async function listMyChats(req, res) {
  try {
    const data = await ChatService.listMyChats(req.query)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error listando chats' })
  }
}

export async function createFreeChat(req, res) {
  try {
    const chat = await ChatService.createFreeChat(req.body)
    return res.status(201).json({ ok: true, chat })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error creando chat' })
  }
}

export async function getMessages(req, res) {
  try {
    const { chatId } = req.params
    const data = await ChatService.getMessages({ chatId, ...req.query })
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error obteniendo mensajes' })
  }
}

export async function sendMessage(req, res) {
  try {
    const { chatId } = req.params
    const message = await ChatService.sendMessage({ chatId, ...req.body })

    const io = globalThis.__io
    if (io) {
      // Emitir a todos en el chat que hay un nuevo mensaje
      io.to(String(chatId)).emit('chat:message:new', {
        chatId,
        message,
      })

      // Obtener el chat para notificar a los participantes
      const { Conversation } = await import('./model.conversation.js')
      const { Notification } =
        await import('../notifications/model.notification.js')
      const { sendPushToUser } =
        await import('../notifications/service.push.js')
      const chat = await Conversation.findById(chatId).lean()

      const senderId = String(message?.sender_id_personal || '').trim()
      const bodyPreview = String(message?.text || '')
        .substring(0, 80)
        .trim()
      const notificationBody = bodyPreview || '[Archivo adjunto]'

      if (chat && chat.participants) {
        for (const participantId of chat.participants) {
          const pid = String(participantId).trim()
          // No notificar al remitente, solo a los otros participantes
          if (pid && pid !== senderId) {
            try {
              // ✅ GUARDAR en BD
              const notification = await Notification.create({
                to_id_personal: pid,
                type: 'chat.message',
                title: 'Nuevo mensaje en chat',
                body: notificationBody,
                target: {
                  type: 'chat',
                  params: {
                    chatId: String(chatId),
                    messageId: String(message._id),
                  },
                },
                createdBy: senderId,
                isRead: false,
              })

              // Emitir socket.io
              io.to(`user:${pid}`).emit('notification:new', {
                _id: notification._id,
                type: 'chat.message',
                chatId,
                messageId: message._id,
                title: 'Nuevo mensaje en chat',
                body: notificationBody,
                createdAt: notification.createdAt,
              })

              await sendPushToUser({
                id_personal: pid,
                payload: {
                  title: 'Nuevo mensaje en chat',
                  body: notificationBody,
                  data: {
                    url: `/home?openChatId=${encodeURIComponent(
                      String(chatId)
                    )}`,
                    target: {
                      type: 'chat',
                      params: {
                        chatId: String(chatId),
                        messageId: String(message._id),
                      },
                    },
                  },
                },
              })
            } catch (err) {
              // Ignorar errores de notificación para no bloquear el envío del mensaje
            }
          }
        }
      }
    }

    return res.status(201).json({ ok: true, message })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error enviando mensaje' })
  }
}

export async function markRead(req, res) {
  try {
    const { chatId } = req.params
    const data = await ChatService.markRead({ chatId, ...req.body })

    const io = globalThis.__io
    if (io) {
      io.to(String(chatId)).emit('chat:read:update', {
        chatId,
        id_personal: String(req.body.id_personal || '').trim(),
        lastReadAt: data.lastReadAt,
      })
    }

    return res.json({ ok: true, lastReadAt: data.lastReadAt })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error marcando leído' })
  }
}

export async function patchParticipants(req, res) {
  try {
    const { chatId } = req.params
    const chat = await ChatService.patchParticipants({ chatId, ...req.body })

    const io = globalThis.__io
    if (io) {
      io.to(String(chatId)).emit('chat:participants:update', {
        chatId,
        participants: chat.participants,
      })
    }

    return res.json({ ok: true, chat })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error editando participantes' })
  }
}

export async function deactivateChat(req, res) {
  try {
    const { chatId } = req.params
    const chat = await ChatService.deactivateChat({ chatId, ...req.body })

    const io = globalThis.__io
    if (io) {
      io.to(String(chatId)).emit('chat:deactivated', { chatId })
    }

    return res.json({ ok: true, chat })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error desactivando chat' })
  }
}
