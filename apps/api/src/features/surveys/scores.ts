import type { Answers, FormContent } from './surveys.record.js';

/**
 * A score on 100 from 1-to-5 ratings (spec 011): `(average − 1) ÷ 4 × 100`, « not applicable »
 * left out. Two people applying it to the same answers find the same number.
 */
export function scoreOf(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const average = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  return Math.round(((average - 1) / 4) * 1000) / 10;
}

export interface Group {
  /** How many submitted forms answered at least one rating of the group. */
  count: number;
  /** Null when there is no rating, or too few answers to keep an anonymous group anonymous. */
  score: number | null;
  hidden: boolean;
}

export interface Results {
  forms: number;
  overall: Group;
  sections: (Group & { key: string; title: string; unitId: string | null })[];
  questions: (Group & { key: string; sectionKey: string; label: string; yes?: number })[];
  people: (Group & { personId: string; name: string })[];
  texts: { sectionKey: string; questionKey: string; text: string }[];
}

const ratingsIn = (answers: Answers, keys: string[]) =>
  keys.map((k) => answers[k]).filter((v): v is number => typeof v === 'number');

function group(perForm: number[][], minGroup: number, anonymous: boolean): Group {
  const answered = perForm.filter((r) => r.length > 0);
  const hidden = anonymous && answered.length > 0 && answered.length < minGroup;
  return {
    count: answered.length,
    score: hidden ? null : scoreOf(answered.flat()),
    hidden,
  };
}

/**
 * The results of a campaign from its submitted forms (never their respondents): per section, per
 * question, per person about whom, overall, and the free texts — without author, sorted, so their
 * order tells nothing either.
 */
export function computeResults(
  form: FormContent,
  submitted: { aboutPersonId: string | null; aboutName: string | null; answers: Answers }[],
  options: { anonymous: boolean; minGroup: number },
): Results {
  const ratingKeys = (keys: { key: string; type: string }[]) =>
    keys.filter((q) => q.type === 'rating').map((q) => q.key);
  const allKeys = form.sections.flatMap((s) => ratingKeys(s.questions));
  const sections = form.sections.map((s) => ({
    key: s.key,
    title: s.title,
    unitId: s.unitId ?? null,
    ...group(
      submitted.map((f) => ratingsIn(f.answers, ratingKeys(s.questions))),
      options.minGroup,
      options.anonymous,
    ),
  }));
  const questions = form.sections.flatMap((s) =>
    s.questions
      .filter((q) => q.type !== 'text')
      .map((q) => {
        if (q.type === 'yes_no') {
          const values = submitted
            .map((f) => f.answers[q.key])
            .filter((v): v is boolean => typeof v === 'boolean');
          const hidden = options.anonymous && values.length > 0 && values.length < options.minGroup;
          return {
            key: q.key,
            sectionKey: s.key,
            label: q.label,
            count: values.length,
            hidden,
            // A yes/no has no score on 100: its share of « yes » says it.
            score: null,
            ...(hidden || values.length === 0
              ? {}
              : {
                  yes: Math.round((values.filter(Boolean).length / values.length) * 1000) / 10,
                }),
          };
        }
        return {
          key: q.key,
          sectionKey: s.key,
          label: q.label,
          ...group(
            submitted.map((f) => ratingsIn(f.answers, [q.key])),
            options.minGroup,
            options.anonymous,
          ),
        };
      }),
  );
  const byPerson = new Map<string, { name: string; forms: number[][] }>();
  for (const f of submitted) {
    if (!f.aboutPersonId) continue;
    const entry = byPerson.get(f.aboutPersonId) ?? { name: f.aboutName ?? '', forms: [] };
    entry.forms.push(ratingsIn(f.answers, allKeys));
    byPerson.set(f.aboutPersonId, entry);
  }
  const people = [...byPerson.entries()]
    .map(([personId, entry]) => ({
      personId,
      name: entry.name,
      ...group(entry.forms, options.minGroup, options.anonymous),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const texts = form.sections
    .flatMap((s) =>
      s.questions
        .filter((q) => q.type === 'text')
        .flatMap((q) =>
          submitted
            .map((f) => f.answers[q.key])
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map((text) => ({ sectionKey: s.key, questionKey: q.key, text: text.trim() })),
        ),
    )
    .sort((a, b) => a.text.localeCompare(b.text));
  return {
    forms: submitted.length,
    overall: group(
      submitted.map((f) => ratingsIn(f.answers, allKeys)),
      options.minGroup,
      options.anonymous,
    ),
    sections,
    questions,
    people,
    texts,
  };
}

/** What a form still lacks before it can be submitted: its required questions left blank. */
export function missingAnswers(form: FormContent, answers: Answers): string[] {
  return form.sections.flatMap((s) =>
    s.questions
      .filter((q) => q.required)
      .filter((q) => {
        const value = answers[q.key];
        if (value === undefined || value === null) return true;
        if (q.type === 'rating')
          return !(typeof value === 'number' || (value === 'na' && q.allowNa));
        if (q.type === 'yes_no') return typeof value !== 'boolean';
        return typeof value !== 'string' || value.trim().length === 0;
      })
      .map((q) => q.key),
  );
}

/** Keeps only the answers that fit the form's questions, each of its own type. */
export function cleanAnswers(form: FormContent, answers: Answers): Answers {
  const clean: Answers = {};
  for (const q of form.sections.flatMap((s) => s.questions)) {
    const value = answers[q.key];
    if (value === undefined) continue;
    if (q.type === 'rating' && (typeof value === 'number' || (value === 'na' && q.allowNa))) {
      clean[q.key] = value;
    } else if (q.type === 'yes_no' && typeof value === 'boolean') {
      clean[q.key] = value;
    } else if (q.type === 'text' && typeof value === 'string') {
      clean[q.key] = value.slice(0, 4000);
    }
  }
  return clean;
}
