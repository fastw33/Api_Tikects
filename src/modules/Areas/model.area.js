import mongoose from 'mongoose'

const { Schema } = mongoose

const AreaSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true },
    nombre_normalizado: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    personal_ids: [{ type: String, trim: true }],
    activo: { type: Boolean, default: true },
  },
  { timestamps: true }
)

AreaSchema.index({ nombre_normalizado: 1 }, { unique: true })

AreaSchema.pre('validate', function (next) {
  if (this.nombre) {
    this.nombre_normalizado = this.nombre.toLowerCase().trim()
  }
  next()
})

// ✅ CLAVE PARA EVITAR OverwriteModelError
export const Area =
  mongoose.models.Area || mongoose.model('Area', AreaSchema, 'areas')
