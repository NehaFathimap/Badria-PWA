frappe.pages["bulk-production-entry"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Bulk Production Entry"),
        single_column: true,
    });

    page.main.css("padding", "20px");

    var chrome_html = `
    <div class="bpe-wrapper">
        <div class="bpe-card">
            <div class="bpe-card-title">${__("1. Choose Employee & Period")}</div>
            <div class="bpe-grid">
                <div class="bpe-field" id="bpe-f-employee"></div>
                <div class="bpe-field" id="bpe-f-supervisor"></div>
                <div class="bpe-field" id="bpe-f-from-date"></div>
                <div class="bpe-field" id="bpe-f-to-date"></div>
            </div>
            <div class="bpe-field" id="bpe-f-skip-weekend" style="max-width: 260px;"></div>
            <div class="bpe-actions">
                <button class="btn btn-primary btn-sm" id="bpe-btn-preview">
                    ${__("List Days")}
                </button>
            </div>
        </div>

        <div id="bpe-preview-wrapper" style="display: none;">
            <div class="bpe-card-title">${__("2. Enter Quantity For Each Day")}</div>
            <div class="bpe-hint">
                ${__("Uncheck a day to skip it. Only checked rows with a quantity greater than 0 will be created.")}
            </div>
            <div class="bpe-summary-bar">
                <span><span id="bpe-count">0</span> ${__("days listed")}</span>
                <span>${__("Total Quantity")}: <span class="bpe-total" id="bpe-grand-total">0</span></span>
            </div>
            <div class="bpe-table-shell">
                <table class="bpe-table">
                    <thead>
                        <tr>
                            <th style="width: 36px;"></th>
                            <th>${__("Date")}</th>
                            <th>${__("Day")}</th>
                            <th style="text-align: right;">${__("Quantity")}</th>
                        </tr>
                    </thead>
                    <tbody id="bpe-table-body"></tbody>
                </table>
            </div>
            <div class="bpe-create-bar">
                <span id="bpe-result"></span>
                <button class="btn btn-primary btn-sm" id="bpe-btn-create">
                    ${__("Create Entries")}
                </button>
            </div>
        </div>
    </div>
    `;
    $(chrome_html).appendTo(page.main);

    var employee_field = frappe.ui.form.make_control({
        parent: $("#bpe-f-employee"),
        df: { fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee", reqd: 1 },
        render_input: true,
    });

    var supervisor_field = frappe.ui.form.make_control({
        parent: $("#bpe-f-supervisor"),
        df: { fieldname: "supervisor", label: __("Supervisor"), fieldtype: "Link", options: "Employee" },
        render_input: true,
    });

    var from_date_field = frappe.ui.form.make_control({
        parent: $("#bpe-f-from-date"),
        df: { fieldname: "from_date", label: __("From Date"), fieldtype: "Date", reqd: 1 },
        render_input: true,
    });

    var to_date_field = frappe.ui.form.make_control({
        parent: $("#bpe-f-to-date"),
        df: { fieldname: "to_date", label: __("To Date"), fieldtype: "Date", reqd: 1 },
        render_input: true,
    });

    var skip_friday_field = frappe.ui.form.make_control({
        parent: $("#bpe-f-skip-weekend"),
        df: { fieldname: "skip_friday", label: __("Skip Friday"), fieldtype: "Check", default: 1 },
        render_input: true,
    });
    skip_friday_field.set_value(1);

    var day_names = [
        __("Sunday"), __("Monday"), __("Tuesday"), __("Wednesday"),
        __("Thursday"), __("Friday"), __("Saturday"),
    ];

    function build_day_list() {
        var from_date = from_date_field.get_value();
        var to_date = to_date_field.get_value();
        var skip_friday = skip_friday_field.get_value();

        var start = new Date(from_date + "T00:00:00");
        var end = new Date(to_date + "T00:00:00");
        var days = [];

        for (var d = start; d <= end; d.setDate(d.getDate() + 1)) {
            var day_of_week = d.getDay(); // Sunday=0 ... Saturday=6
            var is_friday = day_of_week === 5;
            if (cint(skip_friday) && is_friday) {
                continue;
            }
            days.push({
                date: frappe.datetime.obj_to_str(new Date(d)),
                day_of_week: day_of_week,
                is_weekend: is_friday,
            });
        }
        return days;
    }

    function update_summary() {
        var count = 0;
        var total = 0;
        $("#bpe-table-body tr").each(function () {
            var $row = $(this);
            var checked = $row.find(".bpe-row-include").is(":checked");
            $row.toggleClass("bpe-row-excluded", !checked);
            if (checked) {
                count += 1;
                total += flt($row.find(".bpe-row-qty").val());
            }
        });
        $("#bpe-count").text(count);
        $("#bpe-grand-total").text(total);
    }

    function render_table(days) {
        var $tbody = $("#bpe-table-body").empty();
        days.forEach(function (row) {
            var day_label = row.is_weekend
                ? `<span class="bpe-weekend-label">${day_names[row.day_of_week]}</span>`
                : day_names[row.day_of_week];
            var $tr = $(`
                <tr>
                    <td><input type="checkbox" class="bpe-row-include" checked></td>
                    <td>${frappe.datetime.str_to_user(row.date)}</td>
                    <td>${day_label}</td>
                    <td>
                        <input type="number" step="0.01" min="0"
                            class="form-control input-sm bpe-row-qty"
                            data-date="${row.date}" placeholder="0">
                    </td>
                </tr>
            `);
            $tbody.append($tr);
        });
        update_summary();
    }

    $("#bpe-table-body").on("input change", ".bpe-row-qty, .bpe-row-include", update_summary);

    $("#bpe-btn-preview").on("click", function () {
        var employee = employee_field.get_value();
        var from_date = from_date_field.get_value();
        var to_date = to_date_field.get_value();

        if (!employee || !from_date || !to_date) {
            frappe.msgprint(__("Employee, From Date and To Date are required."));
            return;
        }
        if (frappe.datetime.str_to_obj(from_date) > frappe.datetime.str_to_obj(to_date)) {
            frappe.msgprint(__("From Date cannot be after To Date."));
            return;
        }

        var days = build_day_list();
        if (!days.length) {
            frappe.msgprint(__("No days fall in this range (check Skip Friday)."));
            return;
        }

        render_table(days);
        $("#bpe-preview-wrapper").show();
        $("#bpe-result").empty();
    });

    $("#bpe-btn-create").on("click", function () {
        var employee = employee_field.get_value();
        var entries = [];

        $("#bpe-table-body tr").each(function () {
            var $row = $(this);
            if (!$row.find(".bpe-row-include").is(":checked")) return;
            var $qty = $row.find(".bpe-row-qty");
            var quantity = flt($qty.val());
            if (quantity <= 0) return;
            entries.push({ date: $qty.data("date"), quantity: quantity });
        });

        if (!entries.length) {
            frappe.msgprint(__("Enter a quantity greater than 0 for at least one day."));
            return;
        }

        frappe.confirm(
            __("Create {0} Production Entries for {1}?", [entries.length, employee]),
            function () {
                frappe.call({
                    method: "badria_pwa.api.production_entry.bulk_create",
                    args: {
                        employee: employee,
                        supervisor: supervisor_field.get_value(),
                        entries: entries,
                    },
                    freeze: true,
                    freeze_message: __("Creating Production Entries..."),
                    callback: function (r) {
                        if (!r.message) return;
                        var result = r.message;
                        $("#bpe-result").html(
                            `<span class="text-success">
                                ${__("Created {0}, skipped {1} (already existed).", [
                                    result.created,
                                    result.skipped,
                                ])}
                            </span>`
                        );
                    },
                });
            }
        );
    });
};
