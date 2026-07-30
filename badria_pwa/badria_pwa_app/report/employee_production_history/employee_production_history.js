// Copyright (c) 2026, Enfono and contributors
// For license information, please see license.txt

frappe.query_reports["Employee Production History"] = {
    filters: [
        {
            fieldname: "employee",
            label: __("Employee"),
            fieldtype: "Link",
            options: "Employee",
            reqd: 1,
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
        {
            fieldname: "minimum_production_per_day",
            label: __("Minimum Production Per Day"),
            fieldtype: "Int",
            default: 20,
        },
    ],
};
