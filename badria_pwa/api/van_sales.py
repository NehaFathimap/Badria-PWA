# badria_pwa.api.van_sales - Van Sales API (adapted from EnfonoTech/Van-Sales-PWA)
import frappe
import json
import hashlib
import secrets
from datetime import datetime, timedelta
from frappe import _, ValidationError
from frappe.utils import getdate, flt, cint, nowdate, add_days, get_datetime, nowtime, today, strip_html, get_url

try:
    from erpnext.stock.stock_ledger import NegativeStockError
except ImportError:
    NegativeStockError = Exception  # fallback if erpnext not installed


def _resolve_login_id(login_input):
    """
    Resolve login input (email or username) to User document name.
    Frappe User.name can be email, or a short id; User also has .email and .username.
    """
    if not login_input or not isinstance(login_input, str):
        return None
    login_input = login_input.strip()
    if not login_input:
        return None
    # 1. Match by User name (Frappe primary key)
    if frappe.db.exists("User", login_input):
        return login_input
    # 2. Match by email
    user_id = frappe.db.get_value("User", {"email": login_input}, "name")
    if user_id:
        return user_id
    # 3. Match by username if System Settings allow it
    if cint(frappe.db.get_single_value("System Settings", "allow_login_using_user_name")):
        user_id = frappe.db.get_value("User", {"username": login_input}, "name")
        if user_id:
            return user_id
    return None


@frappe.whitelist(allow_guest=True, methods=["POST"])
def login():
    """
    Custom login API using email or username and password
    
    Method: POST
    URL: /api/method/badria_pwa.api.van_sales.login
    Content-Type: application/json
    
    Body:
    {
        "email": "user@example.com" or "username",
        "password": "your_password"
    }
    
    Returns:
        JSON with authentication token and user details
    """
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        login_input = data.get("email") or data.get("usr")  # support both "email" and "usr"
        password = data.get("password") or data.get("pwd")
        
        if not login_input or not password:
            return {
                "status": "error",
                "message": "Email/username and password are required"
            }
        
        user_id = _resolve_login_id(login_input)
        if not user_id:
            return {
                "status": "error",
                "message": "Invalid email or password"
            }
        
        try:
            frappe.auth.check_password(user_id, password)
        except frappe.exceptions.AuthenticationError:
            return {
                "status": "error",
                "message": "Invalid email or password"
            }
        
        user = frappe.get_doc("User", user_id)
        
        if user.enabled == 0:
            return {
                "status": "error",
                "message": "User account is disabled"
            }
        
        api_key = user.api_key
        api_secret = None
        
        if not api_key:
            api_key = frappe.generate_hash(length=15)
            api_secret = frappe.generate_hash(length=15)
            
            user.api_key = api_key
            user.api_secret = api_secret
            user.save(ignore_permissions=True)
            frappe.db.commit()
        else:
            api_secret = user.get_password('api_secret')
        
        token = generate_custom_token(user_id)
        
        return {
            "status": "success",
            "message": "Login successful",
            "data": {
                "user": user_id,
                "full_name": user.full_name,
                "user_image": user.user_image,
                "token": token,
                "api_key": api_key,
                "api_secret": api_secret,
                "expires_in": 86400 
            }
        }
        
    except Exception as e:
        frappe.log_error("Login API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=True, methods=["POST"])
def validate_token():
    """
    Validate authentication token
    
    Method: POST
    URL: /api/method/your_app.api.validate_token
    Content-Type: application/json
    
    Body:
    {
        "token": "your_token_here"
    }
    
    Returns:
        JSON with validation status and user details
    """
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        token = data.get("token")
        
        if not token:
            return {
                "status": "error",
                "message": "Token is required"
            }
        
        user_email = verify_custom_token(token)
        
        if not user_email:
            return {
                "status": "error",
                "message": "Invalid or expired token"
            }
        
        user = frappe.get_doc("User", user_email)
        
        return {
            "status": "success",
            "message": "Token is valid",
            "data": {
                "user": user_email,
                "full_name": user.full_name,
                "user_image": user.user_image
            }
        }
        
    except Exception as e:
        frappe.log_error("Validate Token Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["POST"])
def logout():
    """
    Logout API - invalidates the current session token
    
    Method: POST
    URL: /api/method/your_app.api.logout
    Headers:
        Authorization: Bearer <token>
    
    Returns:
        JSON with logout confirmation
    """
    try:
        auth_header = frappe.get_request_header("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            invalidate_custom_token(token)
        
        frappe.local.login_manager.logout()
        
        return {
            "status": "success",
            "message": "Logged out successfully"
        }
        
    except Exception as e:
        frappe.log_error("Logout API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


def generate_custom_token(user_email):
    """Generate a custom token for user authentication"""
    token = secrets.token_urlsafe(32)
    expiry = datetime.now() + timedelta(hours=24)
    
    frappe.cache().set_value(
        f"auth_token:{token}",
        {
            "user": user_email,
            "expiry": expiry.isoformat()
        },
        expires_in_sec=86400  
    )
    
    return token


def verify_custom_token(token):
    """Verify custom token and return user email"""
    token_data = frappe.cache().get_value(f"auth_token:{token}")
    
    if not token_data:
        return None
    
    expiry = datetime.fromisoformat(token_data["expiry"])
    if datetime.now() > expiry:
        frappe.cache().delete_value(f"auth_token:{token}")
        return None
    
    return token_data["user"]


def invalidate_custom_token(token):
    """Invalidate a custom token"""
    frappe.cache().delete_value(f"auth_token:{token}")


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_user_company():
    """
    Return the company for the current user (from User Permission or user default).
    Frontend can use this for display or to pass in create_sales_invoice; if omitted, backend resolves it.
    """
    company = _get_user_company()
    return {"status": "success", "company": company} if company else {"status": "error", "message": "No company set for user"}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_user_info():
    """
    Return current user information (name, email, full_name, user_image, company).
    """
    try:
        user = frappe.session.user
        if not user or user == "Guest":
            return {"status": "error", "message": "Not authenticated"}
        
        user_doc = frappe.get_doc("User", user)
        company = _get_user_company()
        
        return {
            "status": "success",
            "name": user_doc.name,
            "full_name": user_doc.full_name or user_doc.name,
            "email": user_doc.email or "",
            "user_image": user_doc.user_image or "",
            "company": company or "",
        }
    except Exception as e:
        frappe.log_error("Get User Info Error", frappe.get_traceback())
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_csrf_token():
    """
    Return the current session's CSRF token. PWA/clients must send this as
    X-Frappe-CSRF-Token header on every POST/PUT/DELETE request.
    """
    from frappe.sessions import get_csrf_token as _get_csrf_token
    return _get_csrf_token()


# Allowed doctypes for PWA print (submitted docs only, default print format + doc letterhead)
_PWA_PRINT_DOCTYPES = frozenset({
    "Sales Invoice", "Sales Order", "Quotation", "Payment Entry",
})
_PWA_PRINT_TOKEN_PREFIX = "pwa_print:"
_PWA_PRINT_TOKEN_TTL = 120  # seconds


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_print_pdf_token(doctype=None, name=None):
    """
    Return a short-lived one-time token to open print PDF via URL (no blob).
    Frontend can then open: /api/method/badria_pwa.api.van_sales.get_print_pdf?doctype=X&name=Y&token=...
    """
    doctype = doctype or frappe.form_dict.get("doctype")
    name = name or frappe.form_dict.get("name")
    if not doctype or not name:
        frappe.throw(_("doctype and name are required"), frappe.ValidationError)
    if doctype not in _PWA_PRINT_DOCTYPES:
        frappe.throw(_("Print not allowed for this document type"), frappe.PermissionError)
    doc = frappe.get_doc(doctype, name)
    if cint(doc.docstatus) != 1:
        frappe.throw(_("Only submitted documents can be printed"), frappe.ValidationError)
    doc.check_permission("print")
    token = secrets.token_urlsafe(32)
    cache_key = _PWA_PRINT_TOKEN_PREFIX + token
    frappe.cache().set_value(cache_key, {"doctype": doctype, "name": name}, expires_in_sec=_PWA_PRINT_TOKEN_TTL)
    return {"status": "success", "token": token}


def _get_print_pdf_with_token_or_auth():
    """Common logic: resolve doctype/name from token or request, validate, return PDF."""
    doctype = frappe.form_dict.get("doctype")
    name = frappe.form_dict.get("name")
    token = frappe.form_dict.get("token")
    if token:
        cache_key = _PWA_PRINT_TOKEN_PREFIX + token
        payload = frappe.cache().get_value(cache_key)
        if not payload:
            frappe.throw(_("Print link expired or invalid. Please try again."), frappe.ValidationError)
        frappe.cache().delete_value(cache_key)
        doctype = payload.get("doctype")
        name = payload.get("name")
    if not doctype or not name:
        frappe.throw(_("doctype and name are required"), frappe.ValidationError)
    if doctype not in _PWA_PRINT_DOCTYPES:
        frappe.throw(_("Print not allowed for this document type"), frappe.PermissionError)
    doc = frappe.get_doc(doctype, name)
    if cint(doc.docstatus) != 1:
        frappe.throw(_("Only submitted documents can be printed"), frappe.ValidationError)
    if not token:
        doc.check_permission("print")
    meta = frappe.get_meta(doctype)
    print_format = meta.default_print_format or "Standard"
    letterhead = doc.get("letter_head") or None
    frappe.local.flags.ignore_print_permissions = True
    try:
        pdf_content = frappe.get_print(
            doctype,
            name,
            print_format=print_format,
            doc=doc,
            as_pdf=True,
            letterhead=letterhead,
            no_letterhead=0,
        )
    finally:
        frappe.local.flags.ignore_print_permissions = False
    safe_name = str(name).replace(" ", "-").replace("/", "-")
    frappe.local.response.filename = f"{safe_name}.pdf"
    frappe.local.response.filecontent = pdf_content
    frappe.local.response.type = "pdf"


@frappe.whitelist(allow_guest=True, methods=["GET"])
def get_print_pdf(doctype=None, name=None):
    """
    Return PDF for a submitted document using default print format and document's letterhead.
    Call with ?token=... (from get_print_pdf_token) to open in new tab without auth; or with auth header.
    No hardcoded print format: uses DocType default_print_format or Standard.
    Letterhead from doc.letter_head or default letterhead.
    Only allowed for submitted docs (docstatus == 1).
    """
    _get_print_pdf_with_token_or_auth()


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_items_list():
    """
    API to list all items with filtering and pagination
    """

    try:
        filters = {}

        customer = frappe.form_dict.get("customer")

        item_group = frappe.form_dict.get("item_group")
        if item_group:
            filters["item_group"] = item_group

        is_stock_item = frappe.form_dict.get("is_stock_item")
        if is_stock_item is not None:
            filters["is_stock_item"] = cint(is_stock_item)

        is_sales_item = frappe.form_dict.get("is_sales_item")
        if is_sales_item is not None:
            filters["is_sales_item"] = cint(is_sales_item)

        disabled = frappe.form_dict.get("disabled")
        if disabled is not None:
            filters["disabled"] = cint(disabled)

        search = frappe.form_dict.get("search")
        if search:
            filters["item_code"] = ["like", f"%{search}%"]

        limit = cint(frappe.form_dict.get("limit", 20))
        offset = cint(frappe.form_dict.get("offset", 0))

        order_by = frappe.form_dict.get("order_by", "item_name")
        order = frappe.form_dict.get("order", "asc")

        items = frappe.get_all(
            "Item",
            filters=filters,
            fields=[
                "name",
                "item_code",
                "item_name",
                "item_group",
                "stock_uom",
                "sales_uom",
                "description",
                "is_stock_item",
                "is_sales_item",
                "valuation_rate",
                "standard_rate",
                "image",
                "disabled",
                "creation",
                "modified"
            ],
            order_by=f"{order_by} {order}",
            limit_page_length=limit,
            limit_start=offset
        )

        # Note: Item prices are resolved per-UOM when adding to a transaction via get_item_details
        # (price list + optional customer). No per-UOM rates attached here; frontend uses
        # standard_rate/valuation_rate for list display only.

        total_count = frappe.db.count("Item", filters=filters)

        return {
            "status": "success",
            "count": len(items),
            "total": total_count,
            "limit": limit,
            "offset": offset,
            "data": items
        }

    except Exception as e:
        frappe.log_error("Get Items List Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


# @frappe.whitelist(allow_guest=False, methods=["GET"])
# def get_item_details():
#     """
#     API to get detailed information about a specific item
#     """

#     try:
#         item_code = frappe.form_dict.get("item_code")
#         customer = frappe.form_dict.get("customer")  # optional

#         if not item_code:
#             return {
#                 "status": "error",
#                 "message": "item_code is required"
#             }

#         if not frappe.db.exists("Item", item_code):
#             return {
#                 "status": "error",
#                 "message": f"Item '{item_code}' not found"
#             }

#         item = frappe.get_doc("Item", item_code)

#         # ------------------------------------------------
#         # USER + WAREHOUSE CONTEXT (Accounts only)
#         # ------------------------------------------------
#         user = frappe.get_doc("User", frappe.session.user)
#         user_warehouse = None

#         if user.role_profile_name == "Accounts":
#             user_warehouse = frappe.db.get_value(
#                 "User Permission",
#                 {
#                     "user": frappe.session.user,
#                     "allow": "Warehouse"
#                 },
#                 "for_value"
#             )

#             if not user_warehouse:
#                 frappe.throw("No Warehouse User Permission found for this user")

#         # ------------------------------------------------
#         # UOM CONVERSIONS
#         # ------------------------------------------------
#         uom_conversions = []
#         for u in item.uoms:
#             uom_conversions.append({
#                 "uom": u.uom,
#                 "conversion_factor": u.conversion_factor
#             })

#         # ------------------------------------------------
#         # STOCK LEVELS (WAREHOUSE RESTRICTED)
#         # ------------------------------------------------
#         stock_filters = {"item_code": item_code}
#         if user_warehouse:
#             stock_filters["warehouse"] = user_warehouse

#         stock_levels = []
#         if item.is_stock_item:
#             stock_levels = frappe.get_all(
#                 "Bin",
#                 filters=stock_filters,
#                 fields=[
#                     "warehouse",
#                     "actual_qty",
#                     "reserved_qty",
#                     "ordered_qty",
#                     "projected_qty"
#                 ]
#             )

#         # ------------------------------------------------
#         # ITEM PRICES (RAW – FOR REFERENCE)
#         # ------------------------------------------------
#         item_prices = frappe.get_all(
#             "Item Price",
#             filters={"item_code": item_code},
#             fields=[
#                 "price_list",
#                 "price_list_rate",
#                 "currency",
#                 "uom",
#                 "customer",
#                 "valid_from",
#                 "valid_upto",
#                 "modified"
#             ],
#             order_by="modified desc, creation desc",
#         )

#         # ------------------------------------------------
#         # RATES (Nos / Carton)
#         # ------------------------------------------------
#         rates = {"Nos": 0, "Carton": 0}

#         for uom in ["Nos", "Carton"]:
#             rate = None

#             # 1️⃣ Last Sales Invoice rate for customer
#             if customer:
#                 res = frappe.db.sql("""
#                     SELECT sii.rate
#                     FROM `tabSales Invoice Item` sii
#                     INNER JOIN `tabSales Invoice` si
#                         ON si.name = sii.parent
#                     WHERE
#                         si.customer = %s
#                         AND sii.item_code = %s
#                         AND sii.uom = %s
#                         AND si.docstatus = 1
#                     ORDER BY si.posting_date DESC, si.creation DESC
#                     LIMIT 1
#                 """, (customer, item_code, uom))
#                 rate = res[0][0] if res else None

#             # 2️⃣ Customer-specific Item Price
#             if rate is None and customer:
#                 rate = frappe.db.get_value(
#                     "Item Price",
#                     {
#                         "item_code": item_code,
#                         "uom": uom,
#                         "customer": customer,
#                         "selling": 1
#                     },
#                     "price_list_rate"
#                 )

#             # 3️⃣ Fallback → Standard Selling Price
#             if rate is None:
#                 rate = frappe.db.get_value(
#                     "Item Price",
#                     {
#                         "item_code": item_code,
#                         "uom": uom,
#                         "selling": 1,
#                         "customer": ["is", "not set"]
#                     },
#                     "price_list_rate"
#                 )

#             rates[uom] = flt(rate or 0)

#         # ------------------------------------------------
#         # STANDARD RATE (SPECIAL LOGIC)
#         # ------------------------------------------------
#         resolved_standard_rate = None

#         # 1️⃣ Latest price list for this customer
#         if customer:
#             res = frappe.db.sql("""
#                 SELECT ip.price_list_rate
#                 FROM `tabItem Price` ip
#                 WHERE
#                     ip.item_code = %s
#                     AND ip.selling = 1
#                     AND ip.customer = %s
#                 ORDER BY ip.modified DESC, ip.creation DESC
#                 LIMIT 1
#             """, (item_code, customer))

#             resolved_standard_rate = res[0][0] if res else None

#         # 2️⃣ Second latest price list (no customer)
#         if resolved_standard_rate is None:
#             res = frappe.db.sql("""
#                 SELECT ip.price_list_rate
#                 FROM `tabItem Price` ip
#                 WHERE
#                     ip.item_code = %s
#                     AND ip.selling = 1
#                     AND ip.customer IS NULL
#                 ORDER BY ip.modified DESC, ip.creation DESC
#                 LIMIT 1 OFFSET 1
#             """, (item_code,))

#             resolved_standard_rate = res[0][0] if res else None

#         # 3️⃣ Final fallback
#         standard_rate = flt(resolved_standard_rate or item.standard_rate)

#         # ------------------------------------------------
#         # RESPONSE
#         # ------------------------------------------------
#         return {
#             "status": "success",
#             "data": {
#                 "item_code": item.item_code,
#                 "item_name": item.item_name,
#                 "item_group": item.item_group,
#                 "sales_uom": item.sales_uom,
#                 "stock_uom": item.stock_uom,
#                 "description": item.description,
#                 "is_stock_item": item.is_stock_item,
#                 "is_sales_item": item.is_sales_item,
#                 "valuation_rate": item.valuation_rate,
#                 "standard_rate": standard_rate,
#                 "image": item.image,
#                 "disabled": item.disabled,
#                 "has_variants": item.has_variants,
#                 "variant_of": item.variant_of,

#                 # ✅ Added logic outputs
#                 "rates": rates,

#                 "uom_conversions": uom_conversions,
#                 "stock_levels": stock_levels,
#                 "item_prices": item_prices,
#                 "creation": str(item.creation),
#                 "modified": str(item.modified)
#             }
#         }

#     except Exception as e:
#         frappe.log_error("Get Item Details Error", frappe.get_traceback())
#         return {
#             "status": "error",
#             "message": str(e)
#         }




@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_item_details():
    """
    Frontend sends:
        ?item_code=XXX  (customer optional; not used for price lookup)

    Backend:
        - Price from Price List (Standard Selling) only; does NOT use customer in Item Price.
        - Stock from Item Default warehouse, else all warehouses.
    """

    try:
        item_code = frappe.form_dict.get("item_code")
        customer_param = frappe.form_dict.get("customer")  # optional; not used for price
        logged_user = frappe.session.user

        # -----------------------------
        # VALIDATION
        # -----------------------------
        if not item_code:
            return {"status": "error", "message": "item_code is required"}

        if not frappe.db.exists("Item", item_code):
            return {"status": "error", "message": f"Item '{item_code}' not found"}

        # ------------------------------------------------
        # RESOLVE CUSTOMER (OPTIONAL – for response only, not for price)
        # ------------------------------------------------
        customer = None
        if customer_param:
            customer = frappe.db.get_value(
                "Customer",
                {"name": customer_param, "disabled": 0},
                "name"
            )
            if not customer:
                customer = frappe.db.get_value(
                    "Customer",
                    {"customer_name": customer_param, "disabled": 0},
                    "name"
                )
            if not customer:
                customer = frappe.db.get_value(
                    "Customer",
                    {"custom_customer_name_arabic": customer_param, "disabled": 0},
                    "name"
                )

        item = frappe.get_doc("Item", item_code)

        # ------------------------------------------------
        # WAREHOUSE → ITEM DEFAULT, ELSE ALL
        # ------------------------------------------------
        warehouse = frappe.db.get_value(
            "Item Default",
            {"parent": item_code},
            "default_warehouse"
        )

        # ------------------------------------------------
        # UOM CONVERSIONS
        # ------------------------------------------------
        uom_conversions = [
            {"uom": u.uom, "conversion_factor": u.conversion_factor}
            for u in item.uoms
        ]

        uoms = [item.stock_uom]
        for u in item.uoms:
            if u.uom not in uoms:
                uoms.append(u.uom)

        # ------------------------------------------------
        # STOCK LEVELS
        # ------------------------------------------------
        stock_levels = []

        if item.is_stock_item:
            if warehouse:
                stock_levels = frappe.get_all(
                    "Bin",
                    filters={"item_code": item_code, "warehouse": warehouse},
                    fields=[
                        "warehouse",
                        "actual_qty",
                        "reserved_qty",
                        "ordered_qty",
                        "projected_qty"
                    ]
                )
            else:
                stock_levels = frappe.get_all(
                    "Bin",
                    filters={"item_code": item_code},
                    fields=[
                        "warehouse",
                        "actual_qty",
                        "reserved_qty",
                        "ordered_qty",
                        "projected_qty"
                    ]
                )

        # ------------------------------------------------
        # ITEM PRICES (FROM PRICE LIST ONLY – NO CUSTOMER)
        # ------------------------------------------------
        item_prices = frappe.get_all(
            "Item Price",
            filters=[
                ["item_code", "=", item_code],
                ["price_list", "=", "Standard Selling"],
                ["customer", "is", "not set"],
            ],
            fields=[
                "price_list",
                "price_list_rate",
                "currency",
                "uom",
                "customer",
                "owner",
                "valid_from",
                "valid_upto",
                "modified",
                "creation"
            ],
            order_by="modified desc, creation desc"
        )

        # ------------------------------------------------
        # RATES FROM PRICE LIST ONLY (no customer in Item Price)
        # ------------------------------------------------
        rates = {}
        for uom in uoms:
            rate = None
            # Item Price: price_list + item + uom, customer not set (blank)
            price_row = frappe.get_all(
                "Item Price",
                filters=[
                    ["item_code", "=", item_code],
                    ["price_list", "=", "Standard Selling"],
                    ["uom", "=", uom],
                    ["customer", "is", "not set"],
                ],
                fields=["price_list_rate"],
                order_by="modified desc, creation desc",
                limit_page_length=1
            )
            if price_row:
                rate = price_row[0].price_list_rate
            rates[uom] = flt(rate or 0, 2)

        # ------------------------------------------------
        # STANDARD RATE (2 decimal places)
        # ------------------------------------------------
        standard_rate = flt(
            rates.get(item.sales_uom)
            or rates.get(item.stock_uom)
            or flt(item.standard_rate),
            2,
        )

        # ------------------------------------------------
        # RESPONSE
        # ------------------------------------------------
        return {
            "status": "success",
            "warehouse": warehouse,
            "customer": {
                "input": customer_param,
                "customer_id": customer
            },
            "data": {
                "item_code": item.item_code,
                "item_name": item.item_name,
                "item_group": item.item_group,
                "sales_uom": item.sales_uom,
                "stock_uom": item.stock_uom,
                "description": item.description,
                "is_stock_item": item.is_stock_item,
                "is_sales_item": item.is_sales_item,
                "valuation_rate": flt(item.valuation_rate, 2),
                "standard_rate": standard_rate,
                "disabled": item.disabled,

                "rates": rates,
                "uom_conversions": uom_conversions,
                "stock_levels": stock_levels,
                "item_prices": [
                    {**ip, "price_list_rate": flt(ip.get("price_list_rate"), 2)}
                    for ip in (item_prices or [])
                ],

                "creation": str(item.creation),
                "modified": str(item.modified)
            }
        }

    except Exception:
        frappe.log_error("Get Item Details Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": "Internal Server Error"
        }



@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_item():
    """
    API to create a new item
    
    Method: POST
    URL: /api/method/your_app.api.create_item
    Content-Type: application/json
    
    Body:
    {
        "item_code": "ITEM-001",
        "item_name": "Product Name",
        "item_group": "Products",
        "stock_uom": "Nos",
        "description": "Product description",
        "is_stock_item": 1,
        "is_sales_item": 1,
        "valuation_rate": 100,
        "standard_rate": 150
    }
    
    Returns:
        JSON with created item details
    """
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        item_code = data.get("item_code")
        item_name = data.get("item_name")
        
        if not item_code or not item_name:
            return {
                "status": "error",
                "message": "item_code and item_name are required"
            }
        
        if frappe.db.exists("Item", item_code):
            return {
                "status": "error",
                "message": f"Item '{item_code}' already exists"
            }
        
        item_doc = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_name,
            "item_group": data.get("item_group", "Products"),
            "stock_uom": data.get("stock_uom", "Nos"),
            "description": data.get("description"),
            "is_stock_item": cint(data.get("is_stock_item", 1)),
            "is_sales_item": cint(data.get("is_sales_item", 1)),
            "valuation_rate": flt(data.get("valuation_rate", 0)),
            "standard_rate": flt(data.get("standard_rate", 0))
        })
        
        item_doc.insert(ignore_permissions=True)
        frappe.db.commit()
        
        return {
            "status": "success",
            "message": f"Item '{item_code}' created successfully",
            "data": {
                "item_code": item_doc.item_code,
                "item_name": item_doc.item_name,
                "item_group": item_doc.item_group
            }
        }
        
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Create Item API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["PUT", "POST"])
def update_item():
    """
    API to update an existing item
    
    Method: PUT or POST
    URL: /api/method/your_app.api.update_item
    Content-Type: application/json
    
    Body:
    {
        "item_code": "ITEM-001",
        "item_name": "Updated Product Name",
        "description": "Updated description",
        "standard_rate": 200
    }
    
    Returns:
        JSON with updated item details
    """
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        item_code = data.get("item_code")
        
        if not item_code:
            return {
                "status": "error",
                "message": "item_code is required"
            }
        
        if not frappe.db.exists("Item", item_code):
            return {
                "status": "error",
                "message": f"Item '{item_code}' not found"
            }
        
        item_doc = frappe.get_doc("Item", item_code)
        
        updatable_fields = [
            "item_name", "description", "standard_rate", 
            "valuation_rate", "disabled"
        ]
        
        for field in updatable_fields:
            if field in data:
                setattr(item_doc, field, data[field])
        
        item_doc.save(ignore_permissions=True)
        frappe.db.commit()
        
        return {
            "status": "success",
            "message": f"Item '{item_code}' updated successfully",
            "data": {
                "item_code": item_doc.item_code,
                "item_name": item_doc.item_name,
                "standard_rate": item_doc.standard_rate
            }
        }
        
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Update Item API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }




def ensure_uom_exists(uom):
    """Create UOM if it doesn't exist"""
    if uom and not frappe.db.exists("UOM", uom):
        frappe.get_doc({
            "doctype": "UOM",
            "uom_name": uom
        }).insert(ignore_permissions=True)
        frappe.logger().info(f"✅ Created UOM: {uom}")


def ensure_uom_conversion(item_code, from_uom, to_uom, conversion_factor):
    """Create or update UOM conversion factor for an item"""
    if not from_uom or not to_uom or from_uom == to_uom:
        return
    
    existing = frappe.db.get_value(
        "UOM Conversion Detail",
        {
            "parent": item_code,
            "uom": from_uom
        },
        ["name", "conversion_factor"],
        as_dict=True
    )
    
    if existing:
        if flt(existing.conversion_factor) != flt(conversion_factor):
            frappe.db.set_value(
                "UOM Conversion Detail",
                existing.name,
                "conversion_factor",
                conversion_factor
            )
            frappe.logger().info(f"🔄 Updated UOM conversion for {item_code}: {from_uom} = {conversion_factor} {to_uom}")
    else:
        item_doc = frappe.get_doc("Item", item_code)
        item_doc.append("uoms", {
            "uom": from_uom,
            "conversion_factor": conversion_factor
        })
        item_doc.save(ignore_permissions=True)
        frappe.logger().info(f"✅ Added UOM conversion for {item_code}: {from_uom} = {conversion_factor} {to_uom}")


def create_or_update_customer(customer_data):
    """Create customer if not exists, update if exists"""
    customer_name = customer_data.get("customer_name")
    
    if frappe.db.exists("Customer", customer_name):
        customer_doc = frappe.get_doc("Customer", customer_name)
        updated = False
        
        if customer_data.get("tax_id") and customer_doc.tax_id != customer_data.get("tax_id"):
            customer_doc.tax_id = customer_data.get("tax_id")
            updated = True
            
        if customer_data.get("customer_group") and customer_doc.customer_group != customer_data.get("customer_group"):
            customer_doc.customer_group = customer_data.get("customer_group")
            updated = True
            
        if updated:
            customer_doc.save(ignore_permissions=True)
            frappe.logger().info(f"🔄 Updated customer: {customer_name}")
    else:
        customer_doc = frappe.get_doc({
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": customer_data.get("customer_type", "Company"),
            "customer_group": customer_data.get("customer_group", "Commercial"),
            "territory": customer_data.get("territory", "Saudi Arabia"),
            "tax_id": customer_data.get("tax_id")
        })
        customer_doc.insert(ignore_permissions=True)
        frappe.logger().info(f"✅ Created new customer: {customer_name}")
    
    return customer_name


def ensure_item_exists(item_data):
    """Create item if it doesn't exist, update if exists"""
    item_code = item_data.get("item_code")
    
    if frappe.db.exists("Item", item_code):
        item_doc = frappe.get_doc("Item", item_code)
        updated = False
        
        if item_data.get("item_name") and item_doc.item_name != item_data.get("item_name"):
            item_doc.item_name = item_data.get("item_name")
            updated = True
        
        if item_data.get("description") and item_doc.description != item_data.get("description"):
            item_doc.description = item_data.get("description")
            updated = True
            
        if updated:
            item_doc.save(ignore_permissions=True)
            frappe.logger().info(f"🔄 Updated item: {item_code}")
    else:
        is_stock_item = item_data.get("is_stock_item", 1)
        
        item_doc = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_data.get("item_name"),
            "item_group": item_data.get("item_group", "Products"),
            "stock_uom": item_data.get("stock_uom", "Nos"),
            "description": item_data.get("description"),
            "is_stock_item": is_stock_item,
            "is_sales_item": 1,
            "include_item_in_manufacturing": 0,
            "valuation_rate": item_data.get("valuation_rate", 0)
        })
        item_doc.insert(ignore_permissions=True)
        frappe.logger().info(f"✅ Created new item: {item_code}")


