"""Grupos da Lounge: cada um é uma sala de voz/vídeo/chat independente (como os canais do Discord).

O servidor NUNCA vê áudio/vídeo: só repassa (sinalização do WebRTC) e o chat de texto. A ligação em
si (voz, câmera, tela) vai direto entre os aplicativos (ponto a ponto). O chat não é gravado: quem
não estava conectado não vê mensagens antigas.

Cada pessoa conectada a um grupo entra primeiro como "observadora" (`mode="text"`): já recebe o chat
e a lista de quem está na chamada de voz, mas ainda não aparece nela. Mandar `join_voice` a promove
a `mode="voice"` (some para os outros até então): só aí ela entra na malha do WebRTC e no chat de
voz. Isso permite acompanhar o chat de um grupo enquanto a chamada de voz está em outro.
"""

import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth
from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models import User, VoiceGroup
from ..schemas import CallInvite, InvitableUser, MemberOut, VoiceGroupCreate, VoiceGroupOut, VoiceGroupUpdate

router = APIRouter(tags=["lounge"])

MAX_CHAT_LENGTH = 2000
MAX_GROUP_NAME_LENGTH = 60
MAX_CAPACITY = 99  # mesmo teto do "limite de usuários" do Discord; 0 = sem limite


def _clamp_capacity(value: int) -> int:
    return max(0, min(MAX_CAPACITY, value))
# Tipos de sinalização do WebRTC: só repassados ao destinatário (`target`), nunca lidos aqui.
_SIGNAL_TYPES = ("offer", "answer", "ice-candidate")


class _Peer:
    __slots__ = ("id", "name", "user_id", "websocket", "mode", "muted")

    def __init__(self, id_: str, name: str, user_id: int, websocket: WebSocket) -> None:
        self.id = id_
        self.name = name
        self.user_id = user_id
        self.websocket = websocket
        self.mode = "text"  # "text" (só chat/presença) | "voice" (na chamada, entra na malha WebRTC)
        self.muted = False


class ConnectionManager:
    """Quem está conectado a cada grupo (`group_id` -> `peer_id` -> `_Peer`), tudo em memória do processo."""

    def __init__(self) -> None:
        self._rooms: dict[int, dict[str, _Peer]] = {}

    def room(self, group_id: int) -> dict[str, _Peer]:
        return self._rooms.setdefault(group_id, {})

    def join(self, group_id: int, peer: _Peer) -> None:
        self.room(group_id)[peer.id] = peer

    def leave(self, group_id: int, peer_id: str) -> None:
        room = self._rooms.get(group_id)
        if room is None:
            return
        room.pop(peer_id, None)
        if not room:
            self._rooms.pop(group_id, None)

    def presence(self, group_id: int) -> list[dict]:
        """Só quem está de fato na chamada de voz (não os que só acompanham o chat)."""
        return [{"id": p.id, "name": p.name, "muted": p.muted} for p in self.room(group_id).values() if p.mode == "voice"]

    async def send(self, peer: _Peer, message: dict) -> bool:
        try:
            await peer.websocket.send_json(message)
            return True
        except Exception:
            return False

    async def broadcast(self, group_id: int, message: dict, exclude: str | None = None) -> None:
        """Para todo mundo conectado ao grupo (chat, presença, avisos) — texto ou voz, tanto faz."""
        room = self.room(group_id)
        dead = [pid for pid, peer in room.items() if pid != exclude and not await self.send(peer, message)]
        for pid in dead:
            room.pop(pid, None)

    async def broadcast_voice(self, group_id: int, message: dict, exclude: str | None = None) -> None:
        """Só para quem está NA CHAMADA (mesh do WebRTC): quem só acompanha o chat não precisa receber."""
        room = self.room(group_id)
        dead = [pid for pid, peer in room.items() if pid != exclude and peer.mode == "voice" and not await self.send(peer, message)]
        for pid in dead:
            room.pop(pid, None)

    async def broadcast_presence(self, group_id: int) -> None:
        await self.broadcast(group_id, {"type": "presence_update", "group_id": group_id, "users": self.presence(group_id)})


manager = ConnectionManager()


class NotifyManager:
    """Canal global (fora de qualquer grupo), um por pessoa logada: usado só para avisar, na hora,
    que alguém te chamou para uma chamada. Não fica guardado — se o app estiver fechado, o convite
    simplesmente não chega (como uma chamada perdida do Discord enquanto você está offline)."""

    def __init__(self) -> None:
        self._sockets: dict[int, WebSocket] = {}

    def connect(self, user_id: int, websocket: WebSocket) -> None:
        self._sockets[user_id] = websocket

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        if self._sockets.get(user_id) is websocket:
            self._sockets.pop(user_id, None)

    def online_ids(self) -> set[int]:
        """Quem está com o app aberto agora (tem esta ligação viva) — usado pela lista de membros."""
        return set(self._sockets.keys())

    async def notify(self, user_id: int, message: dict) -> bool:
        websocket = self._sockets.get(user_id)
        if websocket is None:
            return False
        try:
            await websocket.send_json(message)
            return True
        except Exception:
            self._sockets.pop(user_id, None)
            return False

    async def broadcast(self, message: dict) -> None:
        """Para todo mundo com o app aberto agora (ex.: avisar que alguém ficou online/offline)."""
        dead = []
        for user_id, websocket in list(self._sockets.items()):
            try:
                await websocket.send_json(message)
            except Exception:
                dead.append(user_id)
        for user_id in dead:
            self._sockets.pop(user_id, None)


