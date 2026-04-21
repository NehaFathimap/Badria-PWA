import frappe


def after_install():
    _create_roles()
    frappe.db.commit()
    print("\n✅  Badria Van Sales PWA installed successfully!")
    print("    Run: bench build --app badria_pwa")
    print("    Then open /badria_pwa on your site.\n")


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
