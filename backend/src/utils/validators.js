import { z } from 'zod';
import { validateCompanyUrl } from './urlValidator.js';

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long')
    .max(100, 'Password must not exceed 100 characters')
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
});

export const createKitSchema = z.object({
  jd: z
    .string({ required_error: 'Job description is required' })
    .refine((val) => val.trim().length > 0, {
      message: 'Job description cannot be empty'
    })
    .refine((val) => val.length <= 100000, {
      message: 'Job description must not exceed 100,000 characters'
    }),
  company_url: z
    .string({ required_error: 'Company website URL is required' })
    .superRefine((val, ctx) => {
      const result = validateCompanyUrl(val, { allowLocal: false });
      if (!result.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.error || 'Invalid company website URL'
        });
      }
    }),
  days_available: z
    .number({ required_error: 'Days available is required' })
    .int('Days available must be an integer')
    .min(1, 'Days available must be at least 1')
    .max(60, 'Days available must not exceed 60')
});
