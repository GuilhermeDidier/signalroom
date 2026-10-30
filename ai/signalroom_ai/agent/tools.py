"""Tool definitions for the answering loop and the knowledge-base search tool."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..retrieval import Hit

SEARCH_K = 6
SNIPPET_CHARS = 240

TOOLS = [
    {
        "name": "search_knowledge_base",
        "description": (
            "Search this company's help-center documents. Returns numbered passages; cite "
            "them as [n]. Use specific keywords (product names, SKUs, error codes, policy names)."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search query"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "create_ticket",
        "description": (
            "File a support ticket for staff follow-up (bug reports, problems that need an "
            "action). The system creates it after your reply."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "subject": {"type": "string", "description": "Max 80 characters"},
                "summary": {"type": "string", "description": "What happened and what is needed"},
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
            },
            "required": ["subject", "summary", "priority"],
            "additionalProperties": False,
        },
    },
    {
        "name": "handoff_to_human",
        "description": "Hand the conversation to a human support agent.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"reason": {"type": "string", "description": "Why a human is needed"}},
            "required": ["reason"],
            "additionalProperties": False,
        },
    },
]


@dataclass
class SourceRegistry:
    """Numbers retrieved chunks [1], [2], ... across all searches of one turn."""

    hits: dict[int, Hit] = field(default_factory=dict)
    _by_chunk: dict[int, int] = field(default_factory=dict)

    def add(self, hit: Hit) -> int:
        if hit.chunk_id not in self._by_chunk:
            n = len(self.hits) + 1
            self._by_chunk[hit.chunk_id] = n
            self.hits[n] = hit
        return self._by_chunk[hit.chunk_id]

    def cosines(self) -> dict[int, float]:
        return {n: (h.cosine or 0.0) for n, h in self.hits.items()}

    def citation(self, n: int) -> dict:
        h = self.hits[n]
        snippet = " ".join(h.content.split())
        if len(snippet) > SNIPPET_CHARS:
            snippet = snippet[:SNIPPET_CHARS].rsplit(" ", 1)[0] + "…"
        return {
            "n": n,
            "chunk_id": h.chunk_id,
            "document_id": str(h.document_id),
            "document_title": h.document_title,
            "heading": h.heading,
            "page": h.page,
            "snippet": snippet,
        }


def format_results(registry: SourceRegistry, hits: list[Hit]) -> str:
    if not hits:
        return "No matching passages found in the knowledge base."
    blocks = []
    for h in hits:
        n = registry.add(h)
        where = h.document_title + (f" — {h.heading}" if h.heading else "")
        if h.page:
            where += f" (page {h.page})"
        blocks.append(f"[{n}] {where}\n{h.content}")
    return "\n\n".join(blocks)
