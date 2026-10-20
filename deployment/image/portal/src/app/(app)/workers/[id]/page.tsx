import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Lock, Star } from "lucide-react";
import { AgentAvatar } from "@/components/agent-avatar";
import { FavoriteButton } from "@/components/favorite-button";
import { StarterPrompt, StartChat } from "@/components/start-chat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgent } from "@/lib/api";

function safeDecode(v: string) { try { return decodeURIComponent(v); } catch { return v; } }

import { getBrand } from "@/lib/brand";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const org = getBrand().org;
  const { id } = await params;
  const agent = (await getAgent(id)) ?? (await getAgent(safeDecode(id)));
  if (!agent) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <nav className="text-sm text-muted-foreground">
        <Link href="/workers" className="font-medium text-foreground underline underline-offset-4">Workers</Link> / {agent.name}
      </nav>

      <div className="flex flex-wrap items-center gap-4">
        <AgentAvatar name={agent.name} className="size-14 text-xl" />
        <div className="min-w-56 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          <p className="max-w-prose text-muted-foreground">{agent.longDescription || agent.description}</p>
        </div>
        <div className="flex gap-2">
          <FavoriteButton agentId={agent.id} labelled />
          <StartChat agentId={agent.id} size="lg" />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {agent.capabilities.length > 0 && <Card>
            <CardHeader><CardTitle>What it can do</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2.5 text-sm">
                {agent.capabilities.map((c) => <li key={c} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{c}</li>)}
              </ul>
            </CardContent>
          </Card>}
          {agent.starters.length > 0 && <Card>
            <CardHeader><CardTitle>Try asking</CardTitle></CardHeader>
            <CardContent className="space-y-2">{agent.starters.map((s) => <StarterPrompt key={s} agentId={agent.id} prompt={s} />)}</CardContent>
          </Card>}
          {agent.limits && <Card>
            <CardHeader><CardTitle>Good to know</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{agent.limits}</CardContent>
          </Card>}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                {([["Owner", agent.owner], ["Who can use it", agent.access], ["Version", agent.version], ["Updated", agent.updated]] as const).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>
                ))}
                {agent.rating != null && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Rating</dt><dd className="inline-flex items-center gap-1"><Star className="size-3.5 fill-amber-400 text-amber-400" />{agent.rating} / 5</dd></div>}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{agent.tools.length ? "Connected to" : "Privacy"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {agent.tools.map((t) => (
                <div key={t.name} className="flex items-center gap-2.5 text-sm">
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.status}</span>
                </div>
              ))}
              <div className="flex gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                Runs inside {org}’s environment. Conversations are not used to train models.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
