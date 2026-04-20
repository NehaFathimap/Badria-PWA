// API Service Layer for ERPNext Integration

import { getCached, setCached, getPendingRequest, setPendingRequest, invalidateCache } from '../utils/apiCache';

// In development, use proxy (/api) to avoid CORS issues.
// When installed as badria_pwa app, use same-origin /api (no env needed).
// Otherwise use VITE_API_BASE_URL for standalone deployment.
const getApiBase = () => {
  if (import.meta.env.DEV) {
    return '/api';
  }
  // When served from same site (e.g. /assets/badria_pwa/pwa/ or /pwa), use same-origin
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!baseUrl || baseUrl === '') {
    return '/api';
  }
  return baseUrl.endsWith('/api') ? baseUrl : baseUrl.endsWith('/') ? `${baseUrl}api` : `${baseUrl}/api`;
};

const API_BASE = getApiBase();

// CSRF token for same-origin requests (Frappe requires X-Frappe-CSRF-Token on POST/PUT/DELETE)
let cachedCsrfToken = null;

async function getCsrfToken() {
  if (cachedCsrfToken) return cachedCsrfToken;
  const url = `${API_BASE}/method/badria_pwa.api.van_sales.get_csrf_token`;
  const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
  if (!res.ok) return null;
  const data = await res.json();
  const token = data.message ?? data;
  if (token && typeof token === 'string') {
    cachedCsrfToken = token;
    return cachedCsrfToken;
  }
  return null;
}

// Get stored credentials from localStorage or env (no hardcoded defaults for app install)
const getStoredCredentials = () => {
  if (typeof window !== 'undefined') {
    const storedKey = localStorage.getItem('api_key');
    const storedSecret = localStorage.getItem('api_secret');
    if (storedKey && storedSecret) {
      return { apiKey: storedKey, apiSecret: storedSecret };
    }
  }
  // Fallback to env vars only (when set for standalone deploy)
  const apiKey = import.meta.env.VITE_API_KEY;
  const apiSecret = import.meta.env.VITE_API_SECRET;
  if (apiKey && apiSecret) {
    return { apiKey, apiSecret };
  }
  return { apiKey: null, apiSecret: null };
};

// Store credentials in localStorage
const storeCredentials = (apiKey, apiSecret, token = null) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('api_key', apiKey);
    localStorage.setItem('api_secret', apiSecret);
    if (token) {
      localStorage.setItem('api_token', token);
    }
  }
};

// Clear stored credentials and CSRF cache (so next request gets fresh token after logout)
const clearCredentials = () => {
  cachedCsrfToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('api_key');
    localStorage.removeItem('api_secret');
    localStorage.removeItem('api_token');
    localStorage.removeItem('isAuthenticated');
  }
};

// Create authorization header
// Format: token {api_key}:{api_secret} (matches Postman collection)
const getAuthHeader = () => {
  const { apiKey, apiSecret } = getStoredCredentials();
  if (apiKey && apiSecret) {
    // Format matches Postman: token {{api_key}}:{{api_secret}}
    return `token ${apiKey}:${apiSecret}`;
  }
  return null;
};

// Generic API request function with caching and deduplication
const apiRequest = async (endpoint, options = {}, useCache = false) => {
  const method = options.method || 'GET';
  const isReadOperation = method === 'GET';
  
  // Generate cache key from endpoint and params
  const params = options.params || {};
  const cacheKey = endpoint;
  
  // Check cache for GET requests if caching is enabled
  if (useCache && isReadOperation) {
    const cached = getCached(cacheKey, params);
    if (cached !== null) {
      return cached;
    }
    
    // Check for pending request (deduplication)
    const pending = getPendingRequest(cacheKey, params);
    if (pending) {
      return pending;
    }
  }
  
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Frappe requires X-Frappe-CSRF-Token on POST/PUT/DELETE (same-origin). Fetch and add it.
  const isUnsafe = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  if (isUnsafe && API_BASE === '/api') {
    try {
      const csrf = await getCsrfToken();
      if (csrf) headers['X-Frappe-CSRF-Token'] = csrf;
    } catch (_) {}
  }

  // Add Authorization header in the format required by ERPNext API
  // Format: token {api_key}:{api_secret} (matches Postman collection: token {{api_key}}:{{api_secret}})
  const authHeader = getAuthHeader();
  if (authHeader) {
    headers['Authorization'] = authHeader;
  } else {
    console.warn('⚠️ API Key/Secret not found. Set VITE_API_KEY and VITE_API_SECRET in .env file or login first');
    // Request will likely fail without authorization, but we'll still attempt it
  }

  const config = {
    ...options,
    headers,
  };


  // Create request promise
  const requestPromise = (async () => {
    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // ERPNext error format can be:
        // 1) {exc_type, exc, message}
        // 2) Array with error message string
        // 3) {message: "..."} or {message: {status:"error", message:"..."}}
        // 4) {_server_messages: "[\"{...}\"]"} with HTML message
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;

        const stripHtml = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : s);

        // Nested message object: {message: {status:"error", message:"..."}}
        if (errorData?.message && typeof errorData.message === 'object') {
          if (errorData.message.status === 'error' && errorData.message.message) {
            errorMessage = String(errorData.message.message);
          } else if (errorData.message.message) {
            errorMessage = String(errorData.message.message);
          }
        } else if (typeof errorData?.message === 'string' && errorData.message) {
          errorMessage = errorData.message;
        }

        // Array traceback format (often permission issues)
        if (Array.isArray(errorData) && errorData.length > 0) {
          const errorString = errorData[0];
          if (typeof errorString === 'string') {
            if (errorString.includes('PermissionError')) {
              const match = errorString.match(/PermissionError:.*?<details>.*?<summary>(.*?)<\/summary>/s);
              if (match) {
                errorMessage = match[1].trim();
              } else if (errorString.includes('not whitelisted')) {
                errorMessage = 'This API endpoint is not whitelisted. Please contact your system administrator to whitelist the endpoint.';
              } else {
                errorMessage = errorString.split('\n').pop() || errorString;
              }
            } else {
              errorMessage = errorString;
            }
          }
        }

        // Authentication error
        if (errorData?.exc_type === 'AuthenticationError') {
          errorMessage = 'Authentication failed. Please check your API credentials. You may need to login again.';
          console.error('❌ Authentication Error Details:', {
            exc_type: errorData.exc_type,
            exception: errorData.exception,
            authHeaderPresent: !!authHeader,
            hasCredentials: !!(getStoredCredentials().apiKey && getStoredCredentials().apiSecret)
          });
          clearCredentials();
        }

        // Fallbacks
        if (errorData?.exc && typeof errorData.exc === 'string') {
          errorMessage = errorData.exc;
        }

        // Parse _server_messages for a more detailed message (often contains HTML)
        if (errorData?._server_messages) {
          try {
            const serverMessages = JSON.parse(errorData._server_messages);
            if (Array.isArray(serverMessages) && serverMessages.length > 0) {
              const first = serverMessages[0];
              const parsedFirst = typeof first === 'string' ? JSON.parse(first) : first;
              const candidate = parsedFirst?.message || parsedFirst?.title;
              const cleaned = stripHtml(candidate);
              if (cleaned && typeof cleaned === 'string' && cleaned.length >= 3) {
                errorMessage = cleaned;
              }
            }
          } catch (e) {
            // ignore parsing errors
          }
        }

        const err = new Error(stripHtml(errorMessage) || 'An error occurred. Please try again.');
        err.response = { data: errorData, status: response.status, statusText: response.statusText };
        throw err;
      }

      const data = await response.json();
      // ERPNext typically returns {message: {...}} format
      
      // Cache successful GET responses if caching is enabled
      if (useCache && isReadOperation && response.ok) {
        setCached(cacheKey, params, data);
      }
      
      return data;
    } catch (error) {
      // If offline or network error, throw to be caught by background sync
      if (!navigator.onLine) {
        throw new Error('OFFLINE');
      }
      // Network errors (Failed to fetch, NetworkError, etc.) should also be treated as offline
      if (error.message.includes('Failed to fetch') || 
          error.message.includes('NetworkError') ||
          error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('OFFLINE');
      }
      throw error;
    }
  })();
  
  // Track pending request for deduplication
  if (useCache && isReadOperation) {
    setPendingRequest(cacheKey, params, requestPromise);
  }
  
  return requestPromise;
};

// Data Transformation Utilities

/**
 * Transform customer from API format to UI format
 * @param {Object} apiCustomer - Customer from API
 * @returns {Object} Customer in UI format
 */
const transformCustomerFromAPI = (apiCustomer) => {
  const englishName = apiCustomer.customer_name || apiCustomer.custom_customer_name_english || apiCustomer.name || '';
  const arabicName = apiCustomer.custom_customer_name_arabic || '';
  return {
    id: apiCustomer.name || apiCustomer.customer_name || `CUST${Math.random().toString(36).substr(2, 9)}`,
    name: englishName,
    mobile: apiCustomer.mobile_no || apiCustomer.phone || apiCustomer.mobile || '',
    email: apiCustomer.email_id || apiCustomer.email || '',
    city: apiCustomer.city || apiCustomer.territory || '',
    balance: parseFloat(apiCustomer.outstanding_amount || apiCustomer.balance || 0),
    customer_type: apiCustomer.customer_type || 'Individual',
    customer_group: apiCustomer.customer_group || 'Commercial',
    territory: apiCustomer.territory || 'Saudi Arabia',
    custom_vat_registration_number: apiCustomer.custom_vat_registration_number || '',
    custom_customer_name_english: englishName,
    custom_customer_name_arabic: arabicName
  };
};

