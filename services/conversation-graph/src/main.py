"""Conversation-graph service: TTS-aware discussion clustering."""
import os
from typing import Optional

from fastapi import FastAPI, Request
from pydantic import BaseModel

from .graph import Graph, Message

app = FastAPI(title="Conversation Graph Service", version="0.1.0")
graph = Graph()
TOKEN = os.environ.get("STREAM_INGEST_TOKEN", "")


class IngestMsg(BaseModel):
    id: str
    guild_id: str
    channel_id: str
    author_id: str
    content: str
    ts: float
    reply_to: Optional[str] = None
    mentions: list = []
    thread_id: Optional[str] = None
    privacy: str = "public_channel"


def authed(request: Request) -> bool:
    return not TOKEN or request.headers.get("x-stream-token") == TOKEN


@app.get("/health")
async def health():
    return {"status": "ok", "conversations": len(graph.conversations),
            "messages": len(graph.messages)}


@app.post("/ingest")
async def ingest(msg: IngestMsg, request: Request):
    if not authed(request):
        return {"error": "unauthorized"}, 401
    conv_id = graph.ingest(Message(**msg.model_dump()))
    return {"conversation_id": conv_id}


@app.get("/conversations")
async def conversations(guild_id: str, request: Request, limit: int = 10):
    if not authed(request):
        return {"error": "unauthorized"}, 401
    return [
        {
            "conversation_id": c.id,
            "channel_id": c.channel_id,
            "participants": sorted(c.participants, key=c.participants.get, reverse=True),
            "message_count": len(c.messages),
            "activity": c.activity,
            "branch_score": graph.branch_score(c.id),
            "last_activity": c.last_activity,
        }
        for c in graph.active(guild_id, limit)
    ]


@app.get("/branch/{conversation_id}")
async def branch(conversation_id: int, request: Request, viewer_id: str = ""):
    if not authed(request):
        return {"error": "unauthorized"}, 401
    result = graph.resolve(conversation_id)
    result["messages"] = [
        {"id": m.id, "author_id": m.author_id, "content": m.content,
         "ts": m.ts, "reply_to": m.reply_to, "mentions": m.mentions}
        for m in result["messages"]
    ]
    return result


@app.get("/tts/next")
async def tts_next(guild_id: str, request: Request):
    if not authed(request):
        return {"error": "unauthorized"}, 401
    convs = graph.active(guild_id, 1)
    if not convs:
        return {"conversation_id": None, "messages": []}
    return await branch(convs[0].id, request)


@app.post("/privacy/delete-user")
async def delete_user(request: Request, guild_id: str, user_id: str):
    if not authed(request):
        return {"error": "unauthorized"}, 401
    return {"redacted": graph.redact_user(guild_id, user_id)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8200)))
