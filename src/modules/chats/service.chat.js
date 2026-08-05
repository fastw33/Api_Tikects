import mongoose from 'mongoose'
import { Conversation } from './model.conversation.js'
import { Message } from './model.message.js'
import { encryptText, decryptText } from './crypto.message.js'
import { dispatchNotifications } from '../notifications/service.notification.js'

function uniqTrim(arr) {
  return [...new Set(arr.map(x => String(x).trim()))].filter(Boolean)
}

function parsePaging({ page, limit }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const safePage = Math.max(Number(page) || 1, 1)
  const skip = (safePage - safeLimit) * 0 + (safePage - 1) * safeLimit
  return { safePage, safeLimit, skip }
}

function normalizeLastRead(lastRead) {
  if (!lastRead) return {}

  const source =
    lastRead instanceof Map
      ? Object.fromEntries(lastRead.entries())
      : typeof lastRead.toObject === 'function'
        ? lastRead.toObject()
        : lastRead

  return Object.fromEntries(
    Object.entries(source || {})
      .map(([id, value]) => {
        const pid = String(id || '').trim()
        const d = new Date(value)
        if (!pid || Number.isNaN(d.getTime())) return null
        return [pid, d.toISOString()]
      })
      .filter(Boolean)
  )
}

function getLastReadAt(lastRead, id_personal) {
  const pid = String(id_personal || '').trim()
  const value = normalizeLastRead(lastRead)[pid]
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function buildMessagePreview({ text = '', attachments = [] } = {}) {
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim()
  if (cleanText) {
    return cleanText.length > 160 ? `${cleanText.slice(0, 157)}...` : cleanText
  }

  const files = Array.isArray(attachments) ? attachments : []
  if (!files.length) return 'Sin mensaje'
  if (files.length === 1) {
    const name = String(files[0]?.name || '').trim()
    return name ? `Adjunto: ${name}` : 'Adjunto'
  }
  return `${files.length} adjuntos`
}

async function assertParticipant(chatId, id_personal) {
  const chat = await Conversation.findById(chatId).lean()
  if (!chat) {
    const err = new Error('Chat no encontrado.')
    err.status = 404
    throw err
  }

  const pid = String(id_personal).trim()
  if (!chat.participants?.includes(pid)) {
    const err = new Error('No autorizado: no eres participante del chat.')
    err.status = 403
    throw err
  }

  return chat
}

export async function assertChatParticipant(chatId, id_personal) {
  return assertParticipant(chatId, id_personal)
}

export async function createFreeChat({
  id_personal,
  title = '',
  participants,
}) {
  const pid = String(id_personal).trim()
  const users = uniqTrim(participants)

  const chat = await Conversation.create({
    contextType: 'free',
    contextId: null,
    title: String(title ?? '').trim(),
    participants: users,
    activo: true,
    createdBy: pid,
    updatedBy: pid,
  })

  return chat.toObject()
}

export async function listMyChats({
  id_personal,
  page,
  limit,
  contextType,
  search,
}) {
  const pid = String(id_personal).trim()
  const { safePage, safeLimit, skip } = parsePaging({ page, limit })

  const filter = {
    activo: true,
    participants: pid,
  }

  if (contextType) filter.contextType = contextType

  if (search && String(search).trim()) {
    const s = String(search).trim()
    filter.$or = [{ title: { $regex: s, $options: 'i' } }]
  }

  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ 'lastMessage.at': -1, updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Conversation.countDocuments(filter),
  ])

  const enriched = await Promise.all(
    items.map(async c => {
      const lastRead = normalizeLastRead(c.lastRead)
      const lastReadAt = getLastReadAt(lastRead, pid)

      const msgFilter = {
        chatId: c._id,
        sender_id_personal: { $ne: pid },
      }

      if (lastReadAt) msgFilter.createdAt = { $gt: lastReadAt }

      const [unreadCount, latestMessage] = await Promise.all([
        Message.countDocuments(msgFilter),
        Message.findOne({ chatId: c._id }).sort({ createdAt: -1 }).lean(),
      ])

      const latestText = latestMessage ? decryptText(latestMessage) : ''
      const lastMessageAt =
        latestMessage?.createdAt || c?.lastMessage?.at || c?.updatedAt || null
      const lastMessagePreview = latestMessage
        ? buildMessagePreview({
            text: latestText,
            attachments: latestMessage?.attachments,
          })
        : String(c?.lastMessage?.preview || '').trim()

      return {
        ...c,
        lastRead,
        lastMessage: {
          ...(c?.lastMessage || {}),
          preview: lastMessagePreview,
          at: lastMessageAt,
          sender:
            latestMessage?.sender_id_personal || c?.lastMessage?.sender || '',
        },
        participantsCount: c.participants?.length || 0,
        unreadCount,
        lastReadAt,
      }
    })
  )

  enriched.sort((a, b) => {
    const atA = new Date(a?.lastMessage?.at || a?.createdAt || 0).getTime()
    const atB = new Date(b?.lastMessage?.at || b?.createdAt || 0).getTime()
    return atB - atA
  })

  return {
    items: enriched,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  }
}