def _get_user_company():
    """
    Get company from current user's User Permission (allow=Company).
    Falls back to user default Company if no User Permission.
    """
    user = frappe.session.user
    if not user or user == "Guest":
        return None
    company = frappe.db.get_value(
        "User Permission",
        {"user": user, "allow": "Company"},
        "for_value"
    )
    if company:
        return company
    company = frappe.defaults.get_user_default("Company")
    return company


def _get_user_sales_person():
    """
    Get Sales Person for current user.
    Resolves: User -> Employee (user_id) -> Sales Person (employee)
    Returns Sales Person name or None if not found.
    Note: Sales Person doctype doesn't have a direct 'user' field, only links via Employee.
    """
    user = frappe.session.user
    if not user or user == "Guest":
        return None
    
    # Sales Person is linked via Employee (employee field), not User.
    # Resolve: User -> Employee (user_id) -> Sales Person (employee)
    employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if employee:
        sales_person = frappe.db.get_value("Sales Person", {"employee": employee}, "name")
        if sales_person:
            return sales_person
    
    # If no Sales Person found, return None (caller can handle)
    return None


def get_default_warehouse(company):
    """Get default warehouse for company"""
    warehouse = frappe.db.get_value(
        "Warehouse",
        {
            "company": company,
            "is_group": 0,
            "disabled": 0
        },
        "name"
    )
    
    if not warehouse:
        warehouse = frappe.db.get_value(
            "Warehouse",
            {"company": company, "disabled": 0},
            "name"
        )
    
    return warehouse


def _get_user_cost_center(company):
    """
    Get cost center from current user's User Permission (allow=Cost Center).
    Falls back to company default cost_center, then first leaf Cost Center for company.
    """
    if not company:
        return None
    user = frappe.session.user
    if not user or user == "Guest":
        pass
    else:
        cost_center = frappe.db.get_value(
            "User Permission",
            {"user": user, "allow": "Cost Center"},
            "for_value"
        )
        if cost_center and frappe.db.exists("Cost Center", cost_center):
            cc_company = frappe.db.get_value("Cost Center", cost_center, "company")
            if cc_company == company:
                return cost_center
    company_doc = frappe.get_doc("Company", company)
    if getattr(company_doc, "cost_center", None):
        return company_doc.cost_center
    cost_center = frappe.db.get_value(
        "Cost Center",
        {"company": company, "is_group": 0, "disabled": 0},
        "name"
    )
    if cost_center:
        return cost_center
    cost_center = frappe.db.get_value(
        "Cost Center",
        {"company": company, "disabled": 0},
        "name"
    )
    return cost_center


def build_consolidated_taxes(company):
    """Build tax rows from company default tax template"""
    tax_rows = []
    
    default_template = frappe.db.get_value(
        "Sales Taxes and Charges Template",
        {"company": company, "is_default": 1},
        "name"
    )
    
    if default_template:
        template_doc = frappe.get_doc("Sales Taxes and Charges Template", default_template)
        for row in template_doc.taxes:
            tax_rows.append({
                "charge_type": row.charge_type,
                "account_head": row.account_head,
                "rate": row.rate,
                "description": row.description or f"Tax @ {row.rate}%"
            })
    
    return tax_rows



@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_customers_list():
    """
    API: Customers list with calculated outstanding balance

    Only for logged-in users. Shows customers assigned to the current user:
    - Sales Team: Customer's Sales Team contains current user's Sales Person (Employee -> Sales Person), OR
    - Owner: Customer owner is current user, OR
    - ToDo: Customer is assigned to current user via ToDo (allocated_to).

    Used by Sales, Quotations, Sales Orders, Returns, and Payment Collection.

    Outstanding:
    - ONLY for invoices created by the logged-in user
    """

    try:
        filters = {}

        customer_group = frappe.form_dict.get("customer_group")
        if customer_group:
            filters["customer_group"] = customer_group

        territory = frappe.form_dict.get("territory")
        if territory:
            filters["territory"] = territory

        disabled = frappe.form_dict.get("disabled")
        if disabled is not None:
            filters["disabled"] = cint(disabled)

        # -------------------------------------------------
        # LOGGED-IN CONTEXT
        # Sales Person is linked via Employee (employee field), not User.
        # Resolve: User -> Employee (user_id) -> Sales Person (employee)
        # -------------------------------------------------
        current_user = frappe.session.user

        employee = frappe.db.get_value("Employee", {"user_id": current_user}, "name")
        sales_person = None
        if employee:
            sales_person = frappe.db.get_value("Sales Person", {"employee": employee}, "name")

        # -------------------------------------------------
        # FETCH BASE CUSTOMER LIST
        # -------------------------------------------------
        customers = frappe.get_all(
            "Customer",
            filters=filters,
            fields=[
                "name",
                "customer_name",
                "owner",
                "custom_customer_name_arabic",
                "customer_type",
                "customer_group",
                "territory",
                "custom_vat_registration_number",
                "custom_cr_number",
                "disabled",
                "creation",
                "modified"
            ],
            order_by="customer_name asc"
        )

        # Customers assigned to current user via ToDo (same pattern as get_lead_list)
        assigned_customer_names = set(
            frappe.get_all(
                "ToDo",
                filters={
                    "reference_type": "Customer",
                    "allocated_to": current_user,
                    "status": ["!=", "Cancelled"],
                },
                pluck="reference_name",
            )
        )

        result = []

        # -------------------------------------------------
        # VISIBILITY: show customers assigned to current user
        # - Sales Team contains user's Sales Person, OR owner = current user, OR assigned via ToDo
        # -------------------------------------------------
        for cust in customers:
            sales_team = frappe.get_all(
                "Sales Team",
                filters={"parent": cust["name"]},
                fields=["sales_person"],
            )
            by_sales_team = bool(
                sales_person
                and sales_team
                and any(st.get("sales_person") == sales_person for st in sales_team)
            )
            by_owner = cust.get("owner") == current_user
            by_todo = cust["name"] in assigned_customer_names
            include_customer = by_sales_team or by_owner or by_todo

            if not include_customer:
                continue

            # -------------------------
            # OUTSTANDING (USER-CREATED ONLY)
            # -------------------------
            outstanding = frappe.db.sql("""
                SELECT SUM(outstanding_amount)
                FROM `tabSales Invoice`
                WHERE customer = %s
                  AND owner = %s
                  AND docstatus = 1
            """, (cust["name"], current_user))[0][0]

            cust["outstanding_amount"] = flt(outstanding or 0)

            result.append(cust)

        return {
            "status": "success",
            "count": len(result),
            "data": result
        }

    except Exception as e:
        frappe.log_error("Get Customers Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }



@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_customer():
    """
    API to create a new customer
    
    Method: POST
    URL: /api/method/your_app.api.create_customer
    Content-Type: application/json
    
    Body:
    {
        "customer_name": "ABC Company",
        "customer_type": "Company",
        "customer_group": "Commercial",
        "territory": "Saudi Arabia",
        "tax_id": "300000000000003"
    }
    
    Returns:
        JSON with customer details
    """
    try:
        if frappe.request.data:
            data = json.loads(frappe.request.data)
        else:
            data = frappe.form_dict
        
        customer_name = data.get("customer_name")
        if not customer_name:
            return {
                "status": "error",
                "message": "customer_name is required"
            }
        
        if frappe.db.exists("Customer", customer_name):
            return {
                "status": "exists",
                "message": f"Customer '{customer_name}' already exists",
                "data": {
                    "customer_name": customer_name
                }
            }
        
        doc_dict = {
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": data.get("customer_type", "Company"),
            "customer_group": data.get("customer_group", "Commercial"),
            "territory": data.get("territory", "Saudi Arabia"),
            "custom_vat_registration_number": data.get("custom_vat_registration_number"),
        }
        if data.get("custom_customer_name_arabic") is not None:
            doc_dict["custom_customer_name_arabic"] = data.get("custom_customer_name_arabic")
        customer_doc = frappe.get_doc(doc_dict)
        
        # Add sales person to sales_team with 100% contribution
        sales_person = _get_user_sales_person()
        if sales_person:
            customer_doc.append("sales_team", {
                "sales_person": sales_person,
                "allocated_percentage": 100
            })
        
        customer_doc.insert(ignore_permissions=True)
        frappe.db.commit()
        
        return {
            "status": "success",
            "message": f"Customer '{customer_name}' created successfully",
            "data": {
                "customer_name": customer_doc.name,
                "customer_type": customer_doc.customer_type,
                "customer_group": customer_doc.customer_group,
                "territory": customer_doc.territory,
                "custom_vat_registration_number": customer_doc.custom_vat_registration_number
            }
        }
        
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Customer Creation Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_customer_address():
    """
    Create Address for Customer according to custom mandatory fields.

    Required Fields:
    - customer
    - address_title
    - address_line1
    - custom_building_number
    - custom_area
    - country
    - pincode
    """

    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict

        # -------------------------
        # REQUIRED FIELDS
        # -------------------------
        customer = data.get("customer")
        address_title = data.get("address_title")
        address_line1 = data.get("address_line1")
        building = data.get("custom_building_number")
        area = data.get("custom_area")
        country = data.get("country")
        pincode = data.get("pincode")

        # -------------------------
        # VALIDATION
        # -------------------------
        if not customer:
            return {"status": "error", "message": "customer is required"}

        if not frappe.db.exists("Customer", customer):
            return {"status": "error", "message": f"Customer '{customer}' not found"}

        missing = []
        if not address_title: missing.append("address_title")
        if not address_line1: missing.append("address_line1")
        if not building: missing.append("custom_building_number")
        if not area: missing.append("custom_area")
        if not country: missing.append("country")
        if not pincode: missing.append("pincode")

        if missing:
            return {
                "status": "error",
                "message": "Missing mandatory fields",
                "missing": missing
            }

        # -------------------------
        # CREATE ADDRESS DOC
        # -------------------------
        address = frappe.get_doc({
            "doctype": "Address",
            "address_title": address_title,
            "address_type": data.get("address_type", "Billing"),

            "address_line1": address_line1,
            "custom_building_number": building,
            "custom_area": area,
            "city": data.get("city"),          # Optional
            "state": data.get("state"),        # Optional
            "country": country,
            "pincode": pincode,

            "phone": data.get("phone"),
            "email_id": data.get("email_id"),

            "is_primary_address": cint(data.get("is_primary_address", 0)),
            "is_shipping_address": cint(data.get("is_shipping_address", 0)),
            "disabled": cint(data.get("disabled", 0)),

            # ✅ LINK TO CUSTOMER
            "links": [
                {
                    "link_doctype": "Customer",
                    "link_name": customer
                }
            ]
        })

        address.insert(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": "success",
            "message": "Customer address created",
            "data": {
                "address_name": address.name,
                "customer": customer,
                "address_title": address.address_title
            }
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Create Customer Address Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["POST"])
def update_customer_address():
    """
    Update an existing Address.
    Customer must be passed from API URL (?customer=XXXX).

    Required:
    - customer (from URL)
    - address_name (in JSON body)

    Only provided fields will be updated.
    """

    try:
        # -----------------------------
        # READ JSON BODY PROPERLY
        # -----------------------------
        body = {}
        if frappe.request.data:
            try:
                body = json.loads(frappe.request.data)
            except:
                body = frappe.form_dict

        # -----------------------------
        # GET CUSTOMER FROM URL
        # -----------------------------
        customer = frappe.form_dict.get("customer")
        if not customer:
            return {"status": "error", "message": "customer is required in the API URL"}

        if not frappe.db.exists("Customer", customer):
            return {"status": "error", "message": f"Customer '{customer}' not found"}

        # -----------------------------
        # ADDRESS NAME (FROM BODY)
        # -----------------------------
        address_name = body.get("address_name")
        if not address_name:
            return {"status": "error", "message": "address_name is required"}

        if not frappe.db.exists("Address", address_name):
            return {"status": "error", "message": f"Address '{address_name}' not found"}

        # Load document
        doc = frappe.get_doc("Address", address_name)

        # -----------------------------
        # UPDATE ADDRESS FIELDS
        # Only update fields if provided
        # -----------------------------
        editable_fields = [
            "address_title", "address_type", "address_line1", "address_line2",
            "custom_building_number", "custom_area",
            "city", "state", "country", "pincode",
            "phone", "email_id",
            "is_primary_address", "is_shipping_address", "disabled"
        ]

        for field in editable_fields:
            if field in body:
                doc.set(field, body.get(field))

        # -----------------------------
        # LINK ADDRESS TO CUSTOMER
        # Always ensures correct link
        # -----------------------------
        frappe.db.delete(
            "Dynamic Link",
            {"parent": address_name, "link_doctype": "Customer"}
        )

        doc.append("links", {
            "link_doctype": "Customer",
            "link_name": customer
        })

        # -----------------------------
        # SAVE
        # -----------------------------
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": "success",
            "message": f"Address '{address_name}' updated successfully",
            "data": {
                "address_name": address_name,
                "customer": customer
            }
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Update Customer Address Error", frappe.get_traceback())
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=False, methods=["DELETE", "POST"])
def delete_customer_address(address_name=None):
    """
    Delete an Address by name.
    Query parameter: address_name (required)
    """
    try:
        address_name = address_name or frappe.form_dict.get("address_name")
        if not address_name:
            return {"status": "error", "message": "address_name is required"}
        if not frappe.db.exists("Address", address_name):
            return {"status": "error", "message": f"Address '{address_name}' not found"}
        frappe.delete_doc("Address", address_name, ignore_permissions=True)
        frappe.db.commit()
        return {"status": "success", "message": f"Address '{address_name}' deleted successfully"}
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Delete Customer Address Error", frappe.get_traceback())
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_customer_with_addresses():
    """
    Returns customer details first, then all addresses linked to the customer.

    Query Parameters:
    - customer (required)
    """

    try:
        customer = frappe.form_dict.get("customer")
        if not customer:
            return {"status": "error", "message": "customer is required"}

        # Validate customer
        if not frappe.db.exists("Customer", customer):
            return {"status": "error", "message": f"Customer '{customer}' not found"}

        # ----------------------------
        # CUSTOMER DETAILS
        # ----------------------------
        cust = frappe.get_doc("Customer", customer)

        customer_details = {
            "customer_id": cust.name,
            "customer_name": cust.customer_name,
            "customer_type": cust.customer_type,
            "customer_group": cust.customer_group,
            "territory": cust.territory,
            "custom_vat_registration_number": cust.custom_vat_registration_number,
            "mobile_no": cust.mobile_no,
            "email_id": cust.email_id
        }

        # ----------------------------
        # FIND ALL ADDRESSES LINKED TO CUSTOMER
        # ----------------------------
        address_links = frappe.get_all(
            "Dynamic Link",
            filters={"link_doctype": "Customer", "link_name": customer},
            fields=["parent as address_name"]
        )

        if not address_links:
            return {
                "status": "success",
                "customer": customer_details,
                "addresses": []
            }

        address_names = [a.address_name for a in address_links]

        # ----------------------------
        # FETCH ADDRESS DETAILS
        # ----------------------------
        addresses = frappe.get_all(
            "Address",
            filters={"name": ["in", address_names]},
            fields=[
                "name",
                "address_title",
                "address_type",
                "address_line1",
                "address_line2",
                "city",
                "state",
                "country",
                "pincode",
                "phone",
                "email_id",
                "custom_building_number",
                "custom_area",
                "is_primary_address",
                "is_shipping_address",
                "modified"
            ],
            order_by="is_primary_address desc, modified desc"
        )

        return {
            "status": "success",
            "customer": customer_details,
            "addresses": addresses,
            "count": len(addresses)
        }

    except Exception as e:
        frappe.log_error("Customer With Address Error", frappe.get_traceback())
        return {"status": "error", "message": str(e)}






