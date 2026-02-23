// controller.area.js
import * as AreaService from './service.area.js'

export async function create(req, res) {
  try {
    const area = await AreaService.createArea(req.body)
    return res.status(201).json({ ok: true, area })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error creando área' })
  }
}

export async function list(req, res) {
  try {
    const { search, activo, page, limit } = req.query

    const parsedActivo =
      activo === undefined
        ? undefined
        : activo === 'true'
        ? true
        : activo === 'false'
        ? false
        : undefined

    const data = await AreaService.listAreas({
      search,
      activo: parsedActivo,
      page,
      limit,
    })

    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error listando áreas' })
  }
}

export async function getById(req, res) {
  try {
    const area = await AreaService.getAreaById(req.params.id)
    return res.json({ ok: true, area })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error consultando área' })
  }
}

export async function update(req, res) {
  try {
    const area = await AreaService.updateArea(req.params.id, req.body)
    return res.json({ ok: true, area })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando área' })
  }
}

export async function deactivate(req, res) {
  try {
    const area = await AreaService.deactivateArea(req.params.id)
    return res.json({ ok: true, area })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error desactivando área' })
  }
}
