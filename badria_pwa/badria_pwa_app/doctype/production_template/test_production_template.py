# Copyright (c) 2026, Enfono and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


def _company():
	name = frappe.db.get_value("Company", {}, "name")
	if not name:
		raise frappe.DoesNotExistError("No Company on this site to test against")
	return name


def _template(**overrides):
	doc = frappe.get_doc(
		{
			"doctype": "Production Template",
			"template_name": overrides.pop("template_name", "_Test Production Template"),
			"company": overrides.pop("company", _company()),
			"items": overrides.pop("items", []),
		}
	)
	doc.update(overrides)
	return doc


class TestProductionTemplate(FrappeTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def test_row_cannot_have_both_warehouses(self):
		"""Both warehouses on one row makes it an internal transfer, which the
		production sheet silently ignores."""
		wh = frappe.db.get_value("Warehouse", {"is_group": 0}, "name")
		item = frappe.db.get_value("Item", {"is_stock_item": 1}, "name")
		if not (wh and item):
			self.skipTest("site has no stock item / warehouse")

		doc = _template(items=[{"item_code": item, "qty": 1, "s_warehouse": wh, "t_warehouse": wh}])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_manufacture_template_requires_finished_item(self):
		"""Without is_finished_item the resulting Stock Entry throws
		FinishedGoodError, so the template must be rejected up front."""
		if not frappe.db.exists("Stock Entry Type", "Manufacture"):
			self.skipTest("no Manufacture Stock Entry Type")
		item = frappe.db.get_value("Item", {"is_stock_item": 1}, "name")
		wh = frappe.db.get_value("Warehouse", {"is_group": 0}, "name")
		if not (item and wh):
			self.skipTest("site has no stock item / warehouse")

		doc = _template(
			stock_entry_type="Manufacture",
			items=[{"item_code": item, "qty": 1, "s_warehouse": wh}],
		)
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_negative_qty_rejected(self):
		item = frappe.db.get_value("Item", {"is_stock_item": 1}, "name")
		wh = frappe.db.get_value("Warehouse", {"is_group": 0}, "name")
		if not (item and wh):
			self.skipTest("site has no stock item / warehouse")

		doc = _template(items=[{"item_code": item, "qty": -5, "s_warehouse": wh}])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_get_template_items_resolves_warehouse_side(self):
		"""A consumed row must not inherit the default TARGET warehouse, and a
		produced row must not inherit the default SOURCE warehouse."""
		from badria_pwa.badria_pwa_app.doctype.production_template.production_template import (
			get_template_items,
		)

		warehouses = frappe.get_all("Warehouse", filters={"is_group": 0}, pluck="name", limit=2)
		item = frappe.db.get_value("Item", {"is_stock_item": 1}, "name")
		if len(warehouses) < 2 or not item:
			self.skipTest("site needs two warehouses and a stock item")
		src, tgt = warehouses[0], warehouses[1]

		doc = _template(
			template_name="_Test Production Template Sides",
			default_source_warehouse=src,
			default_target_warehouse=tgt,
			items=[
				{"item_code": item, "qty": 5},
				{"item_code": item, "qty": 2, "is_finished_item": 1},
			],
		)
		doc.insert()

		consumed, produced = get_template_items(doc.name)
		self.assertEqual(consumed["s_warehouse"], src)
		self.assertIsNone(consumed["t_warehouse"])
		self.assertEqual(produced["t_warehouse"], tgt)
		self.assertIsNone(produced["s_warehouse"])
