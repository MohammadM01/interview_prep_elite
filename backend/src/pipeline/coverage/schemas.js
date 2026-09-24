import { z } from 'zod';

export const CoverageResultSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  covered_requirement_ids: z.array(z.string()),
  passes: z.number().int().min(1).max(2)
});

export const KitCoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().min(1).max(2)
});
