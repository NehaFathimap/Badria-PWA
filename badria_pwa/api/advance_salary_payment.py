# badria_pwa.api.advance_salary_payment - Payment Entry automation for Advance Salary Payment

import frappe
from frappe import _
from frappe.utils import flt, get_link_to_form


@frappe.whitelist()
def create_payment_entry(name):
    doc = frappe.get_doc("Advance Salary Payment", name)

    if not frappe.has_permission(doc.doctype, "submit", doc):
        frappe.throw(_("You are not permitted to create a payment for this document."))

    if doc.docstatus != 1:
        frappe.throw(_("Advance Salary Payment must be submitted before creating a Payment Entry."))

    if doc.payment_entry:
        frappe.throw(
            _("Payment Entry {0} is already linked to this Advance Salary Payment.").format(
                get_link_to_form("Payment Entry", doc.payment_entry)
            )
        )

    advance_account = frappe.db.get_value(
        "Company", doc.company, "default_employee_advance_account"
    )
    if not advance_account:
        frappe.throw(
            _(
                'Please set the <a href="/app/company/{0}#default_employee_advance_account" '
                "target=\"_blank\">Default Employee Advance Account</a> in the Company record {0}."
            ).format(doc.company)
        )

    from erpnext.accounts.doctype.sales_invoice.sales_invoice import get_bank_cash_account

    try:
        bank_cash = get_bank_cash_account(doc.payment_mode, doc.company)

        pe = frappe.new_doc("Payment Entry")
        pe.payment_type = "Pay"
        pe.company = doc.company
        pe.posting_date = doc.date
        pe.mode_of_payment = doc.payment_mode
        pe.party_type = "Employee"
        pe.party = doc.employee
        pe.paid_from = bank_cash.get("account")
        pe.paid_to = advance_account
        pe.paid_amount = flt(doc.amount)
        pe.received_amount = flt(doc.amount)
        pe.reference_no = doc.name
        pe.reference_date = doc.date
        pe.remarks = _("Advance Salary Payment against {0}").format(doc.name)

        pe.insert()
        pe.submit()
    except Exception:
        frappe.log_error(
            title="Advance Salary Payment: Payment Entry Failed",
            message=frappe.get_traceback(),
        )
        frappe.throw(
            _("Could not create Payment Entry for {0}. Please check the Error Log.").format(doc.name)
        )

    frappe.db.set_value(
        "Advance Salary Payment",
        doc.name,
        {"payment_entry": pe.name, "status": "Paid"},
        update_modified=False,
    )

    return pe.name
