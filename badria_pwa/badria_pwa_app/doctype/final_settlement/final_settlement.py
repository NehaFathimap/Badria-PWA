# Copyright (c) 2026, Enfono and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class FinalSettlement(Document):
    def validate(self):
        if getdate(self.from_date) > getdate(self.to_date):
            frappe.throw(_("From Date cannot be after To Date."))

    def on_submit(self):
        if self.settlement_status == "Draft":
            frappe.throw(_("Please Calculate Settlement before submitting."))

    def on_cancel(self):
        if self.payment_entry:
            frappe.throw(
                _(
                    "Cannot cancel {0}: Payment Entry {1} is already linked. Cancel the Payment Entry first."
                ).format(self.name, self.payment_entry)
            )
