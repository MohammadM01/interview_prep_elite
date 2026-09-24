import { ScheduleOutputSchema } from './schemas.js';

const PRIORITY_RANKS = {
  must: 1,
  should: 2,
  nice: 3
};

/**
 * Extracts numeric suffix from question ID (e.g. "q12" -> 12).
 * @param {string} qId
 * @returns {number}
 */
function parseQuestionIdNumber(qId) {
  const match = String(qId || '').match(/^q(\d+)$/i);
  return match ? parseInt(match[1], 10) : 999999;
}

/**
 * Determines the highest priority rank of a question based on its linked requirements.
 * (must: 1, should: 2, nice: 3, unlinked: 4)
 *
 * @param {Object} question
 * @param {Map<string, Object>} reqMap
 * @returns {number}
 */
function getQuestionPriorityRank(question, reqMap) {
  if (!Array.isArray(question.requirement_ids) || question.requirement_ids.length === 0) {
    return 4;
  }

  let highestRank = 4;
  for (const rId of question.requirement_ids) {
    const req = reqMap.get(rId);
    if (req) {
      const p = (req.priority || 'should').toLowerCase();
      const rank = PRIORITY_RANKS[p] || 4;
      if (rank < highestRank) {
        highestRank = rank;
      }
    }
  }

  return highestRank;
}

/**
 * Deterministically constructs a concise focus title for a study day.
 *
 * @param {Array<Object>} questions Questions assigned to this day
 * @param {number} dayNumber 1-based day index
 * @param {number} totalDays Total days available
 * @returns {string}
 */
