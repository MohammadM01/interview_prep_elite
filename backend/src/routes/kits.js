import { Router } from 'express';
import {
  createKit,
  listKits,
  getKit,
  startKitResearch,
  getKitResearch,
  startKitAnalysis
} from '../controllers/kitController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/', createKit);
router.get('/', listKits);
router.get('/:id', getKit);
router.post('/:id/research', startKitResearch);
router.get('/:id/research', getKitResearch);
router.post('/:id/analyze', startKitAnalysis);

export default router;
