// Copyright (c) 2026, Enfono and contributors
// For license information, please see license.txt

frappe.ui.form.on("Final Settlement", {
    refresh(frm) {
        if (frm.doc.docstatus === 0 && frm.doc.employee && frm.doc.from_date && frm.doc.to_date) {
            frm.add_custom_button(__("Calculate Settlement"), () => {
                frappe.call({
                    method: "badria_pwa.api.final_settlement.calculate_settlement",
                    args: { name: frm.doc.name },
                    freeze: true,
                    freeze_message: __("Calculating Settlement..."),
                    callback(r) {
                        if (r.message) {
                            frm.reload_doc();
                        }
                    },
                });
            }).addClass("btn-primary");
        }

        const main_incentive_amount =
            frm.doc.settlement_type === "Sales" ? frm.doc.total_incentive : frm.doc.incentive_amount;
        const below_minimum_incentive_amount =
            frm.doc.settlement_type === "Sales" ? 0 : frm.doc.below_minimum_incentive_amount;
        const other_incentive_amount = flt(frm.doc.other_allowances) + flt(frm.doc.other_additions);

        const any_incentive_left_to_create =
            (flt(main_incentive_amount) > 0 && !frm.doc.employee_incentive) ||
            (flt(below_minimum_incentive_amount) > 0 && !frm.doc.below_minimum_employee_incentive) ||
            (flt(other_incentive_amount) > 0 && !frm.doc.other_employee_incentive);

        if (frm.doc.docstatus === 1 && any_incentive_left_to_create) {
            frm.add_custom_button(__("Create Employee Incentive"), () => {
                frappe.confirm(
                    __("Create Draft Employee Incentive record(s) for {0}? You'll still need to review and submit each one separately to feed payroll.", [
                        frm.doc.employee_name || frm.doc.employee,
                    ]),
                    () => {
                        frappe.call({
                            method: "badria_pwa.api.final_settlement.create_employee_incentive",
                            args: { name: frm.doc.name },
                            freeze: true,
                            freeze_message: __("Creating Employee Incentive(s)..."),
                            callback(r) {
                                if (r.message) {
                                    frappe.show_alert({
                                        message: __("Employee Incentive record(s) created as Draft."),
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

        if (frm.doc.employee_incentive) {
            const main_incentive_label =
                frm.doc.settlement_type === "Sales" ? __("Sales Incentive") : __("Incentive (20 & Above)");
            frm.add_custom_button(main_incentive_label, () => {
                frappe.set_route("Form", "Employee Incentive", frm.doc.employee_incentive);
            }, __("View"));
        }

        if (frm.doc.below_minimum_employee_incentive) {
            frm.add_custom_button(__("Incentive (Below 20)"), () => {
                frappe.set_route("Form", "Employee Incentive", frm.doc.below_minimum_employee_incentive);
            }, __("View"));
        }

        if (frm.doc.other_employee_incentive) {
            frm.add_custom_button(__("Incentive (Other Allowance/Addition)"), () => {
                frappe.set_route("Form", "Employee Incentive", frm.doc.other_employee_incentive);
            }, __("View"));
        }
    },
});
