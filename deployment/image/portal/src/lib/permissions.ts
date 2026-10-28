/**
 * Permission codes. The catalog (labels, modules) lives in the database table `permissions` and is seeded by migrations;
 * these constants are how code refers to them. Add a code here and in a migration together.
 */
export const P = {
  chatUse: "chat.use",
  bookingsViewOwn: "bookings.view_own",
  bookingsViewAll: "bookings.view_all",
  bookingsCreate: "bookings.create",
  bookingsUpdate: "bookings.update",
  bookingsDelete: "bookings.delete",
  bookingsApprove: "bookings.approve",
  bookingsApproveOwn: "bookings.approve_own",
  usersView: "users.view",
  usersCreate: "users.create",
  usersUpdate: "users.update",
  usersDisable: "users.disable",
  rolesManage: "roles.manage",
  aiManage: "ai.manage",
  approvalsDecide: "approvals.decide",
  mcpManage: "mcp.manage",
} as const;

export type PermissionCode = (typeof P)[keyof typeof P];

/** "*" means the person holds a role that grants everything (Admin). Safe to use in client and server code. */
export const hasPermission = (permissions: readonly string[], code: PermissionCode) => permissions.includes("*") || permissions.includes(code);
