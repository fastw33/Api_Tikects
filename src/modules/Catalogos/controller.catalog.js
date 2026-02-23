import * as CatalogService from './service.catalog.js'

// Asumo que authMiddleware ya setea req.user (con id personal/usuario)
function getUserId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.user?.Id_personal ||
    req.user?.id_personal
  )
}

export async function create(req, res) {
  try {
    const userId = getUserId(req)
    const { orgId } = req.body

    await CatalogService.assertUserCanAccessOrg(req.user, orgId)

    const item = await CatalogService.createCatalogItem({
      ...req.body,
      userId,
    })

    return res.status(201).json({ ok: true, item })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error creando catálogo' })
  }
}

export async function list(req, res) {
  try {
    const { orgId, type, search, page, limit } = req.query

    const parsedActive =
      req.query.active === undefined
        ? undefined
        : req.query.active === 'true'
        ? true
        : req.query.active === 'false'
        ? false
        : undefined

    await CatalogService.assertUserCanAccessOrg(req.user, orgId)

    const data = await CatalogService.listCatalog({
      orgId,
      type,
      search,
      active: parsedActive,
      page,
      limit,
    })

    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error listando catálogo' })
  }
}

export async function getById(req, res) {
  try {
    const { orgId } = req.query

    await CatalogService.assertUserCanAccessOrg(req.user, orgId)

    const item = await CatalogService.getCatalogById({
      orgId,
      id: req.params.id,
    })

    return res.json({ ok: true, item })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error consultando catálogo' })
  }
}

export async function update(req, res) {
  try {
    const userId = getUserId(req)
    const { orgId } = req.query

    await CatalogService.assertUserCanAccessOrg(req.user, orgId)

    const item = await CatalogService.updateCatalog({
      orgId,
      id: req.params.id,
      userId,
      patch: req.body,
    })

    return res.json({ ok: true, item })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando catálogo' })
  }
}

export async function deactivate(req, res) {
  try {
    const userId = getUserId(req)
    const { orgId } = req.query

    await CatalogService.assertUserCanAccessOrg(req.user, orgId)

    const item = await CatalogService.deactivateCatalog({
      orgId,
      id: req.params.id,
      userId,
    })

    return res.json({ ok: true, item })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error desactivando catálogo' })
  }
}
