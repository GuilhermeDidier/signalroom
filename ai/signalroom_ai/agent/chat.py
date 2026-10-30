"""One chat turn: redact -> route -> answer with tools (streamed) -> score -> escalate.

Yields (event_name, payload) pairs in the order of the SSE contract:
meta, token*, tool*, done   (or error).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from uuid import UUID

import anthropic
from pydantic import BaseModel, ValidationError

from ..confidence import compute_confidence, markers_in
from ..config import get_settings
from ..db import connection
from ..redaction import redact
from ..retrieval import hybrid_search
from ..usage import record_call, remaining_calls
from .client import LLMUnavailable, get_client
from .prompts import ANSWER_SYSTEM
from .router import IntentDecision, classify_intent
from .stream_filter import AnswerableFilter
from .tools import SEARCH_K, TOOLS, SourceRegistry, format_results

log = logging.getLogger(__name__)

MAX_MODEL_CALLS = 4  # answering-loop iterations per turn
MAX_HISTORY_TURNS = 10
ESCALATING_INTENTS = ("human_request", "complaint")
CAP_MESSAGE = (
    "Thanks for your message. Our assistant is taking a break right now, so I've passed "
    "your question to the support team and someone will get back to you soon."
)


class SearchInput(BaseModel):
    query: str


class TicketInput(BaseModel):
    subject: str
    summary: str
    priority: str


class HandoffInput(BaseModel):
    reason: str


@dataclass
class TurnState:
    tenant_id: str
    sources: SourceRegistry = field(default_factory=SourceRegistry)
    searched: bool = False
    ticket: dict | None = None
    handoff_reason: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    model_calls: int = 0

    def count(self, usage_in: int, usage_out: int) -> None:
        self.input_tokens += usage_in
        self.output_tokens += usage_out
        self.model_calls += 1
        record_call(self.tenant_id, usage_in, usage_out)


def _tenant_context(tenant_id: str) -> tuple[str, str]:
    with connection() as conn:
        tenant = conn.execute("SELECT name FROM tenants WHERE id = %s", (tenant_id,)).fetchone()
        titles = conn.execute(
            "SELECT title FROM documents WHERE tenant_id = %s AND status = 'indexed'"
            " ORDER BY title LIMIT 20",
            (tenant_id,),
        ).fetchall()
    if tenant is None:
        raise LookupError("unknown tenant")
    topics = ", ".join(t["title"] for t in titles) or "its products and services"
    return tenant["name"], topics


def _history_messages(history: list[dict], message: str) -> list[dict]:
    """Recent history + the new message, merged so roles strictly alternate."""
    turns = [
        {"role": t["role"], "content": t["content"]}
        for t in history[-MAX_HISTORY_TURNS:]
        if t.get("role") in ("user", "assistant") and t.get("content")
    ]
    turns.append({"role": "user", "content": message})
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    merged: list[dict] = []
    for t in turns:
        if merged and merged[-1]["role"] == t["role"]:
            merged[-1]["content"] += "\n\n" + t["content"]
        else:
            merged.append(dict(t))
    return merged


def _synthesize_ticket(intent: str, message: str, answer: str, reason: str) -> dict:
    first_line = " ".join(message.split())
    subject = first_line if len(first_line) <= 70 else first_line[:67].rsplit(" ", 1)[0] + "…"
    priority = "high" if intent == "complaint" else "normal"
    summary = f"Customer wrote: {message}\n\nEscalation reason: {reason}"
    if answer:
        summary += f"\n\nAI reply: {answer[:600]}"
    return {"subject": f"[{intent}] {subject}", "summary": summary, "priority": priority}


async def _run_tool(state: TurnState, name: str, raw_input: object) -> tuple[str, bool]:
    """Execute one tool call. Returns (result_text, is_error)."""
    try:
        if name == "search_knowledge_base":
            args = SearchInput.model_validate(raw_input)
            state.searched = True
            hits = await asyncio.to_thread(hybrid_search, state.tenant_id, args.query, SEARCH_K)
            return format_results(state.sources, hits), False
        if name == "create_ticket":
            args = TicketInput.model_validate(raw_input)
            priority = (
                args.priority if args.priority in ("low", "normal", "high", "urgent") else "normal"
            )
            state.ticket = {
                "subject": args.subject[:120],
                "summary": args.summary,
                "priority": priority,
            }
            return (
                "Ticket recorded; it will be filed after your reply. Tell the customer the team will follow up.",
                False,
            )
        if name == "handoff_to_human":
            args = HandoffInput.model_validate(raw_input)
            state.handoff_reason = args.reason
            return (
                "A human agent will take over after your reply. Tell the customer briefly.",
                False,
            )
    except ValidationError as exc:
        return f"Invalid tool input: {exc.errors()[:1]}", True
    return f"Unknown tool {name}", True


async def run_turn(
    tenant_id: UUID,
    message: str,
    history: list[dict],
    confidence_threshold: float,
) -> AsyncIterator[tuple[str, dict]]:
    settings = get_settings()
    tid = str(tenant_id)
    red = redact(message)
    redacted_message = red.redacted
    state = TurnState(tenant_id=tid)

    tenant_name, topics = await asyncio.to_thread(_tenant_context, tid)

    # Over the daily cap: no LLM call at all, escalate politely.
    if await asyncio.to_thread(remaining_calls) < 2:
        reason = "daily_llm_cap_reached"
        yield (
            "meta",
            {
                "intent": "human_request",
                "intent_reason": "Daily AI budget reached; routed to the team.",
                "redacted_message": redacted_message,
                "redactions": red.summary(),
            },
        )
        yield "token", {"text": CAP_MESSAGE}
        yield (
            "done",
            {
                "answer": CAP_MESSAGE,
                "intent": "human_request",
                "confidence": 0.0,
                "confidence_breakdown": {"mode": "llm_cap", "confidence": 0.0},
                "citations": [],
                "escalate": True,
                "escalation_reason": reason,
                "ticket": _synthesize_ticket("human_request", redacted_message, "", reason),
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        )
        return

    try:
        decision, r_in, r_out = await classify_intent(
            tenant_name, topics, redacted_message, history
        )
        await asyncio.to_thread(state.count, r_in, r_out)
    except LLMUnavailable as exc:
        yield "error", {"message": str(exc)}
        return
    except anthropic.APIError as exc:
        log.warning("router failed: %s", exc)
        decision = IntentDecision(intent="how_to", reason="router unavailable")

    yield (
        "meta",
        {
            "intent": decision.intent,
            "intent_reason": decision.reason,
            "redacted_message": redacted_message,
            "redactions": red.summary(),
        },
    )

    system = ANSWER_SYSTEM.format(
        tenant=tenant_name, topics=topics, intent=decision.intent, intent_reason=decision.reason
    )
    messages = _history_messages(history, redacted_message)
    flt = AnswerableFilter()
    answer_parts: list[str] = []
    client = get_client()

    try:
        for _ in range(MAX_MODEL_CALLS):
            if await asyncio.to_thread(remaining_calls) < 1:
                break
            async with client.messages.stream(
                model=settings.llm_model,
                max_tokens=4096,
                system=system,
                messages=messages,
                tools=TOOLS,
                output_config={"effort": "low"},
            ) as stream:
                async for event in stream:
                    if event.type == "text":
                        visible = flt.feed(event.text)
                        if visible:
                            answer_parts.append(visible)
                            yield "token", {"text": visible}
                response = await stream.get_final_message()
            await asyncio.to_thread(
                state.count, response.usage.input_tokens, response.usage.output_tokens
            )

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason != "tool_use" or not tool_uses:
                break
            results = []
            for block in tool_uses:
                if block.name in ("create_ticket", "handoff_to_human"):
                    yield "tool", {"name": block.name, "input": block.input}
                text, is_error = await _run_tool(state, block.name, block.input)
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": text,
                        "is_error": is_error,
                    }
                )
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": results})
    except anthropic.APIError as exc:
        log.warning("answer loop failed: %s", exc)
        yield "error", {"message": "The assistant is temporarily unavailable. Please try again."}
        return

    tail = flt.flush()
    if tail:
        answer_parts.append(tail)
        yield "token", {"text": tail}
    answer = "".join(answer_parts).strip()

    breakdown = compute_confidence(
        answer, state.sources.cosines(), flt.flag, decision.intent, state.searched
    )
    cited = []
    for n in markers_in(answer):
        if n in state.sources.hits and n not in cited:
            cited.append(n)

    reasons = []
    if state.handoff_reason:
        reasons.append(f"handoff_requested: {state.handoff_reason}")
    if decision.intent in ESCALATING_INTENTS:
        reasons.append(f"intent:{decision.intent}")
    if state.ticket:
        reasons.append("ticket_requested")
    if breakdown.confidence < confidence_threshold:
        reasons.append(f"low_confidence ({breakdown.confidence:.2f} < {confidence_threshold:.2f})")
    if not answer:
        reasons.append("empty_answer")
    escalate = bool(reasons)
    reason = "; ".join(reasons) if reasons else None
    ticket = state.ticket
    if escalate and ticket is None:
        ticket = _synthesize_ticket(decision.intent, redacted_message, answer, reason or "")

    yield (
        "done",
        {
            "answer": answer,
            "intent": decision.intent,
            "confidence": breakdown.confidence,
            "confidence_breakdown": breakdown.to_dict(),
            "citations": [state.sources.citation(n) for n in cited],
            "escalate": escalate,
            "escalation_reason": reason,
            "ticket": ticket,
            "usage": {"input_tokens": state.input_tokens, "output_tokens": state.output_tokens},
        },
    )
