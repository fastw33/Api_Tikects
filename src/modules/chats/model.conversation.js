// src/modules/chats/model.conversation.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const LastMessageSchema = new Schema(
  {
    preview: { type: String, default: '' },
    at: { type: Date, default: null },
    sender: { type: String, default: '', trim: true },
  },
  { _id: false }
)

const ConversationSchema = new Schema(
  {
    contextType: {
      type: String,
      enum: ['ticket', 'free'],
      required: true,
      index: true,
    },
    contextId: { type: Schema.Types.ObjectId, default: null, index: true }, // ticketId si aplica

    title: { type: String, default: '', trim: true }, // solo útil para free

    participants: [{ type: String, required: true, trim: true, index: true }], // id_personal

    // Map de id_personal -> Date (puntero de leído)
    lastRead: { type: Map, of: Date, default: {} },

    lastMessage: { type: LastMessageSchema, default: () => ({}) },

    activo: { type: Boolean, default: true, index: true },

    // Auditoría (actor)
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

// Un chat por ticket
ConversationSchema.index(
  { contextType: 1, contextId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      contextType: 'ticket',
      contextId: { $type: 'objectId' },
    },
  }
)

export const Conversation = mongoose.model(
  'Conversation',
  ConversationSchema,
  'conversations'
)
