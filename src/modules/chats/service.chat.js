import mongoose from 'mongoose'
import { Conversation } from './model.conversation.js'
import { Message } from './model.message.js'
import { encryptText, decryptText } from './crypto.message.js'
import { resolveSharedResourcesFromText } from '../sharedResources/resolver.js'

const ALLOWED_REACTION_EMOJIS = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🙏',
  '👏',
  '🔥',
  '🎉',
  '✅',
]

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

function hasBeenReadByOthers({ chat, message, id_personal }) {
  const pid = String(id_personal || '').trim()
  const messageAt = new Date(message?.createdAt || 0).getTime()
  if (!messageAt) return false

  const lastRead = normalizeLastRead(chat?.lastRead)
  return (chat?.participants || []).some(participantId => {
    const otherId = String(participantId || '').trim()
    if (!otherId || otherId === pid) return false
    const readAt = new Date(lastRead[otherId] || 0).getTime()
    return Boolean(readAt && readAt >= messageAt)
  })
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

async function resolveMessageSharedResources(text) {
  try {
    return await resolveSharedResourcesFromText(text)
  } catch (error) {
    console.warn('shared-resource:chat-resolution-failed', {
      error: error?.message || String(error || 'unknown'),
    })
    return []
  }
}

function dayBounds(dateValue) {
  const raw = String(dateValue || '').trim()
  if (!raw) return null
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000`)
  if (Number.isNaN(date.getTime())) return null
  const next = new Date(date)
  next.setDate(date.getDate() + 1)
  return { from: date, to: next }
}

function normalizeMentionIds({ mentions, participants, senderId }) {
  const allowed = new Set(
    (participants || [])
      .map(p => String(p || '').trim())
      .filter(p => p && p !== senderId)
  )
  return uniqTrim(Array.isArray(mentions) ? mentions : []).filter(id =>
    allowed.has(id)
  )
}

async function buildReplyTo(chatId, replyToMessageId) {
  const id = String(replyToMessageId || '').trim()
  if (!id) return null
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error('replyToMessageId inválido.')
    err.status = 400
    throw err
  }

  const original = await Message.findOne({ _id: id, chatId }).lean()
  if (!original) {
    const err = new Error('El mensaje a responder no existe en este chat.')
    err.status = 404
    throw err
  }

  return {
    messageId: original._id,
    sender_id_personal: original.sender_id_personal || '',
    preview: buildMessagePreview({
      text: decryptText(original),
      attachments: original.attachments,
    }),
    createdAt: original.createdAt || null,
  }
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

  const paged = enriched.slice(skip, skip + safeLimit)

  return {
    items: paged,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  }
}

export async function getMessages({
  chatId,
  id_personal,
  page,
  limit,
  search,
  sender_id_personal,
  date,
  from,
  to,
}) {
  const chat = await assertParticipant(chatId, id_personal)

  const { safePage, safeLimit, skip } = parsePaging({ page, limit })
  const cleanSearch = String(search || '').trim().toLowerCase()
  const senderFilter = String(sender_id_personal || '').trim()
  const day = dayBounds(date)
  const createdAt = {}
  const fromDate = from ? new Date(from) : day?.from
  const toDate = to ? new Date(to) : day?.to

  if (fromDate && !Number.isNaN(fromDate.getTime())) createdAt.$gte = fromDate
  if (toDate && !Number.isNaN(toDate.getTime())) createdAt.$lt = toDate

  const filter = { chatId }
  if (senderFilter) filter.sender_id_personal = senderFilter
  if (Object.keys(createdAt).length) filter.createdAt = createdAt

  if (cleanSearch) {
    const allItems = await Message.find(filter).sort({ createdAt: -1 }).lean()
    const filtered = allItems
      .map(m => ({
        ...m,
        text: decryptText(m),
      }))
      .filter(m => {
        const haystack = [
          m.text,
          m.preview,
          m.sender_id_personal,
          ...(Array.isArray(m.attachments) ? m.attachments.map(a => a.name) : []),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(cleanSearch)
      })

    const total = filtered.length
    const paged = filtered.slice(skip, skip + safeLimit)

    return {
      items: paged,
      lastRead: normalizeLastRead(chat.lastRead),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        pages: Math.ceil(total / safeLimit) || 1,
      },
    }
  }

  const [items, total] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Message.countDocuments(filter),
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
  replyToMessageId,
  mentions = [],
}) {
  const chat = await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  const preview = buildMessagePreview({ text, attachments })
  const replyTo = await buildReplyTo(chatId, replyToMessageId)
  const mentionIds = normalizeMentionIds({
    mentions,
    participants: chat.participants,
    senderId: pid,
  })

  const enc = encryptText(text)
  const sharedResources = await resolveMessageSharedResources(text)

  const msg = await Message.create({
    chatId: new mongoose.Types.ObjectId(chatId),
    sender_id_personal: pid,
    ...enc,
    preview,
    attachments: Array.isArray(attachments) ? attachments : [],
    sharedResources,
    replyTo,
    mentions: mentionIds,
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

  return messageOut
}

export async function editMessage({ chatId, messageId, id_personal, text }) {
  const chat = await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  const message = await Message.findOne({ _id: messageId, chatId }).lean()
  if (!message) {
    const err = new Error('Mensaje no encontrado.')
    err.status = 404
    throw err
  }

  if (String(message.sender_id_personal || '') !== pid) {
    const err = new Error('Solo puedes editar tus propios mensajes.')
    err.status = 403
    throw err
  }

  if (hasBeenReadByOthers({ chat, message, id_personal: pid })) {
    const err = new Error('No puedes editar un mensaje que ya fue leído.')
    err.status = 409
    throw err
  }

  const cleanText = String(text || '').trim()
  if (!cleanText) {
    const err = new Error('El texto del mensaje es requerido.')
    err.status = 400
    throw err
  }

  const enc = encryptText(cleanText)
  const sharedResources = await resolveMessageSharedResources(cleanText)
  const preview = buildMessagePreview({
    text: cleanText,
    attachments: message.attachments,
  })
  const editedAt = new Date()

  const updated = await Message.findOneAndUpdate(
    { _id: messageId, chatId },
    {
      $set: {
        ...enc,
        preview,
        sharedResources,
        editedAt,
        editedBy: pid,
      },
    },
    { new: true }
  ).lean()

  const latest = await Message.findOne({ chatId }).sort({ createdAt: -1 }).lean()
  if (latest && String(latest._id) === String(messageId)) {
    await Conversation.findByIdAndUpdate(chatId, {
      $set: {
        updatedBy: pid,
        lastMessage: {
          preview,
          at: latest.createdAt || updated.createdAt || new Date(),
          sender: pid,
        },
      },
    })
  }

  return {
    ...updated,
    text: decryptText(updated),
  }
}

export async function deleteMessage({ chatId, messageId, id_personal }) {
  const chat = await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()

  const message = await Message.findOne({ _id: messageId, chatId }).lean()
  if (!message) {
    const err = new Error('Mensaje no encontrado.')
    err.status = 404
    throw err
  }

  if (String(message.sender_id_personal || '') !== pid) {
    const err = new Error('Solo puedes eliminar tus propios mensajes.')
    err.status = 403
    throw err
  }

  if (hasBeenReadByOthers({ chat, message, id_personal: pid })) {
    const err = new Error('No puedes eliminar un mensaje que ya fue leído.')
    err.status = 409
    throw err
  }

  await Message.deleteOne({ _id: messageId, chatId })

  const latest = await Message.findOne({ chatId }).sort({ createdAt: -1 }).lean()
  const latestText = latest ? decryptText(latest) : ''
  const lastMessage = latest
    ? {
        preview: buildMessagePreview({
          text: latestText,
          attachments: latest.attachments,
        }),
        at: latest.createdAt || new Date(),
        sender: latest.sender_id_personal || '',
      }
    : { preview: '', at: null, sender: '' }

  await Conversation.findByIdAndUpdate(chatId, {
    $set: {
      updatedBy: pid,
      lastMessage,
    },
  })

  return { messageId: String(messageId), lastMessage }
}

export async function toggleReaction({
  chatId,
  messageId,
  id_personal,
  emoji,
}) {
  await assertParticipant(chatId, id_personal)
  const pid = String(id_personal).trim()
  const cleanEmoji = String(emoji || '').trim()

  if (!ALLOWED_REACTION_EMOJIS.includes(cleanEmoji)) {
    const err = new Error('Reacción inválida.')
    err.status = 400
    throw err
  }

  const message = await Message.findOne({ _id: messageId, chatId })
  if (!message) {
    const err = new Error('Mensaje no encontrado.')
    err.status = 404
    throw err
  }

  const existing = Array.isArray(message.reactions) ? message.reactions : []
  const previous = existing.find(r => String(r.id_personal || '') === pid)
  const shouldRemove = previous && String(previous.emoji || '') === cleanEmoji

  message.reactions = existing
    .filter(r => String(r.id_personal || '') !== pid)
    .map(r => ({
      emoji: r.emoji,
      id_personal: r.id_personal,
      createdAt: r.createdAt || new Date(),
    }))

  if (!shouldRemove) {
    message.reactions.push({
      emoji: cleanEmoji,
      id_personal: pid,
      createdAt: new Date(),
    })
  }

  const saved = await message.save()
  const out = saved.toObject()

  return {
    ...out,
    text: decryptText(out),
  }
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
