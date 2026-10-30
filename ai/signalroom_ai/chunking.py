"""Section -> chunk splitting with LlamaIndex's SentenceSplitter.

Chunk size is measured in the embedding model's own tokens (~350, 50 overlap).
Every chunk carries the heading and page of the section it came from.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from llama_index.core.node_parser import SentenceSplitter

from .embeddings import get_tokenizer
from .parsing import Section

CHUNK_SIZE = 350
CHUNK_OVERLAP = 50


@dataclass
class Chunk:
    ordinal: int
    heading: str | None
    page: int | None
    content: str


@lru_cache(maxsize=1)
def _splitter() -> SentenceSplitter:
    return SentenceSplitter(
        chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP, tokenizer=get_tokenizer()
    )


def chunk_sections(sections: list[Section]) -> list[Chunk]:
    splitter = _splitter()
    chunks: list[Chunk] = []
    for section in sections:
        for piece in splitter.split_text(section.text):
            piece = piece.strip()
            if piece:
                chunks.append(Chunk(len(chunks), section.heading, section.page, piece))
    return chunks


def embedding_text(title: str, chunk: Chunk) -> str:
    """Text that gets embedded: title and heading give the vector its topic context."""
    head = f"{title} — {chunk.heading}" if chunk.heading else title
    return f"{head}\n{chunk.content}"