export async function getMessages({ chatId, id_personal, page, limit }) {
  const chat = await assertParticipant(chatId, id_personal)

  const { safePage, safeLimit, skip } = parsePaging({ page, limit })

  const [items, total] = await Promise.all([
    Message.find({ chatId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Message.countDocuments({ chatId }),
  ])

  const decrypted = items.map(m => ({
    ...m,
    text: decryptText(m),
  }))

  return {
    items: decrypted,
    lastRead: normalizeLastRead(chat.lastRead),
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  }
}

export async function sendMessage({
  chatId,
  id_personal,
  text,
  attachments = [],
}) {
  const chat = await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  const preview = buildMessagePreview({ text, attachments })

  const enc = encryptText(text)

  const msg = await Message.create({
    chatId: new mongoose.Types.ObjectId(chatId),
    sender_id_personal: pid,
    ...enc,
    preview,
    attachments: Array.isArray(attachments) ? attachments : [],
  })

  await Conversation.findByIdAndUpdate(chatId, {
    $set: {
      updatedBy: pid,
      lastMessage: { preview, at: msg.createdAt || new Date(), sender: pid },
    },
  })

  const messageOut = {
    ...msg.toObject(),
    text: decryptText(msg.toObject()),
  }

  const recipients = (chat.participants || []).filter(
    p => String(p).trim() && String(p).trim() !== pid
  )

  const ticketId =
    chat.contextType === 'ticket' && chat.contextId
      ? String(chat.contextId)
      : null

  await dispatchNotifications({
    orgId: null,
    to_ids_personal: recipients,
    createdBy: pid,
    type: 'chat.message',
    title: 'Nuevo mensaje',
    body: preview,
    target: {
      type: 'chat',
      params: { chatId: String(chatId), ...(ticketId ? { ticketId } : {}) },
      url: `/chats/${String(chatId)}`,
    },
    meta: {
      chatId: String(chatId),
      ...(ticketId ? { ticketId } : {}),
    },
  })

  return messageOut
}

export async function markRead({ chatId, id_personal, at }) {
  await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  const parsedAt = at ? new Date(at) : new Date()
  const lastReadAt = Number.isNaN(parsedAt.getTime()) ? new Date() : parsedAt

  const chat = await Conversation.findByIdAndUpdate(
    chatId,
    {
      $set: {
        [`lastRead.${pid}`]: lastReadAt,
      },
    },
    { new: true, timestamps: false }
  ).lean()

  return { lastReadAt, lastRead: normalizeLastRead(chat?.lastRead), chat }
}

export async function patchParticipants({
  chatId,
  id_personal,
  add = [],
  remove = [],
}) {
  const chat = await assertParticipant(chatId, id_personal)
  if (chat.contextType !== 'free') {
    const err = new Error(
      'Solo se pueden editar participantes en chats libres (free).'
    )
    err.status = 400
    throw err
  }

  const pid = String(id_personal).trim()

  const update = { $set: { updatedBy: pid } }

  if (Array.isArray(add) && add.length) {
    update.$addToSet = { participants: { $each: uniqTrim(add) } }
  }
  if (Array.isArray(remove) && remove.length) {
    update.$pull = { participants: { $in: uniqTrim(remove) } }
  }

  const updated = await Conversation.findByIdAndUpdate(chatId, update, {
    new: true,
  }).lean()
  if (!updated) {
    const err = new Error('Chat no encontrado.')
    err.status = 404
    throw err
  }

  if (!updated.participants || updated.participants.length < 2) {
    const err = new Error(
      'participants no puede quedar con menos de 2 personas en chat libre.'
    )
    err.status = 400
    throw err
  }

  return updated
}

export async function updateGroupAvatar({ chatId, id_personal, file }) {
  const chat = await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  if (chat.contextType !== 'free' || (chat.participants || []).length < 3) {
    const err = new Error('Solo los chats grupales pueden tener foto de grupo.')
    err.status = 400
    throw err
  }

  if (String(chat.createdBy || '').trim() !== pid) {
    const err = new Error('Solo quien creó el grupo puede cambiar la foto.')
    err.status = 403
    throw err
  }

  if (!file) {
    const err = new Error('avatar es requerido.')
    err.status = 400
    throw err
  }

  const updated = await Conversation.findByIdAndUpdate(
    chatId,
    {
      $set: {
        avatar_url: `/tikets/chats/${chatId}/avatar/${encodeURIComponent(file.filename)}`,
        avatar_fileId: file.filename,
        avatar_mime: file.mimetype || '',
        avatar_size: file.size || 0,
        updatedBy: pid,
      },
    },
    { new: true }
  ).lean()

  return updated
}

export async function deactivateChat({ chatId, id_personal }) {
  await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  const updated = await Conversation.findByIdAndUpdate(
    chatId,
    { $set: { activo: false, updatedBy: pid } },
    { new: true }
  ).lean()

  return updated
}

export function buildTicketParticipants({
  creado_por,
  watchers,
  assignedPersonals,
  apoyo_ids,
}) {
  const set = new Set()

  if (creado_por) set.add(String(creado_por).trim())
  ;(watchers || []).forEach(x => set.add(String(x).trim()))
  ;(assignedPersonals || []).forEach(x => set.add(String(x).trim()))
  ;(apoyo_ids || []).forEach(x => set.add(String(x).trim()))

  return [...set].filter(Boolean)
}

export async function ensureTicketChat({
  ticketId,
  participants,
  actor_id_personal,
}) {
  const pid = String(actor_id_personal).trim()
  const users = uniqTrim(participants)

  const existing = await Conversation.findOne({
    contextType: 'ticket',
    contextId: String(ticketId),
    activo: true,
  }).lean()

  if (existing) {
    await Conversation.findByIdAndUpdate(existing._id, {
      $set: { updatedBy: pid },
      $addToSet: { participants: { $each: users } },
    })
    return { chat: existing, created: false }
  }

  const created = await Conversation.create({
    contextType: 'ticket',
    contextId: String(ticketId),
    title: '',
    participants: users,
    activo: true,
    createdBy: pid,
    updatedBy: pid,
  })

  return { chat: created.toObject(), created: true }
}

export async function syncTicketChatParticipants({
  chatId,
  participants,
  actor_id_personal,
}) {
  const pid = String(actor_id_personal).trim()
  await Conversation.findByIdAndUpdate(chatId, {
    $set: { participants: uniqTrim(participants), updatedBy: pid },
  })
}

export async function syncTicketChat({
  chatId,
  participants,
  actor_id_personal,
}) {
  return syncTicketChatParticipants({ chatId, participants, actor_id_personal })
}
