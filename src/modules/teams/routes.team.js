// routes.team.js
import { Router } from 'express'
import * as TeamController from './controller.team.js'
import {
  validateCreateTeam,
  validateUpdateTeam,
  validateListTeams,
  validateIdParam,
} from './validator.team.js'

const router = Router()

/**
 * @swagger
 * tags:
 *   name: Teams
 *   description: Gestión de equipos (mixtos por áreas/empresas). Miembros identificados por id_personal.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Team:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: 64f1c2b9e4a8c8d123456789
 *         nombre:
 *           type: string
 *           example: Equipo Importación
 *         descripcion:
 *           type: string
 *           example: Equipo para casos de importación (multi-área).
 *         personal_ids:
 *           type: array
 *           items:
 *             type: string
 *           example: ["PERS-1001","PERS-2002"]
 *         lider_ids:
 *           type: array
 *           items:
 *             type: string
 *           example: ["PERS-1001"]
 *         activo:
 *           type: boolean
 *           example: true
 *         createdBy:
 *           type: string
 *           example: "PERS-9999"
 *         updatedBy:
 *           type: string
 *           example: "PERS-9999"
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /teams:
 *   post:
 *     summary: Crear un team
 *     tags: [Teams]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, personal_ids, id_personal]
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: Equipo Soporte Técnico
 *               descripcion:
 *                 type: string
 *                 example: Soporte transversal
 *               personal_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["PERS-1001","PERS-2002"]
 *               lider_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["PERS-1001"]
 *               id_personal:
 *                 type: string
 *                 description: id_personal del actor que crea el team (auditoría)
 *                 example: "PERS-9999"
 *     responses:
 *       201:
 *         description: Team creado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 team:
 *                   $ref: '#/components/schemas/Team'
 *       400:
 *         description: Error de validación
 *       409:
 *         description: Nombre duplicado
 */
router.post('/', validateCreateTeam, TeamController.create)

/**
 * @swagger
 * /teams:
 *   get:
 *     summary: Listar teams (paginado, último insertado primero)
 *     tags: [Teams]
 *     parameters:
 *       - in: query
 *         name: page
 *         required: true
 *         schema:
 *           type: integer
 *           example: 1
 *       - in: query
 *         name: limit
 *         required: true
 *         schema:
 *           type: integer
 *           example: 20
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *           example: soporte
 *       - in: query
 *         name: activo
 *         required: false
 *         schema:
 *           type: boolean
 *           example: true
 *     responses:
 *       200:
 *         description: Listado paginado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Team'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     pages:
 *                       type: integer
 */
router.get('/', validateListTeams, TeamController.list)

/**
 * @swagger
 * /teams/{id}:
 *   get:
 *     summary: Obtener un team por ID
 *     tags: [Teams]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           example: 64f1c2b9e4a8c8d123456789
 *     responses:
 *       200:
 *         description: Team encontrado
 *       404:
 *         description: No encontrado
 */
router.get('/:id', validateIdParam, TeamController.getById)

/**
 * @swagger
 * /teams/{id}:
 *   put:
 *     summary: Actualizar un team (miembros/líderes/nombre/descripcion/activo)
 *     tags: [Teams]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_personal]
 *             properties:
 *               nombre:
 *                 type: string
 *               descripcion:
 *                 type: string
 *               personal_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Si se envía, NO puede ser vacío.
 *               lider_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Si se envía, debe ser subset de personal_ids (o se limpia).
 *               activo:
 *                 type: boolean
 *               id_personal:
 *                 type: string
 *                 description: id_personal del actor que actualiza (auditoría)
 *     responses:
 *       200:
 *         description: Team actualizado
 *       400:
 *         description: Error de validación
 *       404:
 *         description: No encontrado
 *       409:
 *         description: Nombre duplicado
 */
router.put('/:id', validateIdParam, validateUpdateTeam, TeamController.update)

/**
 * @swagger
 * /teams/{id}/deactivate:
 *   patch:
 *     summary: Desactivar un team (soft delete)
 *     tags: [Teams]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_personal]
 *             properties:
 *               id_personal:
 *                 type: string
 *                 example: "PERS-9999"
 *     responses:
 *       200:
 *         description: Team desactivado
 *       404:
 *         description: No encontrado
 */
router.patch('/:id/deactivate', validateIdParam, TeamController.deactivate)

export default router
