/** The words of Kete's default views, in both languages (doctrine D-013): a view keeps both. */
const catalog = {
  fr: {
    steering: 'Pilotage',
    glance: 'Le trimestre en un coup d’œil',
    fleetByState: 'Le parc par état',
    fleetByUnit: 'Le parc par unité',
    waiting: 'Ce qui attend, par sujet',
    money: 'Facturé, mois par mois',
    cumulative: 'Facturé, en cumul',
  },
  en: {
    steering: 'Steering',
    glance: 'The quarter at a glance',
    fleetByState: 'The fleet by state',
    fleetByUnit: 'The fleet by unit',
    waiting: 'What waits, by subject',
    money: 'Invoiced, month by month',
    cumulative: 'Invoiced, cumulated',
  },
};

export function viewWords() {
  return catalog;
}