/**
 * Transform customer from UI format to API format
 * @param {Object} uiCustomer - Customer from UI form
 * @returns {Object} Customer in API format
 */
const transformCustomerToAPI = (uiCustomer) => {
  // Always use the custom field names as required by the API
  return {
    custom_customer_name_english: uiCustomer.custom_customer_name_english || '',
    customer_name: uiCustomer.customer_name || uiCustomer.custom_customer_name_arabic || '',
    custom_customer_name_arabic: uiCustomer.custom_customer_name_arabic || '',
    custom_vat_registration_number: uiCustomer.custom_vat_registration_number || ''
  };
};

/**
 * Transform invoice from API format to UI format
 * @param {Object} apiInvoice - Invoice from API
 * @returns {Object} Invoice in UI format
 */
const transformInvoiceFromAPI = (apiInvoice) => {
  // Preserve the original invoice name for API calls
  const invoiceName = apiInvoice.name || apiInvoice.invoice_name || '';
  
  // Calculate tax from vat_amount or taxes array
  let taxAmount = 0;
  if (apiInvoice.vat_amount) {
    taxAmount = parseFloat(apiInvoice.vat_amount);
  } else if (apiInvoice.total_taxes_and_charges) {
    taxAmount = parseFloat(apiInvoice.total_taxes_and_charges);
  } else if (apiInvoice.taxes && Array.isArray(apiInvoice.taxes) && apiInvoice.taxes.length > 0) {
    // Sum all tax amounts from taxes array
    taxAmount = apiInvoice.taxes.reduce((sum, tax) => sum + parseFloat(tax.tax_amount || 0), 0);
  } else if (apiInvoice.tax) {
    taxAmount = parseFloat(apiInvoice.tax);
  }
  
  // Payment method: use payments table (POS) or custom_mode_of_payment for display
  const is_pos = apiInvoice.is_pos === 1 || apiInvoice.is_pos === true;
  const payments = Array.isArray(apiInvoice.payments) ? apiInvoice.payments : [];
  const custom_mode_of_payment = apiInvoice.custom_mode_of_payment || '';

  return {
    id: invoiceName,
    invoice_name: invoiceName, // Preserve original field name for API calls
    name: invoiceName, // Also preserve as 'name' for compatibility
    customerId: apiInvoice.customer || apiInvoice.customer_name || '',
    customerName: apiInvoice.customer_name || apiInvoice.customer || '',
    customerEnglishName: apiInvoice.customer_english_name || apiInvoice.custom_customer_name_english || apiInvoice.customer?.custom_customer_name_english || '',
    date: apiInvoice.posting_date || apiInvoice.date || new Date().toISOString().split('T')[0],
    dueDate: apiInvoice.due_date || apiInvoice.dueDate,
    items: (apiInvoice.items || []).map(item => ({
      code: item.item_code || item.code,
      name: item.item_name || item.name,
      description: item.description || '',
      quantity: item.qty || item.quantity || 1,
      price: parseFloat(item.rate || item.price || 0),
      discount: parseFloat(item.discount_amount || item.discount || 0),
      total: parseFloat(item.amount || item.total || 0),
      uom: item.uom || item.stock_uom || 'Unit',
      warehouse: item.warehouse || ''
    })),
    subtotal: parseFloat(apiInvoice.net_total || apiInvoice.subtotal || 0),
    discount: parseFloat(apiInvoice.total_discount || apiInvoice.discount || 0),
    tax: taxAmount,
    total: parseFloat(apiInvoice.grand_total || apiInvoice.total || 0),
    status: apiInvoice.status || (apiInvoice.docstatus === 1 ? 'Submitted' : apiInvoice.docstatus === 0 ? 'Draft' : 'Cancelled'),
    docstatus: apiInvoice.docstatus,
    outstanding_amount: parseFloat(apiInvoice.outstanding_amount || 0),
    pdf_url: apiInvoice.pdf_url || '',
    is_pos,
    payments,
    custom_mode_of_payment
  };
};

/**
 * Transform invoice from UI format to API format
 * @param {Object} uiInvoice - Invoice from UI
 * @returns {Object} Invoice in API format
 */
const transformInvoiceToAPI = (uiInvoice) => {
  const today = new Date().toISOString().split('T')[0];
  const customer = uiInvoice.customer || uiInvoice.customerName;

  const apiData = {
    customer_name: customer,
    customer_type: 'Individual',
    customer_group: 'Commercial',
    territory: 'Saudi Arabia',
    posting_date: uiInvoice.date || today,
    due_date: uiInvoice.dueDate || uiInvoice.date || today,
    naming_series: 'ACC-SINV-.YYYY.-', // Default, should come from config
    update_stock: 1, // Update stock when invoice is created
    target_warehouse: uiInvoice.warehouse, // Default, should be selectable
    discount_amount: parseFloat(uiInvoice.discount_amount || uiInvoice.discount || 0),
    items: (uiInvoice.items || []).map(item => {
      const selectedUOM = item.uom || item.sales_uom || item.stock_uom || 'Nos';
      const rate = Math.round(parseFloat(item.price || item.rate || 0) * 100) / 100;
      return {
        item_code: item.code || item.item_code,
        item_name: item.name || item.item_name,
        description: item.description || '',
        qty: item.quantity || item.qty || 1,
        rate,
        uom: selectedUOM, // Include uom field set to selected UOM
        sales_uom: selectedUOM, // Include sales_uom set to selected UOM
        stock_uom: selectedUOM, // Include stock_uom set to selected UOM
      };
    })
  };

  // Preserve is_pos and payments if provided (for included payment functionality)
  if (uiInvoice.is_pos !== undefined) {
    apiData.is_pos = uiInvoice.is_pos;
  }
  if (uiInvoice.payments && Array.isArray(uiInvoice.payments)) {
    apiData.payments = uiInvoice.payments;
    // Also send top-level mode_of_payment for backend fallback (first payment method)
    if (uiInvoice.payments.length > 0 && (uiInvoice.payments[0].mode_of_payment || uiInvoice.payments[0].payment_method)) {
      apiData.mode_of_payment = uiInvoice.payments[0].mode_of_payment || uiInvoice.payments[0].payment_method;
    }
  }
  if (uiInvoice.mode_of_payment) {
    apiData.mode_of_payment = uiInvoice.mode_of_payment;
  }

  return apiData;
};

/**
 * Build a minimal/partial sales invoice update payload for the update endpoint
 * @param {Object} uiInvoice - Invoice data from UI
 * @returns {Object} Payload in API format
 */
const buildPartialInvoiceUpdate = (uiInvoice) => {
  if (!uiInvoice || typeof uiInvoice !== 'object') {
    throw new Error('Invoice data is required');
  }
  const invoiceName = uiInvoice.invoice_name || uiInvoice.invoiceName || uiInvoice.name || uiInvoice.id || uiInvoice.invoice;
  if (!invoiceName || String(invoiceName).trim() === '') {
    throw new Error('invoice_name is required for updating invoice');
  }

  const payload = { invoice_name: String(invoiceName).trim() };

  if (uiInvoice.warehouse || uiInvoice.target_warehouse) {
    payload.target_warehouse = uiInvoice.warehouse || uiInvoice.target_warehouse;
  }

  // Preserve is_pos and payments if provided (for included payment functionality)
  if (uiInvoice.is_pos !== undefined) {
    payload.is_pos = uiInvoice.is_pos;
  }
  if (uiInvoice.payments && Array.isArray(uiInvoice.payments)) {
    payload.payments = uiInvoice.payments;
    if (uiInvoice.payments.length > 0 && (uiInvoice.payments[0].mode_of_payment || uiInvoice.payments[0].payment_method)) {
      payload.mode_of_payment = uiInvoice.payments[0].mode_of_payment || uiInvoice.payments[0].payment_method;
    }
  }
  if (uiInvoice.mode_of_payment) {
    payload.mode_of_payment = uiInvoice.mode_of_payment;
  }

  // Items (rate to 2 decimal places)
  if (Array.isArray(uiInvoice.items)) {
    payload.items = uiInvoice.items.map(item => {
      const selectedUOM = item.uom || item.sales_uom || item.stock_uom || 'Nos';
      const rate = Math.round(parseFloat(item.price || item.rate || 0) * 100) / 100;
      return {
        item_code: item.code || item.item_code,
        item_name: item.name || item.item_name,
        qty: item.quantity || item.qty || 1,
        rate,
        uom: selectedUOM,
        sales_uom: selectedUOM,
        stock_uom: selectedUOM
      };
    });
  }

  // Discount
  if (uiInvoice.discount_amount !== undefined || uiInvoice.discount !== undefined) {
    payload.discount_amount = parseFloat(uiInvoice.discount_amount ?? uiInvoice.discount ?? 0);
  }

  return payload;
};

// API Functions

/**
 * Fetch item price by code (using get_item_details)
 * @param {string} itemCode - Item code to fetch price for
 * @returns {Promise<number>} Item price (standard_rate)
 */
