"""
Moorcheh Memory Service for 6ixthSense / UrbanSim Toronto

FastAPI microservice that wraps the moorcheh-sdk to provide:
- Document ingestion into namespaces (regulatory-docs, impact-analyses)
- Similarity search over past analyses
- Grounded chat (answer generation) over all stored memory
- Analysis storage (every impact analysis becomes searchable memory)
"""

import os
import json
import time
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ---------------------------------------------------------------------------
# Moorcheh SDK setup
# ---------------------------------------------------------------------------
from moorcheh import Client as MoorchehClient

MOORCHEH_API_KEY = os.getenv("MOORCHEH_API_KEY", "")

if not MOORCHEH_API_KEY:
    print("WARNING: MOORCHEH_API_KEY not set. Set it in .env to enable memory features.")

client: Optional[MoorchehClient] = None

NAMESPACES = {
    "regulatory": "regulatory-docs",
    "analyses": "impact-analyses",
    "community": "community-data",
}


def get_client() -> MoorchehClient:
    global client
    if client is None:
        if not MOORCHEH_API_KEY:
            raise HTTPException(status_code=503, detail="MOORCHEH_API_KEY not configured")
        client = MoorchehClient(api_key=MOORCHEH_API_KEY)
    return client


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class IngestRequest(BaseModel):
    namespace: str = Field(description="Namespace: 'regulatory', 'analyses', or 'community'")
    content: str = Field(description="Document text content")
    metadata: dict = Field(default_factory=dict, description="Document metadata")
    document_id: Optional[str] = Field(default=None, description="Optional document ID")


class SearchRequest(BaseModel):
    namespace: str = Field(description="Namespace to search in")
    query: str = Field(description="Search query text")
    top_k: int = Field(default=3, description="Number of results to return")


class ChatRequest(BaseModel):
    query: str = Field(description="User's question")
    history: list[dict] = Field(default_factory=list, description="Chat history [{role, content}]")
    namespaces: list[str] = Field(
        default=["regulatory", "analyses"],
        description="Namespaces to ground answers in",
    )


class SimilarRequest(BaseModel):
    location: list[float] = Field(description="[lng, lat] of the building")
    building_type: str = Field(default="", description="Type of building")
    height: float = Field(default=0, description="Building height in meters")
    footprint: float = Field(default=0, description="Building footprint in m²")
    top_k: int = Field(default=3, description="Number of similar results")


class StoreAnalysisRequest(BaseModel):
    location: list[float] = Field(description="[lng, lat]")
    building_type: str = Field(default="unknown")
    height: float = Field(default=0)
    footprint: float = Field(default=0)
    stories: int = Field(default=0)
    traffic_impact: dict = Field(default_factory=dict)
    air_quality: dict = Field(default_factory=dict)
    noise: dict = Field(default_factory=dict)
    economic_impact: dict = Field(default_factory=dict)
    overall_risk: str = Field(default="medium")
    severity: int = Field(default=5)
    narrative: str = Field(default="")
    timestamp: Optional[str] = Field(default=None)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Moorcheh Memory Service starting...")
    if MOORCHEH_API_KEY:
        print(f"  MOORCHEH_API_KEY: Set ({MOORCHEH_API_KEY[:8]}...)")
    else:
        print("  MOORCHEH_API_KEY: NOT SET")
    print(f"  Namespaces: {list(NAMESPACES.values())}")
    yield
    print("Moorcheh Memory Service shutting down.")


app = FastAPI(
    title="6ixthSense Moorcheh Memory Service",
    description="Community memory layer for urban impact analysis",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "moorcheh_configured": bool(MOORCHEH_API_KEY),
        "namespaces": NAMESPACES,
    }


