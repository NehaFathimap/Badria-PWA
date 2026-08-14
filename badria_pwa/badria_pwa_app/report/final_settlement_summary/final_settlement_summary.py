# Copyright (c) 2026, Enfono and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
    columns = get_columns()
    data = get_data(filters or {})
    return columns, data


def get_columns():
    return [
        {"label": _("Final Settlement"), "fieldname": "name", "fieldtype": "Link", "options": "Final Settlement", "width": 150},
        {"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 120},
        {"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 150},
        {"label": _("From Date"), "fieldname": "from_date", "fieldtype": "Date", "width": 95},
        {"label": _("To Date"), "fieldname": "to_date", "fieldtype": "Date", "width": 95},
        {"label": _("Settlement Type"), "fieldname": "settlement_type", "fieldtype": "Data", "width": 100},
        {"label": _("Working Days"), "fieldname": "working_days", "fieldtype": "Float", "width": 100},
        {"label": _("Total Production"), "fieldname": "total_production", "fieldtype": "Float", "width": 120},
        {"label": _("Incentive Amount"), "fieldname": "incentive_amount", "fieldtype": "Currency", "width": 120},
        {"label": _("Total Incentive (Sales)"), "fieldname": "total_incentive", "fieldtype": "Currency", "width": 140},
        {"label": _("Total Basic Salary"), "fieldname": "total_basic_salary", "fieldtype": "Currency", "width": 140},
        {"label": _("Total Payment Made During Service"), "fieldname": "total_advance_paid", "fieldtype": "Currency", "width": 190},
        {"label": _("Total Earnings on Settlement"), "fieldname": "gross_settlement", "fieldtype": "Currency", "width": 170},
        {"label": _("Balance Due"), "fieldname": "balance_payable", "fieldtype": "Currency", "width": 120},
        {"label": _("Status"), "fieldname": "settlement_status", "fieldtype": "Data", "width": 100},
    ]


def get_data(filters):
    FinalSettlement = frappe.qb.DocType("Final Settlement")

    query = (
        frappe.qb.from_(FinalSettlement)
        .select(
            FinalSettlement.name,
            FinalSettlement.employee,
            FinalSettlement.employee_name,
            FinalSettlement.from_date,
            FinalSettlement.to_date,
            FinalSettlement.settlement_type,
            FinalSettlement.working_days,
            FinalSettlement.total_production,
            FinalSettlement.incentive_amount,
            FinalSettlement.total_incentive,
            FinalSettlement.total_basic_salary,
            FinalSettlement.total_advance_paid,
            FinalSettlement.gross_settlement,
            FinalSettlement.balance_payable,
            FinalSettlement.settlement_status,
        )
        .where(FinalSettlement.docstatus != 2)
    )

    if filters.get("company"):
        query = query.where(FinalSettlement.company == filters["company"])
    if filters.get("employee"):
        query = query.where(FinalSettlement.employee == filters["employee"])
    if filters.get("settlement_status"):
        query = query.where(FinalSettlement.settlement_status == filters["settlement_status"])
    if filters.get("settlement_type"):
        query = query.where(FinalSettlement.settlement_type == filters["settlement_type"])
    if filters.get("from_date"):
        query = query.where(FinalSettlement.from_date >= filters["from_date"])
    if filters.get("to_date"):
        query = query.where(FinalSettlement.to_date <= filters["to_date"])

    return query.run(as_dict=True)
