# Copyright (c) 2026, Enfono and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class AdvanceSalaryPayment(Document):
    def validate(self):
        if flt(self.amount) <= 0:
            frappe.throw(_("Amount must be greater than zero."))

    def on_cancel(self):
        if self.payment_entry:
            frappe.throw(
                _(
                    "Cannot cancel {0}: Payment Entry {1} is already linked. Cancel the Payment Entry first."
                ).format(self.name, self.payment_entry)
            )
