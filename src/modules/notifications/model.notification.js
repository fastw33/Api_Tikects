// src/modules/notifications/model.notification.js
import mongoose from 'mongoose'
const { Schema } = mongoose

const TargetSchema = new Schema(
  {
    type: { type: String, enum: ['ticket', 'chat'], required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    url: { type: String, default: '' }, // opcional (deep link)
  },
  { _id: false }
)

const NotificationSchema = new Schema(
  {
    to_id_personal: { type: String, required: true, trim: true, index: true },

    type: { type: String, required: true, trim: true, index: true }, // ej: chat.message_new, ticket.assigned
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },

    // para navegar al dar click
    target: { type: TargetSchema, required: true },

    // metadata extra (orgId, estado, prioridad, etc.)
    meta: { type: Schema.Types.Mixed, default: {} },

    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },

    // auditoría
    createdBy: { type: String, required: true, trim: true }, // actor id_personal
  },
  { timestamps: true }
)

NotificationSchema.index({ to_id_personal: 1, isRead: 1, createdAt: -1 })

export const Notification = mongoose.model(
  'Notification',
  NotificationSchema,
  'notifications'
)
