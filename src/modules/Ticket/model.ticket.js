import mongoose from 'mongoose'

const { Schema } = mongoose

// ===============================
// Adjuntos
// ===============================
const AttachmentSchema = new Schema(
  {
    fileId: { type: String, required: true, trim: true },
    name: { type: String, default: '', trim: true },
    url: { type: String, default: '', trim: true },
    mime: { type: String, default: '', trim: true },
    size: { type: Number, default: 0 },
    uploadedBy: { type: String, default: '', trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

// ===============================
// Operación
// ===============================
const OperacionSchema = new Schema(
  {
    // 🔹 Subtipo lógico de operación
    subtipo: {
      type: String,
      enum: ['comercio', 'bodega'],
      required: true,
      index: true,
    },

    cliente: { type: String, required: true, trim: true },
    lote: { type: String, default: '', trim: true },
    producto: { type: String, default: '', trim: true },

    servicios_adicionales: [{ type: String, trim: true }],
    apoyo_ids: [{ type: String, trim: true }],
  },
  { _id: false }
)

// ===============================
// Asignación
// ===============================
const AsignadoASchema = new Schema(
  {
    tipo: { type: String, enum: ['area', 'team', 'personal'], required: true },
    id: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
)

// ===============================
// Historial de estados (eventos)
// ===============================
const EstadoHistorialSchema = new Schema(
  {
    estado_id: { type: Schema.Types.ObjectId, required: true, index: true },

    nota: { type: String, default: '', trim: true },

    // 🔹 Fecha estimada propuesta en este evento (si aplica)
    fecha_estimada: { type: Date, default: null },

    // 🔹 Adjuntos agregados específicamente en este cambio
    adjuntos: { type: [AttachmentSchema], default: [] },

    changedBy: { type: String, required: true, trim: true }, // id_personal
    changedAt: { type: Date, default: Date.now, index: true },
  },
  { _id: false }
)

// ===============================
// Ticket
// ===============================
const TicketSchema = new Schema(
  {
    // Empresa (externo)
    orgId: { type: String, required: true, trim: true, index: true },

    // Código autoincremental
    code: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    codePrefix: { type: String, required: true, trim: true, index: true },
    codeSeq: { type: Number, required: true, index: true },

    tipo: {
      type: String,
      enum: ['tarea', 'proyecto', 'operacion'],
      required: true,
      index: true,
    },

    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, required: true, trim: true },

    categoria_id: { type: Schema.Types.ObjectId, required: true, index: true },
    prioridad_id: { type: Schema.Types.ObjectId, required: true, index: true },
    estado_id: { type: Schema.Types.ObjectId, required: true, index: true },

    // ===============================
    // Gestión de fechas
    // ===============================
    // 🔹 Fecha estimada vigente (opcional)
    fecha_estimada: { type: Date, default: null, index: true },

    // 🔹 Fecha real de cierre
    fecha_cierre_real: { type: Date, default: null },

    // 🔹 Resultado automático
    cumplimiento: {
      type: String,
      enum: ['cumplido', 'incumplido', 'no_aplica'],
      default: 'no_aplica',
      index: true,
    },

    // ===============================
    // Trazabilidad
    // ===============================
    estado_historial: { type: [EstadoHistorialSchema], default: [] },

    asignado_a: { type: AsignadoASchema, default: null },

    creado_por: { type: String, required: true, trim: true, index: true },
    watchers: [{ type: String, trim: true, index: true }],

    // Adjuntos globales del ticket
    adjuntos: { type: [AttachmentSchema], default: [] },

    // Operación (solo si tipo=operacion)
    operacion: { type: OperacionSchema, default: undefined },

    // ===============================
    // Relación entre tickets (comercio → bodega)
    // ===============================
    parent_ticket_id: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    child_ticket_ids: [{ type: Schema.Types.ObjectId, index: true }],

    chatId: { type: Schema.Types.ObjectId, default: null, index: true },

    activo: { type: Boolean, default: true, index: true },

    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

// ===============================
// Índices
// ===============================
TicketSchema.index({ 'asignado_a.tipo': 1, 'asignado_a.id': 1 })
TicketSchema.index({ orgId: 1, tipo: 1, estado_id: 1 })
TicketSchema.index({ orgId: 1, tipo: 1, prioridad_id: 1 })
TicketSchema.index({ tipo: 1, codeSeq: -1 })
TicketSchema.index({ parent_ticket_id: 1 })

export const Ticket = mongoose.model('Ticket', TicketSchema, 'tickets')
