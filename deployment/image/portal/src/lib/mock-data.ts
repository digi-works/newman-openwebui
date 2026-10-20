import type { Agent, Chat, Message } from "./types";

export const AGENTS: Agent[] = [
  {
    id: "digi", name: "Digi", category: "Campus",
    description: "Newman University's AI chatbot: your Digital Institutional Gateway for Information.",
    longDescription: "Your front door to campus life. Ask about events, Jets game days and rooms, and Digi brings in the right worker when you need one.",
    capabilities: ["Find what's on around campus", "Look up home games for the Jets", "Start a room request"],
    tools: [], starters: ["What's happening on campus this week?", "Show me the upcoming home games for the Jets.", "I'd like to reserve a room for a study group."],
    pinned: [
      { title: "Campus events", description: "Find what's on this week and send me the invite.", prompt: "What's happening on campus this week?" },
      { title: "Athletics fixtures", description: "Home games for the Jets, added to my calendar.", prompt: "Show me the upcoming home games for the Jets." },
      { title: "Reserve a room", description: "Book space for a class, club or study group.", prompt: "I'd like to reserve a room for a study group." },
    ],
    owner: "Student Life", version: "1.0", updated: "3 Oct 2026", rating: null, access: "Everyone",
    limits: "Does not invent dates or availability. Room requests are submitted from the Bookings page.",
  },
  {
    id: "fin", name: "Finance Analyst", category: "Finance",
    description: "Answers spend, budget and invoice questions straight from the ERP, with sources.",
    longDescription: "Looks up purchase invoices, budgets and cost centres, compares actuals to plan, and explains variances in plain language.",
    capabilities: ["Compare actual spend to budget by cost centre", "Find and summarise supplier invoices", "Explain month-on-month variances", "Draft a variance note for the monthly review"],
    tools: [{ name: "ERP · Invoices & budgets", status: "Live" }, { name: "Finance policies (SharePoint)", status: "Synced 2h ago" }],
    starters: ["How did Q3 spend compare to budget by department?", "Which suppliers have overdue invoices over $10k?", "Draft a variance note for marketing spend in September"],
    owner: "Finance Systems", version: "2.4", updated: "12 Sep 2026", rating: 4.7, access: "Finance, Leadership",
    limits: "Read-only access. It cannot approve or post payments.",
  },
  {
    id: "hr", name: "HR Policy Assistant", category: "People",
    description: "Answers leave, benefits and policy questions with the exact clause cited.",
    longDescription: "Answers employee questions from the current handbook and policy library, and points to the right form or contact.",
    capabilities: ["Explain leave, travel and expense rules", "Find the right form for a request", "Summarise policy changes since last review"],
    tools: [{ name: "HR handbook (SharePoint)", status: "Synced 1d ago" }, { name: "Leave balances (HRIS)", status: "Live" }],
    starters: ["How many days of parental leave do I get?", "What is the travel expense limit for Singapore?"],
    owner: "People Operations", version: "1.9", updated: "3 Sep 2026", rating: 4.5, access: "All staff",
    limits: "Cannot change records. Sensitive cases go to an HR partner.",
  },
  {
    id: "con", name: "Contract Reviewer", category: "Legal",
    description: "Flags risky clauses in a contract and compares them to Newman’s standard terms.",
    longDescription: "Upload a contract and get a clause-by-clause review against Newman’s playbook, with suggested fallback wording.",
    capabilities: ["Flag non-standard liability and termination clauses", "Compare against the legal playbook", "Suggest redline wording"],
    tools: [{ name: "Legal playbook", status: "Synced 5d ago" }, { name: "Contract repository", status: "Live" }],
    starters: ["Review this MSA and list the high-risk clauses", "Is a 90-day termination notice acceptable?"],
    owner: "Legal & Compliance", version: "3.1", updated: "28 Aug 2026", rating: 4.6, access: "Legal, Procurement, Sales",
    limits: "Not legal advice. Material contracts need counsel sign-off.",
  },
  {
    id: "sal", name: "Sales Briefing", category: "Sales",
    description: "Prepares account briefs before a customer call from CRM and recent news.",
    longDescription: "Pulls account history, open opportunities and recent activity into a one-page brief before your meeting.",
    capabilities: ["Build a one-page account brief", "Summarise open opportunities and risks", "Suggest talking points"],
    tools: [{ name: "CRM · Accounts & deals", status: "Live" }, { name: "Call notes", status: "Synced 30m ago" }],
    starters: ["Prepare a brief for my 3pm call with Northwind", "Which of my deals have gone quiet for 14 days?"],
    owner: "Revenue Operations", version: "1.6", updated: "17 Sep 2026", rating: 4.4, access: "Sales",
    limits: "Reads CRM only. It does not update deal stages.",
  },
  {
    id: "it", name: "IT Helpdesk", category: "IT",
    description: "Fixes common issues, handles access requests and raises a ticket if it can’t.",
    longDescription: "Walks through common problems, checks service status, and files a ticket with the details already filled in.",
    capabilities: ["Troubleshoot VPN, email and printer issues", "Check service status", "Raise a ticket with context"],
    tools: [{ name: "Service desk", status: "Live" }, { name: "Knowledge base", status: "Synced 3h ago" }],
    starters: ["My VPN keeps disconnecting on Wi-Fi", "Request access to the shared finance drive"],
    owner: "IT Operations", version: "2.0", updated: "22 Sep 2026", rating: 4.3, access: "All staff",
    limits: "Cannot grant access directly. Requests go through approvers.",
  },
  {
    id: "pro", name: "Procurement Assistant", category: "Finance",
    description: "Finds approved suppliers, checks PO status and guides you through purchasing rules.",
    longDescription: "Helps you find an approved supplier, check the status of a purchase order, and follow the right approval path.",
    capabilities: ["Find approved suppliers by category", "Check purchase order status", "Explain approval thresholds"],
    tools: [{ name: "ERP · Purchase orders", status: "Live" }, { name: "Supplier master", status: "Synced 6h ago" }],
    starters: ["What is the status of PO-48213?", "Which approved suppliers offer laptops?"],
    owner: "Procurement", version: "1.3", updated: "9 Sep 2026", rating: 4.2, access: "All staff",
    limits: "Cannot create or approve purchase orders.",
  },
  {
    id: "mee", name: "Meeting Summarizer", category: "People",
    description: "Turns a transcript into decisions, owners and next steps.",
    longDescription: "Paste or upload a transcript and get a short summary, a decision log and an action list with owners.",
    capabilities: ["Summarise a meeting in five lines", "List decisions and owners", "Draft the follow-up email"],
    tools: [{ name: "File upload", status: "Ready" }],
    starters: ["Summarise this transcript and list actions by owner"],
    owner: "Digiworks", version: "1.1", updated: "1 Sep 2026", rating: 4.5, access: "All staff",
    limits: "Works only on content you provide.",
  },
  {
    id: "cmp", name: "Compliance Checker", category: "Legal",
    description: "Checks a document or process against Newman’s compliance policies.",
    longDescription: "Compares a draft policy, vendor form or process note against internal compliance rules and flags gaps.",
    capabilities: ["Check a document against policy", "Flag missing approvals or data-handling gaps", "Summarise regulatory changes"],
    tools: [{ name: "Compliance library", status: "Synced 1d ago" }],
    starters: ["Does this vendor onboarding form meet our data-handling policy?"],
    owner: "Legal & Compliance", version: "1.2", updated: "14 Sep 2026", rating: 4.4, access: "Legal, Finance, Procurement",
    limits: "Advisory only. A compliance officer makes the final call.",
  },
];

