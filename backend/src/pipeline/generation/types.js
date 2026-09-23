export const GENERATION_STAGES = {
  REQUIREMENTS_EXTRACTION: 'requirements_extraction',
  COMPANY_BRIEF: 'company_brief',
  ROLE_ANALYSIS: 'role_analysis',
  ANALYSIS_COMPLETED: 'analysis_completed'
};

export const STAGE_PROGRESS = {
  [GENERATION_STAGES.REQUIREMENTS_EXTRACTION]: 20,
  [GENERATION_STAGES.COMPANY_BRIEF]: 45,
  [GENERATION_STAGES.ROLE_ANALYSIS]: 70,
  [GENERATION_STAGES.ANALYSIS_COMPLETED]: 75
};

export const GENERATION_DEFAULTS = {
  maxRetries: 2,
  timeoutMs: 15000,
  maxPageCharsForLlm: 3000,
  maxTotalResearchChars: 12000
};