export const getItemPrice = async (itemCode) => {
  try {
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_item_details?item_code=${encodeURIComponent(itemCode)}`);
    const item = response.message || response;
    // Return standard_rate or valuation_rate as price
    return item.standard_rate || item.valuation_rate || 0;
  } catch (error) {
    console.error('Error fetching item price:', error);
    throw error;
  }
};

/**
 * Search items by code or name
 * @param {string} query - Search query
 * @param {Object} options - Additional options (limit, item_group, is_sales_item)
 * @returns {Promise<Array>} Array of matching items
 */
export const searchItems = async (query, options = {}) => {
  try {
    const params = new URLSearchParams();
    if (query) params.append('search', query);
    if (options.limit) params.append('limit', options.limit.toString());
    else params.append('limit', '50'); // Default limit
    if (options.item_group) params.append('item_group', options.item_group);
    if (options.is_sales_item !== undefined) params.append('is_sales_item', options.is_sales_item ? '1' : '0');
    if (options.offset) params.append('offset', options.offset.toString());
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_items_list?${params.toString()}`);
    const message = response.message || {};
    const items = message.data || message || [];
    
    // Transform API format to UI format
    return Array.isArray(items) ? items.map(item => ({
      code: item.item_code,
      name: item.item_name,
      price: item.standard_rate || item.valuation_rate || 0,
      uom: item.stock_uom || 'Nos',
      description: item.description || '',
      item_group: item.item_group,
      is_stock_item: item.is_stock_item,
      is_sales_item: item.is_sales_item,
      valuation_rate: item.valuation_rate || 0,
      standard_rate: item.standard_rate || 0,
    })) : [];
  } catch (error) {
    console.error('Error searching items:', error);
    throw error;
  }
};

/**
 * Get items list with filters
 * @param {Object} filters - Filter options (limit, offset, item_group, is_sales_item, search)
 * @returns {Promise<Object>} Items list with pagination info
 */
export const getItemsList = async (filters = {}) => {
  try {
    const params = new URLSearchParams();
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());
    if (filters.item_group) params.append('item_group', filters.item_group);
    if (filters.is_sales_item !== undefined) params.append('is_sales_item', filters.is_sales_item ? '1' : '0');
    if (filters.search) params.append('search', filters.search);
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_items_list?${params.toString()}`);
    const message = response.message || {};
    
    return {
      items: Array.isArray(message.data) ? message.data.map(item => ({
        code: item.item_code,
        name: item.item_name,
        price: item.standard_rate || item.valuation_rate || 0,
        uom: item.stock_uom || 'Nos',
        description: item.description || '',
        item_group: item.item_group,
        is_stock_item: item.is_stock_item,
        is_sales_item: item.is_sales_item,
        valuation_rate: item.valuation_rate || 0,
        standard_rate: item.standard_rate || 0,
      })) : [],
      count: message.count || 0,
      status: message.status || 'success'
    };
  } catch (error) {
    console.error('Error fetching items list:', error);
    throw error;
  }
};

/**
 * Get item details by item code and customer
 * @param {string} itemCode - Item code
 * @param {string} customer - Customer name (optional)
 * @returns {Promise<Object>} Item details
 */
export const getItemDetails = async (itemCode, customer = null) => {
  try {
    let endpoint = `/method/badria_pwa.api.van_sales.get_item_details?item_code=${encodeURIComponent(itemCode)}`;
    if (customer) {
      endpoint += `&customer=${encodeURIComponent(customer)}`;
    }
    
    // Use caching for item details (cache key includes customer for customer-specific pricing)
    const response = await apiRequest(endpoint, {}, true);
    
    // Handle different response structures
    let item = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      item = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      item = response.message;
    }
    
    // Extract price_list_rate from item_prices array (use first price list)
    // If price_list_rate is not present, use 0 instead of standard_rate
    const priceListRate = item.item_prices && item.item_prices.length > 0 
      ? (item.item_prices[0].price_list_rate || 0)
      : 0;
    
    // Extract actual_qty from stock_levels array (use first warehouse)
    const actualQty = item.stock_levels && item.stock_levels.length > 0
      ? item.stock_levels[0].actual_qty || 0
      : 0;
    
    return {
      code: item.item_code,
      name: item.item_name,
      price: priceListRate, // Use price_list_rate instead of standard_rate
      price_list_rate: priceListRate,
      actual_qty: actualQty,
      stock_uom: item.stock_uom || 'Nos', // Include stock_uom separately
      sales_uom: item.sales_uom || item.stock_uom || 'Nos', // Include sales_uom
      uom: item.stock_uom || 'Nos',
      description: item.description || '',
      item_group: item.item_group,
      is_stock_item: item.is_stock_item,
      is_sales_item: item.is_sales_item,
      valuation_rate: item.valuation_rate || 0,
      standard_rate: item.standard_rate || 0,
      item_prices: item.item_prices || [], // Preserve item_prices for reference
      uom_conversions: item.uom_conversions || [], // Include uom_conversions array
    };
  } catch (error) {
    console.error('Error fetching item details:', error);
    throw error;
  }
};

/**
 * Create a new item
 * @param {Object} itemData - Item data
 * @returns {Promise<Object>} Created item
 */
export const createItem = async (itemData) => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.create_item', {
      method: 'POST',
      body: JSON.stringify(itemData),
    });
    return response.message || response;
  } catch (error) {
    console.error('Error creating item:', error);
    throw error;
  }
};

/**
 * Update an existing item
 * @param {Object} itemData - Item data to update
 * @returns {Promise<Object>} Updated item
 */
export const updateItem = async (itemData) => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.update_item', {
      method: 'POST',
      body: JSON.stringify(itemData),
    });
    return response.message || response;
  } catch (error) {
    console.error('Error updating item:', error);
    throw error;
  }
};

/**
 * Fetch customer list (only customers assigned to current user: Sales Team, owner, or ToDo).
 * Used by Sales, Quotations, Sales Orders, Returns, and Payment Collection.
 * @returns {Promise<Array>} Array of customers
 */
export const getCustomers = async () => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.get_customers_list', {}, true);
  // API returns {message: {status: "success", count: 29, data: [...]}} format
  const message = response.message || {};
  const customers = message.data || message || [];
  // Transform API format to UI format
  return Array.isArray(customers) ? customers.map(transformCustomerFromAPI) : [];
};

/**
 * Create a new customer
 * @param {Object} customerData - Customer data from UI form
 * @returns {Promise<Object>} Created customer
 */
export const createCustomer = async (customerData) => {
  try {
    // Transform UI format to API format
    const apiData = transformCustomerToAPI(customerData);
    const response = await apiRequest('/method/badria_pwa.api.van_sales.create_customer', {
      method: 'POST',
      body: JSON.stringify(apiData),
    });
    // Invalidate customers cache
    invalidateCache('get_customers_list');
    // Transform response back to UI format
    const transformed = transformCustomerFromAPI(response.message || response);
    return transformed;
  } catch (error) {
    console.error('Error in createCustomer:', error);
    throw error;
  }
};

/**
 * Create a new customer address
 * @param {Object} addressData - Address data
 * @param {string} addressData.customer - Customer name
 * @param {string} addressData.address_title - Address title (e.g., "Office Address")
 * @param {string} addressData.address_line1 - Address line 1 (required)
 * @param {string} addressData.custom_building_number - Building number
 * @param {string} addressData.custom_area - Area
 * @param {string} addressData.city - City (required)
 * @param {string} addressData.country - Country (required, default: "Saudi Arabia")
 * @param {string} addressData.pincode - Pincode
 * @returns {Promise<Object>} Created address
 */
export const createCustomerAddress = async (addressData) => {
  try {
    // Ensure payload matches exact API requirements - only these fields
    const payload = {
      customer: addressData.customer,
      address_title: addressData.address_title,
      address_line1: addressData.address_line1,
      custom_building_number: addressData.custom_building_number,
      custom_area: addressData.custom_area,
      city: addressData.city,
      country: addressData.country,
      pincode: addressData.pincode
    };

    const response = await apiRequest('/method/badria_pwa.api.van_sales.create_customer_address', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return response.message || response;
  } catch (error) {
    console.error('❌ Error creating customer address:', error);
    throw error;
  }
};

/**
 * Get customer addresses
 * @param {string} customerName - Customer name
 * @returns {Promise<Array>} Array of customer addresses
 */
export const getCustomerAddresses = async (customerName) => {
  try {
    const encodedCustomerName = encodeURIComponent(customerName);
    const endpoint = `/method/badria_pwa.api.van_sales.get_customer_with_addresses?customer=${encodedCustomerName}`;
    
    // Use caching for customer addresses
    const response = await apiRequest(endpoint, {}, true);
    
    // Handle different response structures
    let addresses = [];
    
    // Try to find addresses in various possible locations
    if (response) {
      // Case 1: response.message.addresses (most common)
      if (response.message?.addresses && Array.isArray(response.message.addresses)) {
        addresses = response.message.addresses;
      }
      // Case 2: response.message.data.addresses
      else if (response.message?.data?.addresses && Array.isArray(response.message.data.addresses)) {
        addresses = response.message.data.addresses;
      }
      // Case 3: response.message.data (direct array)
      else if (response.message?.data && Array.isArray(response.message.data)) {
        addresses = response.message.data;
      }
      // Case 4: response.message.customer.addresses
      else if (response.message?.customer?.addresses && Array.isArray(response.message.customer.addresses)) {
        addresses = response.message.customer.addresses;
      }
      // Case 5: response.message is directly an array
      else if (Array.isArray(response.message)) {
        addresses = response.message;
      }
      // Case 6: response.addresses
      else if (response.addresses && Array.isArray(response.addresses)) {
        addresses = response.addresses;
      }
      // Case 7: response is directly an array
      else if (Array.isArray(response)) {
        addresses = response;
      }
      // Case 8: Check if message has a nested structure we haven't checked
      else if (response.message) {
        // Try to find any array in message
        for (const key in response.message) {
          if (Array.isArray(response.message[key])) {
            addresses = response.message[key];
            break;
          }
        }
      }
    }
    
    return addresses;
  } catch (error) {
    console.error('❌ Error fetching customer addresses:', error);
    // Return empty array instead of throwing to prevent UI breakage
    return [];
  }
};

/**
 * Update customer address
 * API Endpoint: https://badriasweets.enfonoerp.com/api/method/badria_pwa.api.van_sales.update_customer_address?customer={customerName}
 * @param {Object} addressData - Address data with customer name and updated fields
 * @param {string} addressData.customer - Customer name (passed as query parameter)
 * @param {string} addressData.address_title - Address title
 * @param {string} addressData.address_line1 - Address line 1
 * @param {string} addressData.custom_building_number - Building number
 * @param {string} addressData.custom_area - Area
 * @param {string} addressData.city - City
 * @param {string} addressData.country - Country
 * @param {string} addressData.pincode - Pincode
 * @returns {Promise<Object>} Updated address
 */
export const updateCustomerAddress = async (addressData) => {
  try {
    const { customer, ...addressFields } = addressData;
    
    if (!customer) {
      throw new Error('Customer name is required for updating address');
    }

    // Prepare payload - customer is passed as query parameter, not in body
    const payload = {
      address_title: addressFields.address_title,
      address_line1: addressFields.address_line1,
      custom_building_number: addressFields.custom_building_number,
      custom_area: addressFields.custom_area,
      city: addressFields.city,
      country: addressFields.country,
      pincode: addressFields.pincode
    };

    // Encode customer name for query parameter
    const encodedCustomerName = encodeURIComponent(customer);
    const endpoint = `/method/badria_pwa.api.van_sales.update_customer_address?customer=${encodedCustomerName}`;

    const response = await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return response.message || response;
  } catch (error) {
    console.error('❌ Error updating customer address:', error);
    throw error;
  }
};

/**
 * Delete customer address
 * @param {string} addressName - Address name/identifier
 * @returns {Promise<Object>} Deletion response
 */
export const deleteCustomerAddress = async (addressName) => {
  try {
    const encodedAddressName = encodeURIComponent(addressName);
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.delete_customer_address?address_name=${encodedAddressName}`, {
      method: 'DELETE',
    });
    return response.message || response;
  } catch (error) {
    console.error('Error deleting customer address:', error);
    throw error;
  }
};

