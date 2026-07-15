#!/usr/bin/env python3
r"""End-to-end test of the click-to-approve connector loop.

Walks the exact path an MCP client (ChatGPT, Claude) takes:
    discovery -> dynamic client registration -> sign in -> consent approval ->
    PKCE token exchange -> authenticated MCP initialize + tools/list -> refresh
    rotation -> replay rejection and family revocation.

Run against a dev server with AUTH_DEV_LOGIN=1 (dev-login must be enabled;
it is off on production, so this script cannot run against prod):

    python3 scripts/test-oauth-mcp-loop.py [base-url]   # default http://localhost:3000

Each run registers one OAuth client named "Connector Loop Test" and mints two
short-lived access tokens in one refresh family. Clean them up afterwards
(the command loads DATABASE_URL from .env.local):

    node --input-type=module -e "import pkg from '@next/env';import{neon}from'@neondatabase/serverless';pkg.loadEnvConfig(process.cwd(),true,{info(){},error(){}});const s=neon(process.env.DATABASE_URL);await s\`DELETE FROM api_tokens WHERE name = 'OAuth: Connector Loop Test'\`;await s\`DELETE FROM oauth_authorization_codes WHERE client_id IN (SELECT client_id FROM oauth_clients WHERE client_name = 'Connector Loop Test')\`;await s\`DELETE FROM oauth_refresh_token_families WHERE client_id IN (SELECT client_id FROM oauth_clients WHERE client_name = 'Connector Loop Test')\`;await s\`DELETE FROM oauth_clients WHERE client_name = 'Connector Loop Test'\`"

This loop is what caught the Response.redirect() immutable-headers bug that
500ed every OAuth approval, so keep it passing.
"""
import base64
import hashlib
import http.cookiejar
import json
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:3000"
REDIRECT = "https://connector-test.example.com/callback"
DEV_EMAIL = "connector-loop-test@example.com"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


no_redirect_opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(jar), NoRedirect
)


def call(op, url, data=None, headers=None, form=False):
    body = None
    h = dict(headers or {})
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url, data=body, headers=h, method="POST" if body is not None else "GET"
    )
    try:
        res = op.open(req)
        return res.getcode(), dict(res.headers), res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


def fail(step, code, body):
    print(f"FAIL at {step}: HTTP {code}\n{body[:500]}")
    sys.exit(1)


# 0. Discovery chain: the 401 breadcrumb and both metadata documents.
code, headers, body = call(opener, f"{BASE}/api/mcp", {
    "jsonrpc": "2.0", "method": "initialize", "id": 0,
    "params": {"protocolVersion": "2025-06-18", "capabilities": {},
               "clientInfo": {"name": "probe", "version": "0"}},
}, headers={"Accept": "application/json, text/event-stream"})
www = headers.get("WWW-Authenticate", headers.get("www-authenticate", ""))
if code != 401 or "resource_metadata=" not in www:
    fail("discovery-401", code, f"WWW-Authenticate: {www}")
prm_url = re.search(r'resource_metadata="([^"]+)"', www).group(1)
code, _, body = call(opener, prm_url)
if code != 200:
    fail("protected-resource-metadata", code, body)
prm = json.loads(body)
if set(prm.get("scopes_supported", [])) != {"read", "sync"}:
    fail("protected-resource-scopes", code, body)
auth_server = prm["authorization_servers"][0]
code, _, body = call(opener, f"{auth_server}/.well-known/oauth-authorization-server")
auth_metadata = json.loads(body)
if (
    code != 200
    or "registration_endpoint" not in auth_metadata
    or set(auth_metadata.get("scopes_supported", [])) != {"read", "sync"}
    or "refresh_token" not in auth_metadata.get("grant_types_supported", [])
):
    fail("authorization-server-metadata", code, body)
print(f"0. discovery chain ok: 401 -> {prm_url} -> {auth_server}")

# 1. Dynamic client registration.
code, _, body = call(opener, f"{BASE}/oauth/register", {
    "client_name": "Connector Loop Test",
    "redirect_uris": [REDIRECT],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "token_endpoint_auth_method": "none",
    "scope": "sync",
})
if code not in (200, 201):
    fail("register", code, body)
client_id = json.loads(body)["client_id"]
print(f"1. registered: {client_id}")

# 2. Sign in via dev-login.
code, _, body = call(opener, f"{BASE}/api/auth/csrf")
csrf = json.loads(body)["csrfToken"]
call(opener, f"{BASE}/api/auth/callback/dev-login", {
    "csrfToken": csrf,
    "email": DEV_EMAIL,
    "name": "Connector Loop Test",
    "callbackUrl": "/start",
}, form=True)
code, _, body = call(opener, f"{BASE}/api/auth/session")
session = json.loads(body)
if not session.get("user"):
    fail("signin (is AUTH_DEV_LOGIN=1 set?)", code, body)
print(f"2. signed in: {session['user']['email']}")

# 3. PKCE pair.
verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
challenge = (
    base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
    .rstrip(b"=")
    .decode()
)

# 4. Approve: the user's one click on the consent page.
read_consent_query = urllib.parse.urlencode({
    "response_type": "code",
    "client_id": client_id,
    "redirect_uri": REDIRECT,
    "scope": "read",
    "code_challenge": challenge,
    "code_challenge_method": "S256",
})
code, _, body = call(opener, f"{BASE}/oauth/authorize?{read_consent_query}")
if (
    code != 200
    or "Read-only" not in body
    or "cannot create or change it" not in body
):
    fail("read-only-consent", code, body)

