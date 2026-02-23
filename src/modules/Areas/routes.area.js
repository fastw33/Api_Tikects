// routes.area.js
import { Router } from 'express'
import * as AreaController from './controller.area.js'
import {
  validateCreateArea,
  validateUpdateArea,
  validateIdParam,
} from './validator.area.js'

const router = Router()

/**
 * @swagger
 * tags:
 *   name: Areas
 *   description: Gestión de áreas/departamentos de la empresa
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Area:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: 64f1c2b9e4a8c8d123456789
 *         nombre:
 *           type: string
 *           example: Bodega
 *         descripcion:
 *           type: string
 *           example: Área encargada de inventario y despacho
 *         personal_ids:
 *           type: array
 *           items:
 *             type: string
 *             example: 64f1c2b9e4a8c8d987654321
 *         activo:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /areas:
 *   post:
 *     summary: Crear un área
 *     tags: [Areas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nombre
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: Tecnología
 *               descripcion:
 *                 type: string
 *                 example: Área de sistemas y desarrollo
 *               personal_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Área creada correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 area:
 *                   $ref: '#/components/schemas/Area'
 *       409:
 *         description: Área duplicada
 *       400:
 *         description: Error de validación
 */
router.post('/', validateCreateArea, AreaController.create)

/**
 * @swagger
 * /areas:
 *   get:
 *     summary: Listar áreas con paginación
 *     tags: [Areas]
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
 *         schema:
 *           type: string
 *           example: bodega
 *       - in: query
 *         name: activo
 *         schema:
 *           type: boolean
 *           example: true
 *     responses:
 *       200:
 *         description: Listado paginado de áreas (último registro primero)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Area'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       example: 45
 *                     page:
 *                       type: integer
 *                       example: 1
 *                     limit:
 *                       type: integer
 *                       example: 20
 *                     pages:
 *                       type: integer
 *                       example: 3
 */
router.get('/', AreaController.list)

/**
 * @swagger
 * /areas/{id}:
 *   get:
 *     summary: Obtener un área por ID
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           example: 64f1c2b9e4a8c8d123456789
 *     responses:
 *       200:
 *         description: Área encontrada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 area:
 *                   $ref: '#/components/schemas/Area'
 *       404:
 *         description: Área no encontrada
 */
router.get('/:id', validateIdParam, AreaController.getById)

/**
 * @swagger
 * /areas/{id}:
 *   put:
 *     summary: Actualizar un área
 *     tags: [Areas]
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
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: Comercio
 *               descripcion:
 *                 type: string
 *                 example: Área comercial
 *               personal_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               activo:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Área actualizada
 *       400:
 *         description: Error de validación
 *       404:
 *         description: Área no encontrada
 */
router.put('/:id', validateIdParam, validateUpdateArea, AreaController.update)

/**
 * @swagger
 * /areas/{id}/deactivate:
 *   patch:
 *     summary: Desactivar un área
 *     tags: [Areas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Área desactivada
 *       404:
 *         description: Área no encontrada
 */
router.patch('/:id/deactivate', validateIdParam, AreaController.deactivate)

export default router