function determineDayFocus(questions, dayNumber, totalDays) {
  if (!Array.isArray(questions) || questions.length === 0) {
    if (dayNumber === totalDays && totalDays > 1) {
      return 'Final review & mock simulation';
    }
    return 'Review & reinforcement';
  }

  const categoryCounts = {};
  for (const q of questions) {
    const cat = q.category || 'general';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const sortedCategories = Object.keys(categoryCounts).sort(
    (a, b) => categoryCounts[b] - categoryCounts[a]
  );

  const primaryCategory = sortedCategories[0];
  const secondaryCategory = sortedCategories[1];

  if (sortedCategories.length === 1 || categoryCounts[primaryCategory] >= questions.length * 0.7) {
    switch (primaryCategory) {
      case 'technical':
        return 'Core technical depth & architecture';
      case 'behavioral':
        return 'Behavioral competencies & leadership';
      case 'domain':
        return 'Domain principles & system concepts';
      case 'role_specific':
        return 'Role execution & responsibilities';
      case 'company':
        return 'Company mission & cultural alignment';
      case 'experience':
        return 'Applied experience & project deep dive';
      default:
        return 'Targeted role preparation';
    }
  }

  if (sortedCategories.includes('technical') && sortedCategories.includes('behavioral')) {
    return 'Technical systems & behavioral practice';
  }

  if (sortedCategories.includes('technical') && sortedCategories.includes('domain')) {
    return 'Technical architecture & domain standards';
  }

  if (sortedCategories.includes('behavioral') && sortedCategories.includes('experience')) {
    return 'Leadership, collaboration & project history';
  }

  if (dayNumber === 1) {
    return 'High-priority core requirements';
  }

  return 'Integrated interview preparation';
}

/**
 * Generates a deterministic day-by-day study schedule.
 *
 * Requirements:
 * - Exactly daysAvailable days produced.
 * - Integer minutes per day (default 60).
 * - Higher priority requirements (must > should > nice) scheduled earlier.
 * - Harder questions (difficulty 3 > 2 > 1) scheduled earlier within same priority.
 * - Deterministic tie-breaker: question ID ascending.
 * - Pure code logic (no LLM).
 *
 * @param {Object} params
 * @param {number} params.daysAvailable Total days available for prep (1-60)
 * @param {Array<Object>} params.requirements Extracted role requirements
 * @param {Array<Object>} params.questions Available interview questions
 * @param {number} [params.dailyMinutes=60] Fixed daily study minutes (integer)
 * @returns {{ days_available: number, days: Array<Object> }}
 */
export function generateSchedule({
  daysAvailable,
  requirements = [],
  questions = [],
  dailyMinutes = 60
}) {
  const daysCount = parseInt(daysAvailable, 10);
  if (isNaN(daysCount) || daysCount < 1 || daysCount > 60) {
    throw new Error(`daysAvailable must be an integer between 1 and 60. Received: ${daysAvailable}`);
  }

  const minutesPerDay = Math.max(1, parseInt(dailyMinutes, 10) || 60);

  // Map requirements by ID for fast lookup
  const reqMap = new Map();
  for (const r of (requirements || [])) {
    if (r && r.id) {
      reqMap.set(r.id, r);
    }
  }

  // Deduplicate and filter questions to valid objects with IDs
  const validQuestions = (questions || []).filter((q) => q && typeof q.id === 'string' && /^q\d+$/.test(q.id));

  // Sort questions deterministically:
  // 1. Priority rank: must (1) < should (2) < nice (3) < other (4)
  // 2. Difficulty: descending (3 before 2 before 1)
  // 3. Question ID: ascending (q1 before q2)
  const sortedQuestions = [...validQuestions].sort((a, b) => {
    const rankA = getQuestionPriorityRank(a, reqMap);
    const rankB = getQuestionPriorityRank(b, reqMap);
    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const diffA = typeof a.difficulty === 'number' ? a.difficulty : 2;
    const diffB = typeof b.difficulty === 'number' ? b.difficulty : 2;
    if (diffA !== diffB) {
      return diffB - diffA; // descending: harder first
    }

    const idNumA = parseQuestionIdNumber(a.id);
    const idNumB = parseQuestionIdNumber(b.id);
    return idNumA - idNumB;
  });

  const totalQuestions = sortedQuestions.length;
  const days = [];

  if (daysCount === 1) {
    // 1-day edge case: all questions scheduled on Day 1
    const questionIds = sortedQuestions.map((q) => q.id);
    days.push({
      day: 1,
      focus: determineDayFocus(sortedQuestions, 1, 1),
      question_ids: questionIds,
      minutes: minutesPerDay
    });
  } else if (totalQuestions <= daysCount) {
    // Fewer or equal questions than days: allocate at most 1 question per day in priority order
    for (let d = 0; d < daysCount; d++) {
      const dayNum = d + 1;
      if (d < totalQuestions) {
        const assignedQ = sortedQuestions[d];
        days.push({
          day: dayNum,
          focus: determineDayFocus([assignedQ], dayNum, daysCount),
          question_ids: [assignedQ.id],
          minutes: minutesPerDay
        });
      } else {
        // Subsequent days have empty question_ids with honest focus and standard minutes
        days.push({
          day: dayNum,
          focus: determineDayFocus([], dayNum, daysCount),
          question_ids: [],
          minutes: minutesPerDay
        });
      }
    }
  } else {
    // More questions than days: chunk questions across days proportionally
    // Earlier days receive higher count if not evenly divisible
    const baseCount = Math.floor(totalQuestions / daysCount);
    const remainder = totalQuestions % daysCount;

    let cursor = 0;
    for (let d = 0; d < daysCount; d++) {
      const dayNum = d + 1;
      const countForThisDay = baseCount + (d < remainder ? 1 : 0);
      const dayQuestions = sortedQuestions.slice(cursor, cursor + countForThisDay);
      cursor += countForThisDay;

      days.push({
        day: dayNum,
        focus: determineDayFocus(dayQuestions, dayNum, daysCount),
        question_ids: dayQuestions.map((q) => q.id),
        minutes: minutesPerDay
      });
    }
  }

  const schedule = {
    days_available: daysCount,
    days
  };

  // Validate output against schema
  return ScheduleOutputSchema.parse(schedule);
}
