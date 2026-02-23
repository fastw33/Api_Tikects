// src/modules/chats/socket.chat.js
import jwt from 'jsonwebtoken'
import { Conversation } from './model.conversation.js'
import { markRead } from './service.chat.js'

export function registerChatSocket(io) {
  io.use((socket, next) => {
    try {
      const authToken = socket.handshake?.auth?.token
      const headerAuth = socket.handshake?.headers?.authorization || ''
      const bearer = headerAuth.startsWith('Bearer ')
        ? headerAuth.slice(7).trim()
        : ''

      const token = (authToken || bearer || '').trim()
      if (!token) return next(new Error('NO_TOKEN'))

      const secret = process.env.JWT_SECRET
      if (!secret) return next(new Error('NO_JWT_SECRET'))

      const payload = jwt.verify(token, secret)

      const id_personal =
        payload?.id_personal ??
        payload?.id_usuario ??
        payload?.userId ??
        payload?.idPersonal

      const pid = String(id_personal || '').trim()
      if (!pid) return next(new Error('NO_ID_PERSONAL'))

      socket.user = { id_personal: pid }
      return next()
    } catch {
      return next(new Error('INVALID_TOKEN'))
    }
  })

  io.on('connection', socket => {
    const pid = String(socket.user?.id_personal || '').trim()
    if (pid) socket.join(`user:${pid}`)

    socket.on('chat:join', async ({ chatId }) => {
      try {
        const chat = await Conversation.findById(chatId).lean()
        if (!chat) return

        if (!pid || !chat.participants?.includes(pid)) return

        socket.join(String(chatId))
        socket.emit('chat:joined', { chatId })
      } catch {
        // silent
      }
    })

    socket.on('chat:typing:start', async ({ chatId }) => {
      try {
        const chat = await Conversation.findById(chatId).lean()
        if (!chat) return

        if (!pid || !chat.participants?.includes(pid)) return

        socket
          .to(String(chatId))
          .emit('chat:typing:start', { chatId, id_personal: pid })
      } catch {
        // silent
      }
    })

    socket.on('chat:typing:stop', async ({ chatId }) => {
      try {
        const chat = await Conversation.findById(chatId).lean()
        if (!chat) return

        if (!pid || !chat.participants?.includes(pid)) return

        socket
          .to(String(chatId))
          .emit('chat:typing:stop', { chatId, id_personal: pid })
      } catch {
        // silent
      }
    })

    socket.on('chat:read', async ({ chatId, at }) => {
      try {
        const chat = await Conversation.findById(chatId).lean()
        if (!chat) return

        if (!pid || !chat.participants?.includes(pid)) return

        const data = await markRead({ chatId, id_personal: pid, at })
        io.to(String(chatId)).emit('chat:read:update', {
          chatId,
          id_personal: pid,
          lastReadAt: data.lastReadAt,
        })
      } catch {
        // silent
      }
    })
  })
}
