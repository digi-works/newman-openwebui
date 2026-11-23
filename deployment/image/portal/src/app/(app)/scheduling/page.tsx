import { redirect } from "next/navigation";

/** Scheduling opens on Issues, its only page so far. */
export default function SchedulingPage() {
  redirect("/scheduling/issues");
}
