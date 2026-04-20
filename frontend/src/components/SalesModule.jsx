import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Search, Trash2, Save, Loader2, Check } from 'lucide-react';
import { getItemPrice, searchItems, createSalesInvoice, updateSalesInvoice, getInvoiceDetails, getItemDetails, submitSalesInvoice, createCustomer, getSalesInvoiceList, getPaymentMethods, openPrintPdf } from '../services/api';
import SARSymbol from './SARSymbol';
import ErrorDialog from './ErrorDialog';
import ConfirmationDialog from './ConfirmationDialog';
import SuccessDialog from './SuccessDialog';

function SalesModule({ customers, items, sales, onAddSale, onAddCustomer, loadingCustomers, loadingItems, loadingSales }) {
  const location = useLocation();
  const [view, setView] = useState('list'); // 'list', 'create', or 'detail'
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [itemSearch, setItemSearch] = useState('');
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('0');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingItem, setLoadingItem] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceDetails, setInvoiceDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceSearchResults, setInvoiceSearchResults] = useState([]);
  const [loadingInvoiceSearch, setLoadingInvoiceSearch] = useState(false);
  const invoiceSearchDebounceRef = useRef(null);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [showQuickCustomerForm, setShowQuickCustomerForm] = useState(false);
  const [quickCustomerFormData, setQuickCustomerFormData] = useState({
    custom_customer_name_arabic: '',
    custom_vat_registration_number: ''
  });
  const [quickCustomerVatError, setQuickCustomerVatError] = useState('');
  const [submittingQuickCustomer, setSubmittingQuickCustomer] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');
  const itemDropdownRef = useRef(null);
  const [errorDialog, setErrorDialog] = useState({ isOpen: false, title: '', message: '' });
  const [confirmationDialog, setConfirmationDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null, onCancel: null });
  const [successDialog, setSuccessDialog] = useState({ isOpen: false, title: '', message: '' });
  const sanitizeDecimalInput = (value = '') => value.replace(/[^0-9.]/g, '');
  const sanitizeIntegerInput = (value = '') => value.replace(/[^0-9]/g, '');
  
  // Get available UOMs for an item: stock_uom + UOMs with conversion_factor set
  // Only shows UOMs that have conversion rates set in item master (no hardcoded UOMs)
  const getAvailableUOMs = (item) => {
    const stockUOM = item.stock_uom; // Only use if exists, no fallback
    const uomConversions = item.uom_conversions || [];
    const availableUOMs = [];
    
    // Include stock UOM if it exists
    if (stockUOM) {
      availableUOMs.push(stockUOM);
    }
    
    // Add UOMs from conversions that have conversion_factor set
    uomConversions.forEach(conv => {
      if (conv.uom && conv.conversion_factor && !availableUOMs.includes(conv.uom)) {
        availableUOMs.push(conv.uom);
      }
    });
    
    return availableUOMs;
  };
  
  const cleanErrorMessage = (error) => {
    const stripHtml = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');
    const stripStatusPrefix = (s) => {
      if (typeof s !== 'string') return '';
      const statusCodePattern = /^(API Error:\s*\d+\s+[A-Za-z\s]+:\s*|^\d+\s+[A-Za-z\s]+:\s*)/i;
      return s.replace(statusCodePattern, '').trim();
    };

    // Strings
    if (typeof error === 'string') {
      const cleaned = stripStatusPrefix(stripHtml(error));
      return cleaned && cleaned.length >= 3 ? cleaned : 'An error occurred. Please try again.';
    }

    // Objects
    if (error && typeof error === 'object') {
      // Priority 1: error.response.data.message.message (nested)
      if (error.response?.data?.message?.status === 'error' && error.response.data.message.message) {
        const msg = stripHtml(String(error.response.data.message.message));
        if (msg && msg.length >= 3) return msg;
      }
      // Priority 2: error.response.data.message.message (alternative)
      if (error.response?.data?.message?.message && typeof error.response.data.message.message === 'string') {
        const msg = stripHtml(error.response.data.message.message);
        if (msg && msg.length >= 3) return msg;
      }
      // Priority 3: error.response.message.message (alternative structure)
      if (error.response?.message?.status === 'error' && error.response.message.message) {
        const msg = stripHtml(String(error.response.message.message));
        if (msg && msg.length >= 3) return msg;
      }
      // Priority 4: error.message (most common for thrown errors)
      if (typeof error.message === 'string' && error.message.trim()) {
        const cleaned = stripStatusPrefix(stripHtml(error.message));
        if (cleaned && cleaned.length >= 3) return cleaned;
      }
      // Priority 5: error.response.data.message (string or object)
      if (error.response?.data?.message) {
        if (typeof error.response.data.message === 'string') {
          const cleaned = stripStatusPrefix(stripHtml(error.response.data.message));
          if (cleaned && cleaned.length >= 3) return cleaned;
        }
        if (typeof error.response.data.message === 'object' && error.response.data.message.message) {
          const cleaned = stripStatusPrefix(stripHtml(String(error.response.data.message.message)));
          if (cleaned && cleaned.length >= 3) return cleaned;
        }
      }
      // Priority 6: error.response.data.exc (exception message)
      if (error.response?.data?.exc && typeof error.response.data.exc === 'string') {
        const cleaned = stripStatusPrefix(stripHtml(error.response.data.exc));
        if (cleaned && cleaned.length >= 3) return cleaned;
      }
      // Priority 7: parse _server_messages
      const serverMessagesStr = error.response?._server_messages || error.response?.data?._server_messages;
      if (serverMessagesStr) {
        try {
          const serverMessages = JSON.parse(serverMessagesStr);
          if (Array.isArray(serverMessages) && serverMessages.length > 0) {
            const first = serverMessages[0];
            const parsedFirst = typeof first === 'string' ? JSON.parse(first) : first;
            const candidate = parsedFirst?.message || parsedFirst?.title;
            const cleaned = stripStatusPrefix(stripHtml(candidate));
            if (cleaned && cleaned.length >= 3) return cleaned;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    return 'An error occurred. Please try again.';
  };
  const getPriceValue = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  };
  const getQuantityValue = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) && num > 0 ? num : 1;
  };
  const getDiscountValue = (value) => {
    const num = parseFloat(value);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  };

  // Format date as DD/MM/YY
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  };

  // Handle navigation from Dashboard - open detail view if saleId is in route state
  useEffect(() => {
    if (location.state?.saleId) {
      const sale = sales.find(s => s.id === location.state.saleId);
      if (sale) {
        handleViewDetails(sale);
      }
      // Clear the state to prevent re-triggering
      window.history.replaceState({}, document.title);
    }
  }, [location.state, sales]);

  // Handle name query parameter to show detail view
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nameParam = params.get('name');
    if (nameParam && nameParam !== selectedInvoice?.name && nameParam !== selectedInvoice?.id) {
      setLoadingDetails(true);
      getInvoiceDetails(nameParam)
        .then((details) => {
          const saleObj = {
            id: nameParam,
            name: nameParam,
            invoice_name: nameParam,
            ...details
          };
          setSelectedInvoice(saleObj);
          setInvoiceDetails(details);
          setView('detail');
        })
        .catch(() => {
          // If error, stay on list view
        })
        .finally(() => setLoadingDetails(false));
    }
  }, [location.search]);

  // Fetch payment methods on mount
  useEffect(() => {
    getPaymentMethods().then((list) => {
      if (Array.isArray(list) && list.length > 0) {
        setPaymentMethods(list);
      }
    }).catch(() => setPaymentMethods([]));
  }, []);

  // Filter customers based on search query (only show dropdown when no customer selected)
  useEffect(() => {
    if (customerSearch.trim() && !selectedCustomer) {
      const filtered = customers.filter(customer =>
        customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        customer.custom_customer_name_english?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        customer.mobile?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        customer.email?.toLowerCase().includes(customerSearch.toLowerCase())
      );
      setFilteredCustomers(filtered);
      setShowCustomerResults(true);
    } else if (!customerSearch.trim()) {
      setFilteredCustomers([]);
      if (!selectedCustomer) setShowCustomerResults(false);
    }
  }, [customerSearch, customers, selectedCustomer]);

  // When user searches invoices, fetch from server (so any invoice can be found, not just the first 20)
  useEffect(() => {
    const term = invoiceSearch.trim();
    if (!term) {
      setInvoiceSearchResults([]);
      setLoadingInvoiceSearch(false);
      if (invoiceSearchDebounceRef.current) {
        clearTimeout(invoiceSearchDebounceRef.current);
        invoiceSearchDebounceRef.current = null;
      }
      return;
    }
    if (invoiceSearchDebounceRef.current) clearTimeout(invoiceSearchDebounceRef.current);
    invoiceSearchDebounceRef.current = setTimeout(() => {
      invoiceSearchDebounceRef.current = null;
      setLoadingInvoiceSearch(true);
      getSalesInvoiceList({ limit: 100, offset: 0, search: term })
        .then(({ invoices }) => {
          setInvoiceSearchResults(Array.isArray(invoices) ? invoices : []);
        })
        .catch(() => setInvoiceSearchResults([]))
        .finally(() => setLoadingInvoiceSearch(false));
    }, 350);
    return () => {
      if (invoiceSearchDebounceRef.current) {
        clearTimeout(invoiceSearchDebounceRef.current);
      }
    };
  }, [invoiceSearch]);

  // Close customer dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showCustomerResults && !event.target.closest('.customer-search-container')) {
        setShowCustomerResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCustomerResults]);

  // Item search logic - fetch on every keystroke (with debounce)
  useEffect(() => {
    if (!selectedCustomer) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    const query = itemSearch.trim().toLowerCase();

    // Sort results to prioritize item code matches
    const sortByCodePriority = (results, searchTerm) => {
      if (!searchTerm) return results;
      
      const term = searchTerm.toLowerCase();
      return results.sort((a, b) => {
        const aCode = (a.code || '').toLowerCase();
        const bCode = (b.code || '').toLowerCase();
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        
        // Get priority score for item (lower number = higher priority)
        const getPriority = (code, name) => {
          // Priority 1: Exact code match
          if (code === term) return 1;
          // Priority 2: Code starts with search term
          if (code.startsWith(term)) return 2;
          // Priority 3: Code contains search term
          if (code.includes(term)) return 3;
          // Priority 4: Name starts with search term
          if (name.startsWith(term)) return 4;
          // Priority 5: Name contains search term
          if (name.includes(term)) return 5;
          // No match
          return 99;
        };
        
        const aPriority = getPriority(aCode, aName);
        const bPriority = getPriority(bCode, bName);
        
        // Sort by priority first
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        
        // If same priority and both are code matches, sort by code length (shorter first) then alphabetically
        if (aPriority <= 3 && bPriority <= 3) {
          if (aCode.length !== bCode.length) {
            return aCode.length - bCode.length;
          }
          return aCode.localeCompare(bCode);
        }
        
        // If same priority and both are name matches, sort alphabetically by name
        if (aPriority >= 4 && bPriority >= 4) {
          return aName.localeCompare(bName);
        }
        
        return 0; // Maintain original order if priority is the same
      });
    };

    const getLocalMatches = (term) => {
      if (!term) {
        return items.slice(0, 20);
      }
      const filtered = items.filter(item =>
          item.code?.toLowerCase().includes(term) ||
          item.name?.toLowerCase().includes(term)
      );
      return sortByCodePriority(filtered, term).slice(0, 20);
    };

    const timeoutId = setTimeout(() => {
      if (!query) {
        setLoadingSearch(false);
        setSearchResults(getLocalMatches(''));
        return;
      }

      setLoadingSearch(true);
      searchItems(itemSearch)
        .then(results => {
          if (results && results.length > 0) {
            // Sort API results to prioritize code matches
            const sortedResults = sortByCodePriority(results, query);
            setSearchResults(sortedResults);
            setShowResults(true);
          } else {
            const fallback = getLocalMatches(query);
            setSearchResults(fallback);
            setShowResults(fallback.length > 0);
          }
        })
        .catch(() => {
          const fallback = getLocalMatches(query);
          setSearchResults(fallback);
          setShowResults(fallback.length > 0);
        })
        .finally(() => setLoadingSearch(false));
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [itemSearch, items, selectedCustomer]);

  // Close item dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showResults && itemDropdownRef.current && !itemDropdownRef.current.contains(event.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showResults]);

  const handleAddItem = async (item) => {
    const existing = invoiceItems.find(i => i.code === item.code);
    if (existing) {
      setInvoiceItems(invoiceItems.map(i =>
        i.code === item.code
          ? { ...i, quantity: ((parseFloat(i.quantity) || 1) + 1).toString() }
          : i
      ));
    } else {
      // Use item data directly (from dummy data or API)
      setLoadingItem(true);
      try {
        // Get customer name for the API call
        const customer = customers.find(c => c.id === selectedCustomer);
        const customerName = customer?.name || null;
        
        // Fetch full item details from API with customer parameter
        const itemDetails = await getItemDetails(item.code || item.item_code, customerName).catch(() => null);
        
        // Extract price_list_rate from first item in item_prices array
        // If price_list_rate is not present, use 0 instead of standard_rate
        let priceListRate = 0;
        if (itemDetails?.item_prices && itemDetails.item_prices.length > 0) {
          priceListRate = itemDetails.item_prices[0].price_list_rate || 0;
        } else if (itemDetails?.price_list_rate) {
          priceListRate = itemDetails.price_list_rate;
        } else {
          priceListRate = 0; // Use 0 instead of falling back to price or standard_rate
        }
        
        const baseQuantity = item.quantity ?? 1;
        const actualQty = itemDetails?.actual_qty ?? item.stock ?? 0;
        
        // Default UOM is sales_uom from API (only if exists, no hardcoded fallback)
        const stockUOM = itemDetails?.stock_uom;
        const salesUOM = itemDetails?.sales_uom;
        const defaultUOM = salesUOM || stockUOM; // Use actual UOMs from API, no fallback
        const uomConversions = itemDetails?.uom_conversions || [];
        
        // Price is per stock_uom, so convert if default UOM is different and stockUOM exists
        let initialPrice = priceListRate;
        if (defaultUOM && stockUOM && defaultUOM !== stockUOM) {
          const defaultConversion = uomConversions.find(conv => conv.uom === defaultUOM);
          if (defaultConversion && defaultConversion.conversion_factor) {
            initialPrice = priceListRate * defaultConversion.conversion_factor;
          }
        }
        const roundPrice = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);
        const newItem = {
          code: itemDetails?.code || item.code,
          name: itemDetails?.name || item.name,
          price: roundPrice(initialPrice), // 2 decimal places
          price_list_rate: Number(roundPrice(priceListRate)), // Store original (per stock_uom)
          uom: defaultUOM || stockUOM || '', // Use actual UOMs from API, no hardcoded fallback
          stock_uom: stockUOM || '', // Store original stock_uom from API (no fallback)
          sales_uom: salesUOM || stockUOM || '', // Store original sales_uom from API (no fallback)
          uom_conversions: uomConversions, // Store conversion factors
          stock: actualQty,
          quantity: baseQuantity.toString(),
          originalPrice: Number(roundPrice(priceListRate)) // Store original for reference
        };
        setInvoiceItems([...invoiceItems, newItem]);
      } catch (error) {
        console.error('Error fetching item details:', error);
        // If API fails, use item data directly
        // Default UOM is sales_uom (only if exists, no hardcoded fallback)
        const stockUOM = item.stock_uom;
        const salesUOM = item.sales_uom;
        const defaultUOM = salesUOM || stockUOM; // Use actual UOMs from API, no fallback
        const basePrice = item.price || 0;
        const uomConversions = item.uom_conversions || [];
        
        // Convert price if default UOM has conversion factor
        let initialPrice = basePrice;
        if (defaultUOM && defaultUOM !== stockUOM) {
          const defaultConversion = uomConversions.find(conv => conv.uom === defaultUOM);
          if (defaultConversion && defaultConversion.conversion_factor) {
            initialPrice = basePrice * defaultConversion.conversion_factor;
          }
        }
        const roundPriceFallback = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);
        const newItem = {
          code: item.code,
          name: item.name,
          price: roundPriceFallback(initialPrice), // 2 decimal places
          price_list_rate: Number(roundPriceFallback(basePrice)),
          uom: defaultUOM || '', // Use actual UOMs from API, no hardcoded fallback
          stock_uom: stockUOM || '', // Store actual stock_uom (no fallback)
          sales_uom: salesUOM || stockUOM || '', // Store actual sales_uom (no fallback)
          uom_conversions: uomConversions,
          stock: item.stock || 0,
          quantity: (item.quantity || 1).toString(),
          originalPrice: Number(roundPriceFallback(basePrice))
        };
        setInvoiceItems([...invoiceItems, newItem]);
      } finally {
        setLoadingItem(false);
      }
    }
    // Close dropdown after item selection
    setItemSearch('');
    setShowResults(false);
    setSearchResults([]);
  };

  const handleUpdatePrice = (code, value) => {
    // Only sanitize while typing (allow digits and one decimal) - do NOT round so user can backspace and type freely
    const sanitized = sanitizeDecimalInput(value);
    setInvoiceItems(invoiceItems.map(item =>
      item.code === code ? { ...item, price: sanitized } : item
    ));
  };

  const handlePriceBlur = (code) => {
    // Round to 2 decimals when user leaves the field
    setInvoiceItems(invoiceItems.map(item => {
      if (item.code !== code) return item;
      const p = item.price;
      if (p === '' || p == null) return { ...item, price: '' };
      const num = parseFloat(String(p).replace(/[^0-9.-]/g, ''));
      if (Number.isNaN(num)) return { ...item, price: '' };
      return { ...item, price: (Math.round(num * 100) / 100).toFixed(2) };
    }));
  };

  const handleUpdateQuantity = (code, value) => {
    const sanitized = sanitizeIntegerInput(value);
    setInvoiceItems(invoiceItems.map(item =>
      item.code === code ? { ...item, quantity: sanitized } : item
    ));
  };

  const handleUpdateUOM = (code, value) => {
    setInvoiceItems(invoiceItems.map(item => {
      if (item.code === code) {
        const priceListRate = item.price_list_rate || parseFloat(item.originalPrice) || parseFloat(item.price) || 0;
        const currentPrice = parseFloat(item.price) || priceListRate;
        const currentUOM = item.uom || item.stock_uom || '';
        const stockUOM = item.stock_uom || '';
        const uomConversions = item.uom_conversions || [];
        
        let newPrice = priceListRate; // Default: base price per stock_uom
        
        // If already at target UOM, keep current price
        if (currentUOM === value) {
          newPrice = currentPrice;
        } else {
          // Find conversion factors
          const currentConv = uomConversions.find(conv => conv.uom === currentUOM);
          const targetConv = uomConversions.find(conv => conv.uom === value);
          
          // Convert via stock_uom (base UOM)
          if (currentUOM === stockUOM) {
            // Converting FROM stock_uom TO target UOM: multiply by conversion_factor
            if (targetConv?.conversion_factor) {
              newPrice = priceListRate * targetConv.conversion_factor;
            } else {
              newPrice = priceListRate; // No conversion factor, keep base price
            }
          } else if (value === stockUOM) {
            // Converting FROM current UOM TO stock_uom: divide by conversion_factor
            if (currentConv?.conversion_factor) {
              newPrice = currentPrice / currentConv.conversion_factor;
            } else {
              newPrice = currentPrice; // No conversion factor, keep current price
            }
          } else {
            // Converting BETWEEN two non-stock UOMs: convert via stock_uom
            // First convert current price to stock_uom, then to target UOM
            let stockPrice = currentPrice;
            if (currentConv?.conversion_factor) {
              stockPrice = currentPrice / currentConv.conversion_factor;
            }
            if (targetConv?.conversion_factor) {
              newPrice = stockPrice * targetConv.conversion_factor;
            } else {
              newPrice = stockPrice;
            }
          }
        }
        const rounded = (Math.round(Number(newPrice) * 100) / 100).toFixed(2);
        return { ...item, uom: value, price: rounded };
      }
      return item;
    }));
  };

  const handleUpdateDiscountAmount = (value) => {
    const sanitized = sanitizeDecimalInput(value);
    setDiscountAmount(sanitized);
  };

  const handleRemoveItem = (code) => {
    setInvoiceItems(invoiceItems.filter(item => item.code !== code));
  };

  const handleQuickCustomerChange = (e) => {
    const { name, value } = e.target;
    
    // VAT number validation - only allow digits and enforce 15 digits
    if (name === 'custom_vat_registration_number') {
      // Only allow digits
      const digitsOnly = value.replace(/[^0-9]/g, '');
      // Limit to 15 digits
      const limitedValue = digitsOnly.slice(0, 15);
      setQuickCustomerFormData({ ...quickCustomerFormData, [name]: limitedValue });
      
      // Validate length
      if (limitedValue.length > 0 && limitedValue.length !== 15) {
        setQuickCustomerVatError('VAT number must be exactly 15 digits');
      } else {
        setQuickCustomerVatError('');
      }
    } else {
      setQuickCustomerFormData({ ...quickCustomerFormData, [name]: value });
    }
  };

  const handleCreateQuickCustomer = async (e) => {
    if (e && e.preventDefault) {
    e.preventDefault();
      e.stopPropagation(); // Prevent parent form submission
    }
    
    // Validate VAT number if provided
    if (quickCustomerFormData.custom_vat_registration_number && quickCustomerFormData.custom_vat_registration_number.length !== 15) {
      setQuickCustomerVatError('VAT number must be exactly 15 digits');
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: 'VAT number must be exactly 15 digits'
      });
      return;
    }
    
    if (!quickCustomerFormData.custom_customer_name_arabic) {
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: 'Please fill in Customer Name'
      });
      return;
    }
    
    setSubmittingQuickCustomer(true);
    try {
      const customerData = {
        customer_name: quickCustomerFormData.custom_customer_name_arabic,
        custom_customer_name_arabic: quickCustomerFormData.custom_customer_name_arabic,
        custom_vat_registration_number: quickCustomerFormData.custom_vat_registration_number || ''
      };
      
      // Make sure we're actually calling the API
      if (!customerData.customer_name) {
        setErrorDialog({
          isOpen: true,
          title: 'Validation Error',
          message: 'Please fill in Customer Name'
        });
        setSubmittingQuickCustomer(false);
        return;
      }
      
      const result = await createCustomer(customerData);
      
      // Get customer name from result - try multiple possible fields
      const customerName = result.name || 
                          result.customer_name || 
                          result.custom_customer_name_english ||
                          customerData.customer_name;
      
      if (!customerName) {
        throw new Error('Customer created but name not returned from API');
      }
      
      // Add to local state via callback
      const newCustomer = {
        id: result.name || result.id || result.customer_name || `CUST${String(customers.length + 1).padStart(3, '0')}`,
        name: result.customer_name || customerName,
        custom_customer_name_english: customerData.customer_name || customerData.custom_customer_name_english,
custom_customer_name_arabic: customerData.custom_customer_name_arabic || '',
    customer_name: customerData.customer_name || customerData.custom_customer_name_arabic,
        custom_vat_registration_number: customerData.custom_vat_registration_number,
        balance: 0
      };
      
      // Add customer to state via callback if available
      if (onAddCustomer) {
        onAddCustomer(newCustomer);
      }
      
      // Reset form
      setQuickCustomerFormData({
        custom_customer_name_arabic: '',
        custom_vat_registration_number: ''
      });
      setQuickCustomerVatError('');
      setShowQuickCustomerForm(false);
      
      // Auto-select the new customer
      // Try to find the customer in the updated list
      const foundCustomer = customers.find(c => 
        c.name === customerName || 
        c.id === customerName
      ) || newCustomer;
      
      setSelectedCustomer(foundCustomer.id || newCustomer.id);
      setCustomerSearch(customerName);
      setShowCustomerResults(false);
      
      // Show success dialog
      setSuccessDialog({
        isOpen: true,
        title: 'Success',
        message: `Customer "${customerName}" created and selected successfully!`
      });
    } catch (error) {
      console.error('Error creating customer:', error);
      const errorMessage = cleanErrorMessage(error);
      setErrorDialog({
        isOpen: true,
        title: 'Error Creating Customer',
        message: errorMessage
      });
    } finally {
      setSubmittingQuickCustomer(false);
    }
  };

  const calculateSubtotal = () => {
    return invoiceItems.reduce((sum, item) => {
      const price = getPriceValue(item.price);
      const quantity = getQuantityValue(item.quantity);
      return sum + price * quantity;
    }, 0);
  };

  const calculateDiscount = () => {
    return getDiscountValue(discountAmount);
  };

  const calculateTax = () => {
    return calculateSubtotal() * 0.15; // 15% VAT on subtotal (before discount)
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    const tax = calculateTax();
    const discount = calculateDiscount();
    return Math.max(subtotal + tax - discount, 0); // Discount applied to total (after tax)
  };

  const handleEditInvoice = async () => {
    const invoice = invoiceDetails || selectedInvoice;
    if (!invoice) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'No invoice selected'
      });
      return;
    }

    const invoiceName = invoice.id || invoice.invoice_name || invoice.name;
    if (!invoiceName) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'Invoice name not found. Cannot edit invoice.'
      });
      return;
    }

    setLoadingDetails(true);
    try {
      const details = await getInvoiceDetails(invoiceName);

      // Map items into create-form structure; price limited to 2 decimal places
      const to2 = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);
      
      // Fetch item details for each item to get uom_conversions and price_list_rate
      const customerName = details.customerName || details.customer || null;
      const itemsForForm = await Promise.all((details.items || []).map(async (item) => {
        const itemCode = item.code || item.item_code;
        const currentPrice = item.price ?? item.rate ?? 0;
        const currentUOM = item.uom || item.sales_uom || item.stock_uom || '';
        
        // Fetch item details to get uom_conversions and price_list_rate
        let itemDetails = null;
        try {
          itemDetails = await getItemDetails(itemCode, customerName);
        } catch (error) {
          console.warn(`Failed to fetch details for item ${itemCode}:`, error);
        }
        
        const stockUOM = itemDetails?.stock_uom || item.stock_uom || currentUOM;
        const uomConversions = itemDetails?.uom_conversions || item.uom_conversions || [];
        
        // Get base price_list_rate from item details
        let priceListRate = itemDetails?.item_prices?.[0]?.price_list_rate 
          || itemDetails?.price_list_rate 
          || item.price_list_rate;
        
        // If price_list_rate not found, reverse-convert current price to stock UOM
        if (!priceListRate && currentUOM !== stockUOM && currentPrice) {
          const currentConv = uomConversions.find(conv => conv.uom === currentUOM);
          if (currentConv?.conversion_factor) {
            priceListRate = currentPrice / currentConv.conversion_factor;
          } else {
            priceListRate = currentPrice; // Fallback if no conversion factor
          }
        } else if (!priceListRate) {
          priceListRate = currentPrice; // Use current price as fallback
        }
        
        return {
          code: itemCode,
          name: item.name || item.item_name,
          price: to2(currentPrice), // Keep current price as displayed
          price_list_rate: Number(to2(priceListRate)), // Store base price_list_rate for UOM conversions
          uom: currentUOM,
          stock_uom: stockUOM,
          sales_uom: itemDetails?.sales_uom || itemDetails?.stock_uom || item.sales_uom || item.stock_uom || stockUOM,
          uom_conversions: uomConversions,
          stock: item.stock ?? 0,
          quantity: (item.quantity ?? item.qty ?? 1).toString(),
          originalPrice: Number(to2(priceListRate)) // Store original price_list_rate
        };
      }));

      // Set customer (SalesModule expects selectedCustomer as customer.id)
      const foundCustomer = customers.find(c => c.name === details.customerName || c.name === details.customer || c.id === details.customerId);
      if (foundCustomer) {
        setSelectedCustomer(foundCustomer.id);
        setCustomerSearch(foundCustomer.custom_customer_name_english || foundCustomer.name);
      } else {
        // Fallback: keep selection empty, but allow user to re-select
        setSelectedCustomer('');
        setCustomerSearch(details.customerEnglishName || details.customerName || details.customer || '');
      }

      setInvoiceItems(itemsForForm);
      setDiscountAmount((details.discount ?? details.discount_amount ?? 0).toString());
      
      // Load payment method if invoice has included payment
      if (details.is_pos && details.payments && details.payments.length > 0) {
        const firstPayment = details.payments[0];
        setSelectedPaymentMethod(firstPayment.mode_of_payment || '');
      } else {
        setSelectedPaymentMethod('');
      }

      setEditingInvoice(invoiceName);
      setView('create');
    } catch (error) {
      console.error('Error loading invoice for editing:', error);
      setErrorDialog({
        isOpen: true,
        title: 'Error Loading Invoice',
        message: cleanErrorMessage(error)
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleViewDetails = async (sale) => {
    setSelectedInvoice(sale);
    setLoadingDetails(true);
    setView('detail');
    
    try {
      // Get invoice name from sale object - check multiple possible fields
      const invoiceName = sale.id || sale.invoice_name || sale.name || sale.invoiceName;
      
      if (!invoiceName) {
        console.warn('No invoice name found in sale object:', sale);
        // Fallback to local sale data if no invoice name
        setInvoiceDetails(sale);
        setErrorDialog({
          isOpen: true,
          title: 'Warning',
          message: 'Invoice name not found. Showing available information.'
        });
        return;
      }
      
      // Fetch full invoice details from API using invoice name
      const details = await getInvoiceDetails(invoiceName);
      setInvoiceDetails(details);
    } catch (error) {
      console.error('Error fetching invoice details:', error);
      // Fallback to local sale data if API fails
      setInvoiceDetails(sale);
      setErrorDialog({
        isOpen: true,
        title: 'Warning',
        message: 'Could not fetch full invoice details. Showing available information.'
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleSubmitInvoice = async () => {
    const invoice = invoiceDetails || selectedInvoice;
    if (!invoice) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'No invoice selected'
      });
      return;
    }

    // Get invoice name from invoice object
    const invoiceName = invoice.id || invoice.invoice_name || invoice.name;
    if (!invoiceName) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'Invoice name not found. Cannot submit invoice.'
      });
      return;
    }

    // Check if already submitted
    if (invoice.status === 'Submitted' || invoice.status === 'submitted') {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'This invoice is already submitted.'
      });
      return;
    }

    // Show confirmation dialog
    setConfirmationDialog({
      isOpen: true,
      title: 'Confirm Submission',
      message: 'Are you sure you want to submit this invoice? This action cannot be undone.',
      onConfirm: async () => {
        setConfirmationDialog({ isOpen: false, title: '', message: '', onConfirm: null, onCancel: null });
        setSubmittingInvoice(true);
        try {
          await submitSalesInvoice(invoiceName);
          
          // Refresh invoice details after submission
          const updatedDetails = await getInvoiceDetails(invoiceName);
          setInvoiceDetails(updatedDetails);
          
          // Update the status in the local invoice object
          if (selectedInvoice) {
            setSelectedInvoice({ ...selectedInvoice, status: 'Submitted' });
          }
          
          // Show success dialog
          setSuccessDialog({
            isOpen: true,
            title: 'Success',
            message: 'Invoice submitted successfully!'
          });
          
          // Note: Sales list will be refreshed when user navigates back to it
        } catch (error) {
          console.error('Error submitting invoice:', error);
          const errorMsg = cleanErrorMessage(error);
          
          // Show error dialog
          setErrorDialog({
            isOpen: true,
            title: 'Error Submitting Invoice',
            message: errorMsg
          });
        } finally {
          setSubmittingInvoice(false);
        }
      },
      onCancel: () => {
        setConfirmationDialog({ isOpen: false, title: '', message: '', onConfirm: null, onCancel: null });
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === selectedCustomer);
    
    if (!customer || invoiceItems.length === 0) {
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: 'Please select a customer and add items'
      });
      return;
    }

    // Validate that all items have a valid price
    const itemsWithInvalidPrice = invoiceItems.filter(item => {
      const priceStr = item.price;
      
      // Check if price is missing, null, undefined, or empty string
      if (priceStr === null || priceStr === undefined || priceStr === '') {
        return true;
      }
      
      // Check if it's a string that's empty after trimming
      if (typeof priceStr === 'string' && priceStr.trim() === '') {
        return true;
      }
      
      // Try to parse the price
      const priceNum = parseFloat(priceStr);
      
      // Check if parsing failed or resulted in NaN, Infinity, or non-positive number
      if (isNaN(priceNum) || !isFinite(priceNum) || priceNum <= 0) {
        return true;
      }
      
      return false;
    });

    if (itemsWithInvalidPrice.length > 0) {
      const itemNames = itemsWithInvalidPrice.map(item => item.name || item.code || 'Unknown Item').join(', ');
      const errorMessage = `Please enter a valid price for all items. Missing or invalid price for: ${itemNames}`;
      
      // Show error dialog
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: errorMessage
      });
      return;
    }

    setSubmitting(true);

    const today = new Date().toISOString().split('T')[0];
    
    // Prepare invoice data in UI format (will be transformed by API service); price to 2 decimals
    const round2 = (v) => Math.round(Number(v) * 100) / 100;
    const formattedItems = invoiceItems.map(item => {
      const price = round2(getPriceValue(item.price));
      const quantity = getQuantityValue(item.quantity);
      const selectedUOM = item.uom || item.stock_uom || '';
      return {
        code: item.code,
        name: item.name,
        quantity,
        price,
        total: round2(price * quantity),
        uom: selectedUOM,
        sales_uom: selectedUOM, // Set to selected UOM
        stock_uom: selectedUOM // Set to selected UOM
      };
    });

    const grandTotal = calculateTotal();
    const invoiceData = {
      customer: customer.name, // Use customer name for API
      customerName: customer.name,
      customerId: customer.id,
      date: today,
      dueDate: today, // Can be calculated later
      items: formattedItems,
      subtotal: calculateSubtotal(),
      discount: calculateDiscount(),
      discount_amount: calculateDiscount(),
      tax: calculateTax(),
      total: grandTotal
    };

    // If payment method is selected, add included payment (is_pos = 1 and payments table)
    // Note: Amount will be recalculated by backend based on final grand_total after taxes
    if (selectedPaymentMethod) {
      invoiceData.is_pos = 1;
      invoiceData.mode_of_payment = selectedPaymentMethod; // Top-level fallback for backend
      invoiceData.payments = [{
        mode_of_payment: selectedPaymentMethod,
        amount: grandTotal  // Will be adjusted by backend to match final grand_total
      }];
    }

    try {
      let result;
      let invoiceName;

      if (editingInvoice) {
        // Update existing invoice
        const minimalUpdate = {
          invoice_name: editingInvoice,
          discount_amount: invoiceData.discount_amount,
          items: formattedItems
        };
        // Include payment if selected
        if (selectedPaymentMethod) {
          minimalUpdate.is_pos = 1;
          minimalUpdate.mode_of_payment = selectedPaymentMethod;
          minimalUpdate.payments = [{
            mode_of_payment: selectedPaymentMethod,
            amount: grandTotal
          }];
        }
        result = await updateSalesInvoice(minimalUpdate);
        invoiceName = editingInvoice;
      } else {
        // Create new invoice
        result = await createSalesInvoice(invoiceData);
        // Extract invoice_name from response - API returns "invoice_name" in various possible locations
        invoiceName = result.invoice_name 
          || result.message?.invoice_name 
          || result.message?.data?.invoice_name
          || result.data?.invoice_name
          || result.name 
          || result.message?.name
          || result.message?.data?.name;
      }
      
      // Add to local state in UI format
      const createdSale = {
        customerId: customer.id,
        customerName: customer.name,
        date: today,
        items: formattedItems,
        subtotal: calculateSubtotal(),
        discount: calculateDiscount(),
        tax: calculateTax(),
        total: calculateTotal(),
        id: invoiceName || `INV-${String(sales.length + 1).padStart(3, '0')}`,
        invoice_name: invoiceName, // Store invoice_name from API
        name: invoiceName, // Also store as name for compatibility
        status: result?.docstatus === 1 ? 'Submitted' : 'Draft'
      };

      onAddSale(createdSale);

      // Fetch full invoice details when possible; fall back to createdSale
      let detailData = createdSale;
      if (invoiceName) {
        try {
          const fetchedDetails = await getInvoiceDetails(invoiceName);
          detailData = fetchedDetails || createdSale;
        } catch (err) {
          console.warn('Could not fetch invoice details after create:', err);
        }
      }

      setSelectedInvoice(detailData);
      setInvoiceDetails(detailData);

      // Reset form inputs but stay on detail view
        setSelectedCustomer('');
        setInvoiceItems([]);
        setDiscountAmount('0');
        setSelectedPaymentMethod('');
        setEditingInvoice(null);
        setView('detail');
    } catch (error) {
      console.error('Error creating sale:', error);
      // Don't change view on error - stay on create view to show error
      if (error.message === 'OFFLINE') {
        // Queue for background sync - keep alert for offline message
        const queuedSale = {
          customerId: customer.id,
          customerName: customer.name,
          date: today,
          items: formattedItems,
          subtotal: calculateSubtotal(),
          discount: calculateDiscount(),
          tax: calculateTax(),
          total: calculateTotal(),
          id: `INV-${String(sales.length + 1).padStart(3, '0')}`,
          status: 'Draft (Offline)',
          _queued: true
        };
        onAddSale(queuedSale);
        setSelectedInvoice(queuedSale);
        setInvoiceDetails(queuedSale);
        setSuccessDialog({
          isOpen: true,
          title: 'Saved Offline',
          message: 'Sale saved offline. It will be synced when connection is restored.'
        });
        setSelectedCustomer('');
        setInvoiceItems([]);
        setDiscountAmount('0');
        setView('detail');
      } else {
        // Show error in alert dialog - DON'T change view, stay on create view
        const errorMsg = cleanErrorMessage(error);
        setErrorDialog({
          isOpen: true,
          title: 'Error Creating Invoice',
          message: errorMsg
        });
        // Don't navigate away - keep user on create view to see error
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Error Dialog - render at top level so it's always visible
  const errorDialogElement = (
    <ErrorDialog
      isOpen={errorDialog.isOpen}
      onClose={() => setErrorDialog({ isOpen: false, title: '', message: '' })}
      title={errorDialog.title}
      message={errorDialog.message}
    />
  );

  // Confirmation Dialog - render at top level so it's always visible
  const confirmationDialogElement = (
    <ConfirmationDialog
      isOpen={confirmationDialog.isOpen}
      onClose={() => setConfirmationDialog({ isOpen: false, title: '', message: '', onConfirm: null, onCancel: null })}
      onConfirm={confirmationDialog.onConfirm}
      onCancel={confirmationDialog.onCancel}
      title={confirmationDialog.title}
      message={confirmationDialog.message}
    />
  );

  // Success Dialog - render at top level so it's always visible
  const successDialogElement = (
    <SuccessDialog
      isOpen={successDialog.isOpen}
      onClose={() => setSuccessDialog({ isOpen: false, title: '', message: '' })}
      title={successDialog.title}
      message={successDialog.message}
    />
  );

  if (view === 'create') {
    return (
      <>
      <div className="sales-create fade-in">
        <div className="flex-between mb-6">
          <h1>New Sale</h1>
          <button className="btn btn-secondary" onClick={() => {
            setView('list');
            setInvoiceItems([]);
            setSelectedCustomer('');
            setDiscountAmount('0');
          }}>
            Back to List
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="card mb-4">
            <div className="flex-between mb-4">
              <h3 className="mb-0">Customer Selection</h3>
              {!showQuickCustomerForm && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowQuickCustomerForm(true)}
                >
                  <Plus size={16} />
                  Create New Customer
                </button>
              )}
            </div>
            
            {showQuickCustomerForm && (
              <div className="card mb-4" style={{ backgroundColor: 'var(--gray-50)', border: '1px solid var(--primary)' }}>
                <div className="flex-between mb-4">
                  <h4 style={{ margin: 0, color: 'var(--primary)' }}>Quick Customer Creation</h4>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setShowQuickCustomerForm(false);
                      setQuickCustomerFormData({ custom_customer_name_arabic: '', custom_vat_registration_number: '' });
                      setQuickCustomerVatError('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <div>
                  <div className="grid grid-2 gap-4">
                    <div className="form-group">
                      <label className="form-label">Customer Name *</label>
                      <input
                        type="text"
                        name="customer_name_arabic"
                        className="form-input"
                        value={quickCustomerFormData.custom_customer_name_arabic}
                        onChange={handleQuickCustomerChange}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">VAT Number</label>
                      <input
                        type="text"
                        name="custom_vat_registration_number"
                        className="form-input"
                        value={quickCustomerFormData.custom_vat_registration_number}
                        onChange={handleQuickCustomerChange}
                        placeholder="Enter 15-digit VAT number"
                        maxLength={15}
                        pattern="[0-9]{15}"
                        inputMode="numeric"
                      />
                      {quickCustomerVatError && (
                        <div className="text-sm" style={{ color: 'var(--danger)', marginTop: '0.25rem' }}>
                          {quickCustomerVatError}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3 mt-4">
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={handleCreateQuickCustomer}
                      disabled={submittingQuickCustomer}
                    >
                      {submittingQuickCustomer ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus size={16} />
                          Create Customer
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowQuickCustomerForm(false);
                        setQuickCustomerFormData({ custom_customer_name_arabic: '', custom_vat_registration_number: '' });
                        setQuickCustomerVatError('');
                      }}
                      disabled={submittingQuickCustomer}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            <div className="form-group customer-search-container" style={{ position: 'relative' }}>
              <label className="form-label">Select Customer *</label>
              <div className="text-xs text-gray-500 mb-1">Showing customers assigned to you</div>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  <Search 
                    size={18} 
                    style={{ 
                      position: 'absolute', 
                      left: '12px', 
                      top: '50%', 
                      transform: 'translateY(-50%)', 
                      color: 'var(--gray-400)',
                      pointerEvents: 'none'
                    }} 
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search customer by English name, mobile, or email..."
                    value={customerSearch}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setCustomerSearch(newValue);
                      // Clear selected customer when user starts typing/editing
                      if (selectedCustomer) {
                        setSelectedCustomer('');
                      }
                    }}
                    onFocus={() => {
                      if (!selectedCustomer && (customerSearch || customers.length > 0)) {
                        setShowCustomerResults(true);
                      }
                    }}
                    style={{ paddingLeft: '40px' }}
                    required={!selectedCustomer}
                    autoComplete="off"
                  />
                </div>
                
                {showCustomerResults && !selectedCustomer && (customerSearch || filteredCustomers.length > 0 || customers.length > 0) && (
                  <div 
                    className="card" 
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: '4px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      zIndex: 1000,
                      boxShadow: 'var(--shadow-lg)',
                      padding: 0
                    }}
                  >
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map(customer => (
                        <div
                          key={customer.id}
                          onClick={() => {
                            const customerName = customer.custom_customer_name_english || customer.name;
                            setSelectedCustomer(customer.id);
                            setCustomerSearch(customerName);
                            setShowCustomerResults(false);
                          }}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gray-100)',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.target.style.background = 'var(--gray-50)'}
                          onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                            {customer.custom_customer_name_english || customer.name}
                          </div>
                          {customer.custom_customer_name_arabic && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '2px' }}>
                              {customer.custom_customer_name_arabic}
                            </div>
                          )}
                          {customer.email && (
                            <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                              ✉️ {customer.email}
                            </div>
                          )}
                        </div>
                      ))
                    ) : customerSearch ? (
                      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray-500)' }}>
                        No customers found matching "{customerSearch}"
                      </div>
                    ) : !customerSearch && customers.length > 0 ? (
                      customers.slice(0, 10).map(customer => (
                        <div
                          key={customer.id}
                          onClick={() => {
                            const customerName = customer.custom_customer_name_english || customer.name;
                            setSelectedCustomer(customer.id);
                            setCustomerSearch(customerName);
                            setShowCustomerResults(false);
                          }}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gray-100)',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.target.style.background = 'var(--gray-50)'}
                          onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                            {customer.custom_customer_name_english || customer.name}
                          </div>
                          {customer.custom_customer_name_arabic && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '2px' }}>
                              {customer.custom_customer_name_arabic}
                            </div>
                          )}
                        {customer.email && (
                          <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                            ✉️ {customer.email}
                          </div>
                        )}
                        </div>
                      ))
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {selectedCustomer && (() => {
              const customer = customers.find(c => c.id === selectedCustomer);
              return (
                <div style={{ padding: '1rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-lg)', marginTop: '1rem' }}>
                  <div className="grid grid-3 gap-4">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Customer Name</div>
                      <div className="font-semibold">{customer.custom_customer_name_english || customer.name}</div>
                      {customer.custom_customer_name_arabic && (
                        <div className="text-xs text-gray-500 mt-1">{customer.custom_customer_name_arabic}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Customer Group</div>
                      <div className="font-semibold">{customer.customer_group || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">VAT Number</div>
                      <div className="font-semibold">{customer.custom_vat_registration_number || '—'}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {selectedCustomer && (
            <>
              <div className="card mb-4">
                <h3 className="mb-4">Add Items</h3>
                <div className="form-group" style={{ position: 'relative' }} ref={itemDropdownRef}>
                  <label className="form-label">Search Item by Code or Name</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={itemSearch}
                      onChange={(e) => {
                        setItemSearch(e.target.value);
                        if (!showResults) {
                          setShowResults(true);
                        }
                      }}
                      onFocus={() => {
                        if (!showResults) {
                          setShowResults(true);
                        }
                        if (!itemSearch.trim()) {
                          setSearchResults(items.slice(0, 20));
                        }
                      }}
                      placeholder="Type item code or name..."
                      style={{ paddingRight: '3rem' }}
                    />
                    <Search size={20} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
                  </div>

                  {loadingSearch && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: 'white',
                      border: '2px solid var(--primary)',
                      borderRadius: 'var(--radius-lg)',
                      marginTop: '0.5rem',
                      padding: '1rem',
                      zIndex: 1000,
                      boxShadow: 'var(--shadow-lg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem'
                    }}>
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">Searching...</span>
                    </div>
                  )}
                  {showResults && !loadingSearch && (
                    <div
                      className="card"
                      style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: 'white',
                      border: '2px solid var(--primary)',
                      borderRadius: 'var(--radius-lg)',
                      marginTop: '0.5rem',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      zIndex: 1000,
                      boxShadow: 'var(--shadow-lg)'
                    }}>
                      {searchResults.length > 0 ? searchResults.map(item => (
                        <div
                          key={item.code || item.item_code}
                          onClick={() => handleAddItem(item)}
                          style={{
                            padding: '1rem',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gray-200)',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                        >
                            <div>
                              <div className="font-semibold">{item.name || item.item_name}</div>
                              <div className="text-sm text-gray-600">
                              Code: {item.code || item.item_code} | UOM: {item.uom || 'Unit'}
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--gray-500)' }}>
                          No items found{itemSearch ? ` for "${itemSearch}"` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {invoiceItems.length > 0 && (
                <div className="card mb-4">
                  <h3 className="mb-4">Invoice Items</h3>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Item Name</th>
                          <th>Price</th>
                          <th>Qty</th>
                          <th>UOM</th>
                          <th>Total</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceItems.map(item => {
                          const priceValue = getPriceValue(item.price);
                          const quantityValue = getQuantityValue(item.quantity);
                          const itemTotal = priceValue * quantityValue;
                          return (
                            <tr key={item.code}>
                              <td className="font-semibold">{item.code}</td>
                              <td>{item.name}</td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="form-input"
                                  value={item.price}
                                  onChange={(e) => handleUpdatePrice(item.code, e.target.value)}
                                  onBlur={() => handlePriceBlur(item.code)}
                                  placeholder="0.00"
                                  style={{ width: '110px' }}
                                  required
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="form-input"
                                  value={item.quantity}
                                  onChange={(e) => handleUpdateQuantity(item.code, e.target.value)}
                                  placeholder="1"
                                  style={{ width: '80px' }}
                                />
                              </td>
                              <td>
                                <select
                                  className="form-select"
                                  value={item.uom || item.stock_uom || (getAvailableUOMs(item)[0] || '')}
                                  onChange={(e) => handleUpdateUOM(item.code, e.target.value)}
                                  style={{ width: '100px', padding: '6px 8px' }}
                                >
                                  {getAvailableUOMs(item).map(uom => (
                                    <option key={uom} value={uom}>{uom}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="font-bold"><SARSymbol size={16} /> {itemTotal.toFixed(2)}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(item.code)}
                                  className="btn btn-danger btn-sm"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="5" className="text-right font-bold">Subtotal:</td>
                          <td colSpan="2" className="font-bold"><SARSymbol size={16} /> {calculateSubtotal().toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td colSpan="5" className="text-right font-bold">Discount:</td>
                          <td colSpan="2" style={{ padding: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-start' }}>
                              <span style={{ color: 'var(--gray-600)' }}>-</span>
                              <SARSymbol size={16} />
                              <input
                                type="text"
                                inputMode="decimal"
                                className="form-input"
                                value={discountAmount}
                                onChange={(e) => handleUpdateDiscountAmount(e.target.value)}
                                placeholder="0.00"
                                style={{ 
                                  width: '100px', 
                                  textAlign: 'left',
                                  fontWeight: 'bold',
                                  padding: '4px 8px'
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td colSpan="5" className="text-right font-bold">Tax (15%):</td>
                          <td colSpan="2" className="font-bold"><SARSymbol size={16} /> {calculateTax().toFixed(2)}</td>
                        </tr>
                        <tr style={{ borderTop: '2px solid var(--primary)' }}>
                          <td colSpan="5" className="text-right font-bold" style={{ fontSize: '1.125rem' }}>TOTAL:</td>
                          <td colSpan="2" className="font-bold" style={{ fontSize: '1.25rem', color: 'var(--primary)' }}>
                            <SARSymbol size={16} /> {calculateTotal().toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Payment Method Selection */}
                  <div className="form-group mt-4" style={{ padding: '16px', background: 'var(--gray-50)', borderRadius: 'var(--radius-lg)' }}>
                    <label className="form-label" style={{ marginBottom: '8px' }}>
                      Payment Method
                    </label>
                    <select
                      className="form-select"
                      value={selectedPaymentMethod}
                      onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                      style={{ width: '100%', maxWidth: '400px' }}
                    >
                      <option value="">Credit</option>
                      {paymentMethods.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                    {selectedPaymentMethod && (
                      <div className="text-sm" style={{ marginTop: '8px', color: 'var(--success)', fontWeight: 500 }}>
                        ✓ Payment will be included: Full amount ({calculateTotal().toFixed(2)}) will be allocated to {selectedPaymentMethod}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 mt-4">
                    <button type="submit" className="btn btn-success" disabled={submitting || loadingItem}>
                      {submitting ? (
                        <>
                          <Loader2 size={20} className="animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save size={20} />
                          Save Sale
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </form>
      </div>
      {errorDialogElement}
      {confirmationDialogElement}
      {successDialogElement}
      </>
    );
  }

  // Detail View
  if (view === 'detail') {
    const invoice = invoiceDetails || selectedInvoice;
    
    return (
      <>
      <div className="sales-detail fade-in">
        <div className="flex-between mb-6">
          <div>
            <button 
              className="btn btn-secondary mb-4"
              onClick={() => setView('list')}
            >
              ← Back to Sales
            </button>
            <h1>Invoice Details</h1>
          </div>
        </div>

        {loadingDetails ? (
          <div className="card">
            <div className="empty-state">
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
              <div className="empty-state-title mt-4">Loading invoice details...</div>
            </div>
          </div>
        ) : invoice ? (
          <div className="card">
            {/* Invoice Header */}
            <div className="mb-6" style={{ borderBottom: '2px solid var(--gray-200)', paddingBottom: '20px' }}>
              <div className="flex-between mb-4">
                <div>
                  <h2 style={{ margin: 0, color: 'var(--primary)' }}>{invoice.invoice_name || invoice.id || invoice.name}</h2>
                  <div className="text-sm text-gray-600 mt-1">
                    Status: <span className="badge badge-primary">{invoice.status || 'Draft'}</span>
                  </div>
                </div>
                <div className="text-right">
                  {invoice.docstatus === 1 && (() => {
                    const invoiceName = invoice.invoice_name || invoice.id || invoice.name;
                    return invoiceName ? (
                      <div style={{ marginBottom: '12px' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openPrintPdf('Sales Invoice', invoiceName, invoice.letter_head).catch((e) => alert(e?.message || 'Print failed'))}
                          title="Print (default format with letterhead)"
                        >
                          🖨️ Print Invoice
                        </button>
                      </div>
                    ) : null;
                  })()}
                  <div className="text-sm text-gray-600">Date</div>
                  <div className="font-semibold">{formatDate(invoice.date || invoice.posting_date)}</div>
                  {invoice.dueDate && (
                    <>
                      <div className="text-sm text-gray-600 mt-2">Due Date</div>
                      <div className="font-semibold">{formatDate(invoice.dueDate || invoice.due_date)}</div>
                    </>
                  )}
                </div>
              </div>

              {/* Customer Info */}
              <div className="mb-4">
                <h3 className="mb-2" style={{ fontSize: '1rem', color: 'var(--gray-700)' }}>Customer Information</h3>
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="font-semibold">
                    {invoice.customerEnglishName || invoice.customerName || invoice.customer}
                  </div>
                  {invoice.customerArabicName && (
                    <div className="text-sm text-gray-500 mt-1">{invoice.customerArabicName}</div>
                  )}
                  {invoice.customerMobile && (
                    <div className="text-sm text-gray-600 mt-1">📱 {invoice.customerMobile}</div>
                  )}
                  {invoice.customerEmail && (
                    <div className="text-sm text-gray-600 mt-1">✉️ {invoice.customerEmail}</div>
                  )}
                </div>
              </div>

              {/* Payment Method: show from payments table (POS) or custom_mode_of_payment, else Credit */}
              {(() => {
                const paymentLabel = (invoice.is_pos && invoice.payments && invoice.payments.length > 0)
                  ? invoice.payments.map((p) => p.mode_of_payment || p.payment_method).filter(Boolean).join(', ')
                  : (invoice.custom_mode_of_payment && String(invoice.custom_mode_of_payment).trim()) || '';
                const displayMethod = paymentLabel || 'Credit';
                return (
                  <div className="mb-4">
                    <h3 className="mb-2" style={{ fontSize: '1rem', color: 'var(--gray-700)' }}>Payment Method</h3>
                    <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                      <div className="font-semibold">{displayMethod}</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Invoice Items */}
            <div className="mb-6">
              <h3 className="mb-4" style={{ fontSize: '1rem', color: 'var(--gray-700)' }}>Items</h3>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Item Name</th>
                      <th>Qty</th>
                      <th>UOM</th>
                      <th>Rate</th>
                      <th>Discount</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoice.items || []).map((item, index) => {
                      const itemTotal = ((item.price || item.rate || 0) * (item.quantity || item.qty || 1)) - (item.discount || 0);
                      return (
                        <tr key={item.code || item.item_code || index}>
                          <td className="font-semibold">{item.code || item.item_code}</td>
                          <td>{item.name || item.item_name}</td>
                          <td>{item.quantity || item.qty || 1}</td>
                          <td>{item.uom || '-'}</td>
                          <td><SARSymbol size={16} /> {(item.price || item.rate || 0).toFixed(2)}</td>
                          <td><SARSymbol size={16} /> {(item.discount || 0).toFixed(2)}</td>
                          <td className="font-semibold"><SARSymbol size={16} /> {itemTotal.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="5" className="text-right font-semibold">Subtotal:</td>
                      <td colSpan="2" className="font-semibold">
                        <SARSymbol size={16} /> {(invoice.subtotal || invoice.net_total || 0).toFixed(2)}
                      </td>
                    </tr>
                    {invoice.discount > 0 && (
                      <tr>
                        <td colSpan="5" className="text-right">Discount:</td>
                        <td colSpan="2"><SARSymbol size={16} /> {(invoice.discount || 0).toFixed(2)}</td>
                      </tr>
                    )}
                    <tr>
                      <td colSpan="5" className="text-right">Tax (15%):</td>
                      <td colSpan="2"><SARSymbol size={16} /> {(invoice.tax || invoice.total_taxes_and_charges || 0).toFixed(2)}</td>
                    </tr>
                    <tr style={{ borderTop: '2px solid var(--primary)' }}>
                      <td colSpan="5" className="text-right font-bold" style={{ fontSize: '1.125rem' }}>TOTAL:</td>
                      <td colSpan="2" className="font-bold" style={{ fontSize: '1.25rem', color: 'var(--primary)' }}>
                        <SARSymbol size={16} /> {(invoice.total || invoice.grand_total || 0).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              {(invoice.status === 'Draft' || invoice.status === 'draft' || !invoice.status || (invoice.docstatus !== undefined && invoice.docstatus === 0)) && (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={handleEditInvoice}
                    disabled={submittingInvoice || loadingDetails}
                  >
                    Edit Invoice
                  </button>
                <button 
                  className="btn btn-success"
                  onClick={handleSubmitInvoice}
                  disabled={submittingInvoice}
                >
                  {submittingInvoice ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Check size={20} />
                      Submit Invoice
                    </>
                  )}
                </button>
                </>
              )}
              <button 
                className="btn btn-secondary"
                onClick={() => setView('list')}
              >
                Back to List
              </button>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">❌</div>
              <div className="empty-state-title">Invoice not found</div>
              <button 
                className="btn btn-primary mt-4"
                onClick={() => setView('list')}
              >
                Back to Sales
              </button>
            </div>
          </div>
        )}
      </div>
      {errorDialogElement}
      {confirmationDialogElement}
      {successDialogElement}
      </>
    );
  }

  return (
    <>
    <div className="sales-list fade-in">
      <div className="flex-between mb-6">
        <h1>Sales Invoices</h1>
        <button className="btn btn-primary" onClick={() => setView('create')}>
          <Plus size={20} />
          New Sale
        </button>
      </div>

      {loadingSales || loadingCustomers || loadingItems ? (
        <div className="card">
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading sales data...</div>
          </div>
        </div>
      ) : sales.length > 0 || invoiceSearch.trim() ? (
        <div className="card">
          <div className="mb-4">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Search Invoices</label>
              <div style={{ position: 'relative' }}>
                <Search 
                  size={18} 
                  style={{ 
                    position: 'absolute', 
                    left: '12px', 
                    top: '50%', 
                    transform: 'translateY(-50%)', 
                    color: 'var(--gray-400)',
                    pointerEvents: 'none'
                  }} 
                />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by customer English name or invoice ID (searches all your invoices)..."
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  style={{ paddingLeft: '40px' }}
                />
              </div>
            </div>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingInvoiceSearch ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                      <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto', display: 'block' }} />
                      <span className="text-muted">Searching invoices...</span>
                    </td>
                  </tr>
                ) : (() => {
                  const isSearching = !!invoiceSearch.trim();
                  const list = isSearching ? invoiceSearchResults : sales;
                  const sorted = list.slice().sort((a, b) => {
                    const dateA = new Date(a.date);
                    const dateB = new Date(b.date);
                    return dateB - dateA;
                  });
                  if (isSearching && sorted.length === 0) {
                    return (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }} className="text-muted">
                          No matching invoices
                        </td>
                      </tr>
                    );
                  }
                  return sorted.map(sale => (
                    <tr 
                      key={sale.id}
                      onClick={() => handleViewDetails(sale)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <td className="font-semibold">{sale.id}</td>
                      <td>{formatDate(sale.date)}</td>
                      <td>
                        {(() => {
                          let customerEnglishName = sale.customerEnglishName;
                          if (!customerEnglishName && sale.customerId) {
                            const customer = customers.find(c => c.id === sale.customerId);
                            customerEnglishName = customer?.custom_customer_name_english || '';
                          }
                          if (!customerEnglishName && sale.customerName) {
                            const customer = customers.find(c => c.name === sale.customerName);
                            customerEnglishName = customer?.custom_customer_name_english || '';
                          }
                          return customerEnglishName || sale.customerName || '-';
                        })()}
                      </td>
                      <td className="font-semibold"><SARSymbol size={16} /> {sale.total.toFixed(2)}</td>
                      <td>
                        <span className="badge badge-primary">{sale.status}</span>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🛒</div>
            <div className="empty-state-title">No sales yet</div>
            <p>Create your first sale to get started</p>
            <button className="btn btn-primary mt-4" onClick={() => setView('create')}>
              <Plus size={20} />
              Create First Sale
            </button>
          </div>
        </div>
      )}
    </div>
    {errorDialogElement}
    {confirmationDialogElement}
    {successDialogElement}
    </>
  );
}

export default SalesModule;
