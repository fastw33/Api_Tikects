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
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Conversation.countDocuments(filter),
  ])

  const enriched = await Promise.all(
    items.map(async c => {
      const lastReadAt = c.lastRead?.[pid] ? new Date(c.lastRead[pid]) : null

      const msgFilter = {
        chatId: c._id,
        sender_id_personal: { $ne: pid },
      }

      if (lastReadAt) msgFilter.createdAt = { $gt: lastReadAt }

      const unreadCount = await Message.countDocuments(msgFilter)

      return {
        ...c,
        participantsCount: c.participants?.length || 0,
        unreadCount,
        lastReadAt,
      }
    })
  )

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
  await assertParticipant(chatId, id_personal)

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

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0
  const preview = hasAttachments ? 'Nuevo mensaje con adjunto' : 'Nuevo mensaje'

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
      lastMessage: { preview, at: new Date(), sender: pid },
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
  const chat = await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  const lastReadAt = at ? new Date(at) : new Date()

  await Conversation.findByIdAndUpdate(chatId, {
    $set: {
      [`lastRead.${pid}`]: lastReadAt,
      updatedBy: pid,
    },
  })

  return { lastReadAt, chat }
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
