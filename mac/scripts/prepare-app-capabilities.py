#!/usr/bin/env python3
"""Select and prepare main-app capabilities without reading signing material."""

from __future__ import annotations

import argparse
import plistlib
import sys
from pathlib import Path
from typing import Any


STORE_REQUIRED = {
    "com.apple.security.app-sandbox",
    "com.apple.security.network.client",
    "com.apple.security.network.server",
    "com.apple.security.files.user-selected.read-write",
}
PROFILE_GATED = {
    "com.apple.developer.applesignin",
    "com.apple.security.application-groups",
    "keychain-access-groups",
    "com.apple.application-identifier",
    "com.apple.developer.team-identifier",
}


def select_mode(
    edition: str, profile_available: bool, signing_id: str, app_group: str = ""
) -> str:
    if edition not in {"store", "standalone"}:
        raise ValueError(f"unknown app edition: {edition}")
    if profile_available and signing_id != "-" and (edition == "store" or app_group):
        return "provisioned"
    if edition == "store":
        if signing_id != "-":
            raise ValueError("a signed Store build requires its provisioning profile")
        return "local-store"
    return "local-standalone"


def _load(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        values = plistlib.load(handle)
    if not isinstance(values, dict):
        raise ValueError(f"expected a plist dictionary: {path}")
    return values


def _dump(path: Path, values: dict[str, Any]) -> None:
    with path.open("wb") as handle:
        plistlib.dump(values, handle, fmt=plistlib.FMT_XML, sort_keys=True)


def _require_store_grants(entitlements: dict[str, Any]) -> None:
    missing = sorted(key for key in STORE_REQUIRED if entitlements.get(key) is not True)
    if missing:
        raise ValueError("Store sandbox build is missing required grants: " + ", ".join(missing))


def prepare_entitlements(
    source: dict[str, Any],
    *,
    mode: str,
    edition: str,
    bundle_id: str,
    team: str,
    app_group: str,
    keychain_group: str,
) -> dict[str, Any]:
    if mode == "local-store":
        _require_store_grants(source)
        unknown = sorted(set(source) - STORE_REQUIRED - PROFILE_GATED)
        if unknown:
            raise ValueError("unclassified local Store entitlements: " + ", ".join(unknown))
        return {key: source[key] for key in STORE_REQUIRED}

    if mode == "local-standalone":
        return {}

    if mode != "provisioned":
        raise ValueError(f"unknown capability mode: {mode}")

    result = dict(source)
    if app_group:
        result["com.apple.security.application-groups"] = [app_group]
    else:
        result.pop("com.apple.security.application-groups", None)
    if keychain_group:
        result["keychain-access-groups"] = [keychain_group]
    else:
        result.pop("keychain-access-groups", None)

    for key, expected in (
        ("com.apple.security.application-groups", "TEXTTEXT_APP_GROUP"),
        ("keychain-access-groups", "TEXTTEXT_KEYCHAIN_GROUP"),
    ):
        values = result.get(key)
        if values == [expected]:
            result.pop(key, None)

    if edition == "store":
        _require_store_grants(result)
        if result.get("com.apple.developer.applesignin") != ["Default"]:
            raise ValueError("provisioned Store entitlement source must retain Sign in with Apple")
        if not team or not bundle_id:
            raise ValueError("provisioned Store entitlements require a team and bundle identifier")
        result["com.apple.application-identifier"] = f"{team}.{bundle_id}"
        result["com.apple.developer.team-identifier"] = team
    return result


def prepare_info(
    info: dict[str, Any], *, mode: str, app_group: str, keychain_group: str
) -> dict[str, Any]:
    result = dict(info)
    if mode == "local-store":
        result.pop("TextTextAppGroupIdentifier", None)
        result.pop("TextTextKeychainAccessGroup", None)
    elif mode == "provisioned":
        if app_group:
            result["TextTextAppGroupIdentifier"] = app_group
        else:
            result.pop("TextTextAppGroupIdentifier", None)
        if keychain_group:
            result["TextTextKeychainAccessGroup"] = keychain_group
        else:
            result.pop("TextTextKeychainAccessGroup", None)
    return result


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("select", "prepare"))
    parser.add_argument("--edition", choices=("store", "standalone"), required=True)
    parser.add_argument("--profile-available", choices=("yes", "no"), required=True)
    parser.add_argument("--signing-id", required=True)
    parser.add_argument("--source-entitlements", type=Path)
    parser.add_argument("--output-entitlements", type=Path)
    parser.add_argument("--info-plist", type=Path)
    parser.add_argument("--bundle-id", default="")
    parser.add_argument("--team", default="")
    parser.add_argument("--app-group", default="")
    parser.add_argument("--keychain-group", default="")
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    try:
        mode = select_mode(
            args.edition,
            args.profile_available == "yes",
            args.signing_id,
            args.app_group,
        )
        if args.action == "select":
            print(mode)
            return 0
        if not args.source_entitlements or not args.output_entitlements:
            raise ValueError("prepare requires source and output entitlement paths")
        source = _load(args.source_entitlements)
        entitlements = prepare_entitlements(
            source,
            mode=mode,
            edition=args.edition,
            bundle_id=args.bundle_id,
            team=args.team,
            app_group=args.app_group,
            keychain_group=args.keychain_group,
        )
        _dump(args.output_entitlements, entitlements)
        if args.info_plist:
            info = prepare_info(
                _load(args.info_plist),
                mode=mode,
                app_group=args.app_group,
                keychain_group=args.keychain_group,
            )
            _dump(args.info_plist, info)
        print(mode)
        return 0
    except (OSError, plistlib.InvalidFileException, ValueError) as error:
        print(f"Unable to prepare app capabilities: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
