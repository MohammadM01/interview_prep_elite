import { z } from 'zod';

export const PracticeConfidenceEnum = z.enum(['low', 'medium', 'high']);

export const UpdatePracticeInputSchema = z
  .object({
    question_id: z.string().regex(/^q[a-zA-Z0-9_-]+$/).optional(),
    flashcard_id: z.string().regex(/^f[a-zA-Z0-9_-]+$/).optional(),
    confidence: PracticeConfidenceEnum.optional(),
    covered: z.boolean().optional()
  })
  .refine(
    (data) => Boolean(data.question_id || data.flashcard_id),
    {
      message: 'Either question_id or flashcard_id must be provided',
      path: ['question_id']
    }
  )
  .refine(
    (data) => !(data.question_id && data.flashcard_id),
    {
      message: 'Provide either question_id or flashcard_id, not both',
      path: ['question_id']
    }
  )
  .refine(
    (data) => data.confidence !== undefined || data.covered !== undefined,
    {
      message: 'At least one of confidence or covered must be updated',
      path: ['confidence']
    }
  );
