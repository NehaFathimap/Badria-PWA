import frappe


def execute():
    # The Employee Incentive integration on Final Settlement needs an "Incentive"
    # earning component; none existed in this bench's Salary Component master data.
    if frappe.db.exists("Salary Component", "Incentive"):
        return

    frappe.get_doc(
        {
            "doctype": "Salary Component",
            "salary_component": "Incentive",
            "salary_component_abbr": "INC",
            "type": "Earning",
        }
    ).insert(ignore_permissions=True)
