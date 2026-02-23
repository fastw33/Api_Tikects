// src/modules/Catalogos/model.catalog.js
import mongoose from 'mongoose'

const { Schema } = mongoose

const CatalogSchema = new Schema(
  {
    // ✅ Multi-empresa (ID EXTERNO)
    orgId: { type: String, required: true, trim: true, index: true },

    // Tipo de item (categoria, prioridad, estado, etc.)
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // Código estable
    code: { type: String, required: true, trim: true },

    // Texto visible
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },

    color: {
      type: String,
      default: '',
      trim: true,
      match: /^#([0-9A-Fa-f]{3}){1,2}$/,
    },
    // Control
    active: { type: Boolean, default: true, index: true },

    // Orden UI
    order: { type: Number, default: 0 },

    // Datos extra
    meta: { type: Schema.Types.Mixed, default: {} },

    // Auditoría (IDs externos también)
    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },

    // Normalizados
    code_norm: { type: String, required: true, trim: true },
    name_norm: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

// Unicidad por empresa + tipo + código
CatalogSchema.index({ orgId: 1, type: 1, code_norm: 1 }, { unique: true })

// Evitar duplicados de nombre en el mismo tipo
CatalogSchema.index({ orgId: 1, type: 1, name_norm: 1 }, { unique: true })

CatalogSchema.pre('validate', function (next) {
  if (this.code) this.code_norm = String(this.code).toLowerCase().trim()
  if (this.name) this.name_norm = String(this.name).toLowerCase().trim()
  next()
})

export const Catalog = mongoose.model('Catalog', CatalogSchema, 'catalog')