# ---------------------------------------------------------------------------
# Ingest document
# ---------------------------------------------------------------------------
@app.post("/ingest")
async def ingest_document(req: IngestRequest):
    mc = get_client()
    ns = NAMESPACES.get(req.namespace, req.namespace)

    try:
        result = mc.documents.upload(
            namespace=ns,
            content=req.content,
            metadata=req.metadata,
            document_id=req.document_id,
        )
        return {
            "success": True,
            "namespace": ns,
            "document_id": getattr(result, "document_id", req.document_id),
            "message": f"Document ingested into {ns}",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")


# ---------------------------------------------------------------------------
# Similarity search
# ---------------------------------------------------------------------------
@app.post("/search")
async def search_documents(req: SearchRequest):
    mc = get_client()
    ns = NAMESPACES.get(req.namespace, req.namespace)

    try:
        results = mc.similarity_search.query(
            namespace=ns,
            query=req.query,
            top_k=req.top_k,
        )
        # Normalize results to a consistent format
        docs = []
        for r in results:
            docs.append({
                "content": getattr(r, "content", str(r)),
                "metadata": getattr(r, "metadata", {}),
                "score": getattr(r, "score", 0),
            })
        return {"success": True, "namespace": ns, "results": docs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


# ---------------------------------------------------------------------------
# Chat (grounded answer generation)
# ---------------------------------------------------------------------------
@app.post("/chat")
async def chat(req: ChatRequest):
    mc = get_client()
    namespaces = [NAMESPACES.get(ns, ns) for ns in req.namespaces]

    try:
        result = mc.answer.generate(
            query=req.query,
            namespaces=namespaces,
            chat_history=req.history if req.history else None,
        )
        return {
            "success": True,
            "answer": getattr(result, "answer", str(result)),
            "sources": getattr(result, "sources", []),
            "namespaces_used": namespaces,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


# ---------------------------------------------------------------------------
# Find similar past analyses
# ---------------------------------------------------------------------------
@app.post("/similar")
async def find_similar(req: SimilarRequest):
    mc = get_client()
    ns = NAMESPACES["analyses"]

    # Build a query that describes the building for semantic similarity
    query_parts = []
    if req.building_type:
        query_parts.append(f"{req.building_type} building")
    if req.height > 0:
        query_parts.append(f"{req.height}m tall")
    if req.footprint > 0:
        query_parts.append(f"{req.footprint}m² footprint")
    if req.location and len(req.location) == 2:
        query_parts.append(f"at coordinates {req.location[1]:.4f}N, {req.location[0]:.4f}W")

    query = "Urban impact analysis for a " + ", ".join(query_parts) if query_parts else "building impact analysis"

    try:
        results = mc.similarity_search.query(
            namespace=ns,
            query=query,
            top_k=req.top_k,
        )

        analyses = []
        for r in results:
            content = getattr(r, "content", str(r))
            metadata = getattr(r, "metadata", {})
            score = getattr(r, "score", 0)

            # Try to parse stored analysis data from content
            try:
                parsed = json.loads(content) if isinstance(content, str) and content.startswith("{") else {}
            except (json.JSONDecodeError, TypeError):
                parsed = {}

            analyses.append({
                "content": content,
                "metadata": metadata,
                "score": score,
                "parsed": parsed,
            })

        return {"success": True, "results": analyses, "query_used": query}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Similar search failed: {str(e)}")


# ---------------------------------------------------------------------------
# Store a completed analysis as memory
# ---------------------------------------------------------------------------
@app.post("/store-analysis")
async def store_analysis(req: StoreAnalysisRequest):
    mc = get_client()
    ns = NAMESPACES["analyses"]

    ts = req.timestamp or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Build rich document content for semantic search
    content = json.dumps({
        "type": "impact_analysis",
        "location": {"lng": req.location[0], "lat": req.location[1]},
        "building": {
            "type": req.building_type,
            "height": req.height,
            "footprint": req.footprint,
            "stories": req.stories,
        },
        "impacts": {
            "traffic": req.traffic_impact,
            "air_quality": req.air_quality,
            "noise": req.noise,
            "economic": req.economic_impact,
        },
        "overall": {
            "risk": req.overall_risk,
            "severity": req.severity,
        },
        "narrative": req.narrative,
        "timestamp": ts,
    })

    metadata = {
        "type": "impact_analysis",
        "building_type": req.building_type,
        "lat": str(req.location[1]) if len(req.location) > 1 else "0",
        "lng": str(req.location[0]) if len(req.location) > 0 else "0",
        "risk_level": req.overall_risk,
        "severity": str(req.severity),
        "timestamp": ts,
    }

    doc_id = f"analysis-{req.location[1]:.4f}-{req.location[0]:.4f}-{int(time.time())}"

    try:
        result = mc.documents.upload(
            namespace=ns,
            content=content,
            metadata=metadata,
            document_id=doc_id,
        )
        return {
            "success": True,
            "document_id": doc_id,
            "namespace": ns,
            "message": "Analysis stored in community memory",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage failed: {str(e)}")


# ---------------------------------------------------------------------------
# Get aggregate neighborhood stats
# ---------------------------------------------------------------------------
@app.post("/neighborhood-stats")
async def neighborhood_stats(req: SearchRequest):
    mc = get_client()
    ns = NAMESPACES["analyses"]

    try:
        results = mc.similarity_search.query(
            namespace=ns,
            query=req.query,
            top_k=min(req.top_k, 20),
        )

        analyses = []
        total_severity = 0
        risk_counts = {"low": 0, "medium": 0, "high": 0, "critical": 0}
        building_types = {}

        for r in results:
            content = getattr(r, "content", str(r))
            try:
                parsed = json.loads(content) if isinstance(content, str) and content.startswith("{") else None
            except (json.JSONDecodeError, TypeError):
                parsed = None

            if parsed and parsed.get("type") == "impact_analysis":
                analyses.append(parsed)
                severity = parsed.get("overall", {}).get("severity", 5)
                risk = parsed.get("overall", {}).get("risk", "medium")
                total_severity += severity
                risk_counts[risk] = risk_counts.get(risk, 0) + 1
                bt = parsed.get("building", {}).get("type", "unknown")
                building_types[bt] = building_types.get(bt, 0) + 1

        count = len(analyses)
        return {
            "success": True,
            "total_analyses": count,
            "average_severity": round(total_severity / count, 1) if count > 0 else 0,
            "risk_distribution": risk_counts,
            "building_types": building_types,
            "analyses": analyses[:5],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Neighborhood stats failed: {str(e)}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