export const CATEGORIES = ["All", ...Array.from(new Set(AGENTS.map((a) => a.category)))];

export const getAgent = (id: string) => AGENTS.find((a) => a.id === id);

/** Canned Finance Analyst answer, used for the seeded chat and the mock reply. */
export const FIN_REPLY: Omit<Message, "id" | "role"> = {
  text:
    "Total Q3 spend was $4.82M against a $4.60M budget, 4.8% over. Marketing and IT account for almost all of the overrun.\n\nMarketing’s overrun is mostly the September campaign launch ($82k in agency fees). Want me to draft a variance note for the monthly review?",
  toolLabel: "Queried ERP · budget vs actual, Jul–Sep 2026",
  table: {
    head: ["Department", "Budget", "Actual", "Variance"],
    rows: [
      ["Operations", "$1.90M", "$1.87M", "−1.6%"],
      ["Marketing", "$0.95M", "$1.08M", { text: "+13.7%", flag: true }],
      ["IT", "$0.88M", "$0.97M", { text: "+10.2%", flag: true }],
      ["Sales", "$0.87M", "$0.90M", "+3.4%"],
    ],
  },
  sources: [
    { kind: "data", label: "ERP · Budget vs actual" },
    { kind: "doc", label: "Finance policy: variance thresholds §4.2" },
  ],
  status: "done",
};

const HOUR = 3_600_000;
const mk = (id: string, agentId: string, title: string, hoursAgo: number, reply?: Partial<Message>): Chat => ({
  id, agentId, title, updatedAt: Date.now() - hoursAgo * HOUR,
  messages: [
    { id: id + "-u", role: "user", text: title },
    reply
      ? ({ id: id + "-a", role: "assistant", text: "", status: "done", ...reply } as Message)
      : {
          id: id + "-a", role: "assistant", status: "done",
          toolLabel: `Looked up ${getAgent(agentId)!.tools[0].name}`,
          text: `Here is what I found for “${title}”. This is a saved sample conversation from the mockup.`,
          sources: [{ kind: "doc", label: getAgent(agentId)!.tools[0].name }],
        },
  ],
});

export const seedChats = (): Chat[] => [
  mk("c1", "fin", "Q3 spend vs budget by department", 2, FIN_REPLY),
  mk("c2", "hr", "Parental leave entitlement", 27),
  mk("c3", "con", "Northwind MSA: risky clauses", 52),
  mk("c4", "it", "VPN disconnecting on Wi-Fi", 76),
  mk("c5", "sal", "Brief for Fabrikam renewal call", 220),
];
