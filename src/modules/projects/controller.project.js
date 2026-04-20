import path from 'path'
import * as ProjectService from './service.project.js'

function toArray(v) {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function filesToNodeFile(req) {
  const files = Array.isArray(req.files) ? req.files : []
  const f = files[0]
  if (!f) return null

  const relDir = path
    .relative(path.join(process.cwd(), 'uploads'), path.dirname(f.path))
    .replace(/\\/g, '/')

  const url = `/uploads/${relDir}/${f.filename}`.replace(/\/+/g, '/')

  return {
    fileId: f.filename,
    name: f.originalname || f.filename,
    mime: f.mimetype || '',
    size: Number(f.size) || 0,
    path: url,
    folderPath: relDir,
  }
}

function filesToTraceAdjuntos(req) {
  const files = Array.isArray(req.files) ? req.files : []
  const actor = req.personal?.id_personal || 'sistema'
  
  return files.map(f => {
    const relDir = path
      .relative(path.join(process.cwd(), 'uploads'), path.dirname(f.path))
      .replace(/\\/g, '/')

    const url = `/uploads/${relDir}/${f.filename}`.replace(/\/+/g, '/')

    return {
      tipo: 'archivo',
      fileId: f.filename,
      name: f.originalname || f.filename,
      url,
      mime: f.mimetype || '',
      size: Number(f.size) || 0,
      uploadedBy: actor,
      createdAt: new Date(),
    }
  })
}

function parseUrlAdjuntos(req) {
  const actor = req.personal?.id_personal || 'sistema'
  const urls = []

  // Intentar parsear adjuntos_urls si existe
  const urlsInput = req.body?.adjuntos_urls
  if (urlsInput) {
    try {
      const parsed = typeof urlsInput === 'string' ? JSON.parse(urlsInput) : urlsInput
      if (Array.isArray(parsed)) {
        parsed.forEach(u => {
          const url = String(u?.url || '').trim()
          const nombre = String(u?.nombre || u?.name || url).trim()
          if (url) {
            urls.push({
              tipo: 'url',
              fileId: '',
              name: nombre || url,
              url,
              mime: '',
              size: 0,
              uploadedBy: actor,
              createdAt: new Date(),
            })
          }
        })
      }
    } catch {
      // Si falla el parse, ignorar
    }
  }

  return urls
}

function getAllAdjuntos(req) {
  const fileAdjuntos = filesToTraceAdjuntos(req)
  const urlAdjuntos = parseUrlAdjuntos(req)
  return [...fileAdjuntos, ...urlAdjuntos]
}

function parseMentions(body) {
  let raw = body?.mentions
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = []
    }
  }
  if (!Array.isArray(raw)) return []
  return raw
    .map(m => ({
      id_personal: String(m?.id_personal || '').trim(),
      nombre: String(m?.nombre || '').trim(),
    }))
    .filter(m => m.id_personal)
}

export async function createFromTicket(req, res) {
  try {
    const project = await ProjectService.createOrSyncProjectFromTicket(req.body)
    return res.status(201).json({ ok: true, project })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function list(req, res) {
  try {
    const data = await ProjectService.listProjects(req.query)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function getById(req, res) {
  try {
    const data = await ProjectService.getProjectById({
      project_id: req.params.id,
      id_personal: req.query.id_personal,
    })
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function createTask(req, res) {
  try {
    const adjuntos = getAllAdjuntos(req)
    const task = await ProjectService.createProjectTask({
      project_id: req.params.id,
      id_personal: req.body?.id_personal,
      payload: {
        ...req.body,
        mentions: parseMentions(req.body),
      },
      adjuntos,
    })
    return res.status(201).json({ ok: true, task })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function listTasks(req, res) {
  try {
    const items = await ProjectService.listProjectTasks({
      project_id: req.params.id,
      id_personal: req.query.id_personal,
    })
    return res.json({ ok: true, items })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function patchTask(req, res) {
  try {
    const task = await ProjectService.patchProjectTask({
      project_id: req.params.id,
      task_id: req.params.taskId,
      id_personal: req.body?.id_personal,
      payload: req.body,
    })
    return res.json({ ok: true, task })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function addTaskTrace(req, res) {
  try {
    const adjuntos = getAllAdjuntos(req)
    const task = await ProjectService.addTaskTrace({
      project_id: req.params.id,
      task_id: req.params.taskId,
      id_personal: req.body?.id_personal,
      payload: {
        ...req.body,
        mentions: parseMentions(req.body),
      },
      files: adjuntos,
    })
    return res.json({ ok: true, task })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function createRepoNode(req, res) {
  try {
    const file = filesToNodeFile(req)
    const node = await ProjectService.createRepoNode({
      project_id: req.params.id,
      id_personal: req.body?.id_personal,
      payload: req.body,
      file,
    })
    return res.status(201).json({ ok: true, node })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function listRepoNodes(req, res) {
  try {
    const items = await ProjectService.listRepositoryNodes({
      project_id: req.params.id,
      id_personal: req.query.id_personal,
      parent_id: req.query.parent_id,
    })
    return res.json({ ok: true, items })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function addComment(req, res) {
  try {
    const comment = await ProjectService.addComment({
      project_id: req.params.id,
      id_personal: req.body?.id_personal,
      payload: {
        ...req.body,
        mentions: parseMentions(req.body),
      },
    })
    return res.status(201).json({ ok: true, comment })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function patchCommentStatus(req, res) {
  try {
    const comment = await ProjectService.patchCommentStatus({
      project_id: req.params.id,
      comment_id: req.params.commentId,
      id_personal: req.body?.id_personal,
      estado_mencion: req.body?.estado_mencion,
    })
    return res.json({ ok: true, comment })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function myItems(req, res) {
  try {
    const data = await ProjectService.myItems(req.query)
    return res.json({ ok: true, ...data })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}

export async function addProjectTrace(req, res) {
  try {
    const adjuntos = getAllAdjuntos(req)
    const project = await ProjectService.addProjectTrace({
      project_id: req.params.id,
      id_personal: req.body?.id_personal,
      payload: {
        ...req.body,
        mentions: parseMentions(req.body),
      },
      files: adjuntos,
    })
    return res.json({ ok: true, project })
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, error: e.message })
  }
}