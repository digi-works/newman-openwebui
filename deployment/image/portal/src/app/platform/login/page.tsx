import { redirect } from "next/navigation";
import { PlatformLogin } from "@/components/platform/platform-login";
import { currentOperator } from "@/lib/studio/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio sign-in" };

export default async function PlatformLoginPage() {
  const op = await currentOperator();
  if (op?.mfaVerified) redirect("/platform");
  return <PlatformLogin stage={op ? (op.mfaEnrolled ? "verify" : "enroll") : "password"} />;
}
