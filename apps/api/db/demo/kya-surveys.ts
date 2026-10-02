/**
 * The KYA demo's questionnaires (spec 011). « Satisfaction with the services » takes the wording of
 * KYA's 2026 staff survey, without any person's name; each section is about the unit it rates (by
 * its key in `kya.ts`), so its score feeds that unit's indicators.
 */

type Q = { type: 'rating' | 'text' | 'yes_no'; label: string; required?: boolean };
interface DemoSection {
  title: string;
  unit?: string;
  questions: Q[];
}
export interface DemoQuestionnaire {
  title: string;
  description: string;
  anonymous: boolean;
  sections: DemoSection[];
}

const suggestions = (who: string): Q => ({
  type: 'text',
  label: `Vos suggestions pour améliorer les prestations ${who}`,
  required: false,
});

export const questionnaires: DemoQuestionnaire[] = [
  {
    title: 'Satisfaction du personnel envers les services',
    description:
      'Chaque collaborateur note les prestations des services qui le servent. Les scores alimentent les indicateurs « satisfaction du personnel » des services.',
    anonymous: true,
    sections: [
      {
        title: 'Informatique & Logiciel',
        unit: 'it',
        questions: [
          {
            type: 'rating',
            label: 'Satisfaction par rapport au débit et à la qualité de la connexion internet',
          },
          {
            type: 'rating',
            label: 'Réactivité du service lors des sollicitations d’interventions',
          },
          { type: 'rating', label: 'Efficacité des maintenances' },
          { type: 'rating', label: 'Qualité des interventions et du travail fourni' },
          { type: 'rating', label: 'Qualité des équipements informatiques fournis' },
          {
            type: 'rating',
            label:
              'Satisfaction dans l’utilisation des plateformes développées (solutions de digitalisation)',
          },
          suggestions('du service Informatique & Logiciel'),
        ],
      },
      {
        title: 'QHSE',
        unit: 'qhse',
        questions: [
          { type: 'rating', label: 'Propreté générale des bureaux' },
          {
            type: 'rating',
            label: 'Propreté générale des autres espaces (cour, couloirs, étages)',
          },
          { type: 'rating', label: 'Propreté générale des toilettes' },
          { type: 'rating', label: 'Gestion des déchets et vidange des poubelles' },
          {
            type: 'rating',
            label: 'Disponibilité des équipements de protection individuelle (EPI)',
          },
          { type: 'rating', label: 'Qualité des équipements de protection individuelle (EPI)' },
          {
            type: 'rating',
            label: 'Environnement de travail : harcèlement, discrimination, stress et épuisement',
          },
          { type: 'rating', label: 'Environnement de travail : température, luminosité, bruit' },
          suggestions('du service QHSE'),
        ],
      },
      {
        title: 'Ressources humaines',
        unit: 'drh',
        questions: [
          { type: 'rating', label: 'Gestion des demandes de congés' },
          { type: 'rating', label: 'Gestion des demandes de permissions' },
          {
            type: 'rating',
            label: 'Gestion des demandes d’attestations et de certificats de travail',
          },
          { type: 'rating', label: 'Gestion de la protection sociale (CNSS/AMU)' },
          {
            type: 'rating',
            label: 'Gestion des actions de renforcement de capacités du personnel',
          },
          { type: 'rating', label: 'Gestion des avancements de carrière' },
          { type: 'rating', label: 'Gestion de la communication interne' },
          suggestions('des Ressources humaines'),
        ],
      },
      {
        title: 'Achats & Approvisionnements',
        unit: 'daf_aa',
        questions: [
          {
            type: 'rating',
            label: 'Efficacité du traitement des demandes d’achat et d’approvisionnement',
          },
          suggestions('des Achats & Approvisionnements'),
        ],
      },
      {
        title: 'Moyens généraux et logistique',
        unit: 'daf_mg',
        questions: [
          { type: 'rating', label: 'Disponibilité et attribution des véhicules lors des missions' },
          { type: 'rating', label: 'État des véhicules mis à disposition pour les déplacements' },
          { type: 'rating', label: 'Conduite des chauffeurs lors des missions' },
          suggestions('des Moyens généraux'),
        ],
      },
      {
        title: 'Comptabilité',
        unit: 'daf_cf',
        questions: [
          { type: 'rating', label: 'Rapidité et fiabilité des décaissements liés aux missions' },
          {
            type: 'rating',
            label:
              'Rapidité et fiabilité des décaissements liés aux achats d’équipements et de matériels',
          },
          suggestions('de la Comptabilité'),
        ],
      },
      {
        title: 'Service de santé au travail',
        questions: [
          {
            type: 'rating',
            label: 'Qualité des consultations médicales (écoute, diagnostic, conseils)',
          },
          {
            type: 'rating',
            label: 'Prise d’initiatives pour la prévention des risques professionnels',
          },
          {
            type: 'rating',
            label: 'Actions de formation et de sensibilisation à la santé au travail',
          },
          suggestions('du service de santé'),
        ],
      },
    ],
  },
  {
    title: 'Satisfaction client',
    description:
      'Enquête semestrielle auprès des clients (ISO 9001 § 9.1.2) : source de l’indicateur CSAT, cible ≥ 85 %.',
    anonymous: false,
    sections: [
      {
        title: 'Nos prestations',
        questions: [
          { type: 'rating', label: 'Qualité des équipements et de l’installation' },
          { type: 'rating', label: 'Respect des délais annoncés' },
          { type: 'rating', label: 'Qualité de l’accueil et de l’écoute' },
          { type: 'rating', label: 'Réactivité du service après-vente' },
          { type: 'yes_no', label: 'Recommanderiez-vous KYA-Energy Group ?' },
          { type: 'text', label: 'Que devrions-nous améliorer ?', required: false },
        ],
      },
    ],
  },
  {
    title: 'Évaluation du responsable (N+1)',
    description:
      'Chaque collaborateur évalue son responsable. Anonyme : le responsable voit un score, jamais une réponse.',
    anonymous: true,
    sections: [
      {
        title: 'Mon responsable',
        questions: [
          { type: 'rating', label: 'Il fixe des objectifs clairs et datés' },
          { type: 'rating', label: 'Il est disponible et à l’écoute' },
          { type: 'rating', label: 'Il reconnaît le travail bien fait' },
          { type: 'rating', label: 'Il m’aide à progresser' },
          { type: 'rating', label: 'Il décide en temps utile' },
          { type: 'text', label: 'Un conseil pour lui', required: false },
        ],
      },
    ],
  },
];
