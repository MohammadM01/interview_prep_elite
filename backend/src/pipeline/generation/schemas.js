import { z } from 'zod';

export const RequirementKindEnum = z.enum([
  'technical',
  'behavioral',
  'domain',
  'education',
  'experience',
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
