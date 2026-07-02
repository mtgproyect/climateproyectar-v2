from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SiteContractTests(unittest.TestCase):
    def test_catalog_has_expected_localities(self) -> None:
        payload = json.loads((ROOT / "docs/data/localidades.min.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["count"], 10601)
        self.assertEqual(len(payload["records"]), 10601)

    def test_external_sources_are_separated(self) -> None:
        config = json.loads((ROOT / "docs/config/data-sources.json").read_text(encoding="utf-8"))
        self.assertIn("climate-observations", config["observations"]["base_url"])
        self.assertIn("climate-forecasts", config["forecasts"]["base_url"])
        self.assertFalse(config["radar"]["enabled"])
        self.assertFalse(config["satellite"]["enabled"])

    def test_site_has_no_weather_cache(self) -> None:
        self.assertFalse((ROOT / "data/cache").exists())


if __name__ == "__main__":
    unittest.main()
