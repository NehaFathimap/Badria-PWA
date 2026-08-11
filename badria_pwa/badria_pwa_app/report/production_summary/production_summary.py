# Copyright (c) 2026, Enfono and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder.functions import Count, Sum


def execute(filters=None):
    columns = get_columns()
    data = get_data(filters or {})
    return columns, data


def get_columns():
    return [
        {"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 120},
        {"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
        {"label": _("Total Production"), "fieldname": "total_quantity", "fieldtype": "Float", "width": 140},
        {"label": _("Entries"), "fieldname": "entry_count", "fieldtype": "Int", "width": 90},
    ]


def get_data(filters):
    ProductionEntry = frappe.qb.DocType("Production Entry")
    Employee = frappe.qb.DocType("Employee")

    query = (
        frappe.qb.from_(ProductionEntry)
        .join(Employee)
        .on(ProductionEntry.employee == Employee.name)
        .select(
            ProductionEntry.employee,
            Employee.employee_name,
            Sum(ProductionEntry.production_quantity).as_("total_quantity"),
            Count(ProductionEntry.name).as_("entry_count"),
        )
        .where(ProductionEntry.docstatus == 1)
        .groupby(ProductionEntry.employee)
        .orderby(Employee.employee_name)
    )

    if filters.get("company"):
        query = query.where(ProductionEntry.company == filters["company"])
    if filters.get("employee"):
        query = query.where(ProductionEntry.employee == filters["employee"])
    if filters.get("from_date"):
        query = query.where(ProductionEntry.date >= filters["from_date"])
    if filters.get("to_date"):
        query = query.where(ProductionEntry.date <= filters["to_date"])

    return query.run(as_dict=True)
