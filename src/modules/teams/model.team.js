// model.team.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const TeamSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    nombre_norm: { type: String, required: true, trim: true },

    descripcion: { type: String, default: '', trim: true },

    // IDs del personal (vienen del otro sistema)
    personal_ids: [{ type: String, required: true, trim: true }],
    lider_ids: [{ type: String, trim: true }],

    activo: { type: Boolean, default: true },

    // Auditoría (id_personal del actor)
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

// Unicidad por nombre (normalizado)
TeamSchema.index({ nombre_norm: 1 }, { unique: true })

TeamSchema.pre('validate', function (next) {
  if (this.nombre) this.nombre_norm = String(this.nombre).toLowerCase().trim()
  next()
})

export const Team = mongoose.model('Team', TeamSchema, 'teams')