/**
 * Submit sales invoice
 * @param {Object} invoiceData - Invoice data from UI
 * @returns {Promise<Object>} Created invoice
 */
export const createSalesInvoice = async (invoiceData) => {
  try {
    // Transform UI format to API format
    const apiData = transformInvoiceToAPI(invoiceData);
    
    const response = await apiRequest('/method/badria_pwa.api.van_sales.create_sales_invoice', {
      method: 'POST',
      body: JSON.stringify(apiData),
    });

    // Some endpoints may return 200 OK with a business-logic error
    if (response?.message && typeof response.message === 'object' && response.message.status === 'error') {
      const errorMessage = response.message.message || 'An error occurred while creating the invoice';
      const err = new Error(errorMessage);
      err.response = response;
      throw err;
    }
    
    // Handle different response structures:
    // 1. {message: {status: "success", data: {...}}} - nested data
    // 2. {message: {...}} - direct invoice data
    // 3. Direct response
    let invoiceData_result = null;
    
    if (response.message) {
      if (response.message.data) {
        // Case 1: Data is nested in message.data
        invoiceData_result = response.message.data;
      } else if (response.message.status === 'success' && response.message.data) {
        invoiceData_result = response.message.data;
      } else {
        // Case 2: Message is directly the invoice data
        invoiceData_result = response.message;
      }
    } else {
      // Case 3: Response is directly the invoice data
      invoiceData_result = response;
    }
    
    // Return the invoice data (should contain invoice_name/name field)
    return invoiceData_result || response.message || response;
  } catch (error) {
    console.error('Error creating sales invoice:', error);
    throw error;
  }
};

/**
 * Update an existing sales invoice
 * @param {Object} invoiceData - Minimal invoice update data from UI
 * @returns {Promise<Object>} Updated invoice (API response)
 */
export const updateSalesInvoice = async (invoiceData) => {
  try {
    const payload = buildPartialInvoiceUpdate(invoiceData);

    const response = await apiRequest('/method/badria_pwa.api.van_sales.update_sales_invoice', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    // Some endpoints may return 200 OK with a business-logic error
    if (response?.message && typeof response.message === 'object' && response.message.status === 'error') {
      const errorMessage = response.message.message || 'An error occurred while updating the invoice';
      const err = new Error(errorMessage);
      err.response = response;
      throw err;
    }

    return response.message || response;
  } catch (error) {
    console.error('Error updating sales invoice:', error);
    throw error;
  }
};

// ============================================================================
// AUTHENTICATION APIs
// ============================================================================

/**
 * Login user with email and password
 * @param {string} email - User email or username
 * @param {string} password - User password
 * @returns {Promise<Object>} Login response with api_key, api_secret, and token
 */
export const login = async (email, password) => {
  try {
    // Login endpoint should NOT use authorization header (we don't have credentials yet)
    const endpoint = '/method/badria_pwa.api.van_sales.login';
    const url = `${API_BASE}${endpoint}`;
    const headers = { 'Content-Type': 'application/json' };
    // Frappe requires CSRF token on POST when same-origin. Always fetch a fresh token
    // before login so it matches the session used for the POST (avoids CSRFTokenError).
    const isSameOrigin = !API_BASE.startsWith('http') || (typeof window !== 'undefined' && API_BASE.startsWith(window.location.origin));
    if (isSameOrigin) {
      cachedCsrfToken = null;
      const csrf = await getCsrfToken();
      if (csrf) headers['X-Frappe-CSRF-Token'] = csrf;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
      credentials: 'same-origin',
    });
    
    // Get response text first to handle both JSON and non-JSON responses
    const responseText = await response.text();
    
    if (!response.ok) {
      let errorMessage = `Login failed: ${response.status} ${response.statusText}`;
      
      // Try to parse as JSON
      try {
        const errorData = JSON.parse(responseText);
        console.error('🔐 Error response data:', errorData);
        
        // Extract error message from various possible fields
        if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.exc) {
          errorMessage = errorData.exc;
        } else if (errorData.exception) {
          errorMessage = errorData.exception;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
        
        // Check for ERPNext error format
        if (errorData.exc_type) {
          console.error('🔐 Error type:', errorData.exc_type);
          if (errorData.exc_type === 'ValidationError') {
            errorMessage = errorData.message || 'Invalid login credentials. Please check your username and password.';
          } else if (errorData.exc_type === 'AuthenticationError') {
            errorMessage = 'Authentication failed. Please check your credentials.';
          }
        }
      } catch (parseError) {
        // If not JSON, use the text as error message (might be HTML error page)
        console.error('🔐 Failed to parse error response as JSON:', parseError);
        if (responseText && responseText.length > 0) {
          // Try to extract meaningful error from HTML/text
          const textMatch = responseText.match(/<title>(.*?)<\/title>/i) || 
                           responseText.match(/Error:\s*(.+)/i) ||
                           responseText.match(/(.{0,200})/);
          if (textMatch && textMatch[1]) {
            errorMessage = textMatch[1].trim();
          }
        }
      }
      
      throw new Error(errorMessage);
    }
    
    // Parse successful response
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('🔐 Failed to parse response as JSON:', parseError);
      throw new Error('Invalid response format from server. Please try again.');
    }
    
    // Handle ERPNext response format: {message: {...}} or direct response
    const loginData = data.message || data;
    
    if (loginData.status === 'success' && loginData.data) {
      const { api_key, api_secret, token } = loginData.data;
      // Validate that we have the required credentials
      if (!api_key || !api_secret) {
        throw new Error('Login response missing API credentials (api_key or api_secret)');
      }
      // Store credentials
      storeCredentials(api_key, api_secret, token);
      return loginData.data;
    }
    
    // If response has data directly (without status wrapper)
    if (loginData.api_key || loginData.token) {
      const { api_key, api_secret, token } = loginData;
      // Validate that we have the required credentials
      if (!api_key || !api_secret) {
        throw new Error('Login response missing API credentials (api_key or api_secret)');
      }
      storeCredentials(api_key, api_secret, token);
      return loginData;
    }
    
    throw new Error(loginData.message || data.message || 'Login failed: Invalid response format');
  } catch (error) {
    console.error('❌ Login error:', error);
    console.error('❌ Error stack:', error.stack);
    clearCredentials();
    
    // Re-throw with better error message if it's a network error
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Network error. Please check your internet connection and try again.');
    }
    
    throw error;
  }
};

/**
 * Validate authentication token
 * @param {string} token - Authentication token
 * @returns {Promise<Object>} Validation response
 */
export const validateToken = async (token) => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.validate_token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return response;
  } catch (error) {
    clearCredentials();
    throw error;
  }
};

/**
 * Logout user
 * @returns {Promise<Object>} Logout response
 */
