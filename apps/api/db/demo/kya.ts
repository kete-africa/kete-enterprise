/**
 * The KYA demo profile (spec 010): KYA-Energy Group's structure after decision 2026-010 and the
 * positions of its referentials (KYA-ORG-CIBLE-01 v4, KYA-KPI-01), with **fictitious** people and
 * e-mails. Nobody here is a real employee; the domain `kya-demo.test` never receives mail.
 *
 * Units name a parent by key; positions name their unit and the position they report to by key;
 * a position's title is the referential's, so the indicator grids (spec 012) attach to it.
 */

export interface DemoUnit {
  key: string;
  type: 'group' | 'direction' | 'service' | 'entity' | 'agency';
  name: string;
  parent?: string;
  code?: string;
  country?: string;
}

export interface DemoPosition {
  key: string;
  unit: string;
  title: string;
  reportsTo?: string;
}

export interface DemoPerson {
  key: string;
  name: string;
  /** The positions she holds (the first is primary; others are interims). */
  positions: string[];
  /** Who has an account now: the others are reached by personal links. */
  account: boolean;
}

export const unitTypes: { key: DemoUnit['type']; name: string; legalEntity: boolean }[] = [
  { key: 'group', name: 'Groupe', legalEntity: true },
  { key: 'direction', name: 'Direction', legalEntity: false },
  { key: 'service', name: 'Service', legalEntity: false },
  { key: 'entity', name: 'Entité transverse', legalEntity: false },
  { key: 'agency', name: 'Agence', legalEntity: false },
];

export const units: DemoUnit[] = [
  { key: 'group', type: 'group', name: 'KYA-Energy Group', code: 'KEG', country: 'TG' },
  { key: 'dg', type: 'direction', name: 'Direction Générale', parent: 'group', code: 'DG' },
  { key: 'audit', type: 'service', name: 'Audit Interne & Risques', parent: 'dg' },
  { key: 'qhse', type: 'service', name: 'QHSE', parent: 'dg' },
  { key: 'it', type: 'service', name: 'Informatique & Logiciel (IT)', parent: 'dg', code: 'IT' },
  { key: 'lab', type: 'entity', name: 'KYA-Energy Laboratory', parent: 'dg' },
  { key: 'institute', type: 'entity', name: 'KYA-Institute of Technology', parent: 'dg' },
  { key: 'foundation', type: 'entity', name: 'Fondation KYA', parent: 'dg' },
  {
    key: 'dtp',
    type: 'direction',
    name: 'Direction Technique & Projets',
    parent: 'group',
    code: 'DTP',
  },
  { key: 'dtp_be', type: 'service', name: "Bureau d'études & Offres", parent: 'dtp' },
  { key: 'dtp_ic', type: 'service', name: 'Installations & Chantiers', parent: 'dtp' },
  { key: 'dtp_sav', type: 'service', name: 'SAV & Maintenance', parent: 'dtp' },
  { key: 'dtp_cs', type: 'service', name: 'Contrôle & Supervision', parent: 'dtp' },
  { key: 'di', type: 'direction', name: 'Direction Industrielle', parent: 'group', code: 'DI' },
  { key: 'di_pa', type: 'service', name: 'Production & Assemblage', parent: 'di' },
  { key: 'di_mi', type: 'service', name: 'Méthodes & Industrialisation', parent: 'di' },
  { key: 'di_qp', type: 'service', name: 'Qualité Produit', parent: 'di' },
  { key: 'di_sc', type: 'service', name: 'Supply Chain & Magasins', parent: 'di' },
  {
    key: 'ddc',
    type: 'direction',
    name: 'Direction du Développement & du Réseau Commercial',
    parent: 'group',
    code: 'DDC',
  },
  { key: 'ddc_ga', type: 'service', name: "Grands Comptes & Appels d'offres", parent: 'ddc' },
  { key: 'ddc_vd', type: 'service', name: 'Ventes & Distribution', parent: 'ddc' },
  { key: 'ddc_mc', type: 'service', name: 'Marketing & Communication', parent: 'ddc' },
  { key: 'ddc_ra', type: 'service', name: "Animation du Réseau d'agences", parent: 'ddc' },
  {
    key: 'niger',
    type: 'agency',
    name: 'Agence KYA-Energy Group Niger',
    parent: 'ddc_ra',
    country: 'NE',
  },
  {
    key: 'drh',
    type: 'direction',
    name: 'Direction des Ressources Humaines & du Capital Humain',
    parent: 'group',
    code: 'DRH',
  },
  { key: 'drh_rg', type: 'service', name: 'Recrutement & GPEC', parent: 'drh' },
  { key: 'drh_ap', type: 'service', name: 'Administration du Personnel & Paie', parent: 'drh' },
  { key: 'drh_fd', type: 'service', name: 'Formation & Développement', parent: 'drh' },
  { key: 'drh_rs', type: 'service', name: 'Relations Sociales', parent: 'drh' },
  {
    key: 'daf',
    type: 'direction',
    name: 'Direction Administrative & Financière',
    parent: 'group',
    code: 'DAF',
  },
  { key: 'daf_cf', type: 'service', name: 'Comptabilité & Fiscalité', parent: 'daf' },
  { key: 'daf_cg', type: 'service', name: 'Contrôle de Gestion', parent: 'daf' },
  { key: 'daf_tf', type: 'service', name: 'Trésorerie & Financements', parent: 'daf' },
  { key: 'daf_aa', type: 'service', name: 'Achats & Approvisionnements', parent: 'daf' },
  { key: 'daf_jp', type: 'service', name: 'Juridique & Propriété Intellectuelle', parent: 'daf' },
  { key: 'daf_mg', type: 'service', name: 'Moyens Généraux', parent: 'daf' },
];

