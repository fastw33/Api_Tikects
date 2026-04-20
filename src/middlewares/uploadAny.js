// src/middlewares/uploadAny.js
import multer from 'multer'
import fs from 'fs'
import path from 'path'

// Crea carpeta si no existe
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// Sanitiza nombre
function safeName(name = 'file') {
  return name
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
}

const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    // ✅ soporta :ticketId o :id (en tickets usas :id)
    const ticketId = req.params.ticketId || req.params.id
    const chatId = req.params.chatId
    const isProjectRoute = req.baseUrl?.includes('/projects') || req.path?.includes('/projects')
    const parentId = req.body?.parent_id

    let base = path.join(process.cwd(), 'uploads')

    if (isProjectRoute && ticketId) {
      base = path.join(base, 'projects', String(ticketId))
      
      // Si hay parent_id, intentar obtener la ruta de carpetas
      if (parentId && parentId !== 'null' && parentId !== '') {
        try {
          // Importar dinámicamente ProjectRepositoryNode
          const { ProjectRepositoryNode } = await import('../modules/projects/model.project.js')
          const mongoose = await import('mongoose')
          
          if (mongoose.default.Types.ObjectId.isValid(parentId)) {
            const folderPath = []
            let currentId = new mongoose.default.Types.ObjectId(parentId)
            
            // Construir la ruta navegando hacia arriba
            for (let i = 0; i < 10; i++) { // máximo 10 niveles de profundidad
              const node = await ProjectRepositoryNode.findById(currentId).lean()
              if (!node) break
              
              folderPath.unshift(node.nombre.replace(/[^\w\s\-\.]/g, '_'))
              
              if (!node.parent_id) break
              currentId = node.parent_id
            }
            
            if (folderPath.length > 0) {
              base = path.join(base, ...folderPath)
            }
          }
        } catch (e) {
          // Si falla, usar ruta base
          console.warn('Error construyendo ruta de carpetas:', e.message)
        }
      }
    } else if (ticketId) {
      base = path.join(base, 'tickets', String(ticketId))
    } else if (chatId) {
      base = path.join(base, 'chats', String(chatId))
    } else {
      base = path.join(base, 'misc')
    }

    ensureDir(base)
    cb(null, base)
  },

  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '')
    const base = safeName(path.basename(file.originalname || 'file', ext))
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `${base}-${unique}${ext}`)
  },
})

export const uploadAny = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB por archivo
    files: 50, // max 50 archivos por request
  },
})
