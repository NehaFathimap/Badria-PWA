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
        self.validate_below_minimum_salary_component()
        self.validate_overlapping_settlement_period()

    def validate_below_minimum_salary_component(self):
        if not self.below_minimum_salary_component:
            return
        component_type = frappe.db.get_value(
            "Salary Component", self.below_minimum_salary_component, "type"
        )
        if component_type != "Deduction":
            frappe.throw(
                _("Below Minimum Salary Component {0} must be a Deduction-type Salary Component.").format(
                    self.below_minimum_salary_component
                )
            )

    def validate_overlapping_settlement_period(self):
        FinalSettlement = frappe.qb.DocType("Final Settlement")
        existing = (
            frappe.qb.from_(FinalSettlement)
            .select(FinalSettlement.name)
            .where(FinalSettlement.employee == self.employee)
            .where(FinalSettlement.docstatus == 1)
            .where(FinalSettlement.name != self.name)
            .where(FinalSettlement.from_date <= self.to_date)
            .where(FinalSettlement.to_date >= self.from_date)
        ).run(as_dict=True)
        if existing:
            frappe.throw(
                _(
                    "A Final Settlement {0} is already submitted for Employee {1} covering an overlapping period."
                ).format(frappe.bold(existing[0].name), self.employee)
            )

    def on_submit(self):
        if self.settlement_status == "Draft":
            frappe.throw(_("Please Calculate Settlement before submitting."))
