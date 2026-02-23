// src/modules/chats/model.message.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const AttachmentSchema = new Schema(
  {
    fileId: { type: String, required: true, trim: true },
    name: { type: String, default: '', trim: true },
    url: { type: String, default: '', trim: true },
    mime: { type: String, default: '', trim: true },
    size: { type: Number, default: 0 },
  },
  { _id: false }
)

const MessageSchema = new Schema(
  {
    chatId: { type: Schema.Types.ObjectId, required: true, index: true },

    sender_id_personal: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // texto cifrado (Mongo no puede leerlo)
    text_enc: { type: String, default: '' }, // base64 ciphertext
    iv: { type: String, default: '' }, // base64
    tag: { type: String, default: '' }, // base64

    // preview genérico para notificaciones
    preview: { type: String, default: '' },

    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true }
)

MessageSchema.index({ chatId: 1, createdAt: -1 })

export const Message = mongoose.model('Message', MessageSchema, 'messages')
