import { z } from 'zod';

export const DayScheduleSchema = z.object({
  day: z.number().int().min(1),
  focus: z.string().min(1),
  question_ids: z.array(z.string().regex(/^q\d+$/)),
  minutes: z.number().int().positive()
});

export const ScheduleOutputSchema = z.object({
  days_available: z.number().int().min(1).max(60),
  days: z.array(DayScheduleSchema)
});
