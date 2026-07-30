// Copyright (c) 2026, Enfono and contributors
// For license information, please see license.txt

frappe.query_reports["Final Settlement Summary"] = {
    filters: [
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_user_default("Company"),
        },
        {
            fieldname: "employee",
            label: __("Employee"),
            fieldtype: "Link",
            options: "Employee",
        },
        {
            fieldname: "settlement_status",
            label: __("Settlement Status"),
            fieldtype: "Select",
            options: "\nDraft\nCalculated\nPaid",
        },
        {
            fieldname: "settlement_type",
            label: __("Settlement Type"),
            fieldtype: "Select",
            options: "\nProduction\nSales",
        },
        {
            fieldname: "from_date",
            label: __("From Date"),
            fieldtype: "Date",
        },
        {
            fieldname: "to_date",
            label: __("To Date"),
            fieldtype: "Date",
        },
    ],
};
