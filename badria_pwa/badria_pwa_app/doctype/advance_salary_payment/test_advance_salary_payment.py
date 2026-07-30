# Copyright (c) 2026, Enfono and Contributors
# See license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import today

from badria_pwa.api.advance_salary_payment import create_payment_entry


class IntegrationTestAdvanceSalaryPayment(IntegrationTestCase):
    def setUp(self):
        self.employee, self.company = frappe.db.get_value(
            "Employee", {"status": "Active"}, ["name", "company"]
        ) or (None, None)
        if not self.employee:
            self.skipTest("No active Employee record available in this site to test against.")

        self.mode_of_payment = frappe.db.get_value(
            "Mode of Payment Account", {"company": self.company}, "parent"
        )
        self.advance_account = frappe.db.get_value(
            "Company", self.company, "default_employee_advance_account"
        )
        if not self.mode_of_payment or not self.advance_account:
            self.skipTest(
                "Mode of Payment default account / Default Employee Advance Account "
                "is not configured for this company."
            )

    def tearDown(self):
        frappe.db.rollback()

    def test_amount_must_be_positive(self):
        doc = frappe.get_doc(
            {
                "doctype": "Advance Salary Payment",
                "employee": self.employee,
                "date": today(),
                "amount": 0,
                "payment_mode": self.mode_of_payment,
            }
        )
        self.assertRaises(frappe.ValidationError, doc.insert)

    def test_create_payment_entry_links_back_and_marks_paid(self):
        doc = frappe.get_doc(
            {
                "doctype": "Advance Salary Payment",
                "employee": self.employee,
                "date": today(),
                "amount": 100,
                "payment_mode": self.mode_of_payment,
            }
        ).insert()
        doc.submit()

        pe_name = create_payment_entry(doc.name)

        doc.reload()
        self.assertEqual(doc.payment_entry, pe_name)
        self.assertEqual(doc.status, "Paid")

        pe = frappe.get_doc("Payment Entry", pe_name)
        self.assertEqual(pe.docstatus, 1)
        self.assertEqual(pe.party_type, "Employee")
        self.assertEqual(pe.party, self.employee)
        self.assertEqual(pe.paid_to, self.advance_account)