export const positions: DemoPosition[] = [
  { key: 'dg', unit: 'dg', title: 'Directeur Général' },
  { key: 'dga', unit: 'dg', title: 'Directeur Général Adjoint', reportsTo: 'dg' },
  {
    key: 'assistant',
    unit: 'dg',
    title: 'Assistant(e) de Direction · Assistant(e) administratif',
    reportsTo: 'dg',
  },
  {
    key: 'driver',
    unit: 'dg',
    title: "Chauffeur · Agent d'entretien · Agent de sécurité",
    reportsTo: 'dga',
  },
  {
    key: 'audit',
    unit: 'audit',
    title: 'Chef de service Audit Interne & Risques',
    reportsTo: 'dg',
  },
  { key: 'qhse', unit: 'qhse', title: 'Chef de service QHSE', reportsTo: 'dg' },
  {
    key: 'it',
    unit: 'it',
    title: 'Chef du Service Informatique et de Logiciel (IT)',
    reportsTo: 'dg',
  },
  { key: 'it_net', unit: 'it', title: 'Administrateur réseau', reportsTo: 'it' },
  { key: 'it_dev', unit: 'it', title: 'Développeur DevOps', reportsTo: 'it' },
  {
    key: 'lab',
    unit: 'lab',
    title: 'Directeur Scientifique — KYA-Energy Laboratory',
    reportsTo: 'dg',
  },
  {
    key: 'institute',
    unit: 'institute',
    title: 'Directeur — KYA-Institute of Technology',
    reportsTo: 'dg',
  },
  {
    key: 'foundation',
    unit: 'foundation',
    title: 'Directeur Exécutif — Fondation KYA',
    reportsTo: 'dg',
  },
  { key: 'dtp', unit: 'dtp', title: 'Directeur Technique & Projets', reportsTo: 'dg' },
  {
    key: 'dtp_be',
    unit: 'dtp_be',
    title: "Chef de service Bureau d'études & Offres",
    reportsTo: 'dtp',
  },
  {
    key: 'dtp_ic',
    unit: 'dtp_ic',
    title: 'Chef de service Installations & Chantiers',
    reportsTo: 'dtp',
  },
  {
    key: 'dtp_ic_team',
    unit: 'dtp_ic',
    title: "Chef d'équipe Installations & Chantiers",
    reportsTo: 'dtp_ic',
  },
  { key: 'dtp_sav', unit: 'dtp_sav', title: 'Chef de service SAV & Maintenance', reportsTo: 'dtp' },
  {
    key: 'dtp_sav_team',
    unit: 'dtp_sav',
    title: "Chef d'équipe SAV & Maintenance",
    reportsTo: 'dtp_sav',
  },
  {
    key: 'dtp_tech1',
    unit: 'dtp_sav',
    title: 'Technicien (installation / maintenance)',
    reportsTo: 'dtp_sav_team',
  },
  {
    key: 'dtp_tech2',
    unit: 'dtp_sav',
    title: 'Technicien (installation / maintenance)',
    reportsTo: 'dtp_sav_team',
  },
  {
    key: 'dtp_tech3',
    unit: 'dtp_ic',
    title: 'Technicien (installation / maintenance)',
    reportsTo: 'dtp_ic_team',
  },
  {
    key: 'dtp_cs',
    unit: 'dtp_cs',
    title: 'Chef de service Contrôle & Supervision',
    reportsTo: 'dtp',
  },
  { key: 'di', unit: 'di', title: 'Directeur Industriel', reportsTo: 'dg' },
  {
    key: 'di_pa',
    unit: 'di_pa',
    title: 'Chef de service Production & Assemblage',
    reportsTo: 'di',
  },
  { key: 'di_pa_team', unit: 'di_pa', title: "Chef d'équipe Production", reportsTo: 'di_pa' },
  { key: 'di_op', unit: 'di_pa', title: "Opérateur d'atelier", reportsTo: 'di_pa_team' },
  {
    key: 'di_mi',
    unit: 'di_mi',
    title: 'Chef de service Méthodes & Industrialisation',
    reportsTo: 'di',
  },
  { key: 'di_qp', unit: 'di_qp', title: 'Chef de service Qualité Produit', reportsTo: 'di' },
  {
    key: 'di_sc',
    unit: 'di_sc',
    title: 'Chef de service Supply Chain & Magasins',
    reportsTo: 'di',
  },
  { key: 'di_store', unit: 'di_sc', title: 'Magasinier', reportsTo: 'di_sc' },
  {
    key: 'ddc',
    unit: 'ddc',
    title: 'Directeur du Développement & du Réseau Commercial',
    reportsTo: 'dg',
  },
  {
    key: 'ddc_ga',
    unit: 'ddc_ga',
    title: "Chef de service Grands Comptes & Appels d'offres",
    reportsTo: 'ddc',
  },
  {
    key: 'ddc_vd',
    unit: 'ddc_vd',
    title: 'Chef de service Ventes & Distribution',
    reportsTo: 'ddc',
  },
  { key: 'ddc_sales', unit: 'ddc_vd', title: 'Commercial (siège ou agence)', reportsTo: 'ddc_vd' },
  {
    key: 'ddc_mc',
    unit: 'ddc_mc',
    title: 'Chef de service Marketing & Communication',
    reportsTo: 'ddc',
  },
  {
    key: 'ddc_ra',
    unit: 'ddc_ra',
    title: "Chef de service Animation du Réseau d'agences",
    reportsTo: 'ddc',
  },
  {
    key: 'niger_head',
    unit: 'niger',
    title: "Chef d'agence (Standard / Régionale)",
    reportsTo: 'ddc_ra',
  },
  {
    key: 'niger_sales',
    unit: 'niger',
    title: 'Commercial (siège ou agence)',
    reportsTo: 'niger_head',
  },
  { key: 'drh', unit: 'drh', title: 'Directeur des Ressources Humaines', reportsTo: 'dg' },
  { key: 'drh_rg', unit: 'drh_rg', title: 'Chef de service Recrutement & GPEC', reportsTo: 'drh' },
  {
    key: 'drh_ap',
    unit: 'drh_ap',
    title: 'Chef de service Administration du Personnel & Paie',
    reportsTo: 'drh',
  },
  {
    key: 'drh_fd',
    unit: 'drh_fd',
    title: 'Chef de service Formation & Développement',
    reportsTo: 'drh',
  },
  { key: 'drh_rs', unit: 'drh_rs', title: 'Chef de service Relations Sociales', reportsTo: 'drh' },
  { key: 'daf', unit: 'daf', title: 'Directeur Administratif & Financier', reportsTo: 'dg' },
  {
    key: 'daf_cf',
    unit: 'daf_cf',
    title: 'Chef de service Comptabilité & Fiscalité',
    reportsTo: 'daf',
  },
  { key: 'daf_cg', unit: 'daf_cg', title: 'Contrôleur de Gestion', reportsTo: 'daf' },
  {
    key: 'daf_tf',
    unit: 'daf_tf',
    title: 'Chef de service Trésorerie & Financements',
    reportsTo: 'daf',
  },
  {
    key: 'daf_aa',
    unit: 'daf_aa',
    title: 'Chef de service Achats & Approvisionnements',
    reportsTo: 'daf',
  },
  {
    key: 'daf_jp',
    unit: 'daf_jp',
    title: 'Chef de service Juridique & Propriété Intellectuelle',
    reportsTo: 'daf',
  },
  { key: 'daf_mg', unit: 'daf_mg', title: 'Responsable des Moyens Généraux', reportsTo: 'daf' },
];