authorize_query = urllib.parse.urlencode({
    "response_type": "code",
    "client_id": client_id,
    "redirect_uri": REDIRECT,
    "scope": "sync",
    "code_challenge": challenge,
    "code_challenge_method": "S256",
    "state": "teststate123",
})
code, _, body = call(opener, f"{BASE}/oauth/authorize?{authorize_query}")
if (
    code != 200
    or "Connector Loop Test" not in body
    or "Read/write" not in body
    or "view, create, and change content" not in body
    or "/oauth/authorize/approve" not in body
):
    fail("consent", code, body)

code, headers, body = call(no_redirect_opener, f"{BASE}/oauth/authorize/approve", {
    "decision": "approve",
    "response_type": "code",
    "client_id": client_id,
    "redirect_uri": REDIRECT,
    "scope": "sync",
    "code_challenge": challenge,
    "code_challenge_method": "S256",
    "state": "teststate123",
}, form=True, headers={"Origin": BASE, "Referer": f"{BASE}/oauth/authorize"})
location = headers.get("Location") or headers.get("location")
if code not in (302, 303, 307) or not location:
    fail("approve", code, body)
q = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
auth_code = q.get("code", [""])[0]
if not auth_code or q.get("state", [""])[0] != "teststate123":
    fail("approve-redirect", code, location)
print(f"3. approved -> code {auth_code[:10]}... state ok")

# 5. Token exchange.
code, _, body = call(opener, f"{BASE}/oauth/token", {
    "grant_type": "authorization_code",
    "code": auth_code,
    "redirect_uri": REDIRECT,
    "client_id": client_id,
    "code_verifier": verifier,
}, form=True)
if code != 200:
    fail("token", code, body)
tok = json.loads(body)
token = tok["access_token"]
refresh_token = tok.get("refresh_token", "")
if (
    tok.get("expires_in") != 3600
    or tok.get("scope") != "sync"
    or not refresh_token.startswith("wrt_")
):
    fail("token-shape", code, body)
print(f"4. token: {token[:8]}... type={tok['token_type']} scope={tok['scope']}")

# 6. Authenticated MCP calls.
mcp_headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/json, text/event-stream",
}
code, _, body = call(opener, f"{BASE}/api/mcp", {
    "jsonrpc": "2.0", "method": "initialize", "id": 1,
    "params": {"protocolVersion": "2025-06-18", "capabilities": {},
               "clientInfo": {"name": "loop-test", "version": "0"}},
}, headers=mcp_headers)
if code != 200 or "serverInfo" not in body:
    fail("mcp-initialize", code, body)
print("5. MCP initialize: ok")

code, _, body = call(opener, f"{BASE}/api/mcp", {
    "jsonrpc": "2.0", "method": "tools/list", "id": 2, "params": {},
}, headers=mcp_headers)
if code != 200:
    fail("mcp-tools", code, body)
tools = re.findall(r'"name":"([a-z_]+)"', body)
print(f"6. MCP tools/list: {tools}")

# 7. Rotate the refresh token and use the replacement access token.
code, _, body = call(opener, f"{BASE}/oauth/token", {
    "grant_type": "refresh_token",
    "refresh_token": refresh_token,
    "client_id": client_id,
}, form=True)
if code != 200:
    fail("refresh", code, body)
rotated = json.loads(body)
rotated_token = rotated.get("access_token", "")
rotated_refresh = rotated.get("refresh_token", "")
if (
    rotated_token == token
    or rotated_refresh == refresh_token
    or rotated.get("expires_in") != 3600
    or rotated.get("scope") != "sync"
):
    fail("refresh-shape", code, body)

rotated_headers = {
    "Authorization": f"Bearer {rotated_token}",
    "Accept": "application/json, text/event-stream",
}
code, _, body = call(opener, f"{BASE}/api/mcp", {
    "jsonrpc": "2.0", "method": "tools/list", "id": 3, "params": {},
}, headers=rotated_headers)
if code != 200:
    fail("mcp-tools-after-refresh", code, body)
print("7. refresh rotation + MCP authentication: ok")

# 8. Reusing the consumed refresh token revokes the complete family.
code, _, body = call(opener, f"{BASE}/oauth/token", {
    "grant_type": "refresh_token",
    "refresh_token": refresh_token,
    "client_id": client_id,
}, form=True)
replay = json.loads(body)
if code != 400 or replay.get("error") != "invalid_grant":
    fail("refresh-replay", code, body)

code, _, body = call(opener, f"{BASE}/api/mcp", {
    "jsonrpc": "2.0", "method": "tools/list", "id": 4, "params": {},
}, headers=rotated_headers)
if code != 401:
    fail("refresh-replay-family-revocation", code, body)

code, _, body = call(opener, f"{BASE}/api/mcp", {
    "jsonrpc": "2.0", "method": "tools/list", "id": 5, "params": {},
}, headers=mcp_headers)
if code != 401:
    fail("refresh-replay-original-access-revocation", code, body)
print("8. replay rejected and token family revoked: ok")
print("\nCLICK-TO-APPROVE LOOP: PASS")