notify_manager = NotifyManager()


def _lookup_user(token: str | None) -> User | None:
    """Confere o token (vem por query: um WebSocket do navegador/Electron não manda cabeçalhos custom)."""
    if not token:
        return None
    user_id = auth.decode_access_token(token)
    if user_id is None:
        return None
    with SessionLocal() as db:
        return db.get(User, user_id)


def _group_exists(group_id: int) -> bool:
    with SessionLocal() as db:
        return db.get(VoiceGroup, group_id) is not None


def _group_capacity(group_id: int) -> int:
    """0 = sem limite (ou o grupo sumiu entre o connect e o join_voice: trata como sem limite)."""
    with SessionLocal() as db:
        group = db.get(VoiceGroup, group_id)
        return group.capacity if group else 0


# ------------------------------------------------------------------ Grupos (REST)


@router.get("/voice/groups", response_model=list[VoiceGroupOut])
def list_groups(db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> list[VoiceGroup]:
    # Sem categoria (string vazia) primeiro, depois cada categoria em ordem alfabética; dentro de
    # cada uma, na ordem em que os grupos foram criados. A barra lateral só precisa agrupar por igual.
    return list(db.scalars(select(VoiceGroup).order_by(VoiceGroup.category, VoiceGroup.id)))


@router.post("/voice/groups", response_model=VoiceGroupOut, status_code=201)
def create_group(payload: VoiceGroupCreate, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> VoiceGroup:
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Dê um nome ao grupo.")
    icon = (payload.icon or "🎧").strip() or "🎧"
    group = VoiceGroup(
        name=name[:MAX_GROUP_NAME_LENGTH],
        icon=icon[:10],
        category=payload.category.strip()[:MAX_GROUP_NAME_LENGTH],
        capacity=_clamp_capacity(payload.capacity),
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.put("/voice/groups/{group_id}", response_model=VoiceGroupOut)
def update_group(group_id: int, payload: VoiceGroupUpdate, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> VoiceGroup:
    group = db.get(VoiceGroup, group_id)
    if group is None:
        raise HTTPException(404, "Grupo não encontrado.")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(422, "Dê um nome ao grupo.")
        group.name = name[:MAX_GROUP_NAME_LENGTH]
    if payload.icon is not None:
        group.icon = (payload.icon.strip() or "🎧")[:10]
    if payload.category is not None:
        group.category = payload.category.strip()[:MAX_GROUP_NAME_LENGTH]
    if payload.capacity is not None:
        group.capacity = _clamp_capacity(payload.capacity)
    db.commit()
    db.refresh(group)
    return group


@router.get("/voice/invitable-users", response_model=list[InvitableUser])
def list_invitable_users(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[User]:
    """Todo mundo que já tem conta neste servidor, menos você mesmo — para escolher a quem convidar."""
    return list(db.scalars(select(User).where(User.id != user.id).order_by(User.name)))


@router.get("/voice/members", response_model=list[MemberOut])
def list_members(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[MemberOut]:
    """Todo mundo que já tem conta neste servidor (você incluído), com quem está com o app aberto agora
    (barra de membros, estilo Discord — independente de estar numa chamada de voz ou não)."""
    online = notify_manager.online_ids()
    users = db.scalars(select(User).order_by(User.name))
    return [MemberOut(id=u.id, name=u.name, online=u.id in online, is_self=u.id == user.id) for u in users]


@router.post("/voice/groups/{group_id}/invite")
async def invite_to_group(
    group_id: int, payload: CallInvite, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, bool]:
    group = db.get(VoiceGroup, group_id)
    if group is None:
        raise HTTPException(404, "Grupo não encontrado.")
    if payload.user_id == user.id:
        raise HTTPException(422, "Não dá para se convidar sozinho.")
    target = db.get(User, payload.user_id)
    if target is None:
        raise HTTPException(404, "Pessoa não encontrada.")
    delivered = await notify_manager.notify(
        target.id,
        {"type": "call-invite", "group_id": group_id, "group_name": group.name, "from_name": user.name},
    )
    return {"delivered": delivered}


@router.delete("/voice/groups/{group_id}", status_code=204)
async def delete_group(group_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)) -> None:
    group = db.get(VoiceGroup, group_id)
    if group is None:
        raise HTTPException(404, "Grupo não encontrado.")
    db.delete(group)
    db.commit()
    # Quem estiver conectado a esse grupo é avisado e cai (o frontend volta para a lista de grupos).
    await manager.broadcast(group_id, {"type": "group-deleted"})
    manager._rooms.pop(group_id, None)  # noqa: SLF001 (mesmo módulo: sem getter público para isso)


# ------------------------------------------------------------------ WebSocket (voz/vídeo/chat)


@router.websocket("/ws/voice/{group_id}")
async def voice_room(websocket: WebSocket, group_id: int, token: str | None = Query(default=None)) -> None:
    # O ConnectionManager acima é 100% assíncrono (nenhum I/O bloqueante nos métodos dele). Só estas
    # duas consultas SQLite é que são síncronas — e, diferente de uma rota HTTP comum (que o FastAPI
    # já roda numa thread à parte sozinho), aqui estamos dentro de uma função "async def": chamá-las
    # direto travaria o event loop (e com ele TODAS as chamadas de voz) pelo tempinho da consulta.
    # asyncio.to_thread tira as duas do event loop; a rede da sala continua livre o tempo todo.
    user = await asyncio.to_thread(_lookup_user, token)
    if user is None:
        await websocket.close(code=4401)
        return
    if not await asyncio.to_thread(_group_exists, group_id):
        await websocket.close(code=4404)
        return

    await websocket.accept()
    peer_id = uuid4().hex
    peer = _Peer(peer_id, user.name, user.id, websocket)
    manager.join(group_id, peer)

    await manager.send(peer, {"type": "welcome", "id": peer_id, "group_id": group_id})
    await manager.broadcast_presence(group_id)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(message, dict):
                continue
            kind = message.get("type")

            if kind == "join_voice":
                if peer.mode != "voice":
                    capacity = await asyncio.to_thread(_group_capacity, group_id)
                    current = sum(1 for p in manager.room(group_id).values() if p.mode == "voice")
                    if capacity and current >= capacity:
                        await manager.send(peer, {"type": "voice-full", "capacity": capacity})
                    else:
                        peer.mode = "voice"
                        # Quem já estava na chamada: a malha do WebRTC nasce quando o recém-chegado mandar o "offer".
                        voice_peers = [{"id": p.id, "name": p.name} for p in manager.room(group_id).values() if p.mode == "voice" and p.id != peer_id]
                        await manager.send(peer, {"type": "voice_peers", "peers": voice_peers})
                        await manager.broadcast_voice(group_id, {"type": "peer-joined", "id": peer_id, "name": user.name}, exclude=peer_id)
                        await manager.broadcast_presence(group_id)
            elif kind == "leave_voice":
                if peer.mode == "voice":
                    peer.mode = "text"
                    peer.muted = False
                    await manager.broadcast_voice(group_id, {"type": "peer-left", "id": peer_id}, exclude=peer_id)
                    await manager.broadcast_presence(group_id)
            elif kind in _SIGNAL_TYPES:
                # Repassado tal e qual para o destinatário, só trocando quem é o remetente.
                target_id = message.get("target")
                target = manager.room(group_id).get(target_id) if isinstance(target_id, str) else None
                if target is not None:
                    await manager.send(target, {**message, "from": peer_id, "name": user.name})
            elif kind == "chat_message":
                text = str(message.get("text", "")).strip()[:MAX_CHAT_LENGTH]
                if text:
                    await manager.broadcast(
                        group_id,
                        {"type": "chat_message", "id": uuid4().hex, "from": peer_id, "name": user.name, "text": text, "at": datetime.now(timezone.utc).isoformat()},
                    )
            elif kind == "mute-changed":
                peer.muted = bool(message.get("muted"))
                await manager.broadcast_presence(group_id)
    except WebSocketDisconnect:
        pass
    finally:
        was_voice = peer.mode == "voice"
        manager.leave(group_id, peer_id)
        if was_voice:
            await manager.broadcast_voice(group_id, {"type": "peer-left", "id": peer_id})
        await manager.broadcast_presence(group_id)


# ------------------------------------------------------------------ WebSocket (convite para chamada)


@router.websocket("/ws/notify")
async def notify_channel(websocket: WebSocket, token: str | None = Query(default=None)) -> None:
    """Uma ligação por pessoa, fora de qualquer grupo: recebe convites de chamada na hora e também os
    avisos de "fulano ficou online/offline" (barra de membros, estilo Discord — ver GET /voice/members
    para a lista completa; aqui só chegam as MUDANÇAS, ao vivo)."""
    user = await asyncio.to_thread(_lookup_user, token)
    if user is None:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    notify_manager.connect(user.id, websocket)
    await notify_manager.broadcast({"type": "presence", "online_ids": sorted(notify_manager.online_ids())})
    try:
        while True:
            await websocket.receive_text()  # nada esperado do cliente: só mantém a ligação viva
    except WebSocketDisconnect:
        pass
    finally:
        notify_manager.disconnect(user.id, websocket)
        await notify_manager.broadcast({"type": "presence", "online_ids": sorted(notify_manager.online_ids())})