export const logout = async () => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.logout', {
      method: 'POST',
    });
    clearCredentials();
    return response;
  } catch (error) {
    // Clear credentials even if API call fails
    clearCredentials();
    throw error;
  }
};

/**
 * Open Frappe printview page for a document (same print page for all: Sales Invoice, Sales Order, Quotation, Payment Entry).
 * Uses default print format and letterhead from the doc. Only use when doc.docstatus === 1.
 * @param {string} doctype - e.g. 'Sales Invoice', 'Sales Order', 'Quotation', 'Payment Entry'
 * @param {string} name - document name
 * @param {string} [letterhead] - optional letterhead name (e.g. doc.letter_head) so printview uses doc's letterhead
 */
export const openPrintPdf = (doctype, name, letterhead) => {
  const params = new URLSearchParams({
    doctype,
    name,
    no_letterhead: '0',
    download: '1',
    trigger_print: '1',
  });
  if (letterhead && String(letterhead).trim()) {
    params.set('letterhead', String(letterhead).trim());
  }
  const printUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/printview?${params.toString()}`;
  window.open(printUrl, '_blank', 'noopener');
  return Promise.resolve();
};

/**
 * Get current user information
 * @returns {Promise<Object>} User info (name, email, full_name, user_image, company)
 */
export const getUserInfo = async () => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.get_user_info', {
      method: 'GET',
    });
    const userData = response.message || response;
    if (userData && userData.status === 'success') {
      return {
        name: userData.name,
        full_name: userData.full_name,
        email: userData.email,
        user_image: userData.user_image,
        company: userData.company,
      };
    }
    throw new Error(userData?.message || 'Failed to fetch user info');
  } catch (error) {
    console.error('Error fetching user info:', error);
    throw error;
  }
};

// ============================================================================
// PAYMENT ENTRY APIs
// ============================================================================

/**
 * Create payment entry
 * @param {Object} paymentData - Payment data
 * @returns {Promise<Object>} Created payment entry
 */
export const createPaymentEntry = async (paymentData) => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.create_payment_entry', {
      method: 'POST',
      body: JSON.stringify(paymentData),
    });
    
    // Check if response contains an error status in the message
    const message = response.message || response;
    if (message && typeof message === 'object' && message.status === 'error') {
      const errorMsg = message.message || 'An error occurred while creating the payment entry';
      throw new Error(errorMsg);
    }
    
    // Invalidate related caches
    invalidateCache('get_payment_entries_list');
    invalidateCache('get_today_collection');
    invalidateCache('get_today_cash_collection');
    invalidateCache('get_today_bank_collection');
    invalidateCache('get_customer_billing_and_payments');
    invalidateCache('get_outstanding_invoices_for_payment');
    
    return message;
  } catch (error) {
    console.error('Error creating payment entry:', error);
    throw error;
  }
};

/**
 * Get payment entries list
 * @param {Object} filters - Filter options (limit, offset, party, mode_of_payment, from_date, to_date, status)
 * @returns {Promise<Array>} Array of payment entries
 */
export const getPaymentEntriesList = async (filters = {}) => {
  try {
    const params = new URLSearchParams();
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());
    if (filters.party) params.append('party', filters.party);
    if (filters.mode_of_payment) params.append('mode_of_payment', filters.mode_of_payment);
    if (filters.from_date) params.append('from_date', filters.from_date);
    if (filters.to_date) params.append('to_date', filters.to_date);
    if (filters.status !== undefined) params.append('status', filters.status.toString());
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_payment_entries_list?${params.toString()}`);
    const message = response.message || {};
    const payments = message.data || message || [];
    return Array.isArray(payments) ? payments : [];
  } catch (error) {
    console.error('Error fetching payment entries:', error);
    throw error;
  }
};

/**
 * Get payment entry details
 * @param {string} paymentEntry - Payment entry name
 * @returns {Promise<Object>} Payment entry details
 */
export const getPaymentEntryDetails = async (paymentEntry) => {
  try {
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_payment_entry_details?payment_entry=${encodeURIComponent(paymentEntry)}`);
    
    // Handle nested response structure: response.message.data
    if (response?.message?.data) {
      return response.message.data;
    } else if (response?.message) {
      return response.message;
    }
    return response;
  } catch (error) {
    console.error('Error fetching payment entry details:', error);
    throw error;
  }
};

/**
 * Get outstanding invoices for payment
 * @param {string} customer - Customer name
 * @returns {Promise<Array>} Array of outstanding invoices
 */
export const getOutstandingInvoicesForPayment = async (customer) => {
  try {
    const endpoint = `/method/badria_pwa.api.van_sales.get_outstanding_invoices_for_payment?customer=${encodeURIComponent(customer)}`;
    // Use caching for outstanding invoices
    const response = await apiRequest(endpoint, {}, true);
    const message = response.message || {};
    const invoices = message.data || message || [];
    return Array.isArray(invoices) ? invoices : [];
  } catch (error) {
    console.error('Error fetching outstanding invoices:', error);
    throw error;
  }
};

/**
 * Submit payment entry
 * @param {string} paymentEntry - Payment entry name
 * @returns {Promise<Object>} Submission response
 */
export const submitPaymentEntry = async (paymentEntry) => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.submit_payment_entry', {
      method: 'POST',
      body: JSON.stringify({ payment_entry: paymentEntry }),
    });
    return response.message || response;
  } catch (error) {
    console.error('Error submitting payment entry:', error);
    throw error;
  }
};

/**
 * Create payment entry (legacy function name for backward compatibility)
 * @param {Object} paymentData - Payment data
 * @returns {Promise<Object>} Created payment
 */
export const createPayment = async (paymentData) => {
  return createPaymentEntry(paymentData);
};

/**
 * Get warehouse list
 * @returns {Promise<Array>} Array of warehouses
 */
export const getWarehouses = async () => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.get_warehouse_list');
  // API returns {message: {status: "success", count: X, data: [...]}} format
  const message = response.message || {};
  const warehouses = message.data || message || [];
  // Return array of warehouse names or objects
  return Array.isArray(warehouses) ? warehouses : [];
};

/**
 * Get stock levels
 * @param {string} warehouse - Optional warehouse filter
 * @returns {Promise<Array>} Array of stock items
 * @note Endpoint not available in Postman collection
 */
/**
 * Get stock balance from API
 * @param {Object} filters - Optional filters (warehouse, company, etc.)
 * @returns {Promise<Array>} Array of stock items with stock information
 */
export const getStockBalance = async (filters = {}) => {
  try {
    const params = new URLSearchParams();
    if (filters.warehouse) params.append('warehouse', filters.warehouse);
    if (filters.company) params.append('company', filters.company);
    
    const endpoint = `/method/badria_pwa.api.van_sales.get_stock_balance${params.toString() ? '?' + params.toString() : ''}`;
    const response = await apiRequest(endpoint, {}, true);
    
    // Extract warehouse from response.message.warehouse
    const warehouse = response?.message?.warehouse || filters.warehouse || 'Main';
    
    // Extract data array from response.message.data
    let stockItems = [];
    if (response && response.message && Array.isArray(response.message.data)) {
      stockItems = response.message.data;
    } else if (response && response.message && typeof response.message === 'object' && response.message.data) {
      stockItems = Array.isArray(response.message.data) ? response.message.data : [];
    } else if (Array.isArray(response)) {
      stockItems = response;
    } else if (response && Array.isArray(response.data)) {
      stockItems = response.data;
    } else if (response && Array.isArray(response.items)) {
      stockItems = response.items;
    }
    
    // Transform API response to stock format expected by StockModule (no stock_value – backend Bin does not provide it; use get_stock_levels if valuation needed)
    const transformedItems = stockItems.map(item => ({
      code: item.item_code || item.code || '',
      name: item.item_name || item.name || '',
      uom: item.stock_uom || item.uom || '',
      stock: parseFloat(item.actual_qty || item.qty || item.stock_qty || item.stock || 0),
      warehouse: warehouse,
      description: item.description || '',
      item_group: item.item_group || '',
      is_stock_item: item.is_stock_item !== undefined ? item.is_stock_item : true
    }));
    
    return transformedItems;
  } catch (error) {
    console.error('Error fetching stock balance:', error);
    throw error;
  }
};

/**
 * Get stock items list (uses get_stock_balance API)
 * @param {string} warehouse - Optional warehouse filter
 * @returns {Promise<Array>} Array of stock items with stock information
 */
export const getStock = async (warehouse = null) => {
  // Check cache first
  const cacheKey = '/method/badria_pwa.api.van_sales.get_stock_balance';
  const cached = getCached(cacheKey, { warehouse });
  if (cached !== null) {
    // Transform cached data
    const stockItems = cached.message?.data || cached.data || cached || [];
    return stockItems.map(item => ({
      code: item.item_code || item.code || '',
      name: item.item_name || item.name || '',
      uom: item.stock_uom || item.uom || '',
      stock: parseFloat(item.actual_qty || item.qty || item.stock_qty || item.stock || 0),
      warehouse: warehouse || item.warehouse || '',
      description: item.description || '',
      item_group: item.item_group || '',
      is_stock_item: item.is_stock_item !== undefined ? item.is_stock_item : true
    }));
  }
  
  return getStockBalance({ warehouse });
};

/**
 * Get sales invoice list (paginated; only invoices created by or assigned to current user).
 * When search is provided, results are matched server-side from all allowed invoices.
 * @param {Object} [options] - Optional pagination and search
 * @param {number} [options.limit=20] - Page size (1–100)
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {string} [options.search] - Search by invoice ID or customer name (server-side)
 * @returns {Promise<{ invoices: Array, totalCount: number }>}
 */
export const getSalesInvoiceList = async (options = {}) => {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const offset = Math.max(0, parseInt(options.offset, 10) || 0);
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const search = (options.search || '').trim();
  if (search) params.set('search', search);
  const url = `/method/badria_pwa.api.van_sales.get_sales_invoice_list?${params.toString()}`;
  const response = await apiRequest(url, { method: 'GET' });

  let invoices = [];
  let totalCount = 0;

  if (response.message) {
    const msg = response.message;
    if (msg.invoices && Array.isArray(msg.invoices)) {
      invoices = msg.invoices;
      totalCount = msg.total_count != null ? msg.total_count : invoices.length;
    } else if (Array.isArray(msg)) {
      invoices = msg;
      totalCount = msg.length;
    } else if (msg.data && Array.isArray(msg.data)) {
      invoices = msg.data;
      totalCount = msg.total_count != null ? msg.total_count : invoices.length;
    } else {
      const messageObj = msg;
      for (const key in messageObj) {
        if (Array.isArray(messageObj[key])) {
          invoices = messageObj[key];
          totalCount = msg.total_count != null ? msg.total_count : invoices.length;
          break;
        }
      }
    }
  }

  // Transform API format to UI format
  const transformed = invoices.map((invoice, index) => {
    try {
      const result = transformInvoiceFromAPI(invoice);
      return result;
    } catch (error) {
      console.error(`❌ Error transforming invoice at index ${index}:`, error);
      console.error('Invoice data:', invoice);
      // Return a minimal valid invoice object to prevent breaking the UI
      return {
        id: invoice.name || invoice.invoice_name || `INV-${index}`,
        customerName: invoice.customer || invoice.customer_name || 'Unknown',
        date: invoice.posting_date || invoice.date || new Date().toISOString().split('T')[0],
        items: [],
        subtotal: 0,
        discount: 0,
        tax: 0,
        total: parseFloat(invoice.grand_total || invoice.total || 0),
        status: invoice.docstatus === 1 ? 'Submitted' : 'Draft',
      };
    }
  }).filter(inv => inv && inv.id); // Filter out any null/undefined invoices

  return { invoices: transformed, totalCount };
};

// ---------- Leads ----------
export const getLeadList = async (options = {}) => {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const offset = Math.max(0, parseInt(options.offset, 10) || 0);
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const search = (options.search || '').trim();
  if (search) params.set('search', search);
  const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_lead_list?${params.toString()}`, { method: 'GET' });
  const msg = response?.message || response;
  const leads = Array.isArray(msg?.leads) ? msg.leads : [];
  const totalCount = msg?.total_count != null ? msg.total_count : leads.length;
  return { leads, totalCount };
};