/**
 * Fictitious people. Several directions stay vacant, as at KYA after decision 2026-010: the DGA
 * coordinates HR, the DG the industrial direction.
 */
export const people: DemoPerson[] = [
  { key: 'dg', name: 'Komlan Adjévi', positions: ['dg', 'di'], account: true },
  { key: 'dga', name: 'Mawuena Kpodar', positions: ['dga', 'drh'], account: true },
  { key: 'assistant', name: 'Akossiwa Bébé', positions: ['assistant'], account: true },
  { key: 'driver', name: 'Yawo Agbéko', positions: ['driver'], account: false },
  { key: 'audit', name: 'Essi Lawson', positions: ['audit'], account: true },
  { key: 'qhse', name: 'Kodjo Mensah', positions: ['qhse'], account: true },
  { key: 'it', name: 'Sena Afiwa Dogbé', positions: ['it'], account: true },
  { key: 'it_net', name: 'Edem Kossi Amouzou', positions: ['it_net'], account: false },
  { key: 'it_dev', name: 'Délali Tchalla', positions: ['it_dev'], account: true },
  { key: 'lab', name: 'Atsu Gbédé', positions: ['lab'], account: true },
  { key: 'dtp', name: 'Folly Ayité', positions: ['dtp'], account: true },
  { key: 'dtp_be', name: 'Ablavi Sossou', positions: ['dtp_be'], account: true },
  { key: 'dtp_ic', name: 'Kwami Dossou', positions: ['dtp_ic'], account: true },
  { key: 'dtp_ic_team', name: 'Mensah Atayi', positions: ['dtp_ic_team'], account: false },
  { key: 'dtp_sav', name: 'Abla Nyuiadzi', positions: ['dtp_sav'], account: true },
  { key: 'dtp_sav_team', name: 'Koffi Sénou', positions: ['dtp_sav_team'], account: false },
  { key: 'dtp_tech1', name: 'Kokou Assiongbon', positions: ['dtp_tech1'], account: false },
  { key: 'dtp_tech2', name: 'Elom Gaba', positions: ['dtp_tech2'], account: false },
  { key: 'dtp_tech3', name: 'Yao Klutsé', positions: ['dtp_tech3'], account: false },
  { key: 'di_pa', name: 'Afi Ekoué', positions: ['di_pa'], account: true },
  { key: 'di_op', name: 'Komi Tété', positions: ['di_op'], account: false },
  { key: 'di_store', name: 'Kafui Agbodjan', positions: ['di_store'], account: false },
  { key: 'ddc', name: 'Dzifa Amégan', positions: ['ddc', 'ddc_ga'], account: true },
  { key: 'ddc_vd', name: 'Sélom Hounkpati', positions: ['ddc_vd'], account: true },
  { key: 'ddc_sales', name: 'Ayaovi Kponton', positions: ['ddc_sales'], account: false },
  { key: 'ddc_mc', name: 'Enyonam Akakpo', positions: ['ddc_mc'], account: true },
  { key: 'ddc_ra', name: 'Esinam Gbadoé', positions: ['ddc_ra'], account: true },
  { key: 'niger_head', name: 'Aïchatou Issoufou', positions: ['niger_head'], account: true },
  { key: 'niger_sales', name: 'Moussa Hamani', positions: ['niger_sales'], account: false },
  { key: 'drh_ap', name: 'Afua Djossou', positions: ['drh_ap'], account: true },
  { key: 'drh_fd', name: 'Komivi Attiogbé', positions: ['drh_fd'], account: true },
  { key: 'daf', name: 'Kossivi Ahadji', positions: ['daf'], account: true },
  { key: 'daf_cg', name: 'Afi Mawufemo Agbo', positions: ['daf_cg'], account: true },
  { key: 'daf_aa', name: 'Kodjovi Fiagan', positions: ['daf_aa'], account: true },
];

