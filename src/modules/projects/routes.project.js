import { Router } from 'express'
import { uploadAny } from '../../middlewares/uploadAny.js'
import * as C from './controller.project.js'

const router = Router()

router.get('/', C.list)
router.get('/my-items', C.myItems)
router.post('/from-ticket', C.createFromTicket)
router.get('/:id', C.getById)
router.patch('/:id', C.patchProject)
router.post('/:id/trazabilidad', uploadAny.any(), C.addProjectTrace)

router.get('/:id/tasks', C.listTasks)
router.post('/:id/tasks', uploadAny.any(), C.createTask)
router.patch('/:id/tasks/:taskId', C.patchTask)
router.post('/:id/tasks/:taskId/trazabilidad', uploadAny.any(), C.addTaskTrace)

router.get('/:id/repository', C.listRepoNodes)
router.post('/:id/repository', uploadAny.any(), C.createRepoNode)

router.post('/:id/comments', C.addComment)
router.patch('/:id/comments/:commentId/status', C.patchCommentStatus)

export default router
