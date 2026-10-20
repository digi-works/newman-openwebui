"""The Strands runtime service for Digi (runtime adapter 2).

Digi sends everything it decided for ONE turn: the instructions, the tools allowed this turn, the conversation, the model access and where the tool gateway is.
This service builds a Strands agent for that turn, streams what happens back as server-sent events, and keeps nothing afterwards (no sessions, no memory, no keys).
Every tool the agent calls goes back to Digi's tool gateway with the per-turn handle (execution_id), exactly like the Open WebUI tool modules do, so Authority,
confirm cards, approvals and the audit trail are identical on both runtimes. This service never decides who someone is and never talks to a tool server.

Only Digi may call it: every request needs X-Runtime-Key. It is on the private Docker network and has no published port.

Events: {"type": "text", "delta"} {"type": "tool", "label"} {"type": "embed", "html", "tool"} {"type": "completed", "usage"} {"type": "failed", "message"}
"""
import asyncio
import hmac
import json
import os
import re
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from strands import Agent
from strands.models.openai import OpenAIModel
from strands.tools.tools import PythonAgentTool

try:
    from importlib.metadata import version as _v
    STRANDS_VERSION = _v("strands-agents")
except Exception:  # noqa: BLE001
    STRANDS_VERSION = "unknown"

app = FastAPI(title="Digi Strands runtime", docs_url=None, redoc_url=None, openapi_url=None)
KEY = os.environ.get("STRANDS_RUNTIME_KEY", "")


def require_key(x_runtime_key: str | None):
    if len(KEY) < 16 or not x_runtime_key or not hmac.compare_digest(x_runtime_key, KEY):
        raise HTTPException(status_code=401, detail="not authorised")


@app.get("/health")
async def health(x_runtime_key: str | None = Header(default=None)):
    require_key(x_runtime_key)
    return {"ok": True, "strands": STRANDS_VERSION}


def label_for(name: str) -> str:
    return "Used " + re.sub(r"[_.]+", " ", name)


def make_tool(t: dict, execution_id: str, gateway: dict, emit):
    """A Strands tool whose body is a call to Digi's tool gateway. The model sees the name, description and schema Digi gave it."""
    def run(tool_use, **_kwargs):
        args = tool_use.get("input") or {}
        emit({"type": "tool", "label": label_for(t["name"])})
        try:
            r = httpx.post(
                gateway["url"].rstrip("/") + "/api/internal/tools/" + t["gateway"],
                json={"chat_id": execution_id, "args": args},
                headers={"x-internal-key": gateway["key"], "x-want-embed": "1"}, timeout=90,
            )
            body = r.json()
        except Exception as e:  # noqa: BLE001
            return {"toolUseId": tool_use["toolUseId"], "status": "error", "content": [{"text": f"The tool could not be reached ({type(e).__name__})."}]}
        if r.status_code != 200:
            return {"toolUseId": tool_use["toolUseId"], "status": "error", "content": [{"text": str(body.get("error", "That did not work."))}]}
        embed = body.pop("embed", None)
        if embed:
            emit({"type": "embed", "html": embed, "tool": t["gateway"]})
            body["note_to_assistant"] = "A form or list is now shown to the person. Add at most one short sentence."
        return {"toolUseId": tool_use["toolUseId"], "status": "success", "content": [{"text": json.dumps(body)[:12000]}]}

    schema = t.get("inputSchema") or {"type": "object", "properties": {}}
    return PythonAgentTool(t["name"], {"name": t["name"], "description": t["description"][:900], "inputSchema": {"json": schema}}, run)


def to_strands_messages(messages: list[dict]) -> tuple[str, list[dict], str]:
    """Digi sends system/user/assistant messages. System text joins the instructions; the last user message is the prompt for this turn."""
    system_extra = [m["content"] for m in messages if m["role"] == "system"]
    convo = [m for m in messages if m["role"] in ("user", "assistant") and m["content"].strip()]
    prompt = ""
    if convo and convo[-1]["role"] == "user":
        prompt = convo.pop()["content"]
    history = [{"role": m["role"], "content": [{"text": m["content"]}]} for m in convo]
    return "\n\n".join(system_extra), history, prompt


@app.post("/v1/execute")
async def execute(body: dict, x_runtime_key: str | None = Header(default=None)):
    require_key(x_runtime_key)
    execution_id = str(body.get("execution_id", ""))
    if not execution_id or not isinstance(body.get("model"), dict) or not isinstance(body.get("gateway"), dict):
        raise HTTPException(status_code=400, detail="bad request")
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def emit(event: dict):  # called from tool threads
        loop.call_soon_threadsafe(queue.put_nowait, event)

    m = body["model"]
    extra, history, prompt = to_strands_messages(body.get("messages", []))
    system = (body.get("system") or "") + (("\n\n" + extra) if extra else "")

    async def work():
        try:
            model = OpenAIModel(client_args={"base_url": m["baseUrl"], "api_key": m["apiKey"]}, model_id=m["modelId"])
            tools = [make_tool(t, execution_id, body["gateway"], emit) for t in body.get("tools", [])]
            agent = Agent(model=model, tools=tools, system_prompt=system, messages=history, callback_handler=None)
            usage = {}
            async for ev in agent.stream_async(prompt or "Hello"):
                if "data" in ev and isinstance(ev["data"], str) and ev["data"]:
                    await queue.put({"type": "text", "delta": ev["data"]})
                res = ev.get("result")
                if res is not None:
                    u = getattr(getattr(res, "metrics", None), "accumulated_usage", None) or {}
                    usage = {"tokensIn": u.get("inputTokens"), "tokensOut": u.get("outputTokens")}
            await queue.put({"type": "completed", "usage": usage})
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            await queue.put({"type": "failed", "message": friendly(e)})
        finally:
            await queue.put(None)

    def friendly(e: Exception) -> str:
        text = f"{type(e).__name__}: {e}"
        if re.search(r"429|rate.?limit|quota", text, re.I):
            return "The AI provider is rate limiting this key (429)."
        if re.search(r"401|invalid.{0,12}api.?key|incorrect api key|unauthori", text, re.I):
            return "The AI provider rejected the key (401)."
        return "The AI service returned an error."

    async def stream():
        task = asyncio.create_task(work())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            # the browser left or Digi stopped the turn: stop the agent too
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/v1/complete")
async def complete(body: dict, x_runtime_key: str | None = Header(default=None)):
    require_key(x_runtime_key)
    m = body["model"]
    async with httpx.AsyncClient(timeout=110) as c:
        r = await c.post(m["baseUrl"].rstrip("/") + "/chat/completions", headers={"Authorization": f"Bearer {m['apiKey']}"},
                         json={"model": m["modelId"], "messages": body.get("messages", []), "stream": False})
    if r.status_code != 200:
        return JSONResponse({"error": "the model could not answer"}, status_code=502)
    j: Any = r.json()
    return {"text": (j.get("choices") or [{}])[0].get("message", {}).get("content", "")}
