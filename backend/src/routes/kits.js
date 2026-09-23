import { Router } from 'express';
import { createKit, listKits, getKit } from '../controllers/kitController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/', createKit);
router.get('/', listKits);
router.get('/:id', getKit);

export default router;
