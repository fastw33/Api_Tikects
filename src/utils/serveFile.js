// src/utils/serveFile.js
import fs from 'fs'
import path from 'path'

/**
 * Middleware para servir archivos de forma segura con autenticación
 * Uso: app.get('/api/secure-file/*', authMiddleware, serveSecureFile)
 */
export function serveSecureFile(req, res) {
  try {
    // Obtener la ruta del archivo desde req.path
    // Si la ruta es /tikets/secure-file/projects/123/archivo.pdf
    // extraemos 'projects/123/archivo.pdf'
    const secureFilePrefix = '/tikets/secure-file/'
    let filePath = req.path
    if (filePath.startsWith(secureFilePrefix)) {
      filePath = filePath.substring(secureFilePrefix.length)
    }
    
    if (!filePath) {
      return res.status(400).json({ ok: false, error: 'Ruta de archivo no especificada' })
    }

    // Sanitizar la ruta para evitar directory traversal
    const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '')
    const fullPath = path.join(process.cwd(), 'uploads', safePath)

    // Verificar que el archivo está dentro del directorio uploads
    const uploadsDir = path.join(process.cwd(), 'uploads')
    if (!fullPath.startsWith(uploadsDir)) {
      return res.status(403).json({ ok: false, error: 'Acceso denegado' })
    }

    // Verificar que el archivo existe
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado' })
    }

    // Verificar que es un archivo y no un directorio
    const stats = fs.statSync(fullPath)
    if (!stats.isFile()) {
      return res.status(400).json({ ok: false, error: 'La ruta no corresponde a un archivo' })
    }

    // Obtener el tipo MIME basado en la extensión
    const ext = path.extname(fullPath).toLowerCase()
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
      '.7z': 'application/x-7z-compressed',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
    }

    const contentType = mimeTypes[ext] || 'application/octet-stream'

    // Establecer headers CORS para permitir fetch con credenciales
    const origin = req.headers.origin
    if (origin && process.env.CORS_ORIGIN) {
      const allowedOrigins = process.env.CORS_ORIGIN.split(',').map(s => s.trim())
      if (allowedOrigins.includes(origin) || !process.env.CORS_ORIGIN) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
      }
    }

    // Establecer headers de contenido
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', stats.size)
    
    // Para imágenes y PDFs, permitir visualización inline
    if (contentType.startsWith('image/') || contentType === 'application/pdf') {
      res.setHeader('Content-Disposition', 'inline')
    } else {
      // Para otros archivos, forzar descarga
      const filename = path.basename(fullPath)
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    }

    // Cache control
    res.setHeader('Cache-Control', 'private, max-age=3600')

    // Enviar el archivo
    const fileStream = fs.createReadStream(fullPath)
    fileStream.pipe(res)

    fileStream.on('error', (err) => {
      console.error('Error al leer archivo:', err)
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Error al leer el archivo' })
      }
    })

  } catch (error) {
    console.error('Error en serveSecureFile:', error)
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Error al servir el archivo' })
    }
  }
}
