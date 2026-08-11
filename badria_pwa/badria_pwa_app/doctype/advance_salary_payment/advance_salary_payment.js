// Copyright (c) 2026, Enfono and contributors
// For license information, please see license.txt

frappe.ui.form.on("Advance Salary Payment", {
    refresh(frm) {
        if (frm.doc.docstatus === 1 && !frm.doc.payment_entry) {
            frm.add_custom_button(__("Create Payment Entry"), () => {
                frappe.confirm(
                    __("Create and submit a Payment Entry of {0} for {1}?", [
                        format_currency(frm.doc.amount),
                        frm.doc.employee_name || frm.doc.employee,
                    ]),
                    () => {
                        frappe.call({
                            method:
                                "badria_pwa.api.advance_salary_payment.create_payment_entry",
                            args: { name: frm.doc.name },
                            freeze: true,
                            freeze_message: __("Creating Payment Entry..."),
                            callback(r) {
                                if (r.message) {
                                    frappe.show_alert({
                                        message: __("Payment Entry {0} created.", [r.message]),
                                        indicator: "green",
                                    });
                                    frm.reload_doc();
                                }
                            },
                        });
                    }
                );
            }).addClass("btn-primary");
        }

        if (frm.doc.payment_entry) {
            frm.add_custom_button(__("Payment Entry"), () => {
                frappe.set_route("Form", "Payment Entry", frm.doc.payment_entry);
            }, __("View"));
        }
    },
});
