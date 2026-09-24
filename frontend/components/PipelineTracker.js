'use client';

export default function PipelineTracker({ currentStage, error, onRetry }) {
  const STAGES = [
    { id: 'research', num: '01', label: 'Research company website' },
    { id: 'requirements_extraction', num: '02', label: 'Extract role requirements' },
    { id: 'question_generation', num: '03', label: 'Generate interview questions' },
    { id: 'flashcard_generation', num: '04', label: 'Build study flashcards' },
    { id: 'coverage_checking', num: '05', label: 'Check requirement coverage' },
    { id: 'schedule_generation', num: '06', label: 'Build preparation schedule' }
  ];

  function getStageStatus(stageId) {
    if (error) return 'error';

    const stageOrder = [
      'queued',
      'research',
      'research_completed',
      'requirements_extraction',
      'company_brief',
      'role_analysis',
      'analysis_completed',
      'question_generation',
      'flashcard_generation',
      'coverage_checking',
      'schedule_generation',
      'completed'
    ];

    const currentIdx = stageOrder.indexOf(currentStage || 'queued');

    const stageMap = {
      research: ['research', 'research_completed'],
      requirements_extraction: ['requirements_extraction', 'company_brief', 'role_analysis', 'analysis_completed'],
      question_generation: ['question_generation'],
      flashcard_generation: ['flashcard_generation'],
      coverage_checking: ['coverage_checking'],
      schedule_generation: ['schedule_generation']
    };

    if (currentStage === 'completed') return 'done';

    // Find index of current stage in our mapped display
    const mappedStages = ['research', 'requirements_extraction', 'question_generation', 'flashcard_generation', 'coverage_checking', 'schedule_generation'];
    const thisMappedIdx = mappedStages.indexOf(stageId);

    let activeMappedIdx = 0;
    if (currentIdx >= stageOrder.indexOf('schedule_generation')) activeMappedIdx = 5;
    else if (currentIdx >= stageOrder.indexOf('coverage_checking')) activeMappedIdx = 4;
    else if (currentIdx >= stageOrder.indexOf('flashcard_generation')) activeMappedIdx = 3;
    else if (currentIdx >= stageOrder.indexOf('question_generation')) activeMappedIdx = 2;
    else if (currentIdx >= stageOrder.indexOf('requirements_extraction')) activeMappedIdx = 1;
    else activeMappedIdx = 0;

    if (thisMappedIdx < activeMappedIdx) return 'done';
    if (thisMappedIdx === activeMappedIdx) return 'active';
    return 'pending';
  }

  // Calculate progress percentage
  const doneCount = STAGES.filter((s) => getStageStatus(s.id) === 'done').length;
  const percent = Math.min(100, Math.round(((doneCount + 0.5) / STAGES.length) * 100));

  return (
    <div className="py-6 border-y border-[var(--border-light)] bg-[var(--bg-elevated)]/60 my-6">
      <div className="max-w-xl mx-auto px-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-mono-num uppercase tracking-wider text-[var(--text-muted)] font-medium">
            Building Preparation Kit
          </div>
          <div className="text-[11px] font-mono-num text-[var(--accent-primary)] font-medium">
            {doneCount} / {STAGES.length} Stages Complete
          </div>
        </div>

        {/* Thin progress line */}
        <div className="w-full h-1 bg-[var(--border-light)] rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-[var(--accent-primary)] transition-all duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Structured Pipeline Steps */}
        <div className="space-y-2">
          {STAGES.map((s) => {
            const status = getStageStatus(s.id);
            return (
              <div
                key={s.id}
                className={`flex items-center justify-between py-1.5 px-3 rounded-[6px] text-xs font-mono-num transition-smooth ${
                  status === 'active'
                    ? 'bg-[var(--accent-primary-subtle)] text-[var(--accent-primary)] font-medium'
                    : status === 'done'
                    ? 'text-[var(--text-main)]'
                    : 'text-[var(--text-muted)] opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[var(--text-muted)]">{s.num}</span>
                  <span className="font-sans text-xs">{s.label}</span>
                </div>

                <div>
                  {status === 'done' && <span className="text-[var(--accent-emerald)] font-bold">✓</span>}
                  {status === 'active' && (
                    <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-primary)] animate-pulse" />
                  )}
                  {status === 'pending' && <span className="text-[var(--text-muted)]">○</span>}
                  {status === 'error' && <span className="text-[var(--accent-rose)] font-bold">✕</span>}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-[6px] bg-rose-500/10 border border-[var(--accent-rose)] text-[var(--accent-rose)] text-xs flex items-center justify-between">
            <span>{error}</span>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-2.5 py-1 text-[11px] font-medium bg-[var(--accent-rose)] text-white rounded-[4px] hover:opacity-90 transition-opacity"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
