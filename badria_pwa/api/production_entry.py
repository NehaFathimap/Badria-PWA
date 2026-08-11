# badria_pwa.api.production_entry - Bulk generation of Production Entry records

import json

import frappe
from frappe import _
from frappe.utils import flt, getdate


@frappe.whitelist()
def bulk_create(employee, entries, supervisor=None):
    """
    entries: JSON list of {"date": "YYYY-MM-DD", "quantity": <number>} — the exact,
    reviewed per-day values the user confirmed in the Bulk Production Entry page.
    """
    if not frappe.has_permission("Production Entry", "create"):
        frappe.throw(_("You are not permitted to create Production Entries."))

    if isinstance(entries, str):
        entries = json.loads(entries)

    if not entries:
        frappe.throw(_("No entries to create."))

    created = 0
    skipped = 0

    for row in entries:
        date = getdate(row.get("date"))
        quantity = flt(row.get("quantity"))

        if quantity <= 0:
            skipped += 1
            continue

        if frappe.db.exists(
            "Production Entry",
            {"employee": employee, "date": date, "docstatus": ["!=", 2]},
        ):
            skipped += 1
            continue

        doc = frappe.new_doc("Production Entry")
        doc.employee = employee
        doc.supervisor = supervisor
        doc.date = date
        doc.production_quantity = quantity
        doc.insert()
        doc.submit()
        created += 1

    return {"created": created, "skipped": skipped}
