# Copyright (c) 2026, Enfono and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProductionEntry(Document):
    def validate(self):
        self.validate_quantity()
        self.validate_duplicate()

    def validate_quantity(self):
        if flt(self.production_quantity) <= 0:
            frappe.throw(_("Production Quantity must be greater than zero."))

    def validate_duplicate(self):
        existing = frappe.db.exists(
            "Production Entry",
            {
                "employee": self.employee,
                "date": self.date,
                "name": ["!=", self.name],
                "docstatus": ["!=", 2],
            },
        )
        if existing:
            frappe.throw(
                _("Production Entry {0} already exists for employee {1} on {2}.").format(
                    frappe.utils.get_link_to_form("Production Entry", existing),
                    self.employee,
                    self.date,
                )
            )
