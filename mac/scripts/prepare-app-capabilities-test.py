#!/usr/bin/env python3
"""Credential-free regression tests for Store app entitlement preparation."""

import importlib.util
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HELPER_PATH = Path(__file__).with_name("prepare-app-capabilities.py")
HELPER_SPEC = importlib.util.spec_from_file_location("prepare_app_capabilities", HELPER_PATH)
if HELPER_SPEC is None or HELPER_SPEC.loader is None:
    raise RuntimeError(f"cannot load app capability helper at {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(HELPER_SPEC)
HELPER_SPEC.loader.exec_module(HELPER)

PROFILE_GATED = HELPER.PROFILE_GATED
STORE_REQUIRED = HELPER.STORE_REQUIRED
prepare_entitlements = HELPER.prepare_entitlements
prepare_info = HELPER.prepare_info
select_mode = HELPER.select_mode


TEAM = "52WM463HR2"
BUNDLE_ID = "app.texttext.mac"
APP_GROUP = f"{TEAM}.group.texttext.shared"
KEYCHAIN_GROUP = f"{TEAM}.app.texttext.fp"


def store_source():
    return {
        "com.apple.security.app-sandbox": True,
        "com.apple.security.network.client": True,
        "com.apple.security.network.server": True,
        "com.apple.security.files.user-selected.read-write": True,
        "com.apple.developer.applesignin": ["Default"],
        "com.apple.security.application-groups": ["TEXTTEXT_APP_GROUP"],
        "keychain-access-groups": ["TEXTTEXT_KEYCHAIN_GROUP"],
    }


def assert_no_identity_placeholders(test, value):
    if isinstance(value, dict):
        for key, item in value.items():
            test.assertNotIn("TEXTTEXT_APP_GROUP", key)
            test.assertNotIn("TEXTTEXT_KEYCHAIN_GROUP", key)
            assert_no_identity_placeholders(test, item)
    elif isinstance(value, list):
        for item in value:
            assert_no_identity_placeholders(test, item)
    elif isinstance(value, str):
        test.assertNotIn("TEXTTEXT_APP_GROUP", value)
        test.assertNotIn("TEXTTEXT_KEYCHAIN_GROUP", value)


class CapabilitySelectionTests(unittest.TestCase):
    def test_selects_local_store_only_for_unprovisioned_adhoc_builds(self):
        self.assertEqual(select_mode("store", False, "-"), "local-store")
        self.assertEqual(select_mode("store", True, "-"), "local-store")
        self.assertEqual(
            select_mode("store", True, "Apple Distribution: Fixture (52WM463HR2)"),
            "provisioned",
        )
        with self.assertRaisesRegex(ValueError, "requires its provisioning profile"):
            select_mode("store", False, "Apple Distribution: Fixture (52WM463HR2)")
        self.assertEqual(
            select_mode("standalone", True, "Developer ID Fixture", "group.texttext.shared"),
            "provisioned",
        )
        self.assertEqual(
            select_mode("standalone", True, "Developer ID Fixture"),
            "local-standalone",
        )

    def test_no_profile_store_keeps_required_sandbox_grants_and_strips_restricted_grants(self):
        entitlements = prepare_entitlements(
            store_source(),
            mode="local-store",
            edition="store",
            bundle_id=BUNDLE_ID,
            team="",
            app_group="",
            keychain_group="",
        )
        self.assertEqual(set(entitlements), STORE_REQUIRED)
        self.assertTrue(
            all(entitlements[key] is True for key in STORE_REQUIRED)
        )
        self.assertFalse(PROFILE_GATED.intersection(entitlements))

        info = prepare_info(
            {
                "CFBundleIdentifier": BUNDLE_ID,
                "TextTextAppGroupIdentifier": "TEXTTEXT_APP_GROUP",
                "TextTextKeychainAccessGroup": "TEXTTEXT_KEYCHAIN_GROUP",
            },
            mode="local-store",
            app_group="",
            keychain_group="",
        )
        self.assertNotIn("TextTextAppGroupIdentifier", info)
        self.assertNotIn("TextTextKeychainAccessGroup", info)
        assert_no_identity_placeholders(self, entitlements)
        assert_no_identity_placeholders(self, info)

    def test_provisioned_store_keeps_authorized_signin_and_resolves_identity(self):
        entitlements = prepare_entitlements(
            store_source(),
            mode="provisioned",
            edition="store",
            bundle_id=BUNDLE_ID,
            team=TEAM,
            app_group=APP_GROUP,
            keychain_group=KEYCHAIN_GROUP,
        )
        self.assertTrue(all(entitlements[key] is True for key in STORE_REQUIRED))
        self.assertEqual(entitlements["com.apple.developer.applesignin"], ["Default"])
        self.assertEqual(entitlements["com.apple.security.application-groups"], [APP_GROUP])
        self.assertEqual(entitlements["keychain-access-groups"], [KEYCHAIN_GROUP])
        self.assertEqual(
            entitlements["com.apple.application-identifier"], f"{TEAM}.{BUNDLE_ID}"
        )
        self.assertEqual(entitlements["com.apple.developer.team-identifier"], TEAM)
        info = prepare_info(
            {"TextTextAppGroupIdentifier": "TEXTTEXT_APP_GROUP"},
            mode="provisioned",
            app_group=APP_GROUP,
            keychain_group=KEYCHAIN_GROUP,
        )
        self.assertEqual(info["TextTextAppGroupIdentifier"], APP_GROUP)
        self.assertEqual(info["TextTextKeychainAccessGroup"], KEYCHAIN_GROUP)
        assert_no_identity_placeholders(self, entitlements)
        assert_no_identity_placeholders(self, info)

    def test_provisioned_store_without_group_keeps_signin_but_drops_group_placeholders(self):
        entitlements = prepare_entitlements(
            store_source(),
            mode="provisioned",
            edition="store",
            bundle_id=BUNDLE_ID,
            team=TEAM,
            app_group="",
            keychain_group="",
        )
        self.assertEqual(entitlements["com.apple.developer.applesignin"], ["Default"])
        self.assertNotIn("com.apple.security.application-groups", entitlements)
        self.assertNotIn("keychain-access-groups", entitlements)
        self.assertEqual(entitlements["com.apple.application-identifier"], f"{TEAM}.{BUNDLE_ID}")
        info = prepare_info(
            {
                "TextTextAppGroupIdentifier": "TEXTTEXT_APP_GROUP",
                "TextTextKeychainAccessGroup": "TEXTTEXT_KEYCHAIN_GROUP",
            },
            mode="provisioned",
            app_group="",
            keychain_group="",
        )
        self.assertNotIn("TextTextAppGroupIdentifier", info)
        self.assertNotIn("TextTextKeychainAccessGroup", info)
        assert_no_identity_placeholders(self, entitlements)
        assert_no_identity_placeholders(self, info)

    def test_build_script_uses_the_tested_selector_and_preparer(self):
        build_script = Path(__file__).parent.joinpath("build-app.sh").read_text()
        self.assertIn('CAPABILITY_MODE="$(python3 "$CAPABILITY_HELPER" select', build_script)
        self.assertIn('if [ "$CAPABILITY_MODE" = "provisioned" ]; then', build_script)
        self.assertIn('"$CAPABILITY_HELPER" prepare', build_script)

    def test_prepare_command_writes_a_no_profile_local_store_fixture(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source_path = root / "source.plist"
            output_path = root / "output.plist"
            info_path = root / "Info.plist"
            for path, value in (
                (source_path, store_source()),
                (info_path, {"TextTextAppGroupIdentifier": "TEXTTEXT_APP_GROUP"}),
            ):
                with path.open("wb") as handle:
                    plistlib.dump(value, handle)
            base_command = [
                sys.executable,
                str(HELPER_PATH),
                "prepare",
                "--edition",
                "store",
                "--source-entitlements",
                str(source_path),
                "--output-entitlements",
                str(output_path),
                "--info-plist",
                str(info_path),
            ]
            result = subprocess.run(
                base_command + ["--profile-available", "no", "--signing-id", "-"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.stdout.strip(), "local-store")
            self.assertEqual(set(plistlib.loads(output_path.read_bytes())), STORE_REQUIRED)
            prepared_info = plistlib.loads(info_path.read_bytes())
            self.assertNotIn("TextTextAppGroupIdentifier", prepared_info)
            assert_no_identity_placeholders(self, plistlib.loads(output_path.read_bytes()))
            assert_no_identity_placeholders(self, prepared_info)

            with info_path.open("wb") as handle:
                plistlib.dump({"TextTextAppGroupIdentifier": "TEXTTEXT_APP_GROUP"}, handle)
            result = subprocess.run(
                base_command
                + [
                    "--profile-available",
                    "yes",
                    "--signing-id",
                    "fixture-release-identity",
                    "--bundle-id",
                    BUNDLE_ID,
                    "--team",
                    TEAM,
                    "--app-group",
                    APP_GROUP,
                    "--keychain-group",
                    KEYCHAIN_GROUP,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.stdout.strip(), "provisioned")
            prepared_entitlements = plistlib.loads(output_path.read_bytes())
            prepared_info = plistlib.loads(info_path.read_bytes())
            self.assertEqual(prepared_entitlements["com.apple.developer.applesignin"], ["Default"])
            self.assertEqual(
                prepared_entitlements["com.apple.application-identifier"],
                f"{TEAM}.{BUNDLE_ID}",
            )
            self.assertEqual(prepared_entitlements["com.apple.security.application-groups"], [APP_GROUP])
            self.assertEqual(prepared_info["TextTextAppGroupIdentifier"], APP_GROUP)
            assert_no_identity_placeholders(self, prepared_entitlements)
            assert_no_identity_placeholders(self, prepared_info)


if __name__ == "__main__":
    unittest.main()
