import * as m from '@/paraglide/messages.js';

/** The words of a tool the assistant or an agent called; its name when it has none yet. */
export function toolLabel(name: string): string {
  const labels: Record<string, () => string> = {
    my_day: m.tool_my_day,
    schedule_task: m.tool_schedule_task,
    memory_remember: m.tool_memory_remember,
    knowledge_search: m.tool_knowledge_search,
    structure_chart: m.tool_structure_chart,
    registry_list: m.tool_registry_list,
    registry_register: m.tool_registry_register,
    decisions_inbox: m.tool_decisions_inbox,
    performance_readings_to_take: m.tool_readings_to_take,
    performance_propose_measure: m.tool_propose_measure,
    actions_propose: m.tool_actions_propose,
    canvas_write: m.tool_canvas_write,
    dashboard_propose: m.tool_dashboard_propose,
    dashboard_read: m.tool_dashboard_read,
    dashboard_change: m.tool_dashboard_change,
    team_datasets: m.tool_team_datasets,
    delegate_task: m.tool_delegate_task,
    ask_colleague_assistant: m.tool_ask_colleague,
  };
  return labels[name]?.() ?? name;
}
