"""Conversation graph engine: clusters lounge messages into
micro-conversations and resolves TTS reading branches."""
import math
import re
import time
from dataclasses import dataclass, field
from typing import Optional

REPLY_W, MENTION_W, SEMANTIC_W, CONTINUITY_W, TEMPORAL_W = 0.25, 0.20, 0.35, 0.10, 0.10
ASSIGN_THRESHOLD = 0.45
DRIFT_THRESHOLD = 0.7
HALF_LIFE_S = 300.0


@dataclass
class Message:
    id: str
    guild_id: str
    channel_id: str
    author_id: str
    content: str
    ts: float
    reply_to: Optional[str] = None
    mentions: list = field(default_factory=list)
    thread_id: Optional[str] = None
    privacy: str = "public_channel"
    deleted: bool = False
    conversation_id: Optional[int] = None


@dataclass
class Conversation:
    id: int
    guild_id: str
    channel_id: str
    topic_words: set = field(default_factory=set)
    participants: dict = field(default_factory=dict)  # user_id -> participation score
    messages: list = field(default_factory=list)
    children: dict = field(default_factory=dict)      # msg_id -> [child msg_ids]
    recent_speakers: list = field(default_factory=list)
    last_activity: float = 0.0
    parent_id: Optional[int] = None

    @property
    def activity(self) -> float:
        return math.exp(-max(0.0, time.time() - self.last_activity) / HALF_LIFE_S)


def _tokens(text: str) -> set:
    return {t for t in re.findall(r"[a-z0-9']+", text.lower()) if len(t) > 3}


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


class Graph:
    def __init__(self):
        self.conversations: dict[int, Conversation] = {}
        self.messages: dict[str, Message] = {}
        self._next_id = 1

    # ---- scoring ----
    def _reply_aff(self, m: Message, c: Conversation) -> float:
        return 1.0 if m.reply_to and m.reply_to in c.messages else 0.0

    def _mention_aff(self, m: Message, c: Conversation) -> float:
        s = 0.0
        for u in m.mentions:
            if u in c.participants:
                s += 1.0
            if u in c.recent_speakers:
                s += 1.5
        return min(s, 2.5) / 2.5

    def _continuity(self, m: Message, c: Conversation) -> float:
        return 0.7 if m.author_id in c.participants else 0.0

    def _score(self, m: Message, c: Conversation) -> float:
        sem = _jaccard(_tokens(m.content), c.topic_words)
        temp = c.activity
        return (
            SEMANTIC_W * sem
            + REPLY_W * self._reply_aff(m, c)
            + MENTION_W * self._mention_aff(m, c)
            + CONTINUITY_W * self._continuity(m, c)
            + TEMPORAL_W * temp
        )

    # ---- ingest ----
    def ingest(self, m: Message, acl_visible: bool = True) -> int:
        if not acl_visible:
            return -1
        candidates = [
            c for c in self.conversations.values()
            if c.guild_id == m.guild_id and (c.channel_id == m.channel_id or m.thread_id)
            and time.time() - c.last_activity < 1800
        ]
        # explicit reply/thread anchors first
        best, best_score = None, 0.0
        for c in candidates:
            if m.reply_to and m.reply_to in c.messages:
                best, best_score = c, 1.0
                break
            s = self._score(m, c)
            if s > best_score:
                best, best_score = c, s
        if best is None or best_score < ASSIGN_THRESHOLD:
            best = Conversation(id=self._next_id, guild_id=m.guild_id,
                                channel_id=m.channel_id, last_activity=m.ts)
            self.conversations[best.id] = best
            self._next_id += 1
        elif best_score < DRIFT_THRESHOLD and m.reply_to is None:
            # topic drift: mark lineage on the parent conversation
            best.parent_id = best.parent_id or None
        m.conversation_id = best.id
        best.messages.append(m.id)
        best.children.setdefault(m.id, [])
        if m.reply_to in best.children:
            best.children[m.reply_to].append(m.id)
        elif m.reply_to:
            best.children[m.reply_to] = [m.id]
        best.topic_words |= _tokens(m.content)
        p = best.participants.get(m.author_id, 0.0)
        best.participants[m.author_id] = min(1.0, p + 0.35)
        for u in m.mentions:
            best.participants[u] = max(best.participants.get(u, 0.0), 0.45)
        if m.author_id in best.recent_speakers:
            best.recent_speakers.remove(m.author_id)
        best.recent_speakers.insert(0, m.author_id)
        del best.recent_speakers[8:]
        best.last_activity = m.ts
        self.messages[m.id] = m
        return best.id

    # ---- branch resolver (ACL-aware DFS) ----
    def resolve(self, conv_id: int, can_read=lambda m: True) -> dict:
        c = self.conversations.get(conv_id)
        if not c:
            return {"conversation_id": conv_id, "messages": [], "crossed_private_boundary": False}
        roots = [mid for mid in c.messages if self.messages[mid].reply_to not in c.messages]
        out, crossed = [], False
        for root in roots:
            stack = [root]
            while stack:
                mid = stack.pop()
                m = self.messages[mid]
                if m.deleted:
                    continue
                if not can_read(m):
                    crossed = True
                    continue
                out.append(m)
                for ch in sorted(c.children.get(mid, []), key=lambda x: self.messages[x].ts):
                    stack.append(ch)
        return {"conversation_id": conv_id, "crossed_private_boundary": crossed,
                "participants": sorted(c.participants, key=c.participants.get, reverse=True),
                "messages": out}

    def branch_score(self, conv_id: int) -> float:
        c = self.conversations.get(conv_id)
        if not c:
            return 0.0
        return (c.activity * len(c.messages)
                + len([p for p in c.participants.values() if p > 0.5]) * 0.25
                + sum(len(self.messages[mid].mentions) for mid in c.messages) * 0.5)

    def active(self, guild_id: str, limit: int = 10) -> list:
        convs = [c for c in self.conversations.values() if c.guild_id == guild_id]
        convs.sort(key=lambda c: self.branch_score(c.id), reverse=True)
        return convs[:limit]

    # ---- GDPR ----
    def redact_user(self, guild_id: str, user_id: str) -> int:
        n = 0
        for m in self.messages.values():
            if m.guild_id == guild_id and m.author_id == user_id:
                m.content, m.deleted = "", True
                n += 1
        return n
