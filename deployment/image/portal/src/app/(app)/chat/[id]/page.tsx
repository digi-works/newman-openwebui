import Link from "next/link";
import { redirect } from "next/navigation";
import { ChatView } from "@/components/chat-view";
import { Button } from "@/components/ui/button";
import { isLive, listAgents } from "@/lib/api";
import { conversationStore } from "@/lib/conversations";
import { authLive } from "@/lib/session";
import { actionsForConversation } from "@/lib/pending-actions";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Someone else's conversation and one that does not exist look the same: not found.
  const chat = await conversationStore().get({ id: user.id, tenantId: user.tenantId }, id);
  if (!chat) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-3">
          <h1 className="text-lg font-semibold">Conversation not found</h1>
          <p className="text-sm text-muted-foreground">It may have been deleted.</p>
          <Button render={<Link href="/history" />}>Back to history</Button>
        </div>
      </div>
    );
  }
  // Prepared writes (confirm cards) belong to the answer that prepared them, so they are still there after a reload.
  const acts = authLive() ? await actionsForConversation(user.tenantId, user.id, chat.id).catch(() => []) : [];
  const withActions = { ...chat, messages: chat.messages.map((m) => ({ ...m, actions: acts.filter((a) => a.messageId === m.id) })) };
  return <ChatView agents={await listAgents()} initial={withActions} live={isLive()} />;
}
