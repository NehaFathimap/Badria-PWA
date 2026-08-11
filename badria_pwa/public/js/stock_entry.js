// Stock Entry — Production Template loader.
//
// Replaces "duplicate the last entry" for the daily production sheet: pick a
// saved Production Template and its rows drop straight into the Items table.
//
// The whole table is fetched in ONE server call
// (badria_pwa...production_template.get_template_items), which returns rows
// already carrying stock_uom / conversion_factor / transfer_qty. Two reasons
// it is done that way rather than row-by-row on the client:
//
//   1. frappe.model.set_value fires ERPNext's item_code handler once per row
//      (32 rows took ~30s) and that handler re-stamps s_warehouse/t_warehouse
//      from the header between writes, so consumed rows came back carrying a
//      target warehouse too and vanished from the production print format.
//   2. stock_uom, conversion_factor and transfer_qty are mandatory on Stock
//      Entry Detail and the grid enforces them in the browser, before the
//      request is sent. Bypassing the item_code handler means we must supply
//      them, and the core resolver for conversion factors is not whitelisted.
//
// basic_rate, amount, expense_account and cost_center stay blank — those are
// filled by Stock Entry.validate() on save.

frappe.ui.form.on("Stock Entry", {
	setup(frm) {
		frm.set_query("custom_production_template", () => {
			return {
				filters: {
					disabled: 0,
					company: frm.doc.company,
				},
			};
		});
	},

	refresh(frm) {
		if (frm.doc.docstatus === 0) {
			frm.add_custom_button(
				__("Load Production Template"),
				() => show_template_picker(frm),
				__("Template")
			);
		}
		if (!frm.is_new() && (frm.doc.items || []).length) {
			frm.add_custom_button(
				__("Save as Production Template"),
				() => save_as_template(frm),
				__("Template")
			);
		}
	},

	custom_production_template(frm) {
		if (!frm.doc.custom_production_template) return;
		confirm_then_load(frm, frm.doc.custom_production_template);
	},
});

function show_template_picker(frm) {
	const d = new frappe.ui.Dialog({
		title: __("Load Production Template"),
		fields: [
			{
				fieldname: "template",
				fieldtype: "Link",
				label: __("Production Template"),
				options: "Production Template",
				reqd: 1,
				get_query: () => ({
					filters: { disabled: 0, company: frm.doc.company },
				}),
			},
			{
				fieldname: "append_mode",
				fieldtype: "Check",
				label: __("Append to existing rows (instead of replacing)"),
				default: 0,
			},
		],
		primary_action_label: __("Load"),
		primary_action(values) {
			d.hide();
			frm.set_value("custom_production_template", values.template);
			load_template(frm, values.template, values.append_mode);
		},
	});
	d.show();
}

function confirm_then_load(frm, template) {
	const filled = (frm.doc.items || []).filter((r) => r.item_code).length;
	if (!filled) {
		load_template(frm, template, 0);
		return;
	}
	frappe.confirm(
		__("Replace the {0} existing item row(s) with this template?", [filled]),
		() => load_template(frm, template, 0),
		() => frm.set_value("custom_production_template", null)
	);
}

async function load_template(frm, template, append_mode) {
	let rows;
	try {
		const r = await frappe.call({
			method:
				"badria_pwa.badria_pwa_app.doctype.production_template.production_template.get_template_items",
			args: { template: template },
			freeze: true,
			freeze_message: __("Loading template..."),
		});
		rows = r.message || [];
	} catch (e) {
		// frappe.call already surfaced the server message
		return;
	}

	if (!rows.length) {
		frappe.msgprint(__("Production Template {0} has no item rows.", [template]));
		return;
	}

	const stock_entry_type = await frappe.db.get_value(
		"Production Template",
		template,
		"stock_entry_type"
	);
	const tpl_type = (stock_entry_type.message || {}).stock_entry_type;
	if (tpl_type && tpl_type !== frm.doc.stock_entry_type) {
		await frm.set_value("stock_entry_type", tpl_type);
	}

	if (!append_mode) {
		frm.clear_table("items");
	}

	rows.forEach((row) => {
		frm.add_child("items", {
			item_code: row.item_code,
			item_name: row.item_name,
			qty: row.qty,
			uom: row.uom,
			stock_uom: row.stock_uom,
			conversion_factor: row.conversion_factor,
			transfer_qty: row.transfer_qty,
			// A row is either consumed (source only) or produced (target only).
			// The server has already picked the side; null clears whatever the
			// header default stamped on the new row.
			s_warehouse: row.s_warehouse || null,
			t_warehouse: row.t_warehouse || null,
			is_finished_item: row.is_finished_item,
			is_scrap_item: row.is_scrap_item,
		});
	});

	frm.refresh_field("items");
	frm.dirty();
	frappe.show_alert(
		{
			message: __("Loaded {0} row(s) from {1}. Rates and amounts fill in on save.", [
				rows.length,
				template,
			]),
			indicator: "green",
		},
		7
	);
}

function save_as_template(frm) {
	const d = new frappe.ui.Dialog({
		title: __("Save as Production Template"),
		fields: [
			{
				fieldname: "template_name",
				fieldtype: "Data",
				label: __("Template Name"),
				reqd: 1,
				default: __("{0} Template", [frm.doc.stock_entry_type || "Production"]),
			},
			{
				fieldname: "keep_qty",
				fieldtype: "Check",
				label: __("Keep quantities (uncheck to save a blank-quantity template)"),
				default: 1,
			},
		],
		primary_action_label: __("Create"),
		async primary_action(values) {
			d.hide();
			const items = (frm.doc.items || [])
				.filter((r) => r.item_code)
				.map((r) => ({
					doctype: "Production Template Item",
					item_code: r.item_code,
					qty: values.keep_qty ? flt(r.qty) : 0,
					uom: r.uom,
					s_warehouse: r.s_warehouse,
					t_warehouse: r.t_warehouse,
					is_finished_item: r.is_finished_item ? 1 : 0,
					is_scrap_item: r.is_scrap_item ? 1 : 0,
				}));

			try {
				const doc = await frappe.db.insert({
					doctype: "Production Template",
					template_name: values.template_name,
					company: frm.doc.company,
					stock_entry_type: frm.doc.stock_entry_type,
					items: items,
				});
				frappe.show_alert({
					message: __("Created {0} with {1} row(s)", [doc.name, items.length]),
					indicator: "green",
				});
				frappe.set_route("Form", "Production Template", doc.name);
			} catch (e) {
				// server-side validation message is already shown
			}
		},
	});
	d.show();
}
