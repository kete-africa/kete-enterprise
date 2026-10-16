import type { Policy } from '@kete/sdk';

/**
 * KYA's six policies (spec 088, FR-008; doctrine D-058), on the demo's own roles and positions:
 * who commits the company, who speaks to clients — on which channel, in which hours, with which
 * templates —, spending limits, deputies, retention and confidentiality, consent. They are in
 * force, but for the hours of the agents, still observed on trial.
 */
export function kyaPolicies(ids: {
  /** The role « Comité de direction ». */
  committee: string;
  /** The position of the Directeur Général. */
  director: string;
}): Omit<Policy, 'version' | 'owner'>[] {
  const authority = (id: string, sentence: string, rule: string) => ({
    id,
    sentence,
    rule,
    set: 'authority' as const,
    status: 'active' as const,
  });
  const approval = (id: string, sentence: string, approver: string, rule: string) => ({
    ...authority(id, sentence, rule),
    set: 'approval' as const,
    approver,
  });
  return [
    // 1. Who commits the company.
    authority(
      'signature.committee',
      'Signent les membres du comité de direction',
      `permit (principal is Kete::Person, action == Kete::Action::"contract.sign", resource)
        when { principal in Kete::Role::"${ids.committee}" };`,
    ),
    authority(
      'signature.no-agent',
      'Un agent ne signe jamais',
      `forbid (principal is Kete::Agent, action == Kete::Action::"contract.sign", resource);`,
    ),
    approval(
      'signature.big',
      'Au-delà de 5 000 000 F, le Directeur Général approuve la signature',
      `position:${ids.director}`,
      `permit (principal, action == Kete::Action::"contract.sign", resource)
        when { context.amount > 5000000 };`,
    ),
    // 2. Who speaks to clients, on which channel, in which hours, with which templates.
    authority(
      'clients.speak',
      'On écrit aux clients par WhatsApp ou par mail',
      `permit (principal, action == Kete::Action::"message.client", resource)
        when { ["whatsapp", "mail"].contains(context.channel) };`,
    ),
    {
      ...authority(
        'clients.hours',
        'Un agent n’écrit pas aux clients avant 8 h ni après 19 h',
        `forbid (principal is Kete::Agent, action == Kete::Action::"message.client", resource)
          when { context.hour < 8 || context.hour >= 19 };`,
      ),
      status: 'trial' as const,
    },
    approval(
      'clients.no-template',
      'Un agent qui écrit sans modèle approuvé demande à sa personne',
      'on_behalf_of',
      `permit (principal is Kete::Agent, action == Kete::Action::"message.client", resource)
        unless { context has approvedTemplate && context.approvedTemplate };`,
    ),
    // 3. Spending limits.
    authority(
      'spend.people',
      'Une personne engage un achat',
      `permit (principal is Kete::Person, action == Kete::Action::"purchase.commit", resource);`,
    ),
    authority(
      'spend.agents',
      'Un agent qui agit seul engage un achat',
      `permit (principal is Kete::Agent, action == Kete::Action::"purchase.commit", resource)
        when { principal.autonomyMax >= 2 };`,
    ),
    approval(
      'spend.over-limit',
      'Au-delà de 500 000 F, hors comité de direction, son responsable approuve',
      'manager',
      `permit (principal is Kete::Person, action == Kete::Action::"purchase.commit", resource)
        when { context.amount > 500000 && !(principal in Kete::Role::"${ids.committee}") };`,
    ),
    approval(
      'spend.agent-over-limit',
      'Un agent au-delà de 200 000 F demande à sa personne',
      'on_behalf_of',
      `permit (principal is Kete::Agent, action == Kete::Action::"purchase.commit", resource)
        when { context.amount > 200000 };`,
    ),
    approval(
      'spend.over-budget',
      'Au-delà du budget restant, le responsable du projet approuve',
      'project.holder',
      `permit (principal, action == Kete::Action::"purchase.commit", resource)
        when { context has budgetLeft && context.amount > context.budgetLeft };`,
    ),
    // 4. Deputies.
    authority(
      'deputy.decide',
      'Le titulaire décide sa carte ; son suppléant pendant son absence',
      `permit (principal, action == Kete::Action::"card.decide", resource)
        when { principal == resource.holder ||
          (resource.holder.absent && resource.holder has deputy &&
            resource.holder.deputy == principal) };`,
    ),
    // 5. Retention and confidentiality.
    authority(
      'docs.read',
      'On lit les documents',
      `permit (principal, action == Kete::Action::"document.read", resource);`,
    ),
    authority(
      'docs.confidential',
      'Un document confidentiel, seuls ses lecteurs — et leurs agents',
      `forbid (principal, action == Kete::Action::"document.read", resource)
        when { context has confidential && context.confidential &&
          !(context has reader && context.reader) };`,
    ),
    authority(
      'docs.delete',
      'Une personne supprime un document',
      `permit (principal is Kete::Person, action == Kete::Action::"document.delete", resource);`,
    ),
    authority(
      'docs.retention',
      'Rien n’est supprimé avant la fin de sa conservation',
      `forbid (principal, action == Kete::Action::"document.delete", resource)
        when { context has retentionDays && context.ageDays < context.retentionDays };`,
    ),
    // 6. Consent of outside contacts.
    authority(
      'consent.stop',
      'Un contact qui a écrit STOP, ou n’a pas consenti, ne reçoit plus rien',
      `forbid (principal, action == Kete::Action::"message.client", resource)
        when { (context has optedOut && context.optedOut) ||
          (context has consent && !context.consent) };`,
    ),
  ];
}
