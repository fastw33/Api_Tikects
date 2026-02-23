// src/modules/Ticket/model.ticketCounter.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const TicketCounterSchema = new Schema(
  {
    // key por tipo (tarea/proyecto/operacion)
    key: { type: String, required: true, unique: true, index: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
)

export const TicketCounter = mongoose.model(
  'TicketCounter',
  TicketCounterSchema,
  'ticket_counters'
)
