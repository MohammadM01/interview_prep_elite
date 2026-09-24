import { Router } from 'express';
import {
  createKit,
  listKits,
  getKit,
  startKitResearch,
  getKitResearch,
  startKitAnalysis,
  startKitGeneration,
  startKitGenerationStart,
  startKitGenerationQuestions,
  startKitGenerationFlashcards,
  startKitGenerationContent,
  startKitGenerationFinalize,
  updateKitHandler,
  getKitPracticeHandler,
  updateKitPracticeHandler
} from '../controllers/kitController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/', createKit);
router.get('/', listKits);
router.get('/:id', getKit);
router.patch('/:id', updateKitHandler);
router.get('/:id/practice', getKitPracticeHandler);
router.patch('/:id/practice', updateKitPracticeHandler);
router.post('/:id/research', startKitResearch);
router.get('/:id/research', getKitResearch);
router.post('/:id/analyze', startKitAnalysis);
router.post('/:id/generate/start', startKitGenerationStart);
router.post('/:id/generate/questions', startKitGenerationQuestions);
router.post('/:id/generate/flashcards', startKitGenerationFlashcards);
router.post('/:id/generate/content', startKitGenerationContent);
router.post('/:id/generate/finalize', startKitGenerationFinalize);
router.post('/:id/generate', startKitGeneration);

export default router;

