import { Router } from 'express';
import { getGenerationJob } from '../controllers/kitController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/:id', getGenerationJob);

export default router;
