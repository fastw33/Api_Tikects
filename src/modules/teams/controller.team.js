// controller.team.js
import * as TeamService from './service.team.js'

export async function create(req, res) {
  try {
    const team = await TeamService.createTeam(req.body)
    return res.status(201).json({ ok: true, team })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error creando team' })
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

    const data = await TeamService.listTeams({
      search,
      activo: parsedActivo,
      page,
      limit,
    })

    return res.json({ ok: true, ...data })
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || 'Error listando teams' })
  }
}

export async function getById(req, res) {
  try {
    const team = await TeamService.getTeamById(req.params.id)
    return res.json({ ok: true, team })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error consultando team' })
  }
}

export async function update(req, res) {
  try {
    const team = await TeamService.updateTeam(req.params.id, req.body)
    return res.json({ ok: true, team })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error actualizando team' })
  }
}

export async function deactivate(req, res) {
  try {
    const { id_personal } = req.body
    const team = await TeamService.deactivateTeam(req.params.id, id_personal)
    return res.json({ ok: true, team })
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ ok: false, error: e.message || 'Error desactivando team' })
  }
}
