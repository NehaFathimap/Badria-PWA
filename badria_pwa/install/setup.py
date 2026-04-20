import frappe


def after_install():
    _create_roles()
    _create_workspace()
    frappe.db.commit()
    print("\n✅  Badria Van Sales PWA installed successfully!")
    print("    Open /badria_pwa on your site to launch the app.\n")


def after_uninstall():
    frappe.db.commit()


def _create_roles():
    for role in ("Badria Van Sales User", "Badria Van Sales Manager"):
        if not frappe.db.exists("Role", role):
            frappe.get_doc({
                "doctype": "Role",
                "role_name": role,
                "desk_access": 1,
            }).insert(ignore_permissions=True)
    print("✅ Roles created.")


def _create_workspace():
    if frappe.db.exists("Workspace", "Badria Van Sales"):
        return
    frappe.get_doc({
        "doctype": "Workspace",
        "name": "Badria Van Sales",
        "title": "Badria Van Sales",
        "icon": "shopping-cart",
        "module": "Badria PWA",
        "public": 1,
        "roles": [
            {"role": "Badria Van Sales User"},
            {"role": "Badria Van Sales Manager"},
            {"role": "System Manager"},
        ],
        "links": [
            {"type": "Link", "label": "Open PWA",         "link_type": "URL",     "link_to": "/badria_pwa"},
            {"type": "Link", "label": "Sales Invoice",     "link_type": "DocType", "link_to": "Sales Invoice"},
            {"type": "Link", "label": "Sales Order",       "link_type": "DocType", "link_to": "Sales Order"},
            {"type": "Link", "label": "Quotation",         "link_type": "DocType", "link_to": "Quotation"},
            {"type": "Link", "label": "Delivery Note",     "link_type": "DocType", "link_to": "Delivery Note"},
            {"type": "Link", "label": "Payment Entry",     "link_type": "DocType", "link_to": "Payment Entry"},
            {"type": "Link", "label": "Stock Entry",       "link_type": "DocType", "link_to": "Stock Entry"},
        ],
    }).insert(ignore_permissions=True)
    print("✅ Workspace created.")
