import frappe


def run():
	from badria_pwa.api.sales_collection import get_sales_collection_data

	for kwargs in [
		{"sales_person": "Ramu"},
		{"warehouse": "Stores - E"},
	]:
		result = get_sales_collection_data(from_date="2020-01-01", to_date="2030-01-01", **kwargs)
		print("FILTER:", kwargs)
		print("  totals:", result["totals"])
		for r in result["rows"]:
			print("  row:", dict(r))
