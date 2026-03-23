"""
Master Zebu Session - One shared broker session for market data.
"""

import asyncio
import hashlib
import json
import logging
from typing import Optional

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)

MASTER_SESSION_ID = "__master__"


async def _quickauth_login(
    zebu_uid: str,
    password: str,
    totp: str,
    api_secret: str,
    vendor_code: str = "",
) -> Optional[str]:
    appkey = hashlib.sha256(f"{zebu_uid}|{api_secret}".encode()).hexdigest()
    pwd_hash = hashlib.sha256(password.encode()).hexdigest()

    payload = {
        "apkversion": "1.0.0",
        "uid": zebu_uid,
        "pwd": pwd_hash,
        "factor2": totp,
        "vc": vendor_code or zebu_uid,
        "appkey": appkey,
        "imei": "alphasync",
        "source": "API",
    }

    hosts = []
    seen = set()
    for host in [
        settings.ZEBU_API_URL,
        "https://go.mynt.in/NorenWClientTP",
        "https://api.zebull.in/NorenWClientTP",
    ]:
        normalized = host.rstrip("/")
        if normalized not in seen:
            seen.add(normalized)
            hosts.append(normalized)

    jdata = "jData=" + json.dumps(payload)
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    last_error = None

    async with httpx.AsyncClient(timeout=20.0) as client:
        for host in hosts:
            url = f"{host}/QuickAuth"
            try:
                logger.info(f"Master Zebu QuickAuth -> {url} uid={zebu_uid}")
                response = await client.post(url, data=jdata, headers=headers)
                if response.status_code != 200:
                    last_error = f"HTTP {response.status_code}"
                    continue
                if not response.text or not response.text.strip():
                    last_error = "Empty response"
                    continue
                data = response.json()
                if data.get("stat") == "Ok" and data.get("susertoken"):
                    return data["susertoken"]
                last_error = data.get("emsg", "Authentication failed")
            except Exception as error:
                last_error = str(error)

    logger.error(f"Master Zebu QuickAuth failed: {last_error}")
    return None


class MasterSessionService:
    def __init__(self):
        self._provider = None
        self._initialized = False
        self._lock = asyncio.Lock()

    async def initialize(self) -> bool:
        async with self._lock:
            if self._initialized:
                return True

            required = {
                "ZEBU_MASTER_USER_ID": settings.ZEBU_MASTER_USER_ID,
                "ZEBU_MASTER_PASSWORD": settings.ZEBU_MASTER_PASSWORD,
                "ZEBU_MASTER_DOB": settings.ZEBU_MASTER_DOB,
                "ZEBU_API_SECRET": settings.ZEBU_API_SECRET,
            }
            missing = [key for key, value in required.items() if not value]
            if missing:
                logger.warning(f"Master Zebu session skipped - missing env vars: {missing}")
                return False

            try:
                from providers.zebu_provider import ZebuProvider
                from services.broker_session import broker_session_manager

                session_token = await _quickauth_login(
                    zebu_uid=settings.ZEBU_MASTER_USER_ID,
                    password=settings.ZEBU_MASTER_PASSWORD,
                    totp=settings.ZEBU_MASTER_DOB,
                    api_secret=settings.ZEBU_API_SECRET,
                    vendor_code=settings.ZEBU_VENDOR_CODE or settings.ZEBU_MASTER_USER_ID,
                )
                if not session_token:
                    return False

                provider = ZebuProvider(
                    ws_url=settings.ZEBU_WS_URL,
                    user_id=settings.ZEBU_MASTER_USER_ID,
                    api_key=settings.ZEBU_API_SECRET,
                    session_token=session_token,
                    api_url=settings.ZEBU_API_URL,
                )
                await provider.start()

                broker_session_manager.register_session(MASTER_SESSION_ID, provider)
                self._provider = provider
                self._initialized = True
                logger.info("Master Zebu session active - live NSE data available")
                return True
            except Exception as error:
                logger.error(f"Master Zebu session initialization failed: {error}", exc_info=True)
                return False

    async def refresh(self) -> bool:
        async with self._lock:
            self._initialized = False
            self._provider = None
        return await self.initialize()

    def is_active(self) -> bool:
        return self._initialized and self._provider is not None

    def get_provider(self):
        return self._provider


master_session_service = MasterSessionService()
