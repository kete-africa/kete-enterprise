import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Meetings, decision notes and the register of actions as the API serves them (spec 013).

export interface AgendaItem {
  key: string;
  title: string;
  kind: 'red_indicators' | 'overdue_action' | 'manual';
  detail: string | null;
}

export interface MeetingType {
  typeId: string;
  name: string;
  kind: 'decision' | 'operations' | 'quality' | 'information' | 'innovation';
  cadence: string;
  durationMinutes: number;
  memberPositionIds: string[];
  quorum: number | null;
  recordWithinHours: number;
}

export interface Meeting {
  meetingId: string;
  typeId: string;
  typeName: string;
  kind: MeetingType['kind'];
  title: string;
  startsAt: string;
  status: 'planned' | 'held' | 'recorded';
  agenda: AgendaItem[];
  presentPersonIds: string[];
  quorumMet: boolean | null;
  notes: string | null;
  recordDueAt: string | null;
  recordedAt: string | null;
  onTime: boolean | null;
  decisions: {
    decisionId: string;
    text: string;
    responsiblePersonId: string | null;
    responsibleName: string | null;
    dueOn: string | null;
    actionId: string | null;
    idea: boolean;
  }[];
}

export interface DecisionNote {
  noteId: string;
  number: string | null;
  subject: string;
  body: string;
  signedByPersonId: string;
  signedByName: string;
  status: 'draft' | 'published';
  publishedOn: string | null;
  reads: number;
  readByMe: boolean;
}

export interface Action {
  actionId: string;
  title: string;
  detail: string | null;
  source: 'meeting' | 'indicator' | 'review' | 'manual' | 'audit';
  responsibleName: string | null;
  responsiblePersonId: string | null;
  dueOn: string;
  status: 'open' | 'done' | 'cancelled' | 'verified';
  overdue: boolean;
  doneNote: string | null;
}

export interface MeetingsScreen {
  types: MeetingType[];
  meetings: Meeting[];
  notes: DecisionNote[];
  manages: boolean;
  publishes: boolean;
}

export const fetchMeetings = createServerFn({ method: 'GET' }).handler(() =>
  callApi<MeetingsScreen>(getRequest(), '/v1/meetings'),
);

export const fetchMeeting = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const meetingId = (input as { meetingId?: unknown } | null)?.meetingId;
    if (typeof meetingId !== 'string' || !/^mtg_[0-9a-f-]{8,64}$/.test(meetingId)) {
      throw new Error('Unknown meeting.');
    }
    return { meetingId };
  })
  .handler(({ data }) =>
    callApi<{ meeting: Meeting; manages: boolean }>(
      getRequest(),
      `/v1/meetings/meetings/${data.meetingId}`,
    ),
  );

export const fetchActions = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    scope: (input as { scope?: unknown } | null)?.scope === 'all' ? 'all' : 'mine',
  }))
  .handler(({ data }) =>
    callApi<{ scope: 'mine' | 'all'; everything: boolean; actions: Action[] }>(
      getRequest(),
      `/v1/actions?scope=${data.scope}`,
    ),
  );

const paths = [
  /^\/meetings\/types$/,
  /^\/meetings\/meetings$/,
  /^\/meetings\/meetings\/mtg_[0-9a-f-]+\/(agenda|hold|decisions|publish)$/,
  /^\/meetings\/notes$/,
  /^\/meetings\/notes\/dnt_[0-9a-f-]+\/(publish|read)$/,
  /^\/actions$/,
  /^\/actions\/act_[0-9a-f-]+\/(done|cancel)$/,
];

type Data = Record<string, string | number | boolean | null>;

export const meetingsGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !paths.some((p) => p.test(path))) {
      throw new Error('Unknown gesture.');
    }
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<Data>(getRequest(), `/v1${data.path}`, data.body, data.key);
    return answer.ok
      ? { ok: true, error: null, data: answer.data }
      : { ok: false, error: answer.error, data: null };
  });
