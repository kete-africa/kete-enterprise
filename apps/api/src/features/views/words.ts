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
    measures: {
      count: 'Nombre',
      'sum(amount)': 'Montant',
      'sum(open)': 'En cours',
      'sum(late)': 'En retard',
      'sum(waiting)': 'En attente',
      'sum(done)': 'Faits',
      'sum(in_service)': 'En service',
      'sum(alert)': 'En alerte',
    } as Record<string, string>,
  },
  en: {
    steering: 'Steering',
    glance: 'The quarter at a glance',
    fleetByState: 'The fleet by state',
    fleetByUnit: 'The fleet by unit',
    waiting: 'What waits, by subject',
    money: 'Invoiced, month by month',
    cumulative: 'Invoiced, cumulated',
    measures: {
      count: 'Count',
      'sum(amount)': 'Amount',
      'sum(open)': 'Open',
      'sum(late)': 'Late',
      'sum(waiting)': 'Waiting',
      'sum(done)': 'Done',
      'sum(in_service)': 'In service',
      'sum(alert)': 'In alert',
    } as Record<string, string>,
  },
};

export function viewWords() {
  return catalog;
}
