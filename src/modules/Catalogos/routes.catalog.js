// src/modules/Catalogos/routes.catalog.js
import { Router } from 'express'
import * as CatalogController from './controller.catalog.js'
import {
  validateCreateCatalog,
  validateUpdateCatalog,
  validateListCatalog,
  validateIdParam,
} from './validator.catalog.js'

const router = Router()

/**
 * @swagger
 * tags:
 *   name: Catalog
 *   description: Catálogos multi-empresa (categorías, prioridades, estados, etc.)
 */

/**
 * @swagger
 * /catalog:
 *   post:
 *     summary: Crear item de catálogo
 *     tags: [Catalog]
 */
router.post('/', validateCreateCatalog, CatalogController.create)

/**
 * @swagger
 * /catalog:
 *   get:
 *     summary: Listar items de catálogo (paginado)
 *     tags: [Catalog]
 *     parameters:
 *       - in: query
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         required: true
 *         schema: { type: integer, example: 1 }
 *       - in: query
 *         name: limit
 *         required: true
 *         schema: { type: integer, example: 20 }
 *       - in: query
 *         name: active
 *         required: false
 *         schema: { type: boolean }
 */
router.get('/', validateListCatalog, CatalogController.list)

/**
 * @swagger
 * /catalog/{id}:
 *   get:
 *     summary: Obtener item por id
 *     tags: [Catalog]
 */
router.get('/:id', validateIdParam, CatalogController.getById)

/**
 * @swagger
 * /catalog/{id}:
 *   put:
 *     summary: Actualizar item por id
 *     tags: [Catalog]
 */
router.put(
  '/:id',
  validateIdParam,
  validateUpdateCatalog,
  CatalogController.update
)

/**
 * @swagger
 * /catalog/{id}/deactivate:
 *   patch:
 *     summary: Desactivar item (soft delete)
 *     tags: [Catalog]
 */
router.patch('/:id/deactivate', validateIdParam, CatalogController.deactivate)

export default router