/** The fictitious e-mail of a demo person: first name and last name, ASCII. */
export function demoEmail(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^prof\.\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .trim()
    .split(/\s+/);
  return `${ascii.join('.')}@kya-demo.test`;
}

/**
 * Roles of the demo, granted to positions (whoever holds them): who runs which business tool. The
 * permissions of specs 011 to 013 are listed by name; a permission the API does not know yet is
 * skipped by the seed.
 */
export const roles: { name: string; permissions: string[]; positions: string[] }[] = [
  {
    name: 'Ressources humaines',
    permissions: ['surveys:manage', 'performance:manage', 'performance:validate', 'structure:read'],
    positions: ['drh', 'drh_ap', 'drh_fd'],
  },
  {
    name: 'Qualité (QHSE)',
    permissions: ['surveys:manage', 'compliance:manage', 'compliance:read'],
    positions: ['qhse'],
  },
  {
    name: 'Contrôle de gestion',
    permissions: ['performance:measure', 'performance:read'],
    positions: ['daf_cg'],
  },
  {
    name: 'Comité de direction',
    permissions: ['meetings:manage', 'performance:read', 'compliance:read', 'structure:read'],
    positions: ['dg', 'dga', 'dtp', 'di', 'ddc', 'drh', 'daf', 'qhse'],
  },
  {
    name: 'Secrétariat de direction',
    permissions: ['meetings:manage', 'meetings:publish'],
    positions: ['assistant'],
  },
  {
    name: 'Revue des ressources numériques',
    permissions: ['registry:review', 'registry:read'],
    positions: ['it'],
  },
];
