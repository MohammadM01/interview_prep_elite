import { Router } from 'express';
import {
  createKit,
  listKits,
  getKit,
  startKitResearch,
  getKitResearch,
  startKitAnalysis,
  startKitGeneration,
  updateKitHandler
} from '../controllers/kitController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/', createKit);
router.get('/', listKits);
router.get('/:id', getKit);
router.patch('/:id', updateKitHandler);
router.post('/:id/research', startKitResearch);
router.get('/:id/research', getKitResearch);
router.post('/:id/analyze', startKitAnalysis);
router.post('/:id/generate', startKitGeneration);

export default router;
