# Copyright (c) 2026, Enfono and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder import Order


def execute(filters=None):
    columns = get_columns()
    data = get_data(filters or {})
    return columns, data


def get_columns():
    return [
        {"label": _("Advance Salary Payment"), "fieldname": "name", "fieldtype": "Link", "options": "Advance Salary Payment", "width": 170},
        {"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 120},
        {"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 150},
        {"label": _("Date"), "fieldname": "date", "fieldtype": "Date", "width": 100},
        {"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "width": 120},
        {"label": _("Payment Mode"), "fieldname": "payment_mode", "fieldtype": "Link", "options": "Mode of Payment", "width": 120},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 90},
        {"label": _("Payment Entry"), "fieldname": "payment_entry", "fieldtype": "Link", "options": "Payment Entry", "width": 150},
    ]


def get_data(filters):
    AdvanceSalaryPayment = frappe.qb.DocType("Advance Salary Payment")

    query = (
        frappe.qb.from_(AdvanceSalaryPayment)
        .select(
            AdvanceSalaryPayment.name,
            AdvanceSalaryPayment.employee,
            AdvanceSalaryPayment.employee_name,
            AdvanceSalaryPayment.date,
            AdvanceSalaryPayment.amount,
            AdvanceSalaryPayment.payment_mode,
            AdvanceSalaryPayment.status,
            AdvanceSalaryPayment.payment_entry,
        )
        .where(AdvanceSalaryPayment.docstatus == 1)
        .orderby(AdvanceSalaryPayment.date, order=Order.desc)
    )

    if filters.get("company"):
        query = query.where(AdvanceSalaryPayment.company == filters["company"])
    if filters.get("employee"):
        query = query.where(AdvanceSalaryPayment.employee == filters["employee"])
    if filters.get("status"):
        query = query.where(AdvanceSalaryPayment.status == filters["status"])
    if filters.get("from_date"):
        query = query.where(AdvanceSalaryPayment.date >= filters["from_date"])
    if filters.get("to_date"):
        query = query.where(AdvanceSalaryPayment.date <= filters["to_date"])

    return query.run(as_dict=True)
