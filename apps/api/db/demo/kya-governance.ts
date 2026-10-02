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

/**
 * The resources the demo's registry opens to everyone (spec 014): KYA's own products and tools,
 * the skills its business owners hold, and the MCP servers. Owners are the units that answer for
 * them; addresses only where the real site exists.
 */
export const resources: {
  kind: 'app' | 'skill' | 'mcp' | 'agent';
  name: string;
  description: string;
  owner: string;
  address?: string;
}[] = [
  {
    kind: 'app',
    name: 'KYA-SolDesign',
    description: 'Dimensionnement des installations photovoltaïques, du site au dossier client.',
    owner: 'Informatique & Logiciel (IT)',
  },
  {
    kind: 'app',
    name: 'KYA-Energy Market',
    description: 'La boutique en ligne des produits KYA.',
    owner: 'Direction du Développement & du Réseau Commercial',
  },
  {
    kind: 'app',
    name: 'KYA-RemoteControl',
    description: 'Supervision à distance des installations des clients.',
    owner: 'Direction Technique & Projets',
  },
  {
    kind: 'app',
    name: 'KYA-EcoLabel',
    description: 'Étiquetage énergétique des équipements.',
    owner: 'KYA-Energy Laboratory',
  },
  {
    kind: 'app',
    name: 'Site kya-energy.com',
    description: 'Le site public du Groupe.',
    owner: 'Marketing & Communication',
    address: 'https://kya-energy.com',
  },
  {
    kind: 'skill',
    name: 'Document officiel KYA',
    description: 'Rédiger un document officiel au ton, au format et à la charte de KYA.',
    owner: 'Marketing & Communication',
  },
  {
    kind: 'skill',
    name: 'Relevé de décisions',
    description: 'Du compte rendu d’une instance au relevé : décision, responsable, échéance.',
    owner: 'Direction Générale',
  },
  {
    kind: 'skill',
    name: 'Note de décision',
    description: 'Rédiger une note de décision du DG : objet, considérants, décision, effet.',
    owner: 'Direction Générale',
  },
  {
    kind: 'skill',
    name: 'Fiche indicateur',
    description: 'Écrire un indicateur avec ses six attributs, testé par deux calculateurs.',
    owner: 'Contrôle de Gestion',
  },
  {
    kind: 'skill',
    name: 'Réponse à appel d’offres',
    description: 'Monter le dossier technique et financier d’un appel d’offres.',
    owner: "Grands Comptes & Appels d'offres",
  },
  {
    kind: 'mcp',
    name: 'Kete Enterprise (guichet)',
    description:
      'Le guichet MCP : la structure, le registre, mes décisions et ma journée, avec mes droits.',
    owner: 'Informatique & Logiciel (IT)',
  },
];
