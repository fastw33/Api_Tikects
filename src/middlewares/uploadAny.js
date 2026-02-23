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
  destination: (req, _file, cb) => {
    // ✅ soporta :ticketId o :id (en tickets usas :id)
    const ticketId = req.params.ticketId || req.params.id
    const chatId = req.params.chatId

    let base = path.join(process.cwd(), 'uploads')

    if (ticketId) base = path.join(base, 'tickets', String(ticketId))
    else if (chatId) base = path.join(base, 'chats', String(chatId))
    else base = path.join(base, 'misc')

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
