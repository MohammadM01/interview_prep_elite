import { createKitSchema } from '../utils/validators.js';
import { validateCompanyUrl } from '../utils/urlValidator.js';
import {
  createKitAndJob,
  getKitsForUser,
  getKitById,
  getJobById,
  updateKit
} from '../services/kitService.js';

export async function createKit(req, res) {
  try {
    const parseResult = createKitSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues?.[0] || parseResult.error.errors?.[0];
      const message = issue?.message || 'Invalid interview kit input';
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message
        }
      });
    }

    const { jd, company_url, days_available } = parseResult.data;
    const urlValidation = validateCompanyUrl(company_url, { allowLocal: false });
    const normalizedUrl = urlValidation.normalizedUrl || company_url.trim();

    const result = await createKitAndJob({
      userId: req.user.id,
      jd,
      companyUrl: normalizedUrl,
      daysAvailable: days_available
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('Create kit error:', error);
    return res.status(500).json({
      error: {
        code: 'KIT_CREATION_FAILED',
        message: 'An error occurred while creating the interview kit'
      }
    });
  }
}

export async function listKits(req, res) {
  try {
    const kits = await getKitsForUser(req.user.id);
    return res.status(200).json({ kits });
  } catch (error) {
    console.error('List kits error:', error);
    return res.status(500).json({
      error: {
        code: 'KIT_FETCH_FAILED',
        message: 'An error occurred while retrieving interview kits'
      }
    });
  }
}

export async function getKit(req, res) {
  try {
    const { id } = req.params;
    const kit = await getKitById(id, req.user.id);

    if (!kit) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested interview kit was not found'
        }
      });
    }

    return res.status(200).json({ kit });
  } catch (error) {
    console.error('Get kit error:', error);
    return res.status(500).json({
      error: {
        code: 'KIT_FETCH_FAILED',
        message: 'An error occurred while retrieving the interview kit'
      }
    });
  }
}

export async function getGenerationJob(req, res) {
  try {
    const { id } = req.params;
    const job = await getJobById(id, req.user.id);

    if (!job) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested generation job was not found'
        }
      });
    }

    return res.status(200).json({ job });
  } catch (error) {
    console.error('Get generation job error:', error);
    return res.status(500).json({
      error: {
        code: 'JOB_FETCH_FAILED',
        message: 'An error occurred while retrieving the generation job'
      }
    });
  }
}

export async function startKitResearch(req, res) {
  try {
    const { id } = req.params;
    const { researchCompany } = await import('../services/researchService.js');

    const result = await researchCompany({
      kitId: id,
      userId: req.user.id
    });

    return res.status(200).json({
      status: 'success',
      research: result
    });
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message
        }
      });
    }

    console.error('Kit research error:', error);
    return res.status(500).json({
      error: {
        code: error.code || 'RESEARCH_FAILED',
        message: error.message || 'An error occurred while executing company research'
      }
    });
  }
}

export async function getKitResearch(req, res) {
  try {
    const { id } = req.params;
    const { getResearchByKitId } = await import('../services/researchService.js');

    const research = await getResearchByKitId(id, req.user.id);

    if (!research) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'No research data found for this interview kit'
        }
      });
    }

    return res.status(200).json({ research });
  } catch (error) {
    console.error('Get kit research error:', error);
    return res.status(500).json({
      error: {
        code: 'RESEARCH_FETCH_FAILED',
        message: 'An error occurred while retrieving research data'
      }
    });
  }
}

export async function startKitAnalysis(req, res) {
  try {
    const { id } = req.params;
    const { executeKitAnalysis } = await import('../pipeline/generation/index.js');

    const result = await executeKitAnalysis({
      kitId: id,
      userId: req.user.id
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Kit analysis error:', error);
    const status = error.status || (error.code === 'NOT_FOUND' ? 404 : 500);
    return res.status(status).json({
      error: {
        code: error.code || 'ANALYSIS_FAILED',
        message: error.message || 'An error occurred during LLM analysis'
      }
    });
  }
}

export async function startKitGeneration(req, res) {
  try {
    const { id } = req.params;
    const { executeKitGeneration } = await import('../pipeline/generation/index.js');

    const result = await executeKitGeneration({
      kitId: id,
      userId: req.user.id
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Kit generation error:', error);
    const status = error.status || (error.code === 'NOT_FOUND' ? 404 : 500);
    return res.status(status).json({
      error: {
        code: error.code || 'GENERATION_FAILED',
        message: error.message || 'An error occurred during question/flashcard generation'
      }
    });
  }
}

export async function updateKitHandler(req, res) {
  try {
    const { id } = req.params;
    const updatedKit = await updateKit(id, req.user.id, req.body);
    return res.status(200).json({ kit: updatedKit });
  } catch (error) {
    if (error.status === 404 || error.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: error.message || 'Interview kit not found'
        }
      });
    }

    if (error.status === 400 || error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          issues: error.issues
        }
      });
    }

    console.error('Update kit error:', error);
    return res.status(500).json({
      error: {
        code: 'KIT_UPDATE_FAILED',
        message: 'An error occurred while updating the interview kit'
      }
    });
  }
}