@frappe.whitelist(allow_guest=True)
def get_warehouse_list(company=None):
    """
    Return all warehouses filtered by company (if provided).
    """

    filters = {}
    if company:
        filters["company"] = company

    warehouses = frappe.get_all(
        "Warehouse",
        filters=filters,
        fields=["name", "warehouse_name", "company", "is_group"],
        order_by="warehouse_name asc"
    )

    return {
        "status": "success",
        "message": "Warehouse list fetched",
        "warehouses": warehouses
    }

@frappe.whitelist(allow_guest=True)
def get_sales_invoice_list():
    """
    Fetch Sales Invoice list with DIRECT PDF download URL.
    Shows only invoices created by the current user or assigned to them.
    Supports limit/offset for faster loading (default limit=20).
    Print Format: Sales Invoice PF
    """
    customer = frappe.form_dict.get("customer")
    status = frappe.form_dict.get("status")
    start_date = frappe.form_dict.get("start_date")
    end_date = frappe.form_dict.get("end_date")
    search = (frappe.form_dict.get("search") or frappe.form_dict.get("q") or "").strip()
    limit = cint(frappe.form_dict.get("limit"), 20)
    offset = cint(frappe.form_dict.get("offset"), 0)
    limit = max(1, min(limit, 100))  # clamp between 1 and 100
    offset = max(0, offset)

    current_user = frappe.session.user
    # Invoices the user is allowed to see: created by them OR assigned to them (ToDo)
    created_by_me = set(
        frappe.get_all(
            "Sales Invoice",
            filters={"owner": current_user},
            pluck="name"
        )
    )
    assigned_to_me = set(
        frappe.get_all(
            "ToDo",
            filters={
                "reference_type": "Sales Invoice",
                "allocated_to": current_user,
                "status": ["!=", "Cancelled"]
            },
            pluck="reference_name"
        )
    )
    allowed_names = created_by_me | assigned_to_me
    if not allowed_names:
        return {
            "status_code": 200,
            "print_format": "Sales Invoice PF OG",
            "count": 0,
            "total_count": 0,
            "invoices": []
        }

    filters = {"name": ["in", list(allowed_names)]}
    if customer:
        filters["customer"] = customer
    if status:
        filters["status"] = status
    if start_date and end_date:
        filters["posting_date"] = ["between", [start_date, end_date]]

    # When search is provided, match from all allowed invoices (not just first 20)
    or_filters = None
    if search:
        _esc = (search or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_like = "%" + _esc + "%"
        or_filters = [
            ["name", "like", search_like],
            ["customer", "like", search_like],
        ]
        try:
            customer_match = frappe.get_all(
                "Customer",
                filters=[["custom_customer_name_english", "like", search_like]],
                pluck="name",
            )
            if customer_match:
                or_filters.append(["customer", "in", customer_match])
        except Exception:
            pass

    total_count = frappe.db.count("Sales Invoice", filters)
    invoice_names = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        or_filters=or_filters,
        fields=["name"],
        order_by="posting_date desc, modified desc",
        limit_start=offset,
        limit_page_length=limit
    )

    base_url = frappe.utils.get_url()
    invoice_list = []

    # ✅ Encode the format safely
    print_format = frappe.utils.quote("Sales Invoice PF OG")

    for inv in invoice_names:
        doc = frappe.get_doc("Sales Invoice", inv.name)

        # ✅ DIRECT DOWNLOAD PDF URL
        pdf_url = (
            f"{base_url}/printview?"
            f"doctype=Sales%20Invoice"
            f"&trigger_print=1"
            f"&name={doc.name}"
            f"&format={print_format}"
            f"&no_letterhead=0"
            f"&download=1"
        )

        invoice_list.append({
            "name": doc.name,
            "customer": doc.customer,
            "company": doc.company,
            "posting_date": doc.posting_date,
            "due_date": doc.due_date,
            "net_total": doc.net_total,
            "tax_total": doc.total_taxes_and_charges,
            "grand_total": doc.grand_total,
            "rounded_total": doc.rounded_total or doc.grand_total,
            "outstanding_amount": doc.outstanding_amount,
            "status": doc.status,

            # ✅ PDF file download link
            "pdf_url": pdf_url
        })

    return {
        "status_code": 200,
        "print_format": "Sales Invoice PF OG",
        "count": len(invoice_list),
        "total_count": total_count,
        "invoices": invoice_list
    }


