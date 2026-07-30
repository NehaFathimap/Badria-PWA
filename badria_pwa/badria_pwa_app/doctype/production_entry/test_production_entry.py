# Copyright (c) 2026, Enfono and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import today


class IntegrationTestProductionEntry(IntegrationTestCase):
    def setUp(self):
        self.employee = frappe.db.get_value("Employee", {"status": "Active"}, "name")
        if not self.employee:
            self.skipTest("No active Employee record available in this site to test against.")

    def tearDown(self):
        frappe.db.rollback()

    def test_duplicate_entry_for_same_employee_and_day_is_blocked(self):
        first = frappe.get_doc(
            {
                "doctype": "Production Entry",
                "employee": self.employee,
                "date": today(),
                "production_quantity": 10,
            }
        ).insert()
        first.submit()

        duplicate = frappe.get_doc(
            {
                "doctype": "Production Entry",
                "employee": self.employee,
                "date": today(),
                "production_quantity": 5,
            }
        )
        self.assertRaises(frappe.ValidationError, duplicate.insert)

    def test_zero_quantity_is_rejected(self):
        doc = frappe.get_doc(
            {
                "doctype": "Production Entry",
                "employee": self.employee,
                "date": today(),
                "production_quantity": 0,
            }
        )
        self.assertRaises(frappe.ValidationError, doc.insert)