export const getLeadDetails = async (name) => {
  const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_lead_details?name=${encodeURIComponent(name)}`, { method: 'GET' });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Lead not found');
  return msg?.lead || msg;
};

export const createLead = async (data) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.create_lead', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to create lead');
  return msg;
};

// ---------- Quotations ----------
export const getQuotationList = async (options = {}) => {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const offset = Math.max(0, parseInt(options.offset, 10) || 0);
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const search = (options.search || '').trim();
  if (search) params.set('search', search);
  const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_quotation_list?${params.toString()}`, { method: 'GET' });
  const msg = response?.message || response;
  const quotations = Array.isArray(msg?.quotations) ? msg.quotations : [];
  const totalCount = msg?.total_count != null ? msg.total_count : quotations.length;
  return { quotations, totalCount };
};

export const getQuotationDetails = async (name) => {
  const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_quotation_details?name=${encodeURIComponent(name)}`, { method: 'GET' });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Quotation not found');
  return msg?.quotation || msg;
};

export const createQuotation = async (data) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.create_quotation', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to create quotation');
  return msg;
};

export const submitQuotation = async (name) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.submit_quotation', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to submit quotation');
  return msg;
};

export const cancelQuotation = async (name) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.cancel_quotation', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to cancel quotation');
  return msg;
};

export const amendQuotation = async (name) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.amend_quotation', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to amend quotation');
  return msg;
};

export const updateQuotation = async (data) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.update_quotation', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to update quotation');
  return msg;
};

// ---------- Sales Orders ----------
export const getSalesOrderList = async (options = {}) => {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const offset = Math.max(0, parseInt(options.offset, 10) || 0);
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const search = (options.search || '').trim();
  if (search) params.set('search', search);
  const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_sales_order_list?${params.toString()}`, { method: 'GET' });
  const msg = response?.message || response;
  const sales_orders = Array.isArray(msg?.sales_orders) ? msg.sales_orders : [];
  const totalCount = msg?.total_count != null ? msg.total_count : sales_orders.length;
  return { sales_orders, totalCount };
};

export const getSalesOrderDetails = async (name) => {
  const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_sales_order_details?name=${encodeURIComponent(name)}`, { method: 'GET' });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Sales Order not found');
  return msg?.sales_order || msg;
};

export const createSalesOrder = async (data) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.create_sales_order', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to create sales order');
  return msg;
};

export const submitSalesOrder = async (name) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.submit_sales_order', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to submit sales order');
  return msg;
};

export const updateSalesOrder = async (data) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.update_sales_order', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to update sales order');
  return msg;
};

/**
 * Convert a submitted Quotation to a Sales Order
 * @param {string} name - Quotation name
 * @returns {Promise<Object>} Created Sales Order details
 */
export const convertQuotationToSalesOrder = async (name) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.convert_quotation_to_sales_order', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to convert quotation to sales order');
  return msg;
};

/**
 * Convert a submitted Sales Order to a Sales Invoice
 * @param {string} name - Sales Order name
 * @returns {Promise<Object>} Created Sales Invoice details
 */
export const convertSalesOrderToSalesInvoice = async (name) => {
  const response = await apiRequest('/method/badria_pwa.api.van_sales.convert_sales_order_to_sales_invoice', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { 'Content-Type': 'application/json' },
  });
  const msg = response?.message || response;
  if (msg?.status === 'error') throw new Error(msg.message || 'Failed to convert sales order to sales invoice');
  return msg;
};

/**
 * Get invoice details by invoice name
 * @param {string} invoiceName - Invoice name (e.g., "ACC-SINV-2025-00002")
 * @returns {Promise<Object>} Invoice details
 */
export const getInvoiceDetails = async (invoiceName) => {
  try {
    if (!invoiceName || invoiceName.trim() === '') {
      throw new Error('Invoice name is required');
    }
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_invoice_details?invoice_name=${encodeURIComponent(invoiceName)}`);
    
    // Handle different response structures:
    // 1. {message: {status: "success", data: {...}}} - nested data
    // 2. {message: {...}} - direct invoice data
    // 3. Direct response
    let invoiceData = null;
    
    if (response.message) {
      if (response.message.data) {
        // Case 1: Data is nested in message.data
        invoiceData = response.message.data;
      } else if (response.message.status === 'success' && response.message.data) {
        invoiceData = response.message.data;
      } else {
        // Case 2: Message is directly the invoice data
        invoiceData = response.message;
      }
    } else {
      // Case 3: Response is directly the invoice data
      invoiceData = response;
    }
    
    if (!invoiceData) {
      throw new Error('No invoice data received from API');
    }
    
    // Transform API format to UI format
    const transformed = transformInvoiceFromAPI(invoiceData);
    
    return transformed;
  } catch (error) {
    console.error('❌ Error fetching invoice details:', error);
    throw error;
  }
};

/**
 * Submit sales invoice
 * @param {string} invoiceName - Invoice name to submit
 * @param {string} modeOfPayment - Payment method (mode_of_payment)
 * @returns {Promise<Object>} Submission response with invoice details
 */
export const submitSalesInvoice = async (invoiceName, modeOfPayment = null) => {
  try {
    const body = { invoice_name: invoiceName };
    if (modeOfPayment) {
      body.mode_of_payment = modeOfPayment;
    }
    const response = await apiRequest('/method/badria_pwa.api.van_sales.submit_sales_invoice', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // Some endpoints may return 200 OK with a business-logic error
    if (response?.message && typeof response.message === 'object' && response.message.status === 'error') {
      const errorMessage = response.message.message || 'An error occurred while submitting the invoice';
      const err = new Error(errorMessage);
      err.response = response;
      throw err;
    }
    
    // Handle different response structures:
    // 1. {message: {status: "success", data: {...}}} - nested data
    // 2. {message: {...}} - direct invoice data
    // 3. Direct response
    let invoiceData = null;
    
    if (response.message) {
      if (response.message.data) {
        // Case 1: Data is nested in message.data
        invoiceData = response.message.data;
      } else if (response.message.status === 'success' && response.message.data) {
        invoiceData = response.message.data;
      } else {
        // Case 2: Message is directly the invoice data
        invoiceData = response.message;
      }
    } else {
      // Case 3: Response is directly the invoice data
      invoiceData = response;
    }
    
    // Return the invoice data (should contain invoice_name/name field)
    return invoiceData || response.message || response;
  } catch (error) {
    console.error('Error submitting sales invoice:', error);
    throw error;
  }
};

// ============================================================================
// ACCOUNTS RECEIVABLE APIs
// ============================================================================

/**
 * Get accounts receivable summary
 * @param {Object} filters - Filter options (limit, as_on_date, range1, range2, range3, customer)
 * @returns {Promise<Object>} AR summary with aging buckets
 */
export const getAccountsReceivableSummary = async (filters = {}) => {
  try {
    const params = new URLSearchParams();
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.as_on_date) params.append('as_on_date', filters.as_on_date);
    if (filters.range1) params.append('range1', filters.range1.toString());
    if (filters.range2) params.append('range2', filters.range2.toString());
    if (filters.range3) params.append('range3', filters.range3.toString());
    if (filters.customer) params.append('customer', filters.customer);
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_accounts_receivable_summary?${params.toString()}`);
    return response.message || response;
  } catch (error) {
    console.error('Error fetching AR summary:', error);
    throw error;
  }
};

/**
 * Get customer receivable details
 * @param {string} customer - Customer name
 * @param {Object} options - Options (include_payments, as_on_date)
 * @returns {Promise<Object>} Customer AR details
 */
export const getCustomerReceivableDetails = async (customer, options = {}) => {
  try {
    const params = new URLSearchParams();
    params.append('customer', customer);
    if (options.include_payments !== undefined) {
      params.append('include_payments', options.include_payments.toString());
    }
    if (options.as_on_date) {
      params.append('as_on_date', options.as_on_date);
    }
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_customer_receivable_details?${params.toString()}`);
    return response.message || response;
  } catch (error) {
    console.error('Error fetching customer receivable details:', error);
    throw error;
  }
};

