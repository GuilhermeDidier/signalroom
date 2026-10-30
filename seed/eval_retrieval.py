"""Retrieval eval: recall@5 and MRR@10 for keyword-only, vector-only and hybrid RRF.

Ingests the generated seed files into fresh scratch tenants (one per company),
runs every in-scope question of seed/eval.jsonl, and scores at document level: a
hit is any chunk of the expected document. Out-of-scope questions are not scored
for recall; their top-1 cosine is reported next to the in-scope one, which is what
the confidence formula's retrieval-strength floor/ceiling are calibrated on.

Keyword retrieval is reported in both modes:
  all = websearch_to_tsquery as-is (every term must match),
  any = the same parsed query with top-level ANDs turned into ORs (what /retrieve uses).

Run (Postgres from docker compose must be up):
  ai/.venv/bin/python seed/build_files.py
  ai/.venv/bin/python seed/eval_retrieval.py [--keep]
"""

from __future__ import annotations

import argparse
import json
import resource
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

SEED = Path(__file__).resolve().parent
sys.path.insert(0, str(SEED))

from scratch import add_seed_documents, create_tenant, delete_tenant
from signalroom_ai.embeddings import embed_query
from signalroom_ai.ingest import ingest_document
from signalroom_ai.retrieval import (
    keyword_search,
    rrf_fuse,
    vector_search,
)

METHODS = ["keyword(all)", "keyword(any)", "vector", "hybrid(all)", "hybrid(any)"]


def ranked_docs(hits_by_method: dict[str, list]) -> dict[str, list]:
    return {m: [h.document_id for h in hits] for m, hits in hits_by_method.items()}


def run_query(tenant_id, question: str) -> tuple[dict[str, list], float | None]:
    qvec = embed_query(question)
    vec = vector_search(tenant_id, qvec)
    kw_all = keyword_search(tenant_id, question, qvec, mode="all")
    kw_any = keyword_search(tenant_id, question, qvec, mode="any")
    by_id = {h.chunk_id: h for h in vec + kw_all + kw_any}

    def fuse(kw):
        return [
            by_id[c]
            for c, _ in rrf_fuse([[h.chunk_id for h in vec], [h.chunk_id for h in kw]])
        ]

    results = {
        "keyword(all)": kw_all,
        "keyword(any)": kw_any,
        "vector": vec,
        "hybrid(all)": fuse(kw_all),
        "hybrid(any)": fuse(kw_any),
    }
    top_cos = vec[0].cosine if vec else None
    return results, top_cos


def first_rank(doc_ids: list, expected) -> int | None:
    for i, d in enumerate(doc_ids, start=1):
        if d == expected:
            return i
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="keep the scratch tenants")
    args = ap.parse_args()

    questions = [
        json.loads(line)
        for line in (SEED / "eval.jsonl").read_text().splitlines()
        if line.strip()
    ]
    tenants: dict[str, object] = {}
    doc_ids: dict[str, dict[str, object]] = {}
    t0 = time.time()
    try:
        for slug in sorted({q["tenant"] for q in questions}):
            tid = create_tenant(f"eval {slug}", slug_prefix=f"eval-{slug}")
            tenants[slug] = tid
            docs = add_seed_documents(tid, slug)
            doc_ids[slug] = {stem: did for did, stem in docs.items()}
            for did in docs:
                ingest_document(did)
        ingest_s = time.time() - t0

        recall = defaultdict(lambda: defaultdict(list))  # method -> kind -> [0/1]
        rr = defaultdict(lambda: defaultdict(list))
        top1 = defaultdict(lambda: defaultdict(list))
        cos_in, cos_out = [], []
        misses = defaultdict(list)
        for q in questions:
            tid = tenants[q["tenant"]]
            results, top_cos = run_query(tid, q["question"])
            if q["expected_doc"] is None:
                cos_out.append(top_cos)
                continue
            cos_in.append(top_cos)
            expected = doc_ids[q["tenant"]][q["expected_doc"]]
            for method, docs in ranked_docs(results).items():
                rank = first_rank(docs, expected)
                hit5 = rank is not None and rank <= 5
                for kind in (q["kind"], "all"):
                    recall[method][kind].append(1 if hit5 else 0)
                    top1[method][kind].append(1 if rank == 1 else 0)
                    rr[method][kind].append(1 / rank if rank and rank <= 10 else 0.0)
                if not hit5:
                    misses[method].append(
                        f"[{q['tenant']}/{q['kind']}] {q['question']}"
                    )
    finally:
        if not args.keep:
            for tid in tenants.values():
                delete_tenant(tid)

    kinds = ["all", "direct", "paraphrase", "keyword"]
    n = {k: len(recall["vector"][k]) for k in kinds}
    print(
        f"\nIngested {sum(len(v) for v in doc_ids.values())} documents in {ingest_s:.1f}s; "
        f"{n['all']} scored questions ({', '.join(f'{k}={n[k]}' for k in kinds[1:])}), "
        f"{len(cos_out)} out-of-scope\n"
    )
    header = (
        f"{'method':<14}"
        + "".join(f"{'R@5 ' + k:>16}" for k in kinds)
        + f"{'MRR@10 all':>12}{'R@1 all':>10}"
    )
    print(header)
    print("-" * len(header))
    for m in METHODS:
        row = f"{m:<14}" + "".join(
            f"{statistics.mean(recall[m][k]) if recall[m][k] else float('nan'):>16.3f}"
            for k in kinds
        )
        row += f"{statistics.mean(rr[m]['all']):>12.3f}{statistics.mean(top1[m]['all']):>10.3f}"
        print(row)
    print("\nMRR@10 by kind:")
    for m in METHODS:
        print(
            f"  {m:<14}"
            + "  ".join(f"{k}={statistics.mean(rr[m][k]):.3f}" for k in kinds[1:])
        )
    print(
        f"\nTop-1 cosine  in-scope: mean {statistics.mean(cos_in):.3f}, min {min(cos_in):.3f}"
        f" | out-of-scope: mean {statistics.mean(cos_out):.3f}, max {max(cos_out):.3f}"
    )
    print("\nMisses (expected doc not in top 5):")
    for m in ("vector", "keyword(any)", "hybrid(any)"):
        print(f"  {m}: {len(misses[m])}")
        for line in misses[m]:
            print(f"    - {line}")
    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (
        1024 * 1024 if sys.platform == "darwin" else 1024
    )
    print(f"\nPeak RSS of this process: {peak_mb:.0f} MB")


if __name__ == "__main__":
    main()