# ---------- Lead ----------
@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_lead_list():
    """List leads (owner or assigned to current user). Supports limit, offset, search."""
    search = (frappe.form_dict.get("search") or frappe.form_dict.get("q") or "").strip()
    limit = max(1, min(cint(frappe.form_dict.get("limit"), 20), 100))
    offset = max(0, cint(frappe.form_dict.get("offset"), 0))
    current_user = frappe.session.user
    created = set(frappe.get_all("Lead", filters={"owner": current_user}, pluck="name"))
    assigned = set(
        frappe.get_all(
            "ToDo",
            filters={"reference_type": "Lead", "allocated_to": current_user, "status": ["!=", "Cancelled"]},
            pluck="reference_name"
        )
    )
    allowed = created | assigned
    if not allowed:
        return {"status_code": 200, "count": 0, "total_count": 0, "leads": []}
    filters = {"name": ["in", list(allowed)]}
    or_filters = None
    if search:
        _esc = (search or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_like = "%" + _esc + "%"
        or_filters = [
            ["name", "like", search_like],
            ["lead_name", "like", search_like],
            ["company_name", "like", search_like],
            ["email_id", "like", search_like],
            ["mobile_no", "like", search_like],
        ]
    total_count = frappe.db.count("Lead", filters)
    names = frappe.get_all(
        "Lead",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "lead_name", "company_name", "email_id", "mobile_no", "status", "creation"],
        order_by="modified desc",
        limit_start=offset,
        limit_page_length=limit,
    )
    leads = [{"name": n.name, "lead_name": n.lead_name, "company_name": n.company_name, "email_id": n.email_id, "mobile_no": n.mobile_no, "status": n.status, "creation": n.creation} for n in names]
    return {"status_code": 200, "count": len(leads), "total_count": total_count, "leads": leads}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_lead_details():
    """Get a single Lead by name."""
    name = frappe.form_dict.get("name")
    if not name or not frappe.db.exists("Lead", name):
        return {"status": "error", "message": "Lead not found"}
    doc = frappe.get_doc("Lead", name)
    return {"status": "ok", "lead": doc.as_dict()}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_lead():
    """Create a new Lead."""
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        lead_name = (data.get("first_name") or "").strip() or (data.get("lead_name") or "").strip()
        company_name = (data.get("company_name") or "").strip()
        if not lead_name and not company_name:
            return {"status": "error", "message": "Lead name (or first_name) or company_name is required"}
        doc = frappe.new_doc("Lead")
        if lead_name:
            doc.lead_name = lead_name
        if data.get("first_name"):
            doc.first_name = data["first_name"]
        if data.get("last_name"):
            doc.last_name = data["last_name"]
        if company_name:
            doc.company_name = company_name
        if data.get("email_id"):
            doc.email_id = data["email_id"]
        if data.get("mobile_no"):
            doc.mobile_no = data["mobile_no"]
        if data.get("phone"):
            doc.phone = data["phone"]
        if data.get("source"):
            doc.source = data["source"]
        if data.get("status"):
            doc.status = data["status"]
        doc.insert(ignore_permissions=False)
        return {"status": "ok", "message": "Lead created", "name": doc.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Create Lead PWA Error")
        return {"status": "error", "message": str(e) or "Failed to create lead"}


# ---------- Quotation ----------
@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_quotation_list():
    """List quotations (owner or assigned). Supports limit, offset, search."""
    search = (frappe.form_dict.get("search") or frappe.form_dict.get("q") or "").strip()
    limit = max(1, min(cint(frappe.form_dict.get("limit"), 20), 100))
    offset = max(0, cint(frappe.form_dict.get("offset"), 0))
    current_user = frappe.session.user
    created = set(frappe.get_all("Quotation", filters={"owner": current_user}, pluck="name"))
    assigned = set(
        frappe.get_all(
            "ToDo",
            filters={"reference_type": "Quotation", "allocated_to": current_user, "status": ["!=", "Cancelled"]},
            pluck="reference_name"
        )
    )
    allowed = created | assigned
    if not allowed:
        return {"status_code": 200, "count": 0, "total_count": 0, "quotations": []}
    filters = {"name": ["in", list(allowed)]}
    or_filters = None
    if search:
        _esc = (search or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_like = "%" + _esc + "%"
        or_filters = [["name", "like", search_like], ["party_name", "like", search_like], ["customer_name", "like", search_like]]
    total_count = frappe.db.count("Quotation", filters)
    names = frappe.get_all(
        "Quotation",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "quotation_to", "party_name", "customer_name", "transaction_date", "valid_till", "grand_total", "status", "docstatus"],
        order_by="modified desc",
        limit_start=offset,
        limit_page_length=limit,
    )
    out = []
    for n in names:
        out.append({
            "name": n.name,
            "quotation_to": n.quotation_to,
            "party_name": n.party_name,
            "customer_name": n.customer_name,
            "transaction_date": n.transaction_date,
            "valid_till": n.valid_till,
            "grand_total": n.grand_total,
            "status": n.status,
            "docstatus": n.docstatus,
        })
    return {"status_code": 200, "count": len(out), "total_count": total_count, "quotations": out}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_quotation_details():
    """Get a single Quotation by name with PDF URL."""
    name = frappe.form_dict.get("name")
    if not name or not frappe.db.exists("Quotation", name):
        return {"status": "error", "message": "Quotation not found"}
    doc = frappe.get_doc("Quotation", name)
    base_url = frappe.utils.get_url()
    print_format = frappe.utils.quote("Standard")
    pdf_url = (
        f"{base_url}/printview?"
        f"doctype=Quotation"
        f"&name={doc.name}"
        f"&trigger_print=1"
        f"&format={print_format}"
        f"&no_letterhead=0"
        f"&download=1"
    )
    result = doc.as_dict()
    result["pdf_url"] = pdf_url
    # Ensure each item has item_name for display (Frappe may not always include it in as_dict)
    for row in result.get("items") or []:
        if not row.get("item_name") and row.get("item_code"):
            row["item_name"] = frappe.db.get_value("Item", row["item_code"], "item_name") or row["item_code"]
    return {"status": "ok", "quotation": result}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_quotation():
    """Create a new Quotation. quotation_to: Lead or Customer, party_name: name of Lead/Customer, items: list of {item_code, qty, rate, uom}."""
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        quotation_to = (data.get("quotation_to") or "Customer").strip()
        party_name = (data.get("party_name") or data.get("customer") or "").strip()
        items = data.get("items") or []
        if not party_name:
            return {"status": "error", "message": "party_name (or customer) is required"}
        if quotation_to not in ("Lead", "Customer"):
            return {"status": "error", "message": "quotation_to must be Lead or Customer"}
        if not frappe.db.exists(quotation_to, party_name):
            return {"status": "error", "message": f"{quotation_to} '{party_name}' not found"}
        if not items:
            return {"status": "error", "message": "items is required"}
        company = data.get("company") or _get_user_company()
        if not company:
            return {"status": "error", "message": "Company could not be determined"}
        
        # Get cost center
        cost_center = _get_user_cost_center(company)
        if not cost_center:
            return {
                "status": "error",
                "message": "Cost Center could not be determined. Set User Permission (Cost Center) or Company default Cost Center."
            }
        
        # Get tax template
        tax_template = frappe.db.get_value(
            "Sales Taxes and Charges Template",
            {"company": company, "is_default": 1, "disabled": 0},
            "name"
        )
        
        if not tax_template:
            return {
                "status": "error",
                "message": f"No default Sales Taxes and Charges Template for '{company}'"
            }
        
        tpl = frappe.get_doc("Sales Taxes and Charges Template", tax_template)
        tax_rows = [{
            "charge_type": t.charge_type,
            "account_head": t.account_head,
            "description": t.description or f"Tax @ {t.rate}%",
            "rate": t.rate,
            "cost_center": cost_center
        } for t in tpl.taxes]
        
        doc = frappe.new_doc("Quotation")
        doc.quotation_to = quotation_to
        doc.party_name = party_name
        doc.company = company
        if data.get("transaction_date"):
            doc.transaction_date = data["transaction_date"]
        if data.get("valid_till"):
            doc.valid_till = data["valid_till"]
        for row in items:
            doc.append("items", {
                "item_code": row.get("item_code"),
                "qty": flt(row.get("qty"), 1),
                "rate": flt(row.get("rate"), 2),
                "uom": row.get("uom") or frappe.db.get_value("Item", row.get("item_code"), "stock_uom") or "Nos",
            })
        
        # Add taxes
        doc.taxes_and_charges = tax_template
        for tax_row in tax_rows:
            doc.append("taxes", tax_row)
        
        doc.set_missing_values()
        doc.run_method("set_taxes")
        doc.run_method("calculate_totals")
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return {"status": "ok", "message": "Quotation created", "name": doc.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Create Quotation PWA Error")
        return {"status": "error", "message": str(e) or "Failed to create quotation"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def submit_quotation():
    """Submit a draft Quotation (set docstatus = 1)."""
    try:
        name = frappe.form_dict.get("name")
        if frappe.request.data:
            data = json.loads(frappe.request.data)
            name = data.get("name") or name
        if not name or not frappe.db.exists("Quotation", name):
            return {"status": "error", "message": "Quotation not found"}
        doc = frappe.get_doc("Quotation", name)
        if doc.docstatus == 1:
            return {"status": "ok", "message": "Quotation already submitted", "name": doc.name}
        if doc.docstatus == 2:
            return {"status": "error", "message": "Cancelled quotation cannot be submitted"}
        doc.submit()
        return {"status": "ok", "message": "Quotation submitted", "name": doc.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Submit Quotation PWA Error")
        return {"status": "error", "message": str(e) or "Failed to submit quotation"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def cancel_quotation():
    """Cancel a submitted Quotation (docstatus = 2). Only for submitted docs."""
    try:
        name = frappe.form_dict.get("name")
        if frappe.request.data:
            data = json.loads(frappe.request.data)
            name = data.get("name") or name
        if not name or not frappe.db.exists("Quotation", name):
            return {"status": "error", "message": "Quotation not found"}
        doc = frappe.get_doc("Quotation", name)
        if doc.docstatus == 0:
            return {"status": "error", "message": "Draft quotation cannot be cancelled"}
        if doc.docstatus == 2:
            return {"status": "ok", "message": "Quotation already cancelled", "name": doc.name}
        doc.cancel()
        return {"status": "ok", "message": "Quotation cancelled", "name": doc.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Cancel Quotation PWA Error")
        return {"status": "error", "message": str(e) or "Failed to cancel quotation"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def amend_quotation():
    """Create an amended draft from a cancelled Quotation only (docstatus must be 2)."""
    try:
        name = frappe.form_dict.get("name")
        if frappe.request.data:
            data = json.loads(frappe.request.data)
            name = data.get("name") or name
        if not name or not frappe.db.exists("Quotation", name):
            return {"status": "error", "message": "Quotation not found"}
        doc = frappe.get_doc("Quotation", name)
        if doc.docstatus == 0:
            return {"status": "error", "message": "Draft quotation cannot be amended. Submit and cancel first."}
        if doc.docstatus == 1:
            return {"status": "error", "message": "Only cancelled quotations can be amended. Cancel the quotation first."}
        # docstatus == 2: cancelled — create new draft from it
        amended = frappe.copy_doc(doc)
        amended.docstatus = 0
        amended.amended_from = name
        amended.insert()
        return {"status": "ok", "message": "Amended quotation created", "name": amended.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Amend Quotation PWA Error")
        return {"status": "error", "message": str(e) or "Failed to amend quotation"}


# ---------- Sales Order ----------
@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_sales_order_list():
    """List sales orders (owner or assigned). Supports limit, offset, search."""
    search = (frappe.form_dict.get("search") or frappe.form_dict.get("q") or "").strip()
    limit = max(1, min(cint(frappe.form_dict.get("limit"), 20), 100))
    offset = max(0, cint(frappe.form_dict.get("offset"), 0))
    current_user = frappe.session.user
    created = set(frappe.get_all("Sales Order", filters={"owner": current_user}, pluck="name"))
    assigned = set(
        frappe.get_all(
            "ToDo",
            filters={"reference_type": "Sales Order", "allocated_to": current_user, "status": ["!=", "Cancelled"]},
            pluck="reference_name"
        )
    )
    allowed = created | assigned
    if not allowed:
        return {"status_code": 200, "count": 0, "total_count": 0, "sales_orders": []}
    filters = {"name": ["in", list(allowed)]}
    or_filters = None
    if search:
        _esc = (search or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_like = "%" + _esc + "%"
        or_filters = [["name", "like", search_like], ["customer", "like", search_like], ["customer_name", "like", search_like]]
    total_count = frappe.db.count("Sales Order", filters)
    names = frappe.get_all(
        "Sales Order",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "customer", "customer_name", "transaction_date", "delivery_date", "grand_total", "status", "docstatus", "po_no"],
        order_by="modified desc",
        limit_start=offset,
        limit_page_length=limit,
    )
    out = [{"name": n.name, "customer": n.customer, "customer_name": n.customer_name, "transaction_date": n.transaction_date, "delivery_date": n.delivery_date, "grand_total": n.grand_total, "status": n.status, "docstatus": n.docstatus, "po_no": getattr(n, "po_no", None)} for n in names]
    return {"status_code": 200, "count": len(out), "total_count": total_count, "sales_orders": out}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_sales_order_details():
    """Get a single Sales Order by name with PDF URL."""
    name = frappe.form_dict.get("name")
    if not name or not frappe.db.exists("Sales Order", name):
        return {"status": "error", "message": "Sales Order not found"}
    doc = frappe.get_doc("Sales Order", name)
    base_url = frappe.utils.get_url()
    print_format = frappe.utils.quote("Standard")
    pdf_url = (
        f"{base_url}/printview?"
        f"doctype=Sales%20Order"
        f"&name={doc.name}"
        f"&trigger_print=1"
        f"&format={print_format}"
        f"&no_letterhead=0"
        f"&download=1"
    )
    result = doc.as_dict()
    result["pdf_url"] = pdf_url
    # Ensure each item has item_name for display (Frappe may not always include it in as_dict)
    for row in result.get("items") or []:
        if not row.get("item_name") and row.get("item_code"):
            row["item_name"] = frappe.db.get_value("Item", row["item_code"], "item_name") or row["item_code"]
    return {"status": "ok", "sales_order": result}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_sales_order():
    """Create a new Sales Order. customer: Customer name, items: list of {item_code, qty, rate, uom}."""
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        customer = (data.get("customer") or data.get("customer_name") or "").strip()
        items = data.get("items") or []
        if not customer:
            return {"status": "error", "message": "customer is required"}
        if not frappe.db.exists("Customer", customer):
            return {"status": "error", "message": f"Customer '{customer}' not found"}
        if not items:
            return {"status": "error", "message": "items is required"}
        company = data.get("company") or _get_user_company()
        if not company:
            return {"status": "error", "message": "Company could not be determined"}
        
        # Get cost center
        cost_center = _get_user_cost_center(company)
        if not cost_center:
            return {
                "status": "error",
                "message": "Cost Center could not be determined. Set User Permission (Cost Center) or Company default Cost Center."
            }
        
        # Get tax template
        tax_template = frappe.db.get_value(
            "Sales Taxes and Charges Template",
            {"company": company, "is_default": 1, "disabled": 0},
            "name"
        )
        
        if not tax_template:
            return {
                "status": "error",
                "message": f"No default Sales Taxes and Charges Template for '{company}'"
            }
        
        tpl = frappe.get_doc("Sales Taxes and Charges Template", tax_template)
        tax_rows = [{
            "charge_type": t.charge_type,
            "account_head": t.account_head,
            "description": t.description or f"Tax @ {t.rate}%",
            "rate": t.rate,
            "cost_center": cost_center
        } for t in tpl.taxes]
        
        doc = frappe.new_doc("Sales Order")
        doc.customer = customer
        doc.company = company
        if data.get("transaction_date"):
            doc.transaction_date = data["transaction_date"]
        if data.get("delivery_date"):
            doc.delivery_date = data["delivery_date"]
        if data.get("po_no") is not None:
            doc.po_no = (data.get("po_no") or "").strip() or None
        for row in items:
            doc.append("items", {
                "item_code": row.get("item_code"),
                "qty": flt(row.get("qty"), 1),
                "rate": flt(row.get("rate"), 2),
                "uom": row.get("uom") or frappe.db.get_value("Item", row.get("item_code"), "stock_uom") or "Nos",
            })
        
        # Add taxes
        doc.taxes_and_charges = tax_template
        for tax_row in tax_rows:
            doc.append("taxes", tax_row)
        
        # Add sales person to sales_team with 100% contribution
        sales_person = _get_user_sales_person()
        if sales_person:
            doc.append("sales_team", {
                "sales_person": sales_person,
                "allocated_percentage": 100
            })
        
        doc.set_missing_values()
        doc.run_method("set_taxes")
        doc.run_method("calculate_totals")
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return {"status": "ok", "message": "Sales Order created", "name": doc.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Create Sales Order PWA Error")
        return {"status": "error", "message": str(e) or "Failed to create sales order"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def submit_sales_order():
    """Submit a draft Sales Order (set docstatus = 1)."""
    try:
        name = frappe.form_dict.get("name")
        if frappe.request.data:
            data = json.loads(frappe.request.data)
            name = data.get("name") or name
        if not name or not frappe.db.exists("Sales Order", name):
            return {"status": "error", "message": "Sales Order not found"}
        doc = frappe.get_doc("Sales Order", name)
        if doc.docstatus == 1:
            return {"status": "ok", "message": "Sales Order already submitted", "name": doc.name}
        if doc.docstatus == 2:
            return {"status": "error", "message": "Cancelled sales order cannot be submitted"}
        doc.submit()
        return {"status": "ok", "message": "Sales Order submitted", "name": doc.name}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Submit Sales Order PWA Error")
        return {"status": "error", "message": str(e) or "Failed to submit sales order"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def convert_quotation_to_sales_order():
    """Convert a submitted Quotation to a Sales Order using ERPNext's conversion logic."""
    try:
        name = frappe.form_dict.get("name")
        if frappe.request.data:
            data = json.loads(frappe.request.data)
            name = data.get("name") or name
        
        if not name or not frappe.db.exists("Quotation", name):
            return {"status": "error", "message": "Quotation not found"}
        
        quotation = frappe.get_doc("Quotation", name)
        
        # Check if quotation is submitted
        if quotation.docstatus != 1:
            return {"status": "error", "message": "Only submitted quotations can be converted to Sales Order"}
        
        # Import ERPNext's conversion function
        from erpnext.selling.doctype.quotation.quotation import make_sales_order
        
        # Create Sales Order from Quotation
        sales_order = make_sales_order(name)
        
        # Set delivery_date to today if not already set
        if not sales_order.delivery_date:
            sales_order.delivery_date = nowdate()
        
        # Save the Sales Order
        sales_order.insert(ignore_permissions=False)
        sales_order.save()
        
        return {
            "status": "ok",
            "message": "Sales Order created from Quotation",
            "name": sales_order.name,
            "quotation_name": name
        }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Convert Quotation to Sales Order PWA Error")
        return {"status": "error", "message": str(e) or "Failed to convert quotation to sales order"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def convert_sales_order_to_sales_invoice():
    """Convert a submitted Sales Order to a Sales Invoice using ERPNext's conversion logic."""
    try:
        name = frappe.form_dict.get("name")
        if frappe.request.data:
            data = json.loads(frappe.request.data)
            name = data.get("name") or name
        
        if not name or not frappe.db.exists("Sales Order", name):
            return {"status": "error", "message": "Sales Order not found"}
        
        sales_order = frappe.get_doc("Sales Order", name)
        
        # Check if sales order is submitted
        if sales_order.docstatus != 1:
            return {"status": "error", "message": "Only submitted sales orders can be converted to Sales Invoice"}
        
        # Import ERPNext's conversion function
        from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
        
        # Create Sales Invoice from Sales Order
        sales_invoice = make_sales_invoice(name)
        
        # Save the Sales Invoice
        sales_invoice.insert(ignore_permissions=False)
        sales_invoice.save()
        
        return {
            "status": "ok",
            "message": "Sales Invoice created from Sales Order",
            "name": sales_invoice.name,
            "sales_order_name": name
        }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Convert Sales Order to Sales Invoice PWA Error")
        return {"status": "error", "message": str(e) or "Failed to convert sales order to sales invoice"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def update_quotation():
    """Update an EXISTING Quotation (Draft only)."""
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        quotation_name = data.get("quotation_name") or data.get("name")
        if not quotation_name:
            return {"status": "error", "message": "'quotation_name' or 'name' is required"}
        
        if not frappe.db.exists("Quotation", quotation_name):
            return {"status": "error", "message": f"Quotation '{quotation_name}' not found"}
        
        doc = frappe.get_doc("Quotation", quotation_name)
        
        if doc.docstatus != 0:
            return {"status": "error", "message": "Only Draft Quotations can be updated"}
        
        # Update party (Customer or Lead)
        if data.get("quotation_to"):
            if data.get("quotation_to") not in ("Lead", "Customer"):
                return {"status": "error", "message": "quotation_to must be Lead or Customer"}
            doc.quotation_to = data.get("quotation_to")
        
        if data.get("party_name"):
            party_name = data.get("party_name").strip()
            if doc.quotation_to == "Customer":
                if not frappe.db.exists("Customer", party_name):
                    return {"status": "error", "message": f"Customer '{party_name}' not found"}
            elif doc.quotation_to == "Lead":
                if not frappe.db.exists("Lead", party_name):
                    return {"status": "error", "message": f"Lead '{party_name}' not found"}
            doc.party_name = party_name
        
        # Update items
        if data.get("items"):
            doc.set("items", [])
            for item in data.get("items"):
                if not item.get("item_code"):
                    continue
                doc.append("items", {
                    "item_code": item.get("item_code"),
                    "qty": flt(item.get("qty", 1)),
                    "rate": flt(item.get("rate", 0), 2),
                    "uom": item.get("uom", "Nos"),
                })
        
        # Update discount
        if "discount_amount" in data:
            doc.discount_amount = flt(data.get("discount_amount"))
        
        # Update dates
        if data.get("transaction_date"):
            doc.transaction_date = data.get("transaction_date")
        if data.get("valid_till"):
            doc.valid_till = data.get("valid_till")
        
        doc.run_method("set_taxes")
        doc.run_method("calculate_totals")
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        
        return {
            "status": "ok",
            "message": f"Quotation '{doc.name}' updated successfully",
            "name": doc.name
        }
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Update Quotation PWA Error")
        return {"status": "error", "message": str(e) or "Failed to update quotation"}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def update_sales_order():
    """Update an EXISTING Sales Order (Draft only)."""
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        sales_order_name = data.get("sales_order_name") or data.get("name")
        if not sales_order_name:
            return {"status": "error", "message": "'sales_order_name' or 'name' is required"}
        
        if not frappe.db.exists("Sales Order", sales_order_name):
            return {"status": "error", "message": f"Sales Order '{sales_order_name}' not found"}
        
        doc = frappe.get_doc("Sales Order", sales_order_name)
        
        if doc.docstatus != 0:
            return {"status": "error", "message": "Only Draft Sales Orders can be updated"}
        
        # Update customer
        if data.get("customer") or data.get("customer_name"):
            customer_param = data.get("customer") or data.get("customer_name")
            if not frappe.db.exists("Customer", customer_param):
                return {"status": "error", "message": f"Customer '{customer_param}' not found"}
            doc.customer = customer_param
        
        # Update items
        if data.get("items"):
            doc.set("items", [])
            for item in data.get("items"):
                if not item.get("item_code"):
                    continue
                doc.append("items", {
                    "item_code": item.get("item_code"),
                    "qty": flt(item.get("qty", 1)),
                    "rate": flt(item.get("rate", 0), 2),
                    "uom": item.get("uom", "Nos"),
                })
        
        # Update discount
        if "discount_amount" in data:
            doc.discount_amount = flt(data.get("discount_amount"))
        
        # Update dates
        if data.get("transaction_date"):
            doc.transaction_date = data.get("transaction_date")
        if data.get("delivery_date"):
            doc.delivery_date = data.get("delivery_date")
        if "po_no" in data:
            doc.po_no = (data.get("po_no") or "").strip() or None
        
        # Add sales person to sales_team if not already present
        sales_person = _get_user_sales_person()
        if sales_person:
            existing_sales_persons = [st.sales_person for st in doc.sales_team]
            if sales_person not in existing_sales_persons:
                doc.append("sales_team", {
                    "sales_person": sales_person,
                    "allocated_percentage": 100
                })
        
        doc.run_method("set_missing_values")
        doc.run_method("calculate_taxes_and_totals")
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        
        return {
            "status": "ok",
            "message": f"Sales Order '{doc.name}' updated successfully",
            "name": doc.name
        }
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Update Sales Order PWA Error")
        return {"status": "error", "message": str(e) or "Failed to update sales order"}



def get_conversion_factor(item_code, uom):
    if not item_code or not uom:
        return 1

    stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")

    if uom == stock_uom:
        return 1

    conversion_factor = frappe.db.get_value(
        "UOM Conversion Detail",
        {
            "parent": item_code,
            "uom": uom
        },
        "conversion_factor"
    )

    if not conversion_factor:
        frappe.throw(
            f"Conversion factor not defined for Item '{item_code}' with UOM '{uom}'"
        )

    return flt(conversion_factor)



@frappe.whitelist(allow_guest=True, methods=["POST"])
def create_sales_invoice():
    """
    Create a NEW Sales Invoice only.
    Updating existing invoices is NOT allowed here.
    """

    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict

        # --------------------------------------------------
        # VALIDATION
        # --------------------------------------------------
        for field in ["customer_name", "items"]:
            if not data.get(field):
                return {"status": "error", "message": f"'{field}' is required"}

        customer_param = data["customer_name"]
        company = data.get("company") or _get_user_company()

        # --------------------------------------------------
        # COMPANY (from request or User Permission / user default)
        # --------------------------------------------------
        if not company:
            return {"status": "error", "message": "Company could not be determined. Set User Permission for Company or user default Company."}
        if not frappe.db.exists("Company", company):
            return {"status": "error", "message": f"Company '{company}' not found"}

        company_doc = frappe.get_doc("Company", company)

        if not company_doc.default_income_account or not company_doc.default_receivable_account:
            return {"status": "error", "message": "Company missing default accounts"}
        if not getattr(company_doc, "default_currency", None):
            return {"status": "error", "message": "Company missing default currency"}

        cost_center = _get_user_cost_center(company)
        if not cost_center:
            return {
                "status": "error",
                "message": "Cost Center could not be determined. Set User Permission (Cost Center) or Company default Cost Center."
            }

        # Company round-off fields (required by ERPNext on submit; validate early to avoid unpack errors)
        round_off_account = frappe.get_cached_value("Company", company, "round_off_account")
        round_off_cost_center = frappe.get_cached_value("Company", company, "round_off_cost_center")
        if not round_off_account or not round_off_cost_center:
            return {
                "status": "error",
                "message": (
                    "Company must have 'Round Off Account' and 'Round Off Cost Center' set. "
                    "Set them in the Company master to save and submit invoices."
                )
            }

        # --------------------------------------------------
        # RESOLVE ACTIVE CUSTOMER ONLY
        # --------------------------------------------------
        customer = (
            frappe.db.get_value("Customer", {"name": customer_param, "disabled": 0}, "name")
            or frappe.db.get_value("Customer", {"customer_name": customer_param, "disabled": 0}, "name")
            or frappe.db.get_value("Customer", {"custom_customer_name_arabic": customer_param, "disabled": 0}, "name")
        )

        if not customer:
            return {
                "status": "error",
                "message": f"Active customer matching '{customer_param}' not found"
            }

        # --------------------------------------------------
        # DATES & FLAGS - Always set to today for posting_date, today+1 for due_date
        # --------------------------------------------------
        posting_date = getdate(today())
        due_date = add_days(getdate(today()), 1)

        update_stock = cint(data.get("update_stock", 0))

        # --------------------------------------------------
        # MODE OF PAYMENT (optional – not required for create)
        # --------------------------------------------------
        custom_mode_of_payment = data.get("custom_mode_of_payment")
        if custom_mode_of_payment and not frappe.db.exists("Mode of Payment", custom_mode_of_payment):
            return {
                "status": "error",
                "message": f"Mode of Payment '{custom_mode_of_payment}' not found"
            }

        # --------------------------------------------------
        # INCLUDED PAYMENT (is_pos and payments table)
        # Accept both "payments" array and top-level "mode_of_payment"/"payment_method" for compatibility
        # --------------------------------------------------
        is_pos = cint(data.get("is_pos", 0))
        payments_data = data.get("payments") or []
        if not isinstance(payments_data, list):
            payments_data = []
        # Fallback: single mode_of_payment / payment_method at top level (e.g. from some clients)
        single_mop = data.get("mode_of_payment") or data.get("payment_method")
        if single_mop and not payments_data:
            payments_data = [{"mode_of_payment": single_mop, "amount": 0}]
        if payments_data and len(payments_data) > 0:
            is_pos = 1
            # Validate payment methods
            for payment in payments_data:
                mode_of_payment = payment.get("mode_of_payment") or payment.get("payment_method")
                if mode_of_payment and not frappe.db.exists("Mode of Payment", mode_of_payment):
                    return {
                        "status": "error",
                        "message": f"Mode of Payment '{mode_of_payment}' not found"
            }

        # --------------------------------------------------
        # WAREHOUSE – resolve from User Permission first, then request, then company defaults
        # --------------------------------------------------
        def _get_user_warehouse(company):
            """Get warehouse from User Permission (allow=Warehouse) for current user, preferring one that belongs to company."""
            allowed = frappe.get_all(
                "User Permission",
                filters={"user": frappe.session.user, "allow": "Warehouse"},
                pluck="for_value"
            )
            if not allowed:
                return None
            # Prefer a warehouse that belongs to this company
            for wh in allowed:
                if not wh or not frappe.db.exists("Warehouse", wh):
                    continue
                wh_company = frappe.db.get_value("Warehouse", wh, "company")
                if wh_company == company:
                    return wh
            # Otherwise return first valid one (e.g. single permission)
            for wh in allowed:
                if wh and frappe.db.exists("Warehouse", wh):
                    return wh
            return None

        user_warehouse = _get_user_warehouse(company)

        if update_stock:
            target_warehouse = user_warehouse
            if not target_warehouse:
                req_wh = data.get("target_warehouse") or data.get("warehouse")
                if req_wh and frappe.db.exists("Warehouse", req_wh):
                    target_warehouse = req_wh
            if not target_warehouse:
                target_warehouse = get_default_warehouse(company)
            if not target_warehouse:
                return {
                    "status": "error",
                    "message": "Warehouse is required when updating stock. Set User Permission (Warehouse), pass target_warehouse, or set a default warehouse for the company."
                }
        else:
            target_warehouse = None

        # Every item must have a valid warehouse (ERPNext set_missing_values uses it for bin details).
        warehouse_for_items = target_warehouse or user_warehouse
        if not warehouse_for_items:
            warehouse_for_items = get_default_warehouse(company)
        if not warehouse_for_items:
            warehouse_for_items = frappe.db.get_value(
                "Warehouse", {"company": company, "is_group": 0, "disabled": 0}, "name"
            )
        if not warehouse_for_items:
            warehouse_for_items = frappe.db.get_value(
                "Warehouse", {"company": company, "disabled": 0}, "name"
            )
        if not warehouse_for_items:
            return {
                "status": "error",
                "message": "No warehouse found for company. Create at least one Warehouse for this company."
            }
        if not frappe.db.exists("Warehouse", warehouse_for_items):
            return {
                "status": "error",
                "message": f"Resolved warehouse '{warehouse_for_items}' does not exist. Please use a valid Warehouse."
            }

        # --------------------------------------------------
        # BUILD ITEMS
        # --------------------------------------------------
        invoice_items = []

        for item in data.get("items"):
            if not item.get("item_code"):
                continue

            uom = item.get("uom", "Nos")
            stock_uom = item.get("stock_uom", uom)

            ensure_uom_exists(uom)
            ensure_uom_exists(stock_uom)

            ensure_item_exists({
                "item_code": item["item_code"],
                "item_name": item.get("item_name") or item["item_code"],
                "description": item.get("description") or item["item_code"],
                "stock_uom": stock_uom,
                "valuation_rate": item.get("valuation_rate", 0),
                "item_group": item.get("item_group", "Products"),
                "is_stock_item": update_stock
            })

            row = {
                "item_code": item["item_code"],
                "item_name": item.get("item_name"),
                "description": item.get("description"),
                "qty": flt(item.get("qty", 1)),
                "rate": flt(item.get("rate", 0), 2),
                "uom": uom,
                "stock_uom": stock_uom,
                "conversion_factor": get_conversion_factor(item["item_code"], uom),
                "income_account": company_doc.default_income_account,
                "cost_center": cost_center,
                "warehouse": warehouse_for_items,
            }

            invoice_items.append(row)

        if not invoice_items:
            return {"status": "error", "message": "At least one valid item is required"}

        # --------------------------------------------------
        # TAX TEMPLATE
        # --------------------------------------------------
        tax_template = frappe.db.get_value(
            "Sales Taxes and Charges Template",
            {"company": company, "is_default": 1, "disabled": 0},
            "name"
        )

        if not tax_template:
            return {
                "status": "error",
                "message": f"No default Sales Taxes and Charges Template for '{company}'"
            }

        tpl = frappe.get_doc("Sales Taxes and Charges Template", tax_template)

        tax_rows = [{
            "charge_type": t.charge_type,
            "account_head": t.account_head,
            "description": t.description,
            "rate": t.rate,
            "cost_center": cost_center
        } for t in tpl.taxes]

        # --------------------------------------------------
        # CREATE INVOICE (CREATE ONLY ✅)
        # --------------------------------------------------
        doc = frappe.get_doc({
            "doctype": "Sales Invoice",
            "customer": customer,
            "company": company,
            "posting_date": posting_date,
            "posting_time": nowtime(),   # ✅ CRITICAL FIX
            "due_date": due_date,
            "currency": company_doc.default_currency,
            "debit_to": company_doc.default_receivable_account,
            "ignore_pricing_rule": 1,
            "update_stock": update_stock,
            "set_warehouse": target_warehouse or warehouse_for_items,
            "items": invoice_items,
            "taxes": tax_rows,
            "taxes_and_charges": tax_template,
            "is_pos": is_pos
        })

        # --------------------------------------------------
        # ADD PAYMENTS TABLE (if is_pos = 1 and payments provided)
        # --------------------------------------------------
        if is_pos and payments_data:
            for payment_entry in payments_data:
                mode_of_payment = payment_entry.get("mode_of_payment") or payment_entry.get("payment_method")
                amount = flt(payment_entry.get("amount", 0))
                if mode_of_payment:
                    # Allow amount 0 here; we'll set it to grand_total after calculate_taxes_and_totals
                    if amount <= 0:
                        amount = None  # will be set later from grand_total
                    # Get default account for mode of payment
                    mop_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
                    default_account = None
                    if mop_doc.accounts:
                        for mop_account in mop_doc.accounts:
                            if mop_account.company == company:
                                default_account = mop_account.default_account
                                break
                    doc.append("payments", {
                        "mode_of_payment": mode_of_payment,
                        "amount": amount or 0,
                        "account": default_account
        })

        # Ensure every item and parent have a valid warehouse before set_missing_values.
        # ERPNext get_item_details -> update_bin_details -> get_bin_details(out.warehouse);
        # None causes "cannot unpack non-iterable NoneType" in get_descendants_of.
        doc.set("set_warehouse", doc.get("set_warehouse") or warehouse_for_items)
        for item_row in doc.items:
            item_row.set("warehouse", warehouse_for_items)

        # --------------------------------------------------
        # ADD SALES PERSON TO SALES_TEAM WITH 100% CONTRIBUTION
        # --------------------------------------------------
        sales_person = _get_user_sales_person()
        if sales_person:
            doc.append("sales_team", {
                "sales_person": sales_person,
                "allocated_percentage": 100
            })

        # --------------------------------------------------
        # DISCOUNT
        # --------------------------------------------------
        if data.get("discount_amount"):
            doc.discount_amount = flt(data.get("discount_amount"))
            doc.apply_discount_on = data.get("apply_discount_on", "Grand Total")

        if data.get("discount_percentage"):
            doc.additional_discount_percentage = flt(data.get("discount_percentage"))
            doc.apply_discount_on = data.get("apply_discount_on", "Grand Total")

        doc.set_missing_values()
        
        # Force set dates: posting_date = today, due_date = today+1 AFTER set_missing_values to override any frontend values
        tomorrow_date = add_days(getdate(today()), 1)
        doc.posting_date = getdate(today())
        doc.posting_time = nowtime()
        doc.due_date = tomorrow_date
        
        doc.calculate_taxes_and_totals()

        # Re-apply payments after calculate_taxes_and_totals so they are never cleared by hooks/set_missing_values
        # and set amount to grand_total (full payment)
        if is_pos and payments_data:
            doc.set("payments", [])
            for payment_entry in payments_data:
                mode_of_payment = payment_entry.get("mode_of_payment") or payment_entry.get("payment_method")
                if not mode_of_payment:
                    continue
                mop_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
                default_account = None
                if mop_doc.accounts:
                    for mop_account in mop_doc.accounts:
                        if mop_account.company == company:
                            default_account = mop_account.default_account
                            break
                doc.append("payments", {
                    "mode_of_payment": mode_of_payment,
                    "amount": doc.grand_total,
                    "account": default_account
                })
            if doc.payments:
                for payment_row in doc.payments:
                    payment_row.base_amount = doc.grand_total * flt(doc.conversion_rate)
        
        # Update payment_schedule due_dates to tomorrow_date AFTER calculate_taxes_and_totals
        # (since calculate_taxes_and_totals might regenerate payment_schedule)
        if doc.payment_schedule:
            for payment in doc.payment_schedule:
                payment.due_date = tomorrow_date
        
        try:
            doc.insert(ignore_permissions=True)
        except TypeError as e:
            if "cannot unpack non-iterable NoneType object" in str(e) or "cannot unpack" in str(e).lower():
                frappe.log_error(
                    title="Sales Invoice create unpack error",
                    message=frappe.get_traceback()
                )
                return {
                    "status": "error",
                    "message": (
                        "Server error while saving invoice. Ensure Company has: "
                        "Default Cost Center, Round Off Account, Round Off Cost Center, Default Income Account, "
                        "and (if updating stock) a valid Warehouse. Check Error Log for details."
                    )
                }
            raise

        # Update payment_schedule due_dates in database directly
        if doc.payment_schedule:
            for payment in doc.payment_schedule:
                frappe.db.set_value("Payment Schedule", payment.name, "due_date", tomorrow_date, update_modified=False)
        
        frappe.db.commit()

        return {
            "status": "success",
            "invoice_name": doc.name,
            "customer_id": customer,
            "input_customer": customer_param,
            "grand_total": doc.grand_total,
            "vat_amount": doc.total_taxes_and_charges
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Create Sales Invoice API Error")
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_invoice_details():
    """
    API to get Sales Invoice details with direct PDF download link
    Print Format: Sales Invoice PF OG
    """

    try:
        invoice_name = frappe.form_dict.get("invoice_name")

        if not invoice_name:
            return {
                "status": "error",
                "message": "invoice_name is required"
            }

        if not frappe.db.exists("Sales Invoice", invoice_name):
            return {
                "status": "error",
                "message": f"Invoice '{invoice_name}' not found"
            }

        # -------------------------
        # FETCH INVOICE
        # -------------------------
        doc = frappe.get_doc("Sales Invoice", invoice_name)

        # -------------------------
        # CUSTOMER NAMES (customer_name = English, custom_customer_name_arabic = Arabic)
        # -------------------------
        customer_name_english = doc.customer_name or ""
        customer_name_arabic = frappe.db.get_value(
            "Customer",
            doc.customer,
            "custom_customer_name_arabic"
        ) or ""

        # -------------------------
        # MODE OF PAYMENT  ✅ FIX
        # -------------------------
        custom_mode_of_payment = doc.get("custom_mode_of_payment")

        # -------------------------
        # ITEMS
        # -------------------------
        items = []
        for item in doc.items:
            items.append({
                "item_code": item.item_code,
                "item_name": item.item_name,
                "description": item.description,

                "qty": item.qty,
                "uom": item.uom,

                "stock_uom": item.stock_uom,
                "conversion_factor": item.conversion_factor,
                "stock_qty": item.stock_qty,

                "rate": item.rate,
                "amount": item.amount,
                "warehouse": item.warehouse
            })

        # -------------------------
        # TAXES
        # -------------------------
        taxes = []
        for tax in doc.taxes:
            taxes.append({
                "description": tax.description,
                "charge_type": tax.charge_type,
                "account_head": tax.account_head,
                "rate": tax.rate,
                "tax_amount": tax.tax_amount
            })

        # -------------------------
        # PDF URL
        # -------------------------
        base_url = frappe.utils.get_url()
        print_format = frappe.utils.quote("Sales Invoice PF OG")

        pdf_url = (
            f"{base_url}/printview?"
            f"doctype=Sales%20Invoice"
            f"&name={doc.name}"
            f"&trigger_print=1"
            f"&format={print_format}"
            f"&no_letterhead=0"
            f"&download=1"
        )

        # -------------------------
        # RESPONSE
        # -------------------------
        return {
            "status": "success",
            "data": {
                "invoice_name": doc.name,

                "customer": doc.customer,
                "customer_name": customer_name_english,           # English (standard field)
                "customer_name_english": customer_name_english,
                "customer_name_arabic": customer_name_arabic,     # Arabic (custom field)

                "company": doc.company,
                "custom_mode_of_payment": custom_mode_of_payment,  # ✅ now works

                "posting_date": str(doc.posting_date),
                "due_date": str(doc.due_date),

                "status": doc.status,
                "docstatus": doc.docstatus,

                "net_total": doc.net_total,
                "vat_amount": doc.total_taxes_and_charges,
                "grand_total": doc.grand_total,
                "rounded_total": doc.rounded_total or doc.grand_total,
                "rounding_adjustment": doc.rounding_adjustment or 0,
                "outstanding_amount": doc.outstanding_amount,

                "items": items,
                "taxes": taxes,
                "is_pos": doc.is_pos,
                "payments": [{
                    "mode_of_payment": p.mode_of_payment,
                    "amount": p.amount
                } for p in doc.payments] if doc.is_pos and doc.payments else [],

                "pdf_url": pdf_url
            }
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get Invoice Details Error")
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["POST"])
def update_sales_invoice():
    """
    Update an EXISTING Sales Invoice (Draft only).
    Any edit will RESET:
    - Posting Date = today
    - Posting Time = now
    - Due Date = today
    """

    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict

        # --------------------------------------------------
        # REQUIRED: Invoice Name
        # --------------------------------------------------
        invoice_name = data.get("invoice_name")
        if not invoice_name:
            return {"status": "error", "message": "'invoice_name' is required"}

        if not frappe.db.exists("Sales Invoice", invoice_name):
            return {"status": "error", "message": f"Sales Invoice '{invoice_name}' not found"}

        doc = frappe.get_doc("Sales Invoice", invoice_name)

        if doc.docstatus != 0:
            return {
                "status": "error",
                "message": "Only Draft Sales Invoices can be updated"
            }

        # --------------------------------------------------
        # UPDATE CUSTOMER (OPTIONAL)
        # --------------------------------------------------
        if data.get("customer_name"):
            customer_param = data.get("customer_name")

            customer = (
                frappe.db.get_value("Customer", {"name": customer_param, "disabled": 0}, "name")
                or frappe.db.get_value("Customer", {"customer_name": customer_param, "disabled": 0}, "name")
                or frappe.db.get_value("Customer", {"custom_customer_name_arabic": customer_param, "disabled": 0}, "name")
            )

            if not customer:
                return {
                    "status": "error",
                    "message": f"Customer '{customer_param}' not found"
                }

            doc.customer = customer

        # --------------------------------------------------
        # UPDATE MODE OF PAYMENT (OPTIONAL)
        # --------------------------------------------------
        if data.get("custom_mode_of_payment"):
            if not frappe.db.exists("Mode of Payment", data.get("custom_mode_of_payment")):
                return {
                    "status": "error",
                    "message": f"Mode of Payment '{data.get('custom_mode_of_payment')}' not found"
                }
            doc.custom_mode_of_payment = data.get("custom_mode_of_payment")

        # --------------------------------------------------
        # UPDATE INCLUDED PAYMENT (is_pos and payments table)
        # Accept both "payments" array and top-level "mode_of_payment"/"payment_method"
        # --------------------------------------------------
        if "is_pos" in data:
            doc.is_pos = cint(data.get("is_pos", 0))

        payments_data = data.get("payments") or []
        if not isinstance(payments_data, list):
            payments_data = []
        single_mop = data.get("mode_of_payment") or data.get("payment_method")
        if single_mop and not payments_data:
            payments_data = [{"mode_of_payment": single_mop, "amount": doc.grand_total or 0}]
        if payments_data and len(payments_data) > 0:
            # Set is_pos = 1 if payments are provided
            doc.is_pos = 1
            # Clear existing payments and add new ones
            doc.set("payments", [])
            for payment_entry in payments_data:
                mode_of_payment = payment_entry.get("mode_of_payment") or payment_entry.get("payment_method")
                amount = flt(payment_entry.get("amount", 0))
                if mode_of_payment:
                    # Validate mode of payment exists
                    if not frappe.db.exists("Mode of Payment", mode_of_payment):
                        return {
                            "status": "error",
                            "message": f"Mode of Payment '{mode_of_payment}' not found"
                        }
                    # Get default account for mode of payment
                    mop_doc = frappe.get_doc("Mode of Payment", mode_of_payment)
                    default_account = None
                    if mop_doc.accounts:
                        for mop_account in mop_doc.accounts:
                            if mop_account.company == doc.company:
                                default_account = mop_account.default_account
                                break
                    
                    doc.append("payments", {
                        "mode_of_payment": mode_of_payment,
                        "amount": amount if amount > 0 else (doc.grand_total or 0),
                        "account": default_account
                    })
        elif "is_pos" in data and cint(data.get("is_pos", 0)) == 0:
            # If is_pos is explicitly set to 0, clear payments
            doc.set("payments", [])

        # --------------------------------------------------
        # UPDATE STOCK FLAG (OPTIONAL)
        # --------------------------------------------------
        if "update_stock" in data:
            doc.update_stock = cint(data.get("update_stock"))

        # --------------------------------------------------
        # UPDATE WAREHOUSE (ONLY IF update_stock = 1)
        # --------------------------------------------------
        if doc.update_stock:
            # Resolve warehouse: User Permission first, then request/doc
            warehouse = frappe.db.get_value(
                "User Permission",
                {"user": frappe.session.user, "allow": "Warehouse"},
                "for_value"
            )
            if warehouse and frappe.db.exists("Warehouse", warehouse):
                wh_company = frappe.db.get_value("Warehouse", warehouse, "company")
                if wh_company != doc.company:
                    warehouse = None
            if not warehouse:
                warehouse = data.get("target_warehouse") or data.get("warehouse")
            if not warehouse or not frappe.db.exists("Warehouse", warehouse):
                warehouse = doc.set_warehouse
            if warehouse:
                doc.set_warehouse = warehouse

        # --------------------------------------------------
        # UPDATE ITEMS (OPTIONAL – REPLACES EXISTING ITEMS)
        # --------------------------------------------------
        if data.get("items"):
            doc.set("items", [])

            company_doc = frappe.get_doc("Company", doc.company)
            update_cost_center = _get_user_cost_center(doc.company)
            if not update_cost_center:
                return {
                    "status": "error",
                    "message": "Cost Center could not be determined. Set User Permission (Cost Center) or Company default Cost Center."
                }

            for item in data.get("items"):
                if not item.get("item_code"):
                    continue

                row = {
                    "item_code": item.get("item_code"),
                    "qty": flt(item.get("qty", 1)),
                    "rate": flt(item.get("rate", 0), 2),
                    "uom": item.get("uom", "Nos"),
                    "income_account": company_doc.default_income_account,
                    "cost_center": update_cost_center
                }

                if doc.update_stock and doc.set_warehouse:
                    row["warehouse"] = doc.set_warehouse

                doc.append("items", row)

            # Refresh default taxes
            tax_template = frappe.db.get_value(
                "Sales Taxes and Charges Template",
                {"company": doc.company, "is_default": 1, "disabled": 0},
                "name"
            )

            if tax_template:
                tpl = frappe.get_doc("Sales Taxes and Charges Template", tax_template)
                doc.set("taxes", [])
                for t in tpl.taxes:
                    doc.append("taxes", {
                        "charge_type": t.charge_type,
                        "account_head": t.account_head,
                        "description": t.description,
                        "rate": t.rate,
                        "cost_center": update_cost_center
                    })
                doc.taxes_and_charges = tax_template

        # --------------------------------------------------
        # UPDATE DISCOUNT (OPTIONAL)
        # --------------------------------------------------
        if "discount_amount" in data:
            doc.discount_amount = flt(data.get("discount_amount"))
            doc.apply_discount_on = data.get("apply_discount_on", "Grand Total")

        if "discount_percentage" in data:
            doc.additional_discount_percentage = flt(data.get("discount_percentage"))
            doc.apply_discount_on = data.get("apply_discount_on", "Grand Total")

        # --------------------------------------------------
        # ADD SALES PERSON TO SALES_TEAM IF NOT ALREADY PRESENT
        # --------------------------------------------------
        sales_person = _get_user_sales_person()
        if sales_person:
            existing_sales_persons = [st.sales_person for st in doc.sales_team]
            if sales_person not in existing_sales_persons:
                doc.append("sales_team", {
                    "sales_person": sales_person,
                    "allocated_percentage": 100
                })

        # --------------------------------------------------
        # SAVE
        # --------------------------------------------------
        doc.set_missing_values()
        doc.calculate_taxes_and_totals()
        
        # If payments are provided, update payment amounts to match final grand_total
        # This ensures the payment amount matches the calculated total after taxes/discounts
        if doc.is_pos and doc.payments and len(doc.payments) > 0:
            # Update payment amount to match grand_total (full payment)
            for payment_row in doc.payments:
                payment_row.amount = doc.grand_total
                payment_row.base_amount = doc.grand_total * flt(doc.conversion_rate)
        
        # Force set dates: posting_date = today, due_date = today+1 RIGHT BEFORE save to override any frontend values or hooks
        # This must be after calculate_taxes_and_totals() to ensure dates are final
        today_date = getdate(today())
        tomorrow_date = add_days(today_date, 1)
        current_time = nowtime()
        
        doc.posting_date = today_date
        doc.posting_time = current_time
        doc.due_date = tomorrow_date
        
        # Update payment_schedule due_dates to tomorrow_date
        if doc.payment_schedule:
            for payment in doc.payment_schedule:
                payment.due_date = tomorrow_date
        
        doc.save(ignore_permissions=True)
        
        # Force update dates in database directly as backup to ensure they persist
        # This bypasses any validation or hooks that might override dates during save
        frappe.db.set_value("Sales Invoice", doc.name, {
            "posting_date": today_date,
            "posting_time": current_time,
            "due_date": tomorrow_date
        }, update_modified=False)
        
        # Update payment_schedule due_dates in database directly
        if doc.payment_schedule:
            for payment in doc.payment_schedule:
                frappe.db.set_value("Payment Schedule", payment.name, "due_date", tomorrow_date, update_modified=False)
        
        frappe.db.commit()
        
        # Reload document to get the updated dates
        doc.reload()

        return {
            "status": "success",
            "message": f"Sales Invoice '{doc.name}' updated successfully",
            "invoice_name": doc.name,
            "posting_date": str(doc.posting_date),
            "due_date": str(doc.due_date),
            "grand_total": doc.grand_total,
            "net_total": doc.net_total,
            "vat_amount": doc.total_taxes_and_charges
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Update Sales Invoice Error")
        return {"status": "error", "message": str(e)}



@frappe.whitelist(allow_guest=False, methods=["POST"])
def submit_sales_invoice():

    def error(msg, code=400):
        frappe.local.response["http_status_code"] = code
        return {
            "status": "error",
            "message": msg
        }

    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict

        # -------------------------------------------------
        # VALIDATION
        # -------------------------------------------------
        invoice_name = data.get("invoice_name")
        if not invoice_name:
            return error("invoice_name is required", 422)

        if not frappe.db.exists("Sales Invoice", invoice_name):
            return error(f"Invoice {invoice_name} not found", 404)

        inv = frappe.get_doc("Sales Invoice", invoice_name)

        if inv.docstatus == 1:
            return error("Invoice already submitted", 409)

        if inv.docstatus == 2:
            return error("Invoice is cancelled", 409)

        # Payment method optional: if missing, treat as Credit (submit only, no Payment Entry)
        payment_mode = (inv.get("custom_mode_of_payment") or "").strip() or None
        if not payment_mode:
            inv.submit()
            frappe.db.commit()
            return {
                "status": "success",
                "message": "Invoice submitted successfully. No Payment Entry created.",
                "data": {
                    "invoice_name": inv.name,
                    "payment_entry": None
                }
            }
        payment_mode_lower = payment_mode.lower()

        # -------------------------------------------------
        # SUBMIT INVOICE (ERPNext STOCK CHECK HERE)
        # -------------------------------------------------
        inv.submit()

        # -------------------------------------------------
        # CREDIT / CREDIT CARD → NO PAYMENT ENTRY
        # -------------------------------------------------
        if payment_mode_lower in ("credit", "credit card"):
            frappe.db.commit()
            return {
                "status": "success",
                "message": f"Invoice submitted successfully ({payment_mode}). No Payment Entry created.",
                "data": {
                    "invoice_name": inv.name,
                    "payment_entry": None
                }
            }

        # -------------------------------------------------
        # RECEIVABLE ACCOUNT
        # -------------------------------------------------
        receivable_account = frappe.db.get_value(
            "Company", inv.company, "default_receivable_account"
        )
        if not receivable_account:
            return error("Default Receivable Account missing in Company", 500)

        # -------------------------------------------------
        # PAYMENT ACCOUNT FROM MODE OF PAYMENT
        # -------------------------------------------------
        payment_account = frappe.db.get_value(
            "Mode of Payment Account",
            {
                "parent": payment_mode,
                "company": inv.company
            },
            "default_account"
        )

        if not payment_account:
            return error(
                f"No account configured for Mode of Payment '{payment_mode}' in company '{inv.company}'",
                422
            )

        # -------------------------------------------------
        # BANK MODE → AUTO REFERENCE
        # -------------------------------------------------
        mop_type = frappe.db.get_value("Mode of Payment", payment_mode, "type")

        if mop_type == "Bank":
            reference_no = inv.name
            reference_date = getdate()
        else:
            reference_no = None
            reference_date = None

        # -------------------------------------------------
        # CREATE PAYMENT ENTRY (DRAFT)
        # -------------------------------------------------
        pe = frappe.get_doc({
            "doctype": "Payment Entry",
            "payment_type": "Receive",
            "posting_date": inv.posting_date,
            "company": inv.company,

            "party_type": "Customer",
            "party": inv.customer,

            "paid_from": receivable_account,
            "paid_to": payment_account,

            "mode_of_payment": payment_mode,

            "paid_amount": inv.grand_total,
            "received_amount": inv.grand_total,

            "reference_no": reference_no,
            "reference_date": reference_date,

            "references": [{
                "reference_doctype": "Sales Invoice",
                "reference_name": inv.name,
                "total_amount": inv.grand_total,
                "outstanding_amount": inv.outstanding_amount,
                "allocated_amount": inv.grand_total,
                "exchange_rate": 1
            }]
        })

        pe.insert(ignore_permissions=True)
        frappe.db.commit()

        return {
            "status": "success",
            "message": "Invoice submitted. Payment Entry created as Draft.",
            "data": {
                "invoice_name": inv.name,
                "payment_entry": pe.name,
                "payment_entry_status": "Draft"
            }
        }

    # -------------------------------------------------
    # NEGATIVE STOCK ERROR (CLEAN MESSAGE ONLY)
    # -------------------------------------------------
    except NegativeStockError as e:
        frappe.db.rollback()

        clean_msg = strip_html(str(e))
        clean_msg = clean_msg.replace("to complete this transaction.", "").strip()

        return error(clean_msg, 409)

    # -------------------------------------------------
    # OTHER BUSINESS VALIDATION ERRORS
    # -------------------------------------------------
    except ValidationError as e:
        frappe.db.rollback()
        return error(str(e), 409)

    # -------------------------------------------------
    # SYSTEM / UNEXPECTED ERRORS
    # -------------------------------------------------
    except Exception:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Submit Sales Invoice Error")
        return error("Internal server error while submitting invoice", 500)


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_mode_of_payment_list():
    """
    Return list of enabled Mode of Payment that have an account for the user's company.
    Used by Collect Payment to show only valid payment methods (no hardcoding).
    """
    try:
        company = _get_user_company()
        if not company:
            return {"status": "success", "data": []}
        # Mode of Payment that have an account for this company
        mop_names = frappe.get_all(
            "Mode of Payment Account",
            filters={"company": company},
            pluck="parent"
        )
        if not mop_names:
            return {"status": "success", "data": []}
        enabled = frappe.get_all(
            "Mode of Payment",
            filters={"name": ["in", list(set(mop_names))], "enabled": 1},
            fields=["name"],
            order_by="name"
        )
        return {
            "status": "success",
            "data": [r["name"] for r in enabled]
        }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get Mode of Payment List Error")
        return {"status": "error", "message": str(e), "data": []}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_payment_entries_list():
    """
    API to list payment entries.
    Draft and Submitted included.
    Cancelled excluded.
    Restricted to logged-in user and user's company (no hardcoded company).
    """

    try:
        company = _get_user_company()
        filters = {
            "docstatus": ["!=", 2],   # Exclude Cancelled
            "owner": frappe.session.user  # 🔐 USER RESTRICTION
        }
        if company:
            filters["company"] = company

        party = frappe.form_dict.get("party")
        if party:
            filters["party"] = party

        party_type = frappe.form_dict.get("party_type", "Customer")
        filters["party_type"] = party_type

        payment_type = frappe.form_dict.get("payment_type")
        if payment_type:
            filters["payment_type"] = payment_type

        mode_of_payment = frappe.form_dict.get("mode_of_payment")
        if mode_of_payment:
            filters["mode_of_payment"] = mode_of_payment

        from_date = frappe.form_dict.get("from_date")
        to_date = frappe.form_dict.get("to_date")

        if from_date and to_date:
            filters["posting_date"] = ["between", [from_date, to_date]]
        elif from_date:
            filters["posting_date"] = [">=", from_date]
        elif to_date:
            filters["posting_date"] = ["<=", to_date]

        order_by = frappe.form_dict.get("order_by", "posting_date")
        order = frappe.form_dict.get("order", "desc")

        payment_entries = frappe.get_all(
            "Payment Entry",
            filters=filters,
            fields=[
                "name",
                "posting_date",
                "docstatus",
                "payment_type",
                "party_type",
                "party",
                "party_name",
                "paid_amount",
                "received_amount",
                "paid_from",
                "paid_to",
                "mode_of_payment",
                "reference_no",
                "reference_date",
                "creation",
                "modified",
                "company"
            ],
            order_by=f"{order_by} {order}, modified desc"
        )

        return {
            "status": "success",
            "total": len(payment_entries),
            "data": payment_entries
        }

    except Exception as e:
        frappe.log_error("Get Payment Entries Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_payment_entry_details():
    """
    API to get detailed information about a specific payment entry
    with direct PDF download link

    Method: GET
    URL: /api/method/your_app.api.get_payment_entry_details?payment_entry=PE-00001
    """

    try:
        payment_entry_name = frappe.form_dict.get("payment_entry")

        if not payment_entry_name:
            return {
                "status": "error",
                "message": "payment_entry is required"
            }

        if not frappe.db.exists("Payment Entry", payment_entry_name):
            return {
                "status": "error",
                "message": f"Payment Entry '{payment_entry_name}' not found"
            }

       
        pe = frappe.get_doc("Payment Entry", payment_entry_name)

       
        references = []
        for ref in pe.references:
            references.append({
                "reference_doctype": ref.reference_doctype,
                "reference_name": ref.reference_name,
                "total_amount": ref.total_amount,
                "outstanding_amount": ref.outstanding_amount,
                "allocated_amount": ref.allocated_amount,
                "exchange_rate": ref.exchange_rate
            })

        
        deductions = []
        if hasattr(pe, "deductions"):
            for ded in pe.deductions:
                deductions.append({
                    "account": ded.account,
                    "cost_center": ded.cost_center,
                    "amount": ded.amount,
                    "description": ded.description
                })

        
        base_url = get_url()
        print_format = frappe.utils.quote("Receipt voucher")

        pdf_url = (
            f"{base_url}/printview?"
            f"doctype=Payment%20Entry"
            f"&name={pe.name}"
            f"&trigger_print=1"
            f"&format={print_format}"
            f"&no_letterhead=0"
            f"&download=1"
        )

        # -------------------------
        # RESPONSE
        # -------------------------
        return {
            "status": "success",
            "data": {
                "name": pe.name,
                "posting_date": str(pe.posting_date),

                "payment_type": pe.payment_type,
                "party_type": pe.party_type,
                "party": pe.party,
                "party_name": pe.party_name,
                "company": pe.company,

                "paid_from": pe.paid_from,
                "paid_from_account_currency": pe.paid_from_account_currency,
                "paid_to": pe.paid_to,
                "paid_to_account_currency": pe.paid_to_account_currency,

                "paid_amount": pe.paid_amount,
                "received_amount": pe.received_amount,
                "source_exchange_rate": pe.source_exchange_rate,
                "target_exchange_rate": pe.target_exchange_rate,

                "mode_of_payment": pe.mode_of_payment,
                "reference_no": pe.reference_no,
                "reference_date": str(pe.reference_date) if pe.reference_date else None,

                "total_allocated_amount": pe.total_allocated_amount,
                "unallocated_amount": pe.unallocated_amount,
                "difference_amount": pe.difference_amount,

                "docstatus": pe.docstatus,
                "status": (
                    "Draft" if pe.docstatus == 0
                    else "Submitted" if pe.docstatus == 1
                    else "Cancelled"
                ),

                "remarks": pe.remarks,

                "references": references,
                "deductions": deductions,

                "pdf_url": pdf_url,   

                "creation": str(pe.creation),
                "modified": str(pe.modified)
            }
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get Payment Entry Details Error")
        return {
            "status": "error",
            "message": str(e)
        }




@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_payment_entry():
    """
    API to create a payment entry against single or multiple invoices
    
    Method: POST
    URL: /api/method/your_app.api.create_payment_entry
    Content-Type: application/json
    
    Body:
    {
        "party_type": "Customer",
        "party": "CUST-001",
        "payment_type": "Receive",
        "posting_date": "2024-01-15",
        "mode_of_payment": "Cash",
        "paid_amount": 1500.00,
        "company": "Your Company",
        "reference_no": "CHQ-12345",
        "reference_date": "2024-01-15",
        "remarks": "Payment received",
        "invoices": [
            {
                "reference_name": "SINV-00001",
                "allocated_amount": 1000.00
            },
            {
                "reference_name": "SINV-00002",
                "allocated_amount": 500.00
            }
        ]
    }
    
    Note: If invoices array is empty or not provided, creates an unallocated payment
    
    Returns:
        JSON with created payment entry details
    """
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        required_fields = ["party_type", "party", "payment_type", "paid_amount", "mode_of_payment"]
        for field in required_fields:
            if not data.get(field):
                return {
                    "status": "error",
                    "message": f"{field} is required"
                }
        
        party_type = data.get("party_type")
        party = data.get("party")
        payment_type = data.get("payment_type")
        company = data.get("company") or _get_user_company()
        
        if not frappe.db.exists(party_type, party):
            return {
                "status": "error",
                "message": f"{party_type} '{party}' not found"
            }
        
        if payment_type == "Receive":
            receivable_account = frappe.db.get_value(
                "Company", company, "default_receivable_account"
            )
            if not receivable_account:
                return {
                    "status": "error",
                    "message": "Default Receivable Account missing in Company settings"
                }
            paid_from = receivable_account
        else:
            payable_account = frappe.db.get_value(
                "Company", company, "default_payable_account"
            )
            if not payable_account:
                return {
                    "status": "error",
                    "message": "Default Payable Account missing in Company settings"
                }
            paid_from = payable_account
        
        payment_account = frappe.db.get_value(
            "Mode of Payment Account",
            {"parent": data.get("mode_of_payment"), "company": company},
            "default_account"
        )
        
        if not payment_account:
            return {
                "status": "error",
                "message": f"No account found for Mode of Payment '{data.get('mode_of_payment')}'"
            }
        
        paid_to = payment_account if payment_type == "Receive" else receivable_account or payable_account
        
        pe = frappe.get_doc({
            "doctype": "Payment Entry",
            "payment_type": payment_type,
            "posting_date": data.get("posting_date", nowdate()),
            "company": company,
            "party_type": party_type,
            "party": party,
            
            "paid_from": paid_from,
            "paid_to": paid_to,
            
            "mode_of_payment": data.get("mode_of_payment"),
            "paid_amount": flt(data.get("paid_amount")),
            "received_amount": flt(data.get("received_amount", data.get("paid_amount"))),
            
            "reference_no": data.get("reference_no"),
            "reference_date": data.get("reference_date"),
            "remarks": data.get("remarks", "Payment Entry created via API")
        })
        
        invoices = data.get("invoices", [])
        total_allocated = 0
        
        for inv_data in invoices:
            invoice_name = inv_data.get("reference_name")
            allocated_amount = flt(inv_data.get("allocated_amount", 0))
            
            if not invoice_name:
                continue
            
            if payment_type == "Receive":
                ref_doctype = "Sales Invoice"
            else:
                ref_doctype = "Purchase Invoice"
            
            if not frappe.db.exists(ref_doctype, invoice_name):
                return {
                    "status": "error",
                    "message": f"{ref_doctype} '{invoice_name}' not found"
                }
            
            inv = frappe.get_doc(ref_doctype, invoice_name)
            
            if inv.docstatus != 1:
                return {
                    "status": "error",
                    "message": f"{ref_doctype} '{invoice_name}' is not submitted"
                }
            
            pe.append("references", {
                "reference_doctype": ref_doctype,
                "reference_name": invoice_name,
                "total_amount": inv.grand_total,
                "outstanding_amount": inv.outstanding_amount,
                "allocated_amount": allocated_amount,
                "exchange_rate": 1
            })
            
            total_allocated += allocated_amount
        
        if total_allocated > flt(data.get("paid_amount")):
            return {
                "status": "error",
                "message": f"Total allocated amount ({total_allocated}) exceeds paid amount ({data.get('paid_amount')})"
            }
        
        pe.insert(ignore_permissions=True)
        
        if data.get("submit", False):
            pe.submit()
        
        frappe.db.commit()
        
        return {
            "status": "success",
            "message": f"Payment Entry '{pe.name}' created successfully",
            "data": {
                "payment_entry": pe.name,
                "party": pe.party,
                "paid_amount": pe.paid_amount,
                "total_allocated_amount": pe.total_allocated_amount,
                "unallocated_amount": pe.unallocated_amount,
                "docstatus": pe.docstatus,
                "status": "Draft" if pe.docstatus == 0 else "Submitted"
            }
        }
        
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Create Payment Entry API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["POST"])
def submit_payment_entry():
    """
    API to submit a payment entry
    
    Method: POST
    URL: /api/method/your_app.api.submit_payment_entry
    Content-Type: application/json
    
    Body:
    {
        "payment_entry": "PE-00001"
    }
    
    Returns:
        JSON with submission status
    """
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        payment_entry_name = data.get("payment_entry")
        
        if not payment_entry_name:
            return {
                "status": "error",
                "message": "payment_entry is required"
            }
        
        if not frappe.db.exists("Payment Entry", payment_entry_name):
            return {
                "status": "error",
                "message": f"Payment Entry '{payment_entry_name}' not found"
            }
        
        pe = frappe.get_doc("Payment Entry", payment_entry_name)
        
        if pe.docstatus == 1:
            return {
                "status": "error",
                "message": "Payment Entry is already submitted"
            }
        
        if pe.docstatus == 2:
            return {
                "status": "error",
                "message": "Payment Entry is cancelled"
            }
        
        pe.submit()
        frappe.db.commit()
        
        return {
            "status": "success",
            "message": f"Payment Entry '{pe.name}' submitted successfully",
            "data": {
                "payment_entry": pe.name,
                "docstatus": pe.docstatus
            }
        }
        
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Submit Payment Entry Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }



@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_accounts_receivable_summary():
    """
    API to get accounts receivable summary for all customers or specific customer
    
    Method: GET
    URL: /api/method/your_app.api.get_accounts_receivable_summary
    
    Query Parameters:
    - customer: Filter by specific customer (optional)
    - company: Company name (optional, uses default if not provided)
    - as_on_date: Date to calculate receivables (default: today)
    - ageing_based_on: posting_date or due_date (default: posting_date)
    - range1: First ageing range (default: 30)
    - range2: Second ageing range (default: 60)
    - range3: Third ageing range (default: 90)
    - limit: Number of customers per page (default: 20)
    - offset: Starting position (default: 0)
    
    Returns:
        JSON with accounts receivable summary
    """
    try:
        filters = {}
        
        customer = frappe.form_dict.get("customer")
        if customer:
            filters["party"] = customer
        
        company = frappe.form_dict.get("company") or _get_user_company()
        as_on_date = frappe.form_dict.get("as_on_date", nowdate())
        ageing_based_on = frappe.form_dict.get("ageing_based_on", "posting_date")
        
        range1 = cint(frappe.form_dict.get("range1", 30))
        range2 = cint(frappe.form_dict.get("range2", 60))
        range3 = cint(frappe.form_dict.get("range3", 90))
        
        limit = cint(frappe.form_dict.get("limit", 20))
        offset = cint(frappe.form_dict.get("offset", 0))
        
        outstanding_invoices = frappe.db.sql("""
            SELECT 
                si.customer as party,
                si.customer_name as party_name,
                si.name as voucher_no,
                si.posting_date,
                si.due_date,
                si.grand_total,
                si.outstanding_amount,
                DATEDIFF(%s, {date_field}) as age_days,
                si.company,
                si.currency
            FROM `tabSales Invoice` si
            WHERE si.docstatus = 1
            AND si.outstanding_amount > 0
            AND si.company = %s
            {customer_filter}
            ORDER BY si.posting_date DESC
        """.format(
            date_field=ageing_based_on,
            customer_filter="AND si.customer = %(customer)s" if customer else ""
        ), {
            "as_on_date": as_on_date,
            "company": company,
            "customer": customer
        }, as_dict=True)
        
        customer_summary = {}
        
        for inv in outstanding_invoices:
            party = inv.party
            
            if party not in customer_summary:
                customer_summary[party] = {
                    "customer": party,
                    "customer_name": inv.party_name,
                    "currency": inv.currency,
                    "total_outstanding": 0,
                    f"range_0_{range1}": 0,
                    f"range_{range1}_{range2}": 0,
                    f"range_{range2}_{range3}": 0,
                    f"range_above_{range3}": 0,
                    "invoices": []
                }
            
            outstanding = flt(inv.outstanding_amount)
            age_days = inv.age_days or 0
            
            customer_summary[party]["total_outstanding"] += outstanding
            
            if age_days <= range1:
                customer_summary[party][f"range_0_{range1}"] += outstanding
            elif age_days <= range2:
                customer_summary[party][f"range_{range1}_{range2}"] += outstanding
            elif age_days <= range3:
                customer_summary[party][f"range_{range2}_{range3}"] += outstanding
            else:
                customer_summary[party][f"range_above_{range3}"] += outstanding
            
            customer_summary[party]["invoices"].append({
                "invoice_no": inv.voucher_no,
                "posting_date": str(inv.posting_date),
                "due_date": str(inv.due_date),
                "grand_total": inv.grand_total,
                "outstanding_amount": outstanding,
                "age_days": age_days
            })
        
        customer_list = list(customer_summary.values())
        total_count = len(customer_list)
        
        customer_list.sort(key=lambda x: x["total_outstanding"], reverse=True)
        
        paginated_list = customer_list[offset:offset + limit]
        
        grand_total = sum(c["total_outstanding"] for c in customer_list)
        
        return {
            "status": "success",
            "count": len(paginated_list),
            "total": total_count,
            "limit": limit,
            "offset": offset,
            "summary": {
                "as_on_date": as_on_date,
                "company": company,
                "total_outstanding": grand_total,
                "ageing_based_on": ageing_based_on,
                "ranges": {
                    f"0-{range1} days": sum(c[f"range_0_{range1}"] for c in customer_list),
                    f"{range1}-{range2} days": sum(c[f"range_{range1}_{range2}"] for c in customer_list),
                    f"{range2}-{range3} days": sum(c[f"range_{range2}_{range3}"] for c in customer_list),
                    f"Above {range3} days": sum(c[f"range_above_{range3}"] for c in customer_list)
                }
            },
            "data": paginated_list
        }
        
    except Exception as e:
        frappe.log_error("Get Accounts Receivable Summary Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_customer_receivable_details():
    """
    API to get detailed accounts receivable for a specific customer
    
    Method: GET
    URL: /api/method/your_app.api.get_customer_receivable_details?customer=CUST-001
    
    Query Parameters:
    - customer: Customer name (required)
    - company: Company name (optional)
    - as_on_date: Date to calculate receivables (default: today)
    - include_payments: Include payment history (default: true)
    
    Returns:
        JSON with detailed customer receivable information
    """
    try:
        customer = frappe.form_dict.get("customer")
        
        if not customer:
            return {
                "status": "error",
                "message": "customer is required"
            }
        
        if not frappe.db.exists("Customer", customer):
            return {
                "status": "error",
                "message": f"Customer '{customer}' not found"
            }
        
        company = frappe.form_dict.get("company") or _get_user_company()
        as_on_date = frappe.form_dict.get("as_on_date", nowdate())
        include_payments = frappe.form_dict.get("include_payments", "true").lower() == "true"
        
        customer_doc = frappe.get_doc("Customer", customer)
        
        outstanding_invoices = frappe.db.sql("""
            SELECT 
                name,
                posting_date,
                due_date,
                grand_total,
                outstanding_amount,
                DATEDIFF(%s, posting_date) as age_days,
                status
            FROM `tabSales Invoice`
            WHERE docstatus = 1
            AND customer = %s
            AND company = %s
            AND outstanding_amount > 0
            ORDER BY posting_date DESC
        """, (as_on_date, customer, company), as_dict=True)
        
        total_outstanding = sum(flt(inv.outstanding_amount) for inv in outstanding_invoices)
        
        payment_history = []
        if include_payments:
            payments = frappe.db.sql("""
                SELECT 
                    pe.name,
                    pe.posting_date,
                    pe.paid_amount,
                    pe.mode_of_payment,
                    pe.reference_no,
                    pe.remarks
                FROM `tabPayment Entry` pe
                WHERE pe.docstatus = 1
                AND pe.party_type = 'Customer'
                AND pe.party = %s
                AND pe.company = %s
                AND pe.payment_type = 'Receive'
                ORDER BY pe.posting_date DESC
                LIMIT 10
            """, (customer, company), as_dict=True)
            
            for payment in payments:
                refs = frappe.db.sql("""
                    SELECT reference_name, allocated_amount
                    FROM `tabPayment Entry Reference`
                    WHERE parent = %s
                """, payment.name, as_dict=True)
                
                payment["references"] = refs
                payment_history.append(payment)
        
        all_invoices = frappe.db.sql("""
            SELECT 
                name,
                posting_date,
                due_date,
                grand_total,
                outstanding_amount,
                paid_amount,
                status
            FROM `tabSales Invoice`
            WHERE docstatus = 1
            AND customer = %s
            AND company = %s
            ORDER BY posting_date DESC
            LIMIT 50
        """, (customer, company), as_dict=True)
        
        total_invoiced = sum(flt(inv.grand_total) for inv in all_invoices)
        total_paid = sum(flt(inv.paid_amount) for inv in all_invoices)
        
        return {
            "status": "success",
            "data": {
                "customer": customer,
                "customer_name": customer_doc.customer_name,
                "customer_group": customer_doc.customer_group,
                "territory": customer_doc.territory,
                "tax_id": customer_doc.tax_id,
                "credit_limit": customer_doc.credit_limits[0].credit_limit if customer_doc.credit_limits else 0,
                
                "summary": {
                    "as_on_date": as_on_date,
                    "total_invoiced": total_invoiced,
                    "total_paid": total_paid,
                    "total_outstanding": total_outstanding,
                    "outstanding_count": len(outstanding_invoices)
                },
                
                "outstanding_invoices": [
                    {
                        "invoice_no": inv.name,
                        "posting_date": str(inv.posting_date),
                        "due_date": str(inv.due_date),
                        "grand_total": inv.grand_total,
                        "outstanding_amount": inv.outstanding_amount,
                        "age_days": inv.age_days,
                        "status": inv.status
                    }
                    for inv in outstanding_invoices
                ],
                
                "payment_history": [
                    {
                        "payment_entry": p.name,
                        "posting_date": str(p.posting_date),
                        "paid_amount": p.paid_amount,
                        "mode_of_payment": p.mode_of_payment,
                        "reference_no": p.reference_no,
                        "remarks": p.remarks,
                        "invoices_paid": [
                            {
                                "invoice_no": r.reference_name,
                                "allocated_amount": r.allocated_amount
                            }
                            for r in p.get("references", [])
                        ]
                    }
                    for p in payment_history
                ] if include_payments else [],
                
                "recent_invoices": [
                    {
                        "invoice_no": inv.name,
                        "posting_date": str(inv.posting_date),
                        "due_date": str(inv.due_date),
                        "grand_total": inv.grand_total,
                        "outstanding_amount": inv.outstanding_amount,
                        "paid_amount": inv.paid_amount,
                        "status": inv.status
                    }
                    for inv in all_invoices[:10]
                ]
            }
        }
        
    except Exception as e:
        frappe.log_error("Get Customer Receivable Details Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_outstanding_invoices_for_payment():
    """
    API to get outstanding invoices for a customer to create payment entry
    
    Method: GET
    URL: /api/method/your_app.api.get_outstanding_invoices_for_payment?customer=CUST-001
    
    Query Parameters:
    - customer: Customer name (required)
    - company: Company name (optional)
    
    Returns:
        JSON with list of outstanding invoices ready for payment allocation
    """
    try:
        customer = frappe.form_dict.get("customer")
        
        if not customer:
            return {
                "status": "error",
                "message": "customer is required"
            }
        
        if not frappe.db.exists("Customer", customer):
            return {
                "status": "error",
                "message": f"Customer '{customer}' not found"
            }
        
        company = frappe.form_dict.get("company") or _get_user_company()
        
        # Get outstanding invoices
        invoices = frappe.db.sql("""
            SELECT 
                name as invoice_no,
                posting_date,
                due_date,
                grand_total,
                outstanding_amount,
                DATEDIFF(CURDATE(), due_date) as overdue_days,
                currency
            FROM `tabSales Invoice`
            WHERE docstatus = 1
            AND customer = %s
            AND company = %s
            AND outstanding_amount > 0
            ORDER BY posting_date ASC
        """, (customer, company), as_dict=True)
        
        total_outstanding = sum(flt(inv.outstanding_amount) for inv in invoices)
        
        return {
            "status": "success",
            "count": len(invoices),
            "summary": {
                "customer": customer,
                "total_outstanding": total_outstanding,
                "invoice_count": len(invoices),
                "overdue_count": sum(1 for inv in invoices if inv.overdue_days > 0)
            },
            "data": [
                {
                    "invoice_no": inv.invoice_no,
                    "posting_date": str(inv.posting_date),
                    "due_date": str(inv.due_date),
                    "grand_total": inv.grand_total,
                    "outstanding_amount": inv.outstanding_amount,
                    "overdue_days": inv.overdue_days,
                    "is_overdue": inv.overdue_days > 0,
                    "currency": inv.currency
                }
                for inv in invoices
            ]
        }
        
    except Exception as e:
        frappe.log_error("Get Outstanding Invoices Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }



@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_customer_billing_and_payments():
    """
    Combined API:
    - All Submitted Sales Invoices (including Paid)
    - Submitted Payment Entries
    
    Filters:
    - customer
    - from_date
    - to_date

    Returns:
    - Full ledger list (no pagination)
    - Total Billed
    - Total Paid
    - Total Outstanding
    """

    try:
        customer = frappe.form_dict.get("customer")
        from_date = frappe.form_dict.get("from_date")
        to_date = frappe.form_dict.get("to_date")

        date_filter = None
        if from_date and to_date:
            date_filter = ["between", [from_date, to_date]]
        elif from_date:
            date_filter = [">=", from_date]
        elif to_date:
            date_filter = ["<=", to_date]

        # --------------------------
        # SALES INVOICES
        # --------------------------
        inv_filters = {"docstatus": 1}

        if customer:
            inv_filters["customer"] = customer
        if date_filter:
            inv_filters["posting_date"] = date_filter

        invoices = frappe.get_all(
            "Sales Invoice",
            filters=inv_filters,
            fields=[
                "name", "posting_date", "customer",
                "grand_total", "outstanding_amount",
                "due_date", "status"
            ]
        )

        # --------------------------
        # PAYMENT ENTRIES
        # --------------------------
        pay_filters = {
            "party_type": "Customer",
            "docstatus": 1
        }

        if customer:
            pay_filters["party"] = customer
        if date_filter:
            pay_filters["posting_date"] = date_filter

        payments = frappe.get_all(
            "Payment Entry",
            filters=pay_filters,
            fields=[
                "name", "posting_date", "party",
                "paid_amount", "received_amount",
                "mode_of_payment", "payment_type"
            ]
        )

        # --------------------------
        # TOTALS
        # --------------------------
        total_billed = 0
        total_paid = 0
        total_outstanding = 0

        for inv in invoices:
            total_billed += flt(inv["grand_total"])
            total_outstanding += flt(inv["outstanding_amount"])
            total_paid += flt(inv["grand_total"]) - flt(inv["outstanding_amount"])

            inv["source"] = "Invoice"
            inv["amount"] = inv["grand_total"]
            inv["date"] = inv["posting_date"]
            inv["invoice_status"] = inv["status"]

        for pay in payments:
            paid = flt(pay["received_amount"] or pay["paid_amount"])
            total_paid += paid

            pay["source"] = "Payment"
            pay["customer"] = pay["party"]
            pay["amount"] = paid
            pay["date"] = pay["posting_date"]
            pay["invoice_status"] = None

        # --------------------------
        # FINAL COMBINED LIST
        # --------------------------
        combined = invoices + payments
        combined.sort(key=lambda x: x["date"], reverse=True)

        return {
            "status": "success",
            "filters": {
                "customer": customer,
                "from_date": from_date,
                "to_date": to_date
            },
            "summary": {
                "total_billed": total_billed,
                "total_paid": total_paid,
                "total_outstanding": total_outstanding
            },
            "total_records": len(combined),
            "data": combined
        }

    except Exception as e:
        frappe.log_error("Combined Billing API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }



@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_today_sales():
    """Today's sales invoice total (logged-in user only)"""

    try:
        today = frappe.utils.today()
        current_user = frappe.session.user

        data = frappe.db.sql("""
            SELECT
                COUNT(name) AS invoice_count,
                SUM(grand_total) AS total_sales
            FROM `tabSales Invoice`
            WHERE
                posting_date = %s
                AND docstatus = 1
                AND owner = %s
        """, (today, current_user), as_dict=True)[0]

        invoice_count = cint(data.invoice_count or 0)
        total_sales = flt(data.total_sales or 0)
        return {
            "status": "success",
            "date": today,
            "amount": total_sales,
            "total": total_sales,
            "count": invoice_count,
            "invoice_count": invoice_count,
            "invoices": invoice_count
        }

    except Exception as e:
        frappe.log_error("Today Sales API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


def _get_today_collection_data(mode_type=None):
    """
    Internal: today's collection (Payment Entry + Sales Invoice payments) for current user.
    mode_type: None = all, 'Cash' = Mode of Payment type Cash, 'Bank' = type Bank.
    Returns (total_amount, total_count).
    """
    today = frappe.utils.today()
    current_user = frappe.session.user
    params = (today, current_user)

    if mode_type is None:
        pe_sql = """
            SELECT COUNT(pe.name) AS c, COALESCE(SUM(pe.paid_amount), 0) AS amt
            FROM `tabPayment Entry` pe
            WHERE pe.posting_date = %s AND pe.docstatus = 1
                AND pe.payment_type = 'Receive' AND pe.owner = %s
        """
        si_sql = """
            SELECT COUNT(sip.name) AS c, COALESCE(SUM(sip.amount), 0) AS amt
            FROM `tabSales Invoice Payment` sip
            INNER JOIN `tabSales Invoice` si ON si.name = sip.parent
            WHERE si.posting_date = %s AND si.docstatus = 1 AND si.owner = %s
        """
    else:
        pe_sql = """
            SELECT COUNT(pe.name) AS c, COALESCE(SUM(pe.paid_amount), 0) AS amt
            FROM `tabPayment Entry` pe
            INNER JOIN `tabMode of Payment` mop ON mop.name = pe.mode_of_payment AND mop.type = %s
            WHERE pe.posting_date = %s AND pe.docstatus = 1
                AND pe.payment_type = 'Receive' AND pe.owner = %s
        """
        si_sql = """
            SELECT COUNT(sip.name) AS c, COALESCE(SUM(sip.amount), 0) AS amt
            FROM `tabSales Invoice Payment` sip
            INNER JOIN `tabSales Invoice` si ON si.name = sip.parent
            INNER JOIN `tabMode of Payment` mop ON mop.name = sip.mode_of_payment AND mop.type = %s
            WHERE si.posting_date = %s AND si.docstatus = 1 AND si.owner = %s
        """
        params = (mode_type, today, current_user)

    pe_row = frappe.db.sql(pe_sql, params, as_dict=True)[0]
    si_row = frappe.db.sql(si_sql, params, as_dict=True)[0]
    total_amount = flt(pe_row.amt or 0) + flt(si_row.amt or 0)
    total_count = cint(pe_row.c or 0) + cint(si_row.c or 0)
    return total_amount, total_count


def _api_error(title, message=None):
    """Return standard error response and log."""
    frappe.log_error(title, frappe.get_traceback())
    return {"status": "error", "message": message or str(frappe.get_traceback())}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_today_collection():
    """
    Today's total collection (logged-in user only).
    Includes both Payment Entry and included payments on Sales Invoices. No mode filter.
    """
    try:
        today = frappe.utils.today()
        total_amount, total_count = _get_today_collection_data(mode_type=None)
        return {
            "status": "success",
            "date": today,
            "amount": total_amount,
            "total": total_amount,
            "payments": total_count,
            "payment_count": total_count,
        }
    except Exception as e:
        return _api_error("Today Collection API Error", str(e))


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_today_cash_collection():
    """Today's CASH collection (Mode of Payment type = 'Cash'). PE + Sales Invoice payments."""
    try:
        today = frappe.utils.today()
        total_amount, total_count = _get_today_collection_data(mode_type="Cash")
        return {
            "status": "success",
            "date": today,
            "amount": total_amount,
            "total": total_amount,
            "payments": total_count,
            "payment_count": total_count,
        }
    except Exception as e:
        return _api_error("Cash Collection API Error", str(e))


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_today_bank_collection():
    """Today's BANK collection (Mode of Payment type = 'Bank'). PE + Sales Invoice payments."""
    try:
        today = frappe.utils.today()
        total_amount, total_count = _get_today_collection_data(mode_type="Bank")
        return {
            "status": "success",
            "date": today,
            "amount": total_amount,
            "total": total_amount,
            "payments": total_count,
            "payment_count": total_count,
        }
    except Exception as e:
        return _api_error("Bank Collection API Error", str(e))


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_daily_pos_collection():
    """Today's POS (Shabaka) collection — logged-in user only"""

    try:
        today = frappe.utils.today()
        current_user = frappe.session.user

        data = frappe.db.sql("""
            SELECT
                COUNT(name) AS payment_count,
                SUM(paid_amount) AS pos_collection
            FROM `tabPayment Entry`
            WHERE
                posting_date = %s
                AND docstatus = 1
                AND payment_type = 'Receive'
                AND mode_of_payment = 'POS SHABAKA'
                AND owner = %s
        """, (today, current_user), as_dict=True)[0]

        return {
            "status": "success",
            "date": today,
            "amount": data.pos_collection or 0,
            "payments": data.payment_count or 0
        }

    except Exception as e:
        frappe.log_error("POS Collection API Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["POST"])
def create_sales_return():
    """
    Create a Sales Return (Credit Note) against a Sales Invoice.
    
    Two methods supported:
    1. Full return - Return entire invoice
    2. Partial return - Return specific items with quantities
    
    Features:
    - Auto-creates return invoice with negative quantities
    - Links to original invoice
    - Updates stock if original invoice updated stock
    - Preserves tax template and calculations
    - Supports custom return reasons
    """
    
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        # Required field
        original_invoice = data.get("original_invoice")
        if not original_invoice:
            return {"status": "error", "message": "original_invoice is required"}
        
        # Validate original invoice exists and is submitted
        if not frappe.db.exists("Sales Invoice", original_invoice):
            return {"status": "error", "message": f"Sales Invoice '{original_invoice}' not found"}
        
        original_doc = frappe.get_doc("Sales Invoice", original_invoice)
        
        if original_doc.docstatus != 1:
            return {
                "status": "error", 
                "message": f"Original invoice must be submitted. Current status: {original_doc.docstatus}"
            }
        
        # Check if invoice is already fully returned
        if original_doc.is_return:
            return {"status": "error", "message": "Cannot create return against a return invoice"}
        
        # Get return date
        posting_date = getdate(data.get("posting_date") or nowdate())
        
        # Validate posting date is not before original invoice date
        if posting_date < original_doc.posting_date:
            return {
                "status": "error",
                "message": f"Return date cannot be before original invoice date ({original_doc.posting_date})"
            }
        
        # Check if full return or partial return
        return_items = data.get("items")  # If provided, partial return
        custom_return_reason = data.get("custom_return_reason", "")
        
        # Create return invoice data
        return_invoice_data = {
            "doctype": "Sales Invoice",
            "customer": original_doc.customer,
            "company": original_doc.company,
            "posting_date": posting_date,
            "due_date": posting_date,
            "is_return": 1,
            "return_against": original_invoice,
            "currency": original_doc.currency,
            "debit_to": original_doc.debit_to,
            "update_stock": original_doc.update_stock,
            "conversion_rate": original_doc.conversion_rate,
            "taxes_and_charges": original_doc.taxes_and_charges,
            "items": [],
            "taxes": []
        }
        
        # Add naming series if provided
        if data.get("naming_series"):
            return_invoice_data["naming_series"] = data["naming_series"]
        
        # Add warehouse if stock update enabled
        if original_doc.update_stock and original_doc.set_warehouse:
            return_invoice_data["set_warehouse"] = original_doc.set_warehouse
        
        # Process items
        if return_items:
            # Partial return - specific items and quantities
            for return_item in return_items:
                item_code = return_item.get("item_code")
                return_qty = flt(return_item.get("qty", 0))
                
                if not item_code or return_qty <= 0:
                    continue
                
                # Find original item
                original_item = None
                for orig_item in original_doc.items:
                    if orig_item.item_code == item_code:
                        original_item = orig_item
                        break
                
                if not original_item:
                    return {
                        "status": "error",
                        "message": f"Item '{item_code}' not found in original invoice"
                    }
                
                # Validate return quantity
                if return_qty > original_item.qty:
                    return {
                        "status": "error",
                        "message": f"Return qty {return_qty} exceeds original qty {original_item.qty} for item {item_code}"
                    }
                
                # Add return item (negative quantity)
                return_invoice_data["items"].append({
                    "item_code": original_item.item_code,
                    "item_name": original_item.item_name,
                    "description": original_item.description,
                    "qty": -return_qty,  # Negative for return
                    "rate": original_item.rate,
                    "uom": original_item.uom,
                    "stock_uom": original_item.stock_uom,
                    "conversion_factor": original_item.conversion_factor,
                    "income_account": original_item.income_account,
                    "cost_center": original_item.cost_center,
                    "warehouse": original_item.warehouse if original_doc.update_stock else None
                })
        else:
            # Full return - return all items with full quantities
            for orig_item in original_doc.items:
                return_invoice_data["items"].append({
                    "item_code": orig_item.item_code,
                    "item_name": orig_item.item_name,
                    "description": orig_item.description,
                    "qty": -orig_item.qty,  # Negative for return
                    "rate": orig_item.rate,
                    "uom": orig_item.uom,
                    "stock_uom": orig_item.stock_uom,
                    "conversion_factor": orig_item.conversion_factor,
                    "income_account": orig_item.income_account,
                    "cost_center": orig_item.cost_center,
                    "warehouse": orig_item.warehouse if original_doc.update_stock else None
                })
        
        # Copy taxes from original invoice (will be auto-calculated as negative)
        for orig_tax in original_doc.taxes:
            return_invoice_data["taxes"].append({
                "charge_type": orig_tax.charge_type,
                "account_head": orig_tax.account_head,
                "description": orig_tax.description,
                "rate": orig_tax.rate,
                "cost_center": orig_tax.cost_center
            })
        
        # Create return invoice
        return_doc = frappe.get_doc(return_invoice_data)
        
        # Add return reason if provided
        if custom_return_reason:
            return_doc.custom_return_reason = custom_return_reason
        
        return_doc.insert(ignore_permissions=True)
        frappe.db.commit()
        
        # Prepare response
        return {
            "status": "success",
            "message": f"Sales Return {return_doc.name} created successfully",
            "data": {
                "return_invoice": return_doc.name,
                "original_invoice": original_invoice,
                "customer": return_doc.customer,
                "company": return_doc.company,
                "posting_date": str(return_doc.posting_date),
                "is_return": return_doc.is_return,
                "return_against": return_doc.return_against,
                
                "net_total": return_doc.net_total,
                "tax_total": return_doc.total_taxes_and_charges,
                "grand_total": return_doc.grand_total,
                "outstanding_amount": return_doc.outstanding_amount,
                
                "items": [
                    {
                        "item_code": i.item_code,
                        "item_name": i.item_name,
                        "qty": i.qty,
                        "rate": i.rate,
                        "amount": i.amount,
                        "uom": i.uom
                    }
                    for i in return_doc.items
                ],
                
                "taxes": [
                    {
                        "description": t.description,
                        "rate": t.rate,
                        "tax_amount": t.tax_amount
                    }
                    for t in return_doc.taxes
                ]
            }
        }
        
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Sales Return API Error")
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=False, methods=["POST"])
def submit_sales_return():
    """
    Submit a Sales Return (Credit Note).
    
    Features:
    - Validates return invoice exists and is draft
    - Submits the return invoice
    - Updates stock if applicable
    - Updates outstanding amount of original invoice
    - Optionally creates refund payment entry
    
    Note: Payment entry creation is optional based on create_payment flag
    """
    
    try:
        data = json.loads(frappe.request.data) if frappe.request.data else frappe.form_dict
        
        return_invoice = data.get("return_invoice")
        if not return_invoice:
            return {"status": "error", "message": "return_invoice is required"}
        
        # Validate return invoice exists
        if not frappe.db.exists("Sales Invoice", return_invoice):
            return {"status": "error", "message": f"Sales Invoice '{return_invoice}' not found"}
        
        return_doc = frappe.get_doc("Sales Invoice", return_invoice)
        
        # Validate it's a return invoice
        if not return_doc.is_return:
            return {"status": "error", "message": "This is not a return invoice"}
        
        # Validate it's in draft state
        if return_doc.docstatus != 0:
            return {
                "status": "error",
                "message": f"Return invoice already submitted or cancelled. Status: {return_doc.docstatus}"
            }
        
        # Submit the return invoice
        return_doc.submit()
        frappe.db.commit()
        
        # Check if payment entry should be created
        create_payment = data.get("create_payment", False)
        payment_entry = None
        
        if create_payment:
            # Get payment mode (default to Cash if not specified)
            mode_of_payment = data.get("mode_of_payment", "Cash")
            
            # Validate mode of payment exists
            if not frappe.db.exists("Mode of Payment", mode_of_payment):
                return {
                    "status": "error",
                    "message": f"Mode of Payment '{mode_of_payment}' not found"
                }
            
            # Get company's receivable account
            receivable_account = frappe.db.get_value(
                "Company", return_doc.company, "default_receivable_account"
            )
            
            if not receivable_account:
                return {
                    "status": "error",
                    "message": "Default Receivable Account missing in Company settings"
                }
            
            # Get payment account from mode of payment
            payment_account = frappe.db.get_value(
                "Mode of Payment Account",
                {"parent": mode_of_payment, "company": return_doc.company},
                "default_account"
            )
            
            if not payment_account:
                return {
                    "status": "error",
                    "message": f"No account configured for Mode of Payment '{mode_of_payment}'"
                }
            
            # Create Payment Entry for refund
            pe = frappe.get_doc({
                "doctype": "Payment Entry",
                "payment_type": "Pay",  # Pay because we're refunding to customer
                "posting_date": return_doc.posting_date,
                "company": return_doc.company,
                "party_type": "Customer",
                "party": return_doc.customer,
                
                "paid_from": payment_account,  # Pay from cash/bank
                "paid_to": receivable_account,  # Pay to receivable (reduces customer balance)
                
                "mode_of_payment": mode_of_payment,
                
                "paid_amount": abs(return_doc.grand_total),  # Absolute value
                "received_amount": abs(return_doc.grand_total),
                
                "references": [
                    {
                        "reference_doctype": "Sales Invoice",
                        "reference_name": return_doc.name,
                        "total_amount": return_doc.grand_total,
                        "outstanding_amount": return_doc.outstanding_amount,
                        "exchange_rate": 1,
                        "allocated_amount": abs(return_doc.grand_total)
                    }
                ]
            })
            
            pe.insert(ignore_permissions=True)
            pe.submit()
            frappe.db.commit()
            
            payment_entry = pe.name
        
        # Prepare response
        return {
            "status": "success",
            "message": "Sales Return submitted successfully" + (
                " with refund payment" if payment_entry else ""
            ),
            "data": {
                "return_invoice": return_doc.name,
                "original_invoice": return_doc.return_against,
                "docstatus": return_doc.docstatus,
                "payment_entry": payment_entry,
                "grand_total": return_doc.grand_total,
                "outstanding_amount": return_doc.outstanding_amount
            }
        }
        
    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Submit Sales Return Error")
        return {"status": "error", "message": str(e)}


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_sales_return_details():
    """
    Get details of a Sales Return invoice.
    
    Returns:
    - Return invoice details
    - Original invoice reference
    - Items returned
    - Tax details
    - Payment entry (if exists)
    """
    
    try:
        return_invoice = frappe.form_dict.get("return_invoice")
        
        if not return_invoice:
            return {"status": "error", "message": "return_invoice parameter is required"}
        
        if not frappe.db.exists("Sales Invoice", return_invoice):
            return {"status": "error", "message": f"Sales Invoice '{return_invoice}' not found"}
        
        return_doc = frappe.get_doc("Sales Invoice", return_invoice)
        
        if not return_doc.is_return:
            return {"status": "error", "message": "This is not a return invoice"}
        
        # Get payment entry if exists
        payment_entries = frappe.get_all(
            "Payment Entry Reference",
            filters={
                "reference_doctype": "Sales Invoice",
                "reference_name": return_invoice,
                "docstatus": 1
            },
            fields=["parent as payment_entry"]
        )
        
        return {
            "status": "success",
            "data": {
                "return_invoice": return_doc.name,
                "original_invoice": return_doc.return_against,
                "customer": return_doc.customer,
                "customer_name": return_doc.customer_name,
                "company": return_doc.company,
                
                "posting_date": str(return_doc.posting_date),
                "due_date": str(return_doc.due_date),
                
                "docstatus": return_doc.docstatus,
                "status": "Draft" if return_doc.docstatus == 0 else "Submitted" if return_doc.docstatus == 1 else "Cancelled",
                
                "is_return": return_doc.is_return,
                "return_against": return_doc.return_against,
                
                "net_total": return_doc.net_total,
                "tax_total": return_doc.total_taxes_and_charges,
                "grand_total": return_doc.grand_total,
                "rounded_total": return_doc.rounded_total or return_doc.grand_total,
                "outstanding_amount": return_doc.outstanding_amount,
                
                "update_stock": return_doc.update_stock,
                
                "items": [
                    {
                        "item_code": i.item_code,
                        "item_name": i.item_name,
                        "description": i.description,
                        "qty": i.qty,
                        "rate": i.rate,
                        "amount": i.amount,
                        "uom": i.uom,
                        "warehouse": i.warehouse
                    }
                    for i in return_doc.items
                ],
                
                "taxes": [
                    {
                        "description": t.description,
                        "charge_type": t.charge_type,
                        "account_head": t.account_head,
                        "rate": t.rate,
                        "tax_amount": t.tax_amount
                    }
                    for t in return_doc.taxes
                ],
                
                "payment_entries": [pe["payment_entry"] for pe in payment_entries] if payment_entries else []
            }
        }
        
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get Sales Return Details Error")
        return {"status": "error", "message": str(e)}




@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_sales_returns_list():
    """
    Get list of Sales Returns restricted to records owned by the logged-in user.
    """

    try:
        filters = {"is_return": 1}

        # Restrict to current user's records
        filters["owner"] = frappe.session.user

        # --------------------------------
        # OPTIONAL FILTERS
        # --------------------------------
        if frappe.form_dict.get("customer"):
            filters["customer"] = frappe.form_dict.get("customer")

        from_date = frappe.form_dict.get("from_date")
        to_date = frappe.form_dict.get("to_date")

        if from_date and to_date:
            filters["posting_date"] = ["between", [from_date, to_date]]
        elif from_date:
            filters["posting_date"] = [">=", from_date]
        elif to_date:
            filters["posting_date"] = ["<=", to_date]

        if frappe.form_dict.get("status") is not None:
            filters["docstatus"] = cint(frappe.form_dict.get("status"))

        if frappe.form_dict.get("original_invoice"):
            filters["return_against"] = frappe.form_dict.get("original_invoice")

        # --------------------------------
        # FETCH RETURNS
        # --------------------------------
        returns = frappe.get_all(
            "Sales Invoice",
            filters=filters,
            fields=[
                "name",
                "customer",
                "customer_name",
                "posting_date",
                "return_against",
                "grand_total",
                "outstanding_amount",
                "docstatus",
                "set_warehouse",
                "owner"
            ],
            order_by="posting_date desc, modified desc"
        )

        # --------------------------------
        # STATUS LABEL
        # --------------------------------
        for ret in returns:
            ret["status"] = (
                "Draft" if ret.docstatus == 0 else
                "Submitted" if ret.docstatus == 1 else
                "Cancelled"
            )

        return {
            "status": "success",
            "total": len(returns),
            "data": returns
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get Sales Returns List Error")
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_stock_balance_summary():

    try:
        warehouse = frappe.form_dict.get("warehouse")
        company = frappe.form_dict.get("company") or _get_user_company()

        conditions = []

        if warehouse:
            conditions.append(f"sle.warehouse = '{warehouse}'")

        if company:
            conditions.append(f"wh.company = '{company}'")

        where_clause = " AND " + " AND ".join(conditions) if conditions else ""

        query = f"""
            SELECT 
                COUNT(DISTINCT sle.item_code) as total_items,
                SUM(sle.qty_after_transaction) as total_quantity,
                SUM(sle.stock_value) as stock_value
            FROM 
                (
                    SELECT 
                        item_code,
                        warehouse,
                        qty_after_transaction,
                        stock_value,
                        ROW_NUMBER() OVER (PARTITION BY item_code, warehouse 
                                           ORDER BY posting_date DESC, posting_time DESC, creation DESC) as rn
                    FROM `tabStock Ledger Entry`
                    WHERE docstatus < 2
                ) sle
            INNER JOIN `tabWarehouse` wh ON wh.name = sle.warehouse
            WHERE sle.rn = 1
            AND sle.qty_after_transaction > 0
            {where_clause}
        """

        result = frappe.db.sql(query, as_dict=True)

        currency = frappe.db.get_value("Company", company, "default_currency") if company else "SAR"

        summary = result[0] if result else {}

        return {
            "status": "success",
            "data": {
                "total_items": cint(summary.get("total_items", 0)),
                "total_quantity": flt(summary.get("total_quantity", 0), 2),
                "stock_value": flt(summary.get("stock_value", 0), 2),
                "currency": currency or "SAR"
            }
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Stock Summary Error")
        return {"status": "error", "message": str(e)}



@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_stock_levels():

    try:
        warehouse = frappe.form_dict.get("warehouse")
        company = frappe.form_dict.get("company") or _get_user_company()
        item_code_search = frappe.form_dict.get("item_code")
        item_name_search = frappe.form_dict.get("item_name")
        general_search = frappe.form_dict.get("search")

        conditions = ["sle.qty_after_transaction > 0"]

        if warehouse:
            conditions.append(f"sle.warehouse = '{warehouse}'")
        if company:
            conditions.append(f"wh.company = '{company}'")
        if item_code_search:
            conditions.append(f"item.item_code LIKE '%{item_code_search}%'")
        if item_name_search:
            conditions.append(f"item.item_name LIKE '%{item_name_search}%'")
        if general_search:
            conditions.append(f"(item.item_code LIKE '%{general_search}%' OR item.item_name LIKE '%{general_search}%')")

        where_clause = " AND ".join(conditions)

        query = f"""
            SELECT 
                item.item_code,
                item.item_name,
                item.stock_uom as uom,
                sle.warehouse,
                sle.qty_after_transaction as stock_qty,
                item.valuation_rate as cost_price,
                item.standard_rate as sale_price,
                sle.stock_value,
                CASE WHEN sle.qty_after_transaction > 0 THEN 'In Stock' ELSE 'Out of Stock' END status
            FROM 
                (
                    SELECT 
                        item_code,
                        warehouse,
                        qty_after_transaction,
                        stock_value,
                        ROW_NUMBER() OVER (PARTITION BY item_code, warehouse 
                                           ORDER BY posting_date DESC, posting_time DESC, creation DESC) rn
                    FROM `tabStock Ledger Entry`
                    WHERE docstatus < 2
                ) sle
            INNER JOIN `tabItem` item ON item.name = sle.item_code
            INNER JOIN `tabWarehouse` wh ON wh.name = sle.warehouse
            WHERE sle.rn = 1 AND {where_clause}
            ORDER BY item.item_code ASC
        """

        items = frappe.db.sql(query, as_dict=True)

        return {
            "status": "success",
            "data": {
                "items": [{
                    "item_code": i.item_code,
                    "item_name": i.item_name,
                    "uom": i.uom,
                    "warehouse": i.warehouse,
                    "stock_qty": flt(i.stock_qty, 2),
                    "cost_price": flt(i.cost_price, 2),
                    "sale_price": flt(i.sale_price, 2),
                    "stock_value": flt(i.stock_value, 2),
                    "status": i.status
                } for i in items]
            }
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Stock Level Error")
        return {"status": "error", "message": str(e)}



@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_warehouses():
    """
    Get list of all warehouses for the warehouse filter dropdown.
    
    Query Parameters:
    - company: Filter by company (optional)
    
    Returns:
    {
        "status": "success",
        "data": [
            {
                "warehouse": "MAIN",
                "warehouse_name": "Main Warehouse"
            }
        ]
    }
    """
    
    try:
        company = frappe.form_dict.get("company") or _get_user_company()
        
        conditions = []
        if company:
            conditions.append(f"company = '{company}'")
        
        where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""
        
        query = f"""
            SELECT 
                name as warehouse,
                warehouse_name
            FROM `tabWarehouse`
            {where_clause}
            ORDER BY warehouse_name ASC
        """
        
        warehouses = frappe.db.sql(query, as_dict=True)
        
        return {
            "status": "success",
            "data": warehouses
        }
        
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get Warehouses Error")
        return {
            "status": "error",
            "message": str(e)
        }


@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_stock_balance_complete():
    """
    Get complete stock balance data - combines summary and detailed items in one call.
    This is useful for loading the entire page with a single API request.
    
    Query Parameters:
    - warehouse: Filter by warehouse (optional)
    - company: Filter by company (optional)
    - search: Search items (optional)
    - limit: Number of items (default: 100)
    - offset: Pagination offset (default: 0)
    
    Returns:
    {
        "status": "success",
        "data": {
            "summary": {
                "total_items": 7,
                "total_quantity": 1420,
                "stock_value": 12110.00,
                "currency": "SAR"
            },
            "items": [...],
            "warehouses": [...],
            "pagination": {...}
        }
    }
    """
    
    try:
        # Get summary
        summary_response = get_stock_balance_summary()
        if summary_response["status"] != "success":
            return summary_response
        
        # Get items
        items_response = get_stock_levels()
        if items_response["status"] != "success":
            return items_response
        
        # Get warehouses
        warehouses_response = get_warehouses()
        if warehouses_response["status"] != "success":
            return warehouses_response
        
        return {
            "status": "success",
            "data": {
                "summary": summary_response["data"],
                "items": items_response["data"]["items"],
                "warehouses": warehouses_response["data"],
                "pagination": items_response["data"]["pagination"]
            }
        }
        
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get Stock Balance Complete Error")
        return {
            "status": "error",
            "message": str(e)
        }

@frappe.whitelist(allow_guest=False, methods=["GET"])
def get_stock_balance():
    """
    Get stock balance of items from the logged-in user's warehouse
    """

    try:
        # -----------------------------
        # USER CONTEXT
        # -----------------------------
        user = frappe.session.user

        warehouse = frappe.db.get_value(
            "User Permission",
            {
                "user": user,
                "allow": "Warehouse"
            },
            "for_value"
        )

        if not warehouse:
            frappe.throw("No Warehouse User Permission found for this user")

        # -----------------------------
        # OPTIONAL FILTERS
        # -----------------------------
        search = frappe.form_dict.get("search")
        item_group = frappe.form_dict.get("item_group")

        limit = int(frappe.form_dict.get("limit", 20))
        offset = int(frappe.form_dict.get("offset", 0))

        # -----------------------------
        # BUILD CONDITIONS
        # -----------------------------
        conditions = ["b.warehouse = %(warehouse)s"]
        values = {"warehouse": warehouse}

        if search:
            conditions.append(
                "(i.item_code LIKE %(search)s OR i.item_name LIKE %(search)s)"
            )
            values["search"] = f"%{search}%"

        if item_group:
            conditions.append("i.item_group = %(item_group)s")
            values["item_group"] = item_group

        condition_str = " AND ".join(conditions)

        # -----------------------------
        # MAIN QUERY
        # -----------------------------
        data = frappe.db.sql(f"""
            SELECT
                i.item_code,
                i.item_name,
                i.item_group,
                i.stock_uom,
                b.actual_qty,
                b.reserved_qty,
                b.ordered_qty,
                b.projected_qty,
                b.modified
            FROM `tabBin` b
            INNER JOIN `tabItem` i ON i.name = b.item_code
            WHERE {condition_str}
            ORDER BY i.item_name
            LIMIT %(limit)s OFFSET %(offset)s
        """, {**values, "limit": limit, "offset": offset}, as_dict=True)

        # -----------------------------
        # TOTAL COUNT
        # -----------------------------
        total = frappe.db.sql(f"""
            SELECT COUNT(*)
            FROM `tabBin` b
            INNER JOIN `tabItem` i ON i.name = b.item_code
            WHERE {condition_str}
        """, values)[0][0]

        # -----------------------------
        # RESPONSE
        # -----------------------------
        return {
            "status": "success",
            "warehouse": warehouse,
            "count": len(data),
            "total": total,
            "data": data
        }

    except Exception as e:
        frappe.log_error("Get Stock Balance Error", frappe.get_traceback())
        return {
            "status": "error",
            "message": str(e)
        }