/**
 * Get customer billing and payments for statement
 * API Endpoint: /api/method/badria_pwa.api.van_sales.get_customer_billing_and_payments?customer={customerName}
 * Sample: https://badriasweets.enfonoerp.com/api/method/badria_pwa.api.van_sales.get_customer_billing_and_payments?customer=Adarak%20General%20Services
 * @param {string} customerName - Customer name (will be URL encoded automatically)
 * @returns {Promise<Array>} Array of transactions with date, type, reference, total, amount
 */
export const getCustomerBillingAndPayments = async (customerName) => {
  try {
    // URL encode customer name to handle spaces and special characters (e.g., "Adarak General Services" -> "Adarak%20General%20Services")
    const encodedCustomerName = encodeURIComponent(customerName);
    const endpoint = `/method/badria_pwa.api.van_sales.get_customer_billing_and_payments?customer=${encodedCustomerName}`;
    const response = await apiRequest(endpoint);
    
    // Handle different response structures
    let data = null;
    
    // Case 1: response.message.data
    if (response?.message?.data) {
      data = response.message.data;
    }
    // Case 2: response.message (direct object)
    else if (response?.message && typeof response.message === 'object' && !Array.isArray(response.message)) {
      data = response.message;
    }
    // Case 3: response is directly the data
    else if (response && typeof response === 'object' && !Array.isArray(response)) {
      data = response;
    }
    // Case 4: response.message is an array (unlikely but possible)
    else if (Array.isArray(response?.message)) {
      data = { transactions: response.message };
    }
    
    if (!data) {
      console.warn('⚠️ No data found in response, returning empty array');
      console.warn('⚠️ Response structure:', Object.keys(response || {}));
      return [];
    }
    
    // Transform API response to transaction format
    const transactions = [];
    
    // Check if data is directly an array (response.message.data is an array)
    if (Array.isArray(data)) {
      data.forEach(item => {
        const date = item.posting_date || item.date || item.creation || item.transaction_date || new Date().toISOString().split('T')[0];
        const reference = item.name || item.invoice_name || item.invoice || item.payment_entry || item.payment || item.id || item.voucher_no || '';
        const source = item.source || '';
        const amount = parseFloat(item.amount || item.grand_total || item.total || item.base_grand_total || item.base_total || item.paid_amount || 0);
        
        // Determine type based on source field
        // "Invoice" = sale, "Payment" = payment, or check other indicators
        let type = 'sale'; // default
        if (source && source.toLowerCase().includes('payment')) {
          type = 'payment';
        } else if (source && source.toLowerCase().includes('invoice')) {
          type = 'sale';
        } else if (item.paid_amount !== undefined || item.credit !== undefined) {
          type = 'payment';
        } else if (item.grand_total !== undefined || item.total !== undefined) {
          type = 'sale';
        }
        
        if (reference) {
          transactions.push({
            date: date,
            type: type,
            reference: reference,
            total: type === 'sale' ? amount : 0,
            amount: amount
          });
        }
      });
    }
    // Handle billing (sales invoices) - check multiple possible keys
    else {
      const billingData = data.billing || data.invoices || data.sales_invoices || data.sales || data.billing_invoices || [];
      
      if (Array.isArray(billingData) && billingData.length > 0) {
        billingData.forEach(invoice => {
          const date = invoice.posting_date || invoice.date || invoice.creation || invoice.transaction_date || new Date().toISOString().split('T')[0];
          const total = parseFloat(invoice.grand_total || invoice.total || invoice.base_grand_total || invoice.base_total || invoice.amount || 0);
          const reference = invoice.name || invoice.invoice_name || invoice.invoice || invoice.id || invoice.voucher_no || '';
          
          // Don't filter by total > 0, include all invoices
          if (reference) {
            transactions.push({
              date: date,
              type: 'sale',
              reference: reference,
              total: total,
              amount: total
            });
          }
        });
      }
      
      // Handle payments - check multiple possible keys
      const paymentsData = data.payments || data.payment_entries || data.payment || data.payment_entries_list || [];
      
      if (Array.isArray(paymentsData) && paymentsData.length > 0) {
        paymentsData.forEach(payment => {
          const date = payment.posting_date || payment.date || payment.creation || payment.transaction_date || new Date().toISOString().split('T')[0];
          const amount = parseFloat(payment.paid_amount || payment.amount || payment.base_paid_amount || payment.base_amount || payment.credit || 0);
          const reference = payment.name || payment.payment_entry || payment.payment || payment.id || payment.voucher_no || '';
          
          // Don't filter by amount > 0, include all payments
          if (reference) {
            transactions.push({
              date: date,
              type: 'payment',
              reference: reference,
              amount: amount
            });
          }
        });
      }
      
      // Handle direct transactions array (if API returns transactions directly)
      if (Array.isArray(data.transactions)) {
        data.transactions.forEach(tx => {
          transactions.push({
            date: tx.date || tx.posting_date || tx.transaction_date || new Date().toISOString().split('T')[0],
            type: tx.type || (tx.debit > 0 ? 'sale' : 'payment'),
            reference: tx.reference || tx.name || tx.id || tx.voucher_no || '',
            total: parseFloat(tx.debit || tx.total || tx.amount || 0),
            amount: parseFloat(tx.credit || tx.amount || tx.paid_amount || 0)
          });
        });
      }
    }
    
    // If still no transactions, try to find any array in the data
    if (transactions.length === 0) {
      for (const key in data) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          
          // Try to process as transactions
          data[key].forEach((item, index) => {
            // Try to determine if it's a billing or payment based on structure
            const date = item.posting_date || item.date || item.creation || item.transaction_date || new Date().toISOString().split('T')[0];
            const reference = item.name || item.invoice_name || item.invoice || item.payment_entry || item.payment || item.id || item.voucher_no || `Item-${index}`;
            
            // Check if it looks like a billing (has grand_total, total, etc.)
            if (item.grand_total !== undefined || item.total !== undefined || item.base_grand_total !== undefined) {
              const total = parseFloat(item.grand_total || item.total || item.base_grand_total || item.base_total || item.amount || 0);
              transactions.push({
                date: date,
                type: 'sale',
                reference: reference,
                total: total,
                amount: total
              });
            }
            // Check if it looks like a payment (has paid_amount, amount, credit, etc.)
            else if (item.paid_amount !== undefined || item.credit !== undefined || (item.amount !== undefined && item.debit === undefined)) {
              const amount = parseFloat(item.paid_amount || item.amount || item.base_paid_amount || item.base_amount || item.credit || 0);
              transactions.push({
                date: date,
                type: 'payment',
                reference: reference,
                amount: amount
              });
            }
            // Generic transaction with debit/credit
            else if (item.debit !== undefined || item.credit !== undefined) {
              transactions.push({
                date: date,
                type: item.debit > 0 ? 'sale' : 'payment',
                reference: reference,
                total: parseFloat(item.debit || 0),
                amount: parseFloat(item.credit || 0)
              });
            }
          });
          
          if (transactions.length > 0) {
            break; // Stop after finding first valid array
          }
        }
      }
    }
    
    // Sort by date (newest first)
    transactions.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA;
    });
    
    return transactions;
  } catch (error) {
    console.error('❌ Error fetching customer billing and payments:', error);
    // Return empty array instead of throwing to prevent UI breakage
    return [];
  }
};

/** Normalize dashboard stat API response (message.data / message / response) */
const normalizeStatResponse = (response) => {
  if (!response) return response;
  if (response.message && typeof response.message === 'object' && response.message.data) return response.message.data;
  if (response.message && typeof response.message === 'object') return response.message;
  return response;
};

