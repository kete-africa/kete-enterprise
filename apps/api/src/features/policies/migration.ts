import { policiesMigrationSql } from '@kete/policies';

/**
 * The policies and their journal (kete-core `@kete/policies`, with their RLS in the same
 * migration), and the two engines that melt into it (spec 088):
 * - each agents' rule (spec 068) becomes its policy, same id, same state; its form stays in
 *   `ai_rules` (family, permissions, when it was tried), its state is the policy's;
 * - what the rules refused or counted is carried into the journal of decisions, and the old
 *   journal retired;
 * - each active circuit (spec 005) becomes its approval policy, `circuit.<subject>`.
 * The Cedar text written here is the one `ruleText` and `circuitText` write.
 */
export function centerPoliciesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const permissions = `'[' || array_to_string(array(select '"' || p || '"' from unnest(r.permissions) p), ', ') || '].contains(context.permission)'`;
  return `${policiesMigrationSql(options)}
insert into ${s}.kete_policies (organization_id, policy_id, version, sentence, rule, policy_set,
  approver, owner, status, written_by, created_at)
select r.organization_id, r.rule_id, 1, r.sentence,
       'forbid (principal is Kete::Agent, action == Kete::Action::"capability.use", resource)'
       || case
            when r.effect = 'person' and cardinality(r.permissions) > 0
              then ' when { context.autonomy == 2 && ' || ${permissions} || ' }'
            when r.effect = 'person' then ' when { context.autonomy == 2 }'
            when cardinality(r.permissions) > 0 then ' when { ' || ${permissions} || ' }'
            else ''
          end || ';',
       'authority', null, r.created_by, r.state, r.created_by, r.created_at
  from ${s}.ai_rules r;

insert into ${s}.kete_policy_decisions (decision_id, organization_id, gesture, effect, approvers,
  policies, trial, at)
select 'pdc_' || substr(f.refusal_id, 5), f.organization_id,
       jsonb_strip_nulls(jsonb_build_object(
         'actor', jsonb_strip_nulls(jsonb_build_object('kind', 'agent', 'id', f.agent_id,
           'on_behalf_of', f.on_behalf_of)),
         'kind', 'capability.use',
         'object', jsonb_build_object('kind', 'capability', 'id', f.tool),
         'channel', f.channel,
         'context', jsonb_build_object('permission', f.permission),
         'at', to_char(f.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
       case when f.trial then 'allow' else 'refuse' end, '{}',
       case when f.trial then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',
         f.rule_id, 'version', 1, 'effect', 'refuse', 'reason', f.rule_sentence)) end,
       case when f.trial then jsonb_build_array(jsonb_build_object('id', f.rule_id, 'version', 1,
         'effect', 'refuse', 'reason', f.rule_sentence)) else '[]'::jsonb end,
       f.at
  from ${s}.ai_rule_refusals f;
drop table ${s}.ai_rule_refusals;
alter table ${s}.ai_rules drop column state;

insert into ${s}.kete_policies (organization_id, policy_id, version, sentence, rule, policy_set,
  approver, owner, status, written_by, created_at)
select c.organization_id, 'circuit.' || c.subject, 1, 'Le circuit « ' || c.name || ' » décide',
       'permit (principal, action == Kete::Action::"request.open", resource == Kete::Subject::"'
       || c.subject || '");',
       'approval', 'circuit', 'kete', 'active', 'kete', c.created_at
  from ${s}.circuits c where c.active;
`;
}
