import mongoose from 'mongoose'
const { Schema } = mongoose

const PushSubscriptionSchema = new Schema(
  {
    id_personal: { type: String, required: true, trim: true, index: true },

    // Subscription estándar del navegador
    endpoint: { type: String, required: true, trim: true, unique: true },
    keys: {
      p256dh: { type: String, required: true, trim: true },
      auth: { type: String, required: true, trim: true },
    },

    // opcional: para debug / segmentación
    userAgent: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

PushSubscriptionSchema.index({ id_personal: 1, active: 1 })

export const PushSubscription = mongoose.model(
  'PushSubscription',
  PushSubscriptionSchema,
  'push_subscriptions'
)
