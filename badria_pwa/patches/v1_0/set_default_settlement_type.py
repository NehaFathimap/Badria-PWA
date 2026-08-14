import frappe
from frappe.query_builder import Criterion


def execute():
    # Every Final Settlement created before the Sales flow existed was calculated
    # using the Production formula, so backfill those rows accordingly.
    FinalSettlement = frappe.qb.DocType("Final Settlement")
    (
        frappe.qb.update(FinalSettlement)
        .set(FinalSettlement.settlement_type, "Production")
        .where(
            Criterion.any(
                [FinalSettlement.settlement_type.isnull(), FinalSettlement.settlement_type == ""]
            )
        )
    ).run()
