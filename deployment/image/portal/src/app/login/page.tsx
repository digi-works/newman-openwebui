import { existsSync } from "node:fs";
import path from "node:path";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Compass, GraduationCap, HeartHandshake, UserPlus } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { getBrand } from "@/lib/brand";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const AREAS = [
  { label: "Recruitment", icon: UserPlus },
  { label: "Advising", icon: Compass },
  { label: "Student services", icon: GraduationCap },
  { label: "Alumni relations", icon: HeartHandshake },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getSessionUser()) redirect("/");
  const brand = getBrand();
  // Drop a photo at public/login-bg.jpg and it becomes the background; without it the navy art shows.
  const hasPhoto = existsSync(path.join(process.cwd(), "public", "login-bg.jpg"));

  return (
    <div className="relative min-h-svh overflow-hidden bg-[oklch(0.2_0.07_265)] text-white">
      {hasPhoto ? (
        <>
          <Image src="/login-bg.jpg" alt="" fill sizes="100vw" priority className="object-cover object-center" />
          <div aria-hidden className="absolute inset-0 bg-[linear-gradient(100deg,oklch(0.2_0.07_265/0.86),oklch(0.2_0.07_265/0.62)_50%,oklch(0.2_0.07_265/0.42))]" />
        </>
      ) : (
        <>
          <div aria-hidden className="absolute inset-0 bg-[linear-gradient(135deg,oklch(0.27_0.09_265),oklch(0.18_0.06_265))]" />
          <div aria-hidden className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-[oklch(0.8_0.08_235)] opacity-25 blur-3xl" />
          <div aria-hidden className="absolute -bottom-52 left-1/4 size-[36rem] rounded-full bg-[oklch(0.5_0.17_22)] opacity-45 blur-3xl" />
        </>
      )}

      {/* diagonal wedge behind the card, like the split layout in the reference */}
      <div aria-hidden className="absolute inset-y-0 right-0 hidden w-[56%] bg-[oklch(0.13_0.035_265/0.8)] [clip-path:polygon(24%_0,100%_0,100%_100%,0_100%)] lg:block" />

      <div className="relative z-10 grid min-h-svh items-center gap-10 px-6 py-10 lg:grid-cols-2 lg:gap-0 lg:px-0 lg:py-10">
        <section className="mx-auto w-full max-w-xl space-y-6 text-center lg:px-10">
          <Image src="/digiworks-logo-white.png" alt="Digiworks" width={962} height={230} className="mx-auto mb-6 h-16 w-auto" priority />
          <h1 className="text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl xl:text-[2.6rem]"><span className="block">Coworkers for every</span><span className="block">department on campus</span></h1>
          <ul className="flex flex-wrap justify-center gap-2 xl:flex-nowrap">
            {AREAS.map(({ label, icon: Icon }) => (
              <li key={label} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm backdrop-blur">
                <Icon className="size-4 text-[oklch(0.85_0.07_235)]" />
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex justify-center lg:px-10">
          <div className="force-light w-full max-w-md rounded-2xl bg-card p-8 text-card-foreground shadow-2xl ring-1 ring-black/5 sm:p-10">
            <Image src="/newman-logo.png" alt={brand.org} width={221} height={152} className="mx-auto mb-6 h-auto w-40" priority />
            <LoginForm org={brand.org} passwordReset={(await searchParams).reset === "1"} />
          </div>
        </section>
      </div>
    </div>
  );
}