/** Single helper for cached GET stat endpoint */
const fetchTodayStat = async (method, label) => {
  try {
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.${method}`, {}, true);
    return normalizeStatResponse(response);
  } catch (error) {
    console.error(`Error fetching ${label}:`, error);
    throw error;
  }
};

export const getTodaySales = () => fetchTodayStat('get_today_sales', 'today sales');
export const getTodayCollection = () => fetchTodayStat('get_today_collection', 'today collection');
export const getTodayCashCollection = () => fetchTodayStat('get_today_cash_collection', 'today cash collection');
export const getTodayBankCollection = () => fetchTodayStat('get_today_bank_collection', 'today bank collection');
export const getDailyPosCollection = () => fetchTodayStat('get_daily_pos_collection', 'daily POS collection');

// ============================================================================
// SALES RETURN APIs
// ============================================================================

/**
 * Create sales return (credit note)
 * @param {Object} returnData - Return data
 * @param {string} returnData.original_invoice - Original invoice name
 * @param {string} returnData.posting_date - Posting date (optional)
 * @param {string} returnData.custom_return_reason - Return reason
 * @param {string} returnData.naming_series - Naming series (optional)
 * @param {Array} returnData.items - Items array for partial return (optional)
 * @returns {Promise<Object>} Created return invoice
 */
export const createSalesReturn = async (returnData) => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.create_sales_return', {
      method: 'POST',
      body: JSON.stringify(returnData),
    });
    
    let data = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      data = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      data = response.message;
    }
    
    return data;
  } catch (error) {
    console.error('Error creating sales return:', error);
    throw error;
  }
};

/**
 * Submit sales return
 * @param {string} returnInvoice - Return invoice name
 * @param {boolean} createPayment - Whether to create payment entry
 * @param {string} modeOfPayment - Payment method (optional, required if createPayment is true)
 * @returns {Promise<Object>} Submission response
 */
export const submitSalesReturn = async (returnInvoice, createPayment = false, modeOfPayment = null) => {
  try {
    const body = {
      return_invoice: returnInvoice,
      create_payment: createPayment
    };
    
    if (createPayment && modeOfPayment) {
      body.mode_of_payment = modeOfPayment;
    }
    
    const response = await apiRequest('/method/badria_pwa.api.van_sales.submit_sales_return', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    
    let data = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      data = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      data = response.message;
    }
    
    return data;
  } catch (error) {
    console.error('Error submitting sales return:', error);
    throw error;
  }
};

/**
 * Get sales return details
 * @param {string} returnInvoice - Return invoice name
 * @returns {Promise<Object>} Return invoice details
 */
export const getSalesReturnDetails = async (returnInvoice) => {
  try {
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_sales_return_details?return_invoice=${encodeURIComponent(returnInvoice)}`);
    
    let data = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      data = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      data = response.message;
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching sales return details:', error);
    throw error;
  }
};

/**
 * Get sales returns list
 * @param {Object} filters - Filter options
 * @param {number} filters.limit - Number of records to return
 * @param {number} filters.offset - Starting position for pagination
 * @param {string} filters.customer - Filter by customer
 * @param {number} filters.status - Filter by status (0=Draft, 1=Submitted, 2=Cancelled)
 * @param {string} filters.from_date - Start date (YYYY-MM-DD)
 * @param {string} filters.to_date - End date (YYYY-MM-DD)
 * @param {string} filters.original_invoice - Filter by original invoice
 * @returns {Promise<Array>} Array of sales returns
 */
export const getSalesReturnsList = async (filters = {}) => {
  try {
    const params = new URLSearchParams();
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());
    if (filters.customer) params.append('customer', filters.customer);
    if (filters.status !== undefined) params.append('status', filters.status.toString());
    if (filters.from_date) params.append('from_date', filters.from_date);
    if (filters.to_date) params.append('to_date', filters.to_date);
    if (filters.original_invoice) params.append('original_invoice', filters.original_invoice);
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_sales_returns_list?${params.toString()}`);
    
    let data = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      data = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      data = response.message;
    }
    
    // Handle array response; normalize original invoice from return_against for list view
    let list = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (data && Array.isArray(data.returns)) {
      list = data.returns;
    } else if (data && Array.isArray(data.data)) {
      list = data.data;
    }
    return list.map((item) => ({
      ...item,
      original_invoice: item.original_invoice ?? item.return_against ?? item.against_sales_invoice,
    }));
  } catch (error) {
    console.error('Error fetching sales returns list:', error);
    throw error;
  }
};

// ============================================================================
// STOCK BALANCE APIs
// ============================================================================

/**
 * Get stock balance summary
 * @param {string} warehouse - Warehouse filter (optional)
 * @param {string} company - Company filter (optional)
 * @returns {Promise<Object>} Summary with total_items, total_quantity, stock_value
 */
export const getStockBalanceSummary = async (warehouse = null, company = null) => {
  try {
    const params = new URLSearchParams();
    if (warehouse) params.append('warehouse', warehouse);
    if (company) params.append('company', company);
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_stock_balance_summary${params.toString() ? '?' + params.toString() : ''}`);
    
    let data = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      data = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      data = response.message;
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching stock balance summary:', error);
    throw error;
  }
};

/**
 * Get stock levels
 * @param {Object} filters - Filter options
 * @param {string} filters.warehouse - Filter by warehouse
 * @param {string} filters.item_code - Search by item code
 * @param {string} filters.item_name - Search by item name
 * @param {string} filters.search - General search (item code and name)
 * @param {string} filters.company - Filter by company
 * @returns {Promise<Array>} Array of stock items with levels
 */
export const getStockLevels = async (filters = {}) => {
  try {
    const params = new URLSearchParams();
    if (filters.warehouse) params.append('warehouse', filters.warehouse);
    if (filters.item_code) params.append('item_code', filters.item_code);
    if (filters.item_name) params.append('item_name', filters.item_name);
    if (filters.search) params.append('search', filters.search);
    if (filters.company) params.append('company', filters.company);
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_stock_levels${params.toString() ? '?' + params.toString() : ''}`);
    
    let data = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      data = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      data = response.message;
    }
    
    // Handle array response
    if (Array.isArray(data)) {
      return data;
    } else if (data && Array.isArray(data.items)) {
      return data.items;
    } else if (data && Array.isArray(data.data)) {
      return data.data;
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching stock levels:', error);
    throw error;
  }
};

/**
 * Get complete stock balance data (summary + items + warehouses)
 * @param {Object} filters - Filter options
 * @param {string} filters.warehouse - Filter by warehouse
 * @param {string} filters.search - Search term
 * @param {string} filters.company - Filter by company
 * @returns {Promise<Object>} Complete stock balance data
 */
export const getStockBalanceComplete = async (filters = {}) => {
  try {
    const params = new URLSearchParams();
    if (filters.warehouse) params.append('warehouse', filters.warehouse);
    if (filters.search) params.append('search', filters.search);
    if (filters.company) params.append('company', filters.company);
    
    const response = await apiRequest(`/method/badria_pwa.api.van_sales.get_stock_balance_complete${params.toString() ? '?' + params.toString() : ''}`);
    
    let data = response;
    if (response && response.message && typeof response.message === 'object' && response.message.data) {
      data = response.message.data;
    } else if (response && response.message && typeof response.message === 'object') {
      data = response.message;
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching complete stock balance:', error);
    throw error;
  }
};

/**
 * Get payment methods (enabled Mode of Payment with account for user's company) from backend.
 * @returns {Promise<Array<string>>} Array of mode of payment names
 */
export const getPaymentMethods = async () => {
  try {
    const response = await apiRequest('/method/badria_pwa.api.van_sales.get_mode_of_payment_list', { method: 'GET' });
    const msg = response?.message;
    if (msg?.data && Array.isArray(msg.data) && msg.data.length > 0) {
      return msg.data;
    }
    if (Array.isArray(msg)) return msg;
    return [];
  } catch (error) {
    console.warn('getPaymentMethods failed:', error);
    return [];
  }
};

export default {
  // Authentication
  login,
  validateToken,
  logout,
  // Items
  getItemPrice,
  searchItems,
  getItemsList,
  getItemDetails,
  createItem,
  updateItem,
  // Customers
  getCustomers,
  createCustomer,
  // Customer Addresses
  createCustomerAddress,
  getCustomerAddresses,
  updateCustomerAddress,
  deleteCustomerAddress,
  // Sales Invoices
  createSalesInvoice,
  getSalesInvoiceList,
  getInvoiceDetails,
  submitSalesInvoice,
  // Leads
  getLeadList,
  getLeadDetails,
  createLead,
  // Quotations
  getQuotationList,
  getQuotationDetails,
  createQuotation,
  submitQuotation,
  cancelQuotation,
  amendQuotation,
  // Sales Orders
  getSalesOrderList,
  getSalesOrderDetails,
  createSalesOrder,
  submitSalesOrder,
  // Payment Entries
  createPayment,
  createPaymentEntry,
  getPaymentEntriesList,
  getPaymentEntryDetails,
  getOutstandingInvoicesForPayment,
  submitPaymentEntry,
  // Warehouse & Stock
  getWarehouses,
  getStock,
  // Payment Methods
  getPaymentMethods,
  // Accounts Receivable
  getAccountsReceivableSummary,
  getCustomerReceivableDetails,
  // Customer Billing
  getCustomerBillingAndPayments,
  // Dashboard
  getTodaySales,
  getTodayCollection,
  // User
  getUserInfo,
  getTodayCashCollection,
  getTodayBankCollection,
  getDailyPosCollection,
  // Sales Returns
  createSalesReturn,
  submitSalesReturn,
  getSalesReturnDetails,
  getSalesReturnsList,
  // Stock Balance
  getStockBalanceSummary,
  getStockLevels,
  getStockBalanceComplete,
};

