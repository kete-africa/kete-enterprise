/**
 * The KYA demo's instances (KYA-ORG-CIBLE-01 v4 § 3.1) and its ISO 9001 frame (spec 013): the
 * management system's requirements in KYA's own words, each proven by an automatic control that
 * reads the registers — nobody writes the evidence.
 */

export interface DemoMeetingType {
  name: string;
  kind: 'decision' | 'operations' | 'quality' | 'information' | 'innovation';
  cadence: string;
  durationMinutes: number;
  chair: string;
  secretary?: string;
  members: string[];
  quorum?: number;
  recordWithinHours: number;
}

export const meetingTypes: DemoMeetingType[] = [
  {
    name: 'Comité de Direction (Codir)',
    kind: 'decision',
    cadence: 'Mensuel — 1er mardi, 2 h',
    durationMinutes: 120,
    chair: 'dg',
    secretary: 'assistant',
    members: ['dg', 'dga', 'dtp', 'di', 'ddc', 'drh', 'daf', 'qhse', 'foundation'],
    quorum: 5,
    recordWithinHours: 48,
  },
  {
    name: 'Revue opérationnelle hebdomadaire',
    kind: 'operations',
    cadence: 'Hebdomadaire — lundi 16 h, 45 min',
    durationMinutes: 45,
    chair: 'dga',
    secretary: 'assistant',
    members: ['dga', 'dtp', 'di', 'ddc', 'qhse'],
    recordWithinHours: 24,
  },
  {
    name: 'Revue de direction qualité (ISO 9001)',
    kind: 'quality',
    cadence: 'Semestrielle — 3 h',
    durationMinutes: 180,
    chair: 'dg',
    secretary: 'qhse',
    members: ['dg', 'dga', 'dtp', 'di', 'ddc', 'drh', 'daf', 'qhse'],
    quorum: 5,
    recordWithinHours: 72,
  },
  {
    name: "Comité élargi d'encadrement",
    kind: 'information',
    cadence: 'Trimestriel — 2 h 30, visioconférence pour les agences',
    durationMinutes: 150,
    chair: 'dg',
    secretary: 'assistant',
    members: [
      'dg',
      'dga',
      'dtp',
      'di',
      'ddc',
      'drh',
      'daf',
      'qhse',
      'dtp_sav',
      'dtp_ic',
      'niger_head',
    ],
    recordWithinHours: 72,
  },
  {
    name: 'Brainstorming R&D & innovation',
    kind: 'innovation',
    cadence: 'Mensuel, par entité',
    durationMinutes: 60,
    chair: 'lab',
    members: ['lab', 'it', 'it_dev', 'dtp_be', 'di_pa'],
    recordWithinHours: 72,
  },
];

export const iso9001 = {
  code: 'iso-9001-2015',
  name: 'ISO 9001',
  edition: '2015',
  /** Each requirement in KYA's own words, and the automatic check that proves it. */
  requirements: [
    {
      reference: '§ 7.2',
      summary:
        'Les compétences sont évaluées : chaque collaborateur a sa revue trimestrielle tenue.',
      control: 'Revues trimestrielles tenues',
      check: 'performance.reviews_held',
      days: 90,
    },
    {
      reference: '§ 9.1.2',
      summary: 'La satisfaction des clients est mesurée au moins chaque semestre.',
      control: 'Satisfaction client mesurée',
      check: 'surveys.customers_heard',
      days: 180,
    },
    {
      reference: '§ 9.3',
      summary:
        'La direction revoit le système qualité au moins chaque semestre, et en garde le relevé.',
      control: 'Revue de direction tenue',
      check: 'meetings.management_review_held',
      days: 180,
    },
    {
      reference: '§ 9.3.3',
      summary: 'Les décisions des revues sont consignées dans les délais.',
      control: 'Relevés publiés dans les délais',
      check: 'meetings.records_on_time',
      days: 30,
    },
    {
      reference: '§ 10.2',
      summary: 'Les actions correctives sont menées à leur échéance.',
      control: 'Actions à l’heure',
      check: 'actions.on_time',
      days: 30,
    },
  ],
};
