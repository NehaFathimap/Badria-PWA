# Copyright (c) 2026, Enfono and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint, flt


def execute(filters=None):
    filters = filters or {}
    columns = get_columns()
    data = get_data(filters)
    return columns, data


def get_columns():
    return [
        {"label": _("Date"), "fieldname": "date", "fieldtype": "Date", "width": 100},
        {"label": _("Production Quantity"), "fieldname": "production_quantity", "fieldtype": "Float", "width": 140},
        {"label": _("Running Total"), "fieldname": "running_total", "fieldtype": "Float", "width": 130},
        {"label": _("Minimum Expected To Date"), "fieldname": "minimum_expected", "fieldtype": "Float", "width": 170},
        {"label": _("Ahead / Behind"), "fieldname": "variance", "fieldtype": "Float", "width": 130},
    ]


def get_data(filters):
    if not filters.get("employee"):
        frappe.throw(_("Please select an Employee."))

    ProductionEntry = frappe.qb.DocType("Production Entry")
    query = (
        frappe.qb.from_(ProductionEntry)
        .select(ProductionEntry.date, ProductionEntry.production_quantity)
        .where(ProductionEntry.employee == filters["employee"])
        .where(ProductionEntry.docstatus == 1)
        .orderby(ProductionEntry.date)
    )

    if filters.get("from_date"):
        query = query.where(ProductionEntry.date >= filters["from_date"])
    if filters.get("to_date"):
        query = query.where(ProductionEntry.date <= filters["to_date"])

    rows = query.run(as_dict=True)

    minimum_per_day = flt(filters.get("minimum_production_per_day")) or 20

    data = []
    running_total = 0.0
    for idx, row in enumerate(rows, start=1):
        running_total += flt(row.production_quantity)
        minimum_expected = idx * minimum_per_day
        data.append(
            {
                "date": row.date,
                "production_quantity": row.production_quantity,
                "running_total": running_total,
                "minimum_expected": minimum_expected,
                "variance": running_total - minimum_expected,
            }
        )

    return data
