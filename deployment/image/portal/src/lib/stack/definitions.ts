import { enabledMcpTools } from "../mcp/registry";
import type { ToolDefinition } from "../runtime";
import { TOOL_VIEWS } from "../tools/views";

/**
 * The tools allowed this turn, described for a runtime that builds its own tool list. Built-in tools come from the shared tool views; connected (MCP) tools
 * come from the organisation's registry. The runtime only ever calls Digi's tool gateway with `gateway`; it cannot reach a tool server directly.
 */
/** The names the instructions already use (the Open WebUI tool methods), so the same prompts work on every runtime. */
const FRIENDLY: Record<string, string> = {
  "rooms.form": "show_room_request_form", "rooms.search": "find_available_rooms", "rooms.list": "list_rooms", "bookings.list": "list_bookings",
  "bookings.request": "request_room", "bookings.cancel": "cancel_booking", "bookings.override_conflict": "override_conflict",
  "approvals.queue": "approval_queue", "memory.remember": "remember_this",
};
const safe = (id: string) => FRIENDLY[id] ?? id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

export async function toolDefinitions(tenantId: string, toolIds: string[]): Promise<ToolDefinition[]> {
  const mcp = toolIds.some((t) => t.startsWith("mcp.")) ? await enabledMcpTools(tenantId) : [];
  const out: ToolDefinition[] = [];
  for (const id of toolIds) {
    const v = TOOL_VIEWS.find((t) => t.id === id);
    if (v) { out.push({ name: safe(id), gateway: id, description: v.description, inputSchema: v.input }); continue; }
    const m = mcp.find((x) => `mcp.${x.server}.${x.name}` === id);
    if (m) out.push({ name: safe(id), gateway: id, description: m.description || m.name, inputSchema: (m.input_schema?.type ? m.input_schema : { type: "object", properties: {} }) as Record<string, unknown> });
  }
  return out;
}
