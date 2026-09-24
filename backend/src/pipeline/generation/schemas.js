import { z } from 'zod';

export const RequirementKindEnum = z.enum([
  'technical',
  'behavioral',
  'domain',
  'education',
  'experience',
  'system_design',
  'other'
]);

export const RequirementPriorityEnum = z.enum([
  'must',
  'should',
  'nice'
]);

export const RequirementItemSchema = z.object({
  id: z.string().default('r1'),
  text: z.string().min(3, 'Requirement text must be at least 3 characters'),
  kind: RequirementKindEnum,
  priority: RequirementPriorityEnum
});

export const RequirementExtractionOutputSchema = z.object({
  requirements: z.array(RequirementItemSchema).min(1, 'At least one requirement must be extracted from the job description')
});

export const CompanyBriefOutputSchema = z.object({
  summary: z.string().min(5, 'Company summary must be at least 5 characters'),
  what_they_do: z.string().min(5, 'what_they_do description must be at least 5 characters'),
  sources: z.array(z.string().url('Source must be a valid URL')).default([])
});

export const RoleAnalysisLlmOutputSchema = z.object({
  title: z.string().min(1, 'Role title is required'),
  seniority: z.string().default('Mid-Senior'),
  responsibilities: z.array(z.string().min(3)).min(1, 'At least one responsibility is required')
});

export const RoleOutputSchema = z.object({
  title: z.string().min(1),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementItemSchema)
});

export const Step5KitAnalysisSchema = z.object({
  company_brief: CompanyBriefOutputSchema,
  role: RoleOutputSchema
});

export const QuestionCategoryEnum = z.enum([
  'technical',
  'behavioral',
  'role_specific',
  'domain',
  'company',
  'experience',
  'system_design',
  'coding'
]);

export const QuestionDifficultyEnum = z.number().int().min(1).max(3);

export const RawQuestionItemSchema = z.object({
  requirement_ids: z.array(z.string().min(1)).min(1, 'At least one requirement_id must be associated'),
  category: QuestionCategoryEnum,
  prompt: z.string().min(5, 'Question prompt must be at least 5 characters'),
  answer_outline: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        return val.trim();
      }
      if (Array.isArray(val)) {
        if (val.length === 0) return '';
        const parts = val
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0);
        return parts.join('; ');
      }
      return val;
    },
    z.string({ invalid_type_error: 'Answer outline must be a string or non-empty array of strings' })
      .min(5, 'Answer outline must be at least 5 characters')
  ),
  difficulty: QuestionDifficultyEnum,
  follow_ups: z.array(z.string()).optional(),
  evaluation_criteria: z.array(z.string()).optional()
});

export const QuestionGenerationOutputSchema = z.object({
  questions: z.array(RawQuestionItemSchema).min(1, 'At least one interview question must be generated')
});

export const ContentStateEnum = z.enum(['generated', 'edited', 'pinned']);

export const QuestionItemSchema = z.object({
  id: z.string().regex(/^q[a-zA-Z0-9_-]+$/, 'Question ID must start with q (e.g. q1, q_manual_001)'),
  requirement_ids: z.array(z.string().min(1)).min(1),
  category: QuestionCategoryEnum,
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: QuestionDifficultyEnum,
  state: ContentStateEnum.optional().default('generated'),
  follow_ups: z.array(z.string()).optional(),
  evaluation_criteria: z.array(z.string()).optional()
});

export const RawFlashcardItemSchema = z.object({
  front: z.string().min(3, 'Flashcard front must be at least 3 characters'),
  back: z.string().min(3, 'Flashcard back must be at least 3 characters'),
  requirement_ids: z.array(z.string().min(1)).min(1, 'At least one requirement_id must be associated')
});

export const FlashcardGenerationOutputSchema = z.object({
  flashcards: z.array(RawFlashcardItemSchema).min(1, 'At least one study flashcard must be generated')
});

export const FlashcardItemSchema = z.object({
  id: z.string().regex(/^f[a-zA-Z0-9_-]+$/, 'Flashcard ID must start with f (e.g. f1, f_manual_001)'),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)).min(1),
  state: ContentStateEnum.optional().default('generated')
});

export const Step6KitSchema = z.object({
  company_brief: CompanyBriefOutputSchema,
  role: RoleOutputSchema,
  questions: z.array(QuestionItemSchema),
  flashcards: z.array(FlashcardItemSchema)
});

export const KitCoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().min(1).max(2)
});

export const KitScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string().min(1),
  question_ids: z.array(z.string().regex(/^q[a-zA-Z0-9_-]+$/)),
  minutes: z.number().int().positive()
});

export const KitScheduleSchema = z.object({
  days_available: z.number().int().min(1).max(60),
  days: z.array(KitScheduleDaySchema)
});

export const Step7KitSchema = z.object({
  company_brief: CompanyBriefOutputSchema,
  role: RoleOutputSchema,
  questions: z.array(QuestionItemSchema),
  flashcards: z.array(FlashcardItemSchema),
  coverage: KitCoverageSchema,
  schedule: KitScheduleSchema
});

export const KitUpdateInputSchema = z.object({
  role: z.object({
    title: z.string().optional(),
    seniority: z.string().optional(),
    responsibilities: z.array(z.string()).optional(),
    requirements: z.array(RequirementItemSchema).optional()
  }).optional(),
  questions: z.array(QuestionItemSchema).optional(),
  flashcards: z.array(FlashcardItemSchema).optional()
});
