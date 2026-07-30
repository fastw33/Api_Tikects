import mongoose from 'mongoose'

const { Schema } = mongoose

const MentionSchema = new Schema(
  {
    id_personal: { type: String, required: true, trim: true, index: true },
    nombre: { type: String, default: '', trim: true },
  },
  { _id: false }
)

const TraceAttachmentSchema = new Schema(
  {
    tipo: { 
      type: String, 
      enum: ['archivo', 'url'], 
      default: 'archivo',
      required: true 
    },
    fileId: { type: String, default: '', trim: true }, // Solo para archivos
    name: { type: String, default: '', trim: true, required: true },
    url: { type: String, default: '', trim: true, required: true },
    mime: { type: String, default: '', trim: true },
    size: { type: Number, default: 0 },
    uploadedBy: { type: String, default: '', trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

const TaskTraceSchema = new Schema(
  {
    tipo: {
      type: String,
      enum: ['estado', 'comentario', 'bloqueador', 'progreso'],
      default: 'estado',
    },
    estado: { type: String, default: '', trim: true },
    nota: { type: String, default: '', trim: true },
    mentions: { type: [MentionSchema], default: [] },
    adjuntos: { type: [TraceAttachmentSchema], default: [] },
    changedBy: { type: String, required: true, trim: true },
    changedAt: { type: Date, default: Date.now, index: true },
  },
  { _id: false }
)

const ProjectTraceSchema = new Schema(
  {
    tipo: {
      type: String,
      enum: ['estado', 'comentario', 'hito', 'decision'],
      default: 'comentario',
    },
    estado: { type: String, default: '', trim: true },
    titulo: { type: String, default: '', trim: true },
    nota: { type: String, default: '', trim: true },
    mentions: { type: [MentionSchema], default: [] },
    adjuntos: { type: [TraceAttachmentSchema], default: [] },
    changedBy: { type: String, required: true, trim: true },
    changedAt: { type: Date, default: Date.now, index: true },
  },
  { _id: false }
)

const ProjectSchema = new Schema(
  {
    ticket_id: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    orgId: { type: String, required: true, trim: true, index: true },
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    creado_por: { type: String, required: true, trim: true, index: true },
    miembros: [{ type: String, trim: true, index: true }],
    estado: {
      type: String,
      default: 'abierto',
      trim: true,
      index: true,
    },
    trazabilidad: { type: [ProjectTraceSchema], default: [] },
    nextTaskSeq: { type: Number, default: 1 },
    activo: { type: Boolean, default: true, index: true },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

const ProjectTaskSchema = new Schema(
  {
    project_id: { type: Schema.Types.ObjectId, required: true, index: true },
    code: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    seq: { type: Number, required: true },
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '', trim: true },
    
    // Prioridad del catálogo
    prioridad_id: { type: String, default: '', trim: true, index: true },
    prioridad_label: { type: String, default: '', trim: true },
    prioridad_color: { type: String, default: '', trim: true },
    
    estado: {
      type: String,
      default: 'abierta',
      trim: true,
      index: true,
    },
    
    // Asignación
    asignado_tipo: {
      type: String,
      enum: ['personal', 'area', 'team'],
      default: 'personal',
    },
    assigned_to: { type: String, default: '', trim: true, index: true },
    assigned_label: { type: String, default: '', trim: true },
    
    mentions: { type: [MentionSchema], default: [] },
    trazabilidad: { type: [TaskTraceSchema], default: [] },
    due_date: { type: Date, default: null },
    closed_at: { type: Date, default: null },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

ProjectTaskSchema.index({ project_id: 1, seq: 1 }, { unique: true })

const ProjectRepositoryNodeSchema = new Schema(
  {
    project_id: { type: Schema.Types.ObjectId, required: true, index: true },
    parent_id: { type: Schema.Types.ObjectId, default: null, index: true },
    type: {
      type: String,
      enum: ['folder', 'file', 'url'],
      required: true,
      index: true,
    },
    nombre: { type: String, required: true, trim: true },
    url: { type: String, default: '', trim: true },
    file: {
      fileId: { type: String, default: '', trim: true },
      name: { type: String, default: '', trim: true },
      mime: { type: String, default: '', trim: true },
      size: { type: Number, default: 0 },
      path: { type: String, default: '', trim: true },
    },
    activo: { type: Boolean, default: true, index: true },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

const ProjectCommentSchema = new Schema(
  {
    project_id: { type: Schema.Types.ObjectId, required: true, index: true },
    resource_type: {
      type: String,
      enum: ['project', 'task', 'repository_node', 'comment'],
      required: true,
      index: true,
    },
    resource_id: { type: String, required: true, trim: true, index: true },
    parent_comment_id: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    text: { type: String, required: true, trim: true },
    mentions: { type: [MentionSchema], default: [] },
    estado_mencion: {
      type: String,
      enum: ['pendiente', 'respondida', 'cerrada'],
      default: 'pendiente',
      index: true,
    },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

const ProjectAccessGrantSchema = new Schema(
  {
    project_id: { type: Schema.Types.ObjectId, required: true, index: true },
    id_personal: { type: String, required: true, trim: true, index: true },
    resource_type: {
      type: String,
      enum: ['project', 'task', 'repository_node', 'comment'],
      required: true,
      index: true,
    },
    resource_id: { type: String, required: true, trim: true, index: true },
    source: {
      type: String,
      enum: ['assignment', 'mention'],
      required: true,
      index: true,
    },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

ProjectAccessGrantSchema.index(
  {
    project_id: 1,
    id_personal: 1,
    resource_type: 1,
    resource_id: 1,
    source: 1,
  },
  { unique: true }
)

export const Project = mongoose.model('Project', ProjectSchema, 'projects')
export const ProjectTask = mongoose.model(
  'ProjectTask',
  ProjectTaskSchema,
  'project_tasks'
)
export const ProjectRepositoryNode = mongoose.model(
  'ProjectRepositoryNode',
  ProjectRepositoryNodeSchema,
  'project_repository_nodes'
)
export const ProjectComment = mongoose.model(
  'ProjectComment',
  ProjectCommentSchema,
  'project_comments'
)
export const ProjectAccessGrant = mongoose.model(
  'ProjectAccessGrant',
  ProjectAccessGrantSchema,
  'project_access_grants'
)
