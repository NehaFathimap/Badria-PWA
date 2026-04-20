import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Search, Loader2, Check } from 'lucide-react';
import ErrorDialog from './ErrorDialog';
import {
  getSalesOrderList,
  getSalesOrderDetails,
  createSalesOrder,
  updateSalesOrder,
  submitSalesOrder,
  getItemDetails,
  searchItems,
  convertSalesOrderToSalesInvoice,
} from '../services/api';
import SARSymbol from './SARSymbol';
import TransactionFormLayout from './TransactionFormLayout';
import TransactionDetailLayout from './TransactionDetailLayout';

const sanitizeDecimalInput = (value = '') => value.replace(/[^0-9.]/g, '');
const sanitizeIntegerInput = (value = '') => value.replace(/[^0-9]/g, '');
const to2 = (v) => (Number.isFinite(Number(v)) ? (Math.round(Number(v) * 100) / 100).toFixed(2) : '0.00');
const round2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);

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

function SalesOrderModule({ customers = [], items = [] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState('list');
  const [salesOrders, setSalesOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listSearch, setListSearch] = useState('');
  const [listSearchResults, setListSearchResults] = useState([]);
  const [loadingListSearch, setLoadingListSearch] = useState(false);
  const listSearchRef = useRef(null);

  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState([]);

  const [lineItems, setLineItems] = useState([]);
  const [itemSearch, setItemSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loadingItem, setLoadingItem] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('0');
  const itemDropdownRef = useRef(null);
  const [errorDialog, setErrorDialog] = useState({ isOpen: false, title: '', message: '' });

  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [poNo, setPoNo] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetail, setOrderDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingSalesOrder, setSubmittingSalesOrder] = useState(false);
  const [convertingToSalesInvoice, setConvertingToSalesInvoice] = useState(false);
  const [editingSalesOrder, setEditingSalesOrder] = useState(null);

  const getPriceValue = (v) => (Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0 ? parseFloat(v) : 0);
  const getQuantityValue = (v) => (Number.isFinite(parseFloat(v)) && parseFloat(v) > 0 ? parseFloat(v) : 1);
  const getDiscountValue = (v) => (Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0 ? parseFloat(v) : 0);
  // Format date as DD/MM/YYYY (same as Sales Invoice)
  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const calculateSubtotal = () =>
    lineItems.reduce((sum, item) => sum + getPriceValue(item.price) * getQuantityValue(item.quantity), 0);
  const calculateDiscount = () => getDiscountValue(discountAmount);
  const calculateTax = () => calculateSubtotal() * 0.15;
  const calculateTotal = () => Math.max(calculateSubtotal() + calculateTax() - calculateDiscount(), 0);

  const fetchList = async () => {
    setLoading(true);
    try {
      const { sales_orders: list } = await getSalesOrderList({ limit: 100, offset: 0 });
      setSalesOrders(Array.isArray(list) ? list : []);
    } catch (e) {
      setSalesOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, []);

  // Handle name query parameter to show detail view
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nameParam = params.get('name');
    if (nameParam && nameParam !== selectedOrder?.name) {
      setLoadingDetail(true);
      getSalesOrderDetails(nameParam)
        .then((result) => {
          const doc = result.sales_order || result;
          setSelectedOrder({ name: nameParam });
          setOrderDetail(doc);
          setView('detail');
        })
        .catch(() => {
          // If error, stay on list view
        })
        .finally(() => setLoadingDetail(false));
    }
  }, [location.search]);

  useEffect(() => {
    const term = listSearch.trim();
    if (!term) {
      setListSearchResults([]);
      setLoadingListSearch(false);
      if (listSearchRef.current) clearTimeout(listSearchRef.current);
      return;
    }
    if (listSearchRef.current) clearTimeout(listSearchRef.current);
    listSearchRef.current = setTimeout(() => {
      listSearchRef.current = null;
      setLoadingListSearch(true);
      getSalesOrderList({ limit: 100, offset: 0, search: term })
        .then(({ sales_orders: list }) => setListSearchResults(Array.isArray(list) ? list : []))
        .catch(() => setListSearchResults([]))
        .finally(() => setLoadingListSearch(false));
    }, 350);
    return () => { if (listSearchRef.current) clearTimeout(listSearchRef.current); };
  }, [listSearch]);

  useEffect(() => {
    if (customerSearch.trim()) {
      const filtered = (customers || []).filter(
        (c) =>
          (c.name || '').toLowerCase().includes(customerSearch.toLowerCase()) ||
          (c.custom_customer_name_english || '').toLowerCase().includes(customerSearch.toLowerCase()) ||
          (c.mobile || '').toLowerCase().includes(customerSearch.toLowerCase()) ||
          (c.email || '').toLowerCase().includes(customerSearch.toLowerCase())
      );
      setFilteredCustomers(filtered);
      if (!selectedCustomer) setShowCustomerResults(true);
    } else {
      setFilteredCustomers([]);
      if (!selectedCustomer) setShowCustomerResults(false);
    }
  }, [customerSearch, customers, selectedCustomer]);

  useEffect(() => {
    if (!selectedCustomer) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const query = itemSearch.trim().toLowerCase();
    const sortByCode = (results, term) => {
      if (!term) return results;
      return [...results].sort((a, b) => {
        const aCode = (a.code || a.item_code || '').toLowerCase();
        const bCode = (b.code || b.item_code || '').toLowerCase();
        const aName = (a.name || a.item_name || '').toLowerCase();
        const bName = (b.name || b.item_name || '').toLowerCase();
        const pri = (code, name) => {
          if (code === term) return 1;
          if (code.startsWith(term)) return 2;
          if (code.includes(term)) return 3;
          if (name.startsWith(term)) return 4;
          if (name.includes(term)) return 5;
          return 99;
        };
        return pri(aCode, aName) - pri(bCode, bName);
      });
    };
    if (!query) {
      setLoadingSearch(false);
      setSearchResults(sortByCode((items || []).slice(0, 20), ''));
      return;
    }
    setLoadingSearch(true);
    const t = setTimeout(() => {
      searchItems(itemSearch)
        .then((results) => {
          if (results?.length) setSearchResults(sortByCode(results, query));
          else setSearchResults(sortByCode((items || []).filter((i) => (i.code || '').toLowerCase().includes(query) || (i.name || '').toLowerCase().includes(query)), query));
        })
        .catch(() => setSearchResults(sortByCode((items || []).filter((i) => (i.code || '').toLowerCase().includes(query) || (i.name || '').toLowerCase().includes(query)), query)))
        .finally(() => setLoadingSearch(false));
    }, 500);
    return () => clearTimeout(t);
  }, [itemSearch, items, selectedCustomer]);

  useEffect(() => {
    const handleClick = (e) => {
      if (showResults && itemDropdownRef.current && !itemDropdownRef.current.contains(e.target)) setShowResults(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showResults]);

  useEffect(() => {
    const handleClick = (e) => {
      if (showCustomerResults && !e.target.closest('.customer-search-container')) setShowCustomerResults(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCustomerResults]);

  const handleAddItem = async (item) => {
    const code = item.code || item.item_code;
    const existing = lineItems.find((i) => i.code === code);
    if (existing) {
      setLineItems((prev) =>
        prev.map((i) => (i.code === code ? { ...i, quantity: String((parseFloat(i.quantity) || 1) + 1) } : i))
      );
    } else {
      setLoadingItem(true);
      try {
        const customer = customers.find((c) => c.id === selectedCustomer);
        const customerName = customer?.name || null;
        const itemDetails = await getItemDetails(code, customerName).catch(() => null);
        let priceListRate = 0;
        if (itemDetails?.item_prices?.length) priceListRate = itemDetails.item_prices[0].price_list_rate || 0;
        else if (itemDetails?.price_list_rate) priceListRate = itemDetails.price_list_rate;
        const stockUOM = itemDetails?.stock_uom;
        const salesUOM = itemDetails?.sales_uom;
        const defaultUOM = salesUOM || stockUOM; // Use actual UOMs from API, no hardcoded fallback
        const uomConversions = itemDetails?.uom_conversions || [];
        let initialPrice = priceListRate;
        if (defaultUOM && defaultUOM !== stockUOM) {
          const conv = uomConversions.find((c) => c.uom === defaultUOM);
          if (conv?.conversion_factor) initialPrice = priceListRate * conv.conversion_factor;
        }
        const newItem = {
          code: itemDetails?.code || code,
          name: itemDetails?.name || item.name,
          price: to2(initialPrice),
          price_list_rate: priceListRate,
          uom: defaultUOM || '',
          stock_uom: stockUOM || '',
          sales_uom: salesUOM || stockUOM || '',
          uom_conversions: uomConversions,
          quantity: '1',
          originalPrice: priceListRate,
        };
        setLineItems((prev) => [...prev, newItem]);
      } catch {
        const stockUOM = item.stock_uom;
        const salesUOM = item.sales_uom;
        const defaultUOM = salesUOM || stockUOM; // Use actual UOMs from API, no hardcoded fallback
        const basePrice = item.price || 0;
        const uomConversions = item.uom_conversions || [];
        let initialPrice = basePrice;
        if (defaultUOM && defaultUOM !== stockUOM) {
          const conv = uomConversions.find((c) => c.uom === defaultUOM);
          if (conv?.conversion_factor) initialPrice = basePrice * conv.conversion_factor;
        }
        setLineItems((prev) => [
          ...prev,
          {
            code: item.code || item.item_code,
            name: item.name || item.item_name,
            price: to2(initialPrice),
            price_list_rate: basePrice,
            uom: defaultUOM || '',
            stock_uom: stockUOM || '',
            sales_uom: salesUOM || stockUOM || '',
            uom_conversions: uomConversions,
            quantity: '1',
            originalPrice: basePrice,
          },
        ]);
      } finally {
        setLoadingItem(false);
      }
    }
    setItemSearch('');
    setShowResults(false);
    setSearchResults([]);
  };

  const handleUpdatePrice = (code, value) => {
    // Only sanitize while typing - do NOT round so user can backspace and type freely
    const sanitized = sanitizeDecimalInput(value);
    setLineItems((prev) => prev.map((i) => (i.code === code ? { ...i, price: sanitized } : i)));
  };
  const handlePriceBlur = (code) => {
    setLineItems((prev) => prev.map((i) => {
      if (i.code !== code) return i;
      const p = i.price;
      if (p === '' || p == null) return { ...i, price: '' };
      const num = parseFloat(String(p).replace(/[^0-9.-]/g, ''));
      if (Number.isNaN(num)) return { ...i, price: '' };
      return { ...i, price: to2(num) };
    }));
  };
  const handleUpdateQuantity = (code, value) => {
    setLineItems((prev) => prev.map((i) => (i.code === code ? { ...i, quantity: sanitizeIntegerInput(value) } : i)));
  };
  const handleUpdateUOM = (code, value) => {
    setLineItems((prev) =>
      prev.map((i) => {
        if (i.code !== code) return i;
        const priceListRate = i.price_list_rate ?? parseFloat(i.originalPrice) ?? parseFloat(i.price) ?? 0;
        const currentPrice = parseFloat(i.price) || priceListRate;
        const currentUOM = i.uom || i.stock_uom || '';
        const stockUOM = i.stock_uom || '';
        const uomConversions = i.uom_conversions || [];
        
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
        return { ...i, uom: value, price: to2(newPrice) };
      })
    );
  };
  const handleRemoveItem = (code) => setLineItems((prev) => prev.filter((i) => i.code !== code));
  const handleUpdateDiscountAmount = (value) => setDiscountAmount(sanitizeDecimalInput(value));

  const handleViewDetails = async (order) => {
    setSelectedOrder(order);
    setView('detail');
    setLoadingDetail(true);
    setOrderDetail(null);
    try {
      const detail = await getSalesOrderDetails(order.name);
      setOrderDetail(detail);
    } catch {
      setOrderDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleEditSalesOrder = async () => {
    const doc = orderDetail || selectedOrder;
    if (!doc?.name) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'No sales order selected'
      });
      return;
    }
    if (doc.docstatus !== 0) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'Only Draft sales orders can be edited'
      });
      return;
    }
    setLoadingDetail(true);
    try {
      const details = await getSalesOrderDetails(doc.name);
      const orderDoc = details.sales_order || details;
      
      // Map items into form structure
      // Fetch item details for each item to get uom_conversions and price_list_rate
      const customerName = orderDoc.customer || orderDoc.customer_name || null;
      const itemsForForm = await Promise.all((orderDoc.items || []).map(async (item) => {
        const itemCode = item.item_code || item.code;
        const currentPrice = item.rate || item.price || 0;
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
          name: item.item_name || item.name,
          price: to2(currentPrice), // Keep current price as displayed
          price_list_rate: Number(to2(priceListRate)), // Store base price_list_rate for UOM conversions
          uom: currentUOM,
          stock_uom: stockUOM,
          sales_uom: itemDetails?.sales_uom || itemDetails?.stock_uom || item.sales_uom || item.stock_uom || stockUOM,
          uom_conversions: uomConversions,
          quantity: (item.qty || item.quantity || 1).toString(),
          originalPrice: Number(to2(priceListRate)) // Store original price_list_rate
        };
      }));
      
      // Set customer selection
      const foundCustomer = customers.find(c => c.name === orderDoc.customer || c.name === orderDoc.customer_name);
      if (foundCustomer) {
        setSelectedCustomer(foundCustomer.id);
        setCustomerSearch(foundCustomer.custom_customer_name_english || foundCustomer.name);
      } else {
        setSelectedCustomer('');
        setCustomerSearch(orderDoc.customer_name || orderDoc.customer || '');
      }
      
      setLineItems(itemsForForm);
      setDiscountAmount((orderDoc.discount_amount || 0).toString());
      if (orderDoc.delivery_date) {
        setDeliveryDate(new Date(orderDoc.delivery_date).toISOString().split('T')[0]);
      }
      setPoNo(orderDoc.po_no || '');
      setEditingSalesOrder(doc.name);
      setView('create');
    } catch (error) {
      console.error('Error loading sales order for editing:', error);
      setErrorDialog({
        isOpen: true,
        title: 'Error Loading Sales Order',
        message: error.message || 'Unknown error'
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSubmitSalesOrder = async () => {
    const doc = orderDetail || selectedOrder;
    if (!doc?.name) return;
    if (doc.docstatus === 1) return;
    setSubmittingSalesOrder(true);
    try {
      await submitSalesOrder(doc.name);
      const updated = await getSalesOrderDetails(doc.name);
      setOrderDetail(updated);
      setSelectedOrder(updated);
    } catch (err) {
      console.error('Error submitting sales order:', err);
      // Extract and clean error message
      let errorMsg = 'Failed to submit sales order';
      if (err.message) {
        errorMsg = err.message.replace(/<[^>]*>/g, '').trim();
      } else if (err.response?.data?.message) {
        errorMsg = typeof err.response.data.message === 'string' 
          ? err.response.data.message.replace(/<[^>]*>/g, '').trim()
          : err.response.data.message?.message?.replace(/<[^>]*>/g, '').trim() || errorMsg;
      } else if (err.response?.data?.exc) {
        errorMsg = String(err.response.data.exc).replace(/<[^>]*>/g, '').trim();
      }
      setErrorDialog({
        isOpen: true,
        title: 'Error Submitting Sales Order',
        message: errorMsg
      });
    } finally {
      setSubmittingSalesOrder(false);
    }
  };

  const handleConvertToSalesInvoice = async () => {
    const doc = orderDetail || selectedOrder;
    if (!doc?.name) return;
    if (doc.docstatus !== 1) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'Only submitted sales orders can be converted to Sales Invoice'
      });
      return;
    }
    if (!confirm('Create a Sales Invoice from this Sales Order?')) return;
    setConvertingToSalesInvoice(true);
    try {
      const result = await convertSalesOrderToSalesInvoice(doc.name);
      const salesInvoiceName = result.name;
      if (salesInvoiceName) {
        // Navigate to Sales Invoice detail view
        navigate(`/sales?name=${salesInvoiceName}`);
      } else {
        setErrorDialog({
          isOpen: true,
          title: 'Warning',
          message: 'Sales Invoice created but name not returned'
        });
      }
    } catch (err) {
      console.error('Error converting sales order to sales invoice:', err);
      // Extract and clean error message
      let errorMsg = 'Failed to convert sales order to sales invoice';
      if (err.message) {
        errorMsg = err.message.replace(/<[^>]*>/g, '').trim();
      } else if (err.response?.data?.message) {
        errorMsg = typeof err.response.data.message === 'string' 
          ? err.response.data.message.replace(/<[^>]*>/g, '').trim()
          : err.response.data.message?.message?.replace(/<[^>]*>/g, '').trim() || errorMsg;
      } else if (err.response?.data?.exc) {
        errorMsg = String(err.response.data.exc).replace(/<[^>]*>/g, '').trim();
      }
      setErrorDialog({
        isOpen: true,
        title: 'Error Submitting Sales Order',
        message: errorMsg
      });
    } finally {
      setConvertingToSalesInvoice(false);
    }
  };

  const handleSubmitCreate = async (e) => {
    e.preventDefault();
    const customer = customers.find((c) => c.id === selectedCustomer);
    if (!customer || lineItems.length === 0) {
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: 'Please select a customer and add items'
      });
      return;
    }
    const invalidPrice = lineItems.filter((i) => {
      const priceStr = i.price;
      if (!priceStr || (typeof priceStr === 'string' && priceStr.trim() === '')) {
        return true;
      }
      const price = getPriceValue(priceStr);
      return price <= 0 || isNaN(price);
    });
    if (invalidPrice.length) {
      const itemNames = invalidPrice.map((i) => i.name || i.code || 'Unknown Item').join(', ');
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: `Please enter a valid price for: ${itemNames}`
      });
      return;
    }
    setSubmitting(true);
    try {
      const formattedItems = lineItems.map((i) => ({
        item_code: i.code,
        item_name: i.name || i.item_name || '',
        qty: getQuantityValue(i.quantity),
        rate: round2(getPriceValue(i.price)),
        uom: i.uom || i.stock_uom || '',
      }));
      
      let result;
      let orderName;
      
      if (editingSalesOrder) {
        // Update existing sales order
        result = await updateSalesOrder({
          sales_order_name: editingSalesOrder,
          customer: customer.name,
          items: formattedItems,
          delivery_date: deliveryDate || undefined,
          discount_amount: getDiscountValue(discountAmount),
          po_no: poNo || undefined,
        });
        orderName = editingSalesOrder;
      } else {
        // Create new sales order
        result = await createSalesOrder({
          customer: customer.name,
          items: formattedItems,
          delivery_date: deliveryDate || undefined,
          po_no: poNo || undefined,
        });
        orderName = result.name || result.message?.name;
      }
      
      if (orderName) {
        // Fetch details and show detail view so user can submit and print
        const detail = await getSalesOrderDetails(orderName);
        setSelectedOrder({ name: orderName });
        setOrderDetail(detail);
        setView('detail');
      } else {
        // Fallback to list if name not returned
        setView('list');
        fetchList();
      }
      // Clear form after successful create/update
      setSelectedCustomer('');
      setCustomerSearch('');
      setLineItems([]);
      setDiscountAmount('0');
      setDeliveryDate(new Date().toISOString().split('T')[0]);
      setPoNo('');
      setEditingSalesOrder(null);
    } catch (err) {
      console.error('Error creating/updating sales order:', err);
      // Extract and clean error message
      const cleanErrorMessage = (error) => {
        const stripHtml = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');
        const stripStatusPrefix = (s) => {
          if (typeof s !== 'string') return '';
          const statusCodePattern = /^(API Error:\s*\d+\s+[A-Za-z\s]+:\s*|^\d+\s+[A-Za-z\s]+:\s*)/i;
          return s.replace(statusCodePattern, '').trim();
        };
        
        if (typeof error === 'string') {
          return stripStatusPrefix(stripHtml(error)) || 'An error occurred. Please try again.';
        }
        
        if (error && typeof error === 'object') {
          // Check various error message locations
          if (error.response?.data?.message?.status === 'error' && error.response.data.message.message) {
            return stripHtml(String(error.response.data.message.message));
          }
          if (error.response?.data?.message?.message && typeof error.response.data.message.message === 'string') {
            return stripHtml(error.response.data.message.message);
          }
          if (error.response?.data?.message && typeof error.response.data.message === 'string') {
            return stripStatusPrefix(stripHtml(error.response.data.message));
          }
          if (error.response?.data?.exc) {
            return stripHtml(String(error.response.data.exc));
          }
          if (error.message) {
            return stripStatusPrefix(stripHtml(error.message));
          }
          // Try parsing _server_messages
          const serverMessagesStr = error.response?._server_messages || error.response?.data?._server_messages;
          if (serverMessagesStr) {
            try {
              const serverMessages = JSON.parse(serverMessagesStr);
              if (Array.isArray(serverMessages) && serverMessages.length > 0) {
                const msg = typeof serverMessages[0] === 'string' ? JSON.parse(serverMessages[0]) : serverMessages[0];
                if (msg?.message || msg?.title) {
                  return stripHtml(String(msg.message || msg.title));
                }
              }
            } catch {}
          }
        }
        return 'Failed to create/update sales order. Please try again.';
      };
      
      const errorMsg = cleanErrorMessage(err);
      setErrorDialog({
        isOpen: true,
        title: 'Error Submitting Sales Order',
        message: errorMsg
      });
    } finally {
      setSubmitting(false);
    }
  };

  const listToShow = listSearch.trim() ? listSearchResults : salesOrders;
  const isSearchingList = !!listSearch.trim();

  // Error Dialog - render at top level so it's always visible
  const errorDialogElement = (
    <ErrorDialog
      isOpen={errorDialog.isOpen}
      onClose={() => setErrorDialog({ isOpen: false, title: '', message: '' })}
      title={errorDialog.title}
      message={errorDialog.message}
    />
  );

  if (view === 'detail') {
    const doc = orderDetail || selectedOrder;
    const isDraft = doc?.docstatus === 0 || doc?.status === 'Draft' || !doc?.docstatus;
    const isSubmitted = doc?.docstatus === 1;
    const extraActions = (
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isDraft && (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleEditSalesOrder}
              disabled={loadingDetail}
            >
              Edit Order
            </button>
            <button
              type="button"
              className="btn btn-success btn-sm"
              onClick={handleSubmitSalesOrder}
              disabled={submittingSalesOrder}
            >
              {submittingSalesOrder ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Submit Order
                </>
              )}
            </button>
          </>
        )}
        {isSubmitted && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConvertToSalesInvoice}
            disabled={convertingToSalesInvoice}
          >
            {convertingToSalesInvoice ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <Check size={16} />
                Create Sales Invoice
              </>
            )}
          </button>
        )}
      </div>
    );

    return (
      <>
      <TransactionDetailLayout
        title="Sales Order Details"
        docName={doc?.name}
        status={doc?.status || (doc?.docstatus === 1 ? 'Submitted' : 'Draft')}
        docstatus={doc?.docstatus}
        dateLabel="Order Date"
        dateValue={doc?.transaction_date}
        dueDateLabel="Delivery Date"
        dueDateValue={doc?.delivery_date}
        backLabel="Back to Sales Orders"
        onBack={() => setView('list')}
        partyLabel="Customer Information"
        partyName={doc?.customer_name || doc?.customer}
        partySubtitle={doc?.po_no ? `PO No: ${doc.po_no}` : undefined}
        items={doc?.items || []}
        subtotal={doc?.net_total}
        discount={doc?.discount_amount}
        tax={doc?.total_taxes_and_charges}
        total={doc?.grand_total}
        formatDate={formatDate}
        extraActions={extraActions}
        pdfUrl={doc?.pdf_url}
        printDoctype="Sales Order"
        printDocName={doc?.name}
        printLetterhead={doc?.letter_head}
      />
      {errorDialogElement}
      </>
    );
  }

  if (view === 'create') {
    const customer = customers.find((c) => c.id === selectedCustomer);
    const partySelection = (
      <div className="form-group customer-search-container" style={{ position: 'relative' }}>
        <label className="form-label">Select Customer *</label>
        <div className="text-xs text-gray-500 mb-1">Showing customers assigned to you</div>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search customer by English name, mobile, or email..."
            value={customerSearch}
            onChange={(e) => {
              setCustomerSearch(e.target.value);
              if (selectedCustomer) setSelectedCustomer('');
            }}
            onFocus={() => !selectedCustomer && (customerSearch || customers.length) && setShowCustomerResults(true)}
            style={{ paddingLeft: 40 }}
            autoComplete="off"
          />
        </div>
        {showCustomerResults && !selectedCustomer && (customerSearch || filteredCustomers.length || customers.length) && (
          <div
            className="card"
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 300, overflowY: 'auto', zIndex: 1000, boxShadow: 'var(--shadow-lg)', padding: 0 }}
          >
            {(filteredCustomers.length ? filteredCustomers : customers.slice(0, 10)).map((c) => (
              <div
                key={c.id}
                onClick={() => {
                  setSelectedCustomer(c.id);
                  setCustomerSearch(c.custom_customer_name_english || c.name);
                  setShowCustomerResults(false);
                }}
                style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--gray-100)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-50)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontWeight: 600 }}>{c.custom_customer_name_english || c.name}</div>
                {c.custom_customer_name_arabic && <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{c.custom_customer_name_arabic}</div>}
              </div>
            ))}
          </div>
        )}
        {selectedCustomer && customer && (
          <>
            <div style={{ padding: '1rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-lg)', marginTop: '1rem' }}>
              <div className="font-semibold">{customer.custom_customer_name_english || customer.name}</div>
              {customer.custom_customer_name_arabic && <div className="text-xs text-gray-500 mt-1">{customer.custom_customer_name_arabic}</div>}
            </div>
            <div className="form-group mt-4">
              <label className="form-label">Delivery Date *</label>
              <input
                type="date"
                className="form-input"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                required
              />
            </div>
            <div className="form-group mt-4">
              <label className="form-label">PO No</label>
              <input
                type="text"
                className="form-input"
                value={poNo}
                onChange={(e) => setPoNo(e.target.value)}
                placeholder="Purchase order number"
              />
            </div>
          </>
        )}
      </div>
    );

    const addItemsSection = selectedCustomer && (
      <div style={{ position: 'relative' }} ref={itemDropdownRef}>
        <label className="form-label">Search Item by Code or Name</label>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="form-input"
            value={itemSearch}
            onChange={(e) => {
              setItemSearch(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => {
              setShowResults(true);
              if (!itemSearch.trim()) setSearchResults((items || []).slice(0, 20));
            }}
            placeholder="Type item code or name..."
            style={{ paddingRight: '3rem' }}
          />
          <Search size={20} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
        </div>
        {loadingSearch && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '2px solid var(--primary)', borderRadius: 'var(--radius-lg)', marginTop: 8, padding: 16, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={16} className="animate-spin" /> <span className="text-sm">Searching...</span>
          </div>
        )}
        {showResults && !loadingSearch && (
          <div
            className="card"
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, maxHeight: 300, overflowY: 'auto', zIndex: 1000, boxShadow: 'var(--shadow-lg)' }}
          >
            {searchResults.length ? (
              searchResults.map((item) => (
                <div
                  key={item.code || item.item_code}
                  onClick={() => handleAddItem(item)}
                  style={{ padding: '1rem', cursor: 'pointer', borderBottom: '1px solid var(--gray-200)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-50)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                >
                  <div className="font-semibold">{item.name || item.item_name}</div>
                  <div className="text-sm text-gray-600">Code: {item.code || item.item_code} | UOM: {item.uom || 'Unit'}</div>
                </div>
              ))
            ) : (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--gray-500)' }}>No items found</div>
            )}
          </div>
        )}
      </div>
    );

    return (
      <>
      <TransactionFormLayout
        title={editingSalesOrder ? `Edit Sales Order ${editingSalesOrder}` : "New Sales Order"}
        backLabel="Back to Sales Orders"
        onBack={() => { setView('list'); setLineItems([]); setSelectedCustomer(''); setCustomerSearch(''); setDiscountAmount('0'); setDeliveryDate(new Date().toISOString().split('T')[0]); setPoNo(''); setEditingSalesOrder(null); }}
        partySelection={partySelection}
        addItemsSection={addItemsSection}
        lineItems={lineItems}
        getPriceValue={getPriceValue}
        getQuantityValue={getQuantityValue}
        onUpdatePrice={handleUpdatePrice}
        onUpdateQuantity={handleUpdateQuantity}
        onUpdateUOM={handleUpdateUOM}
        onPriceBlur={handlePriceBlur}
        onRemoveItem={handleRemoveItem}
        discountAmount={discountAmount}
        onDiscountChange={handleUpdateDiscountAmount}
        calculateSubtotal={calculateSubtotal}
        calculateDiscount={calculateDiscount}
        calculateTax={calculateTax}
        calculateTotal={calculateTotal}
        onSubmit={handleSubmitCreate}
        submitting={submitting}
        submitLabel="Save Sales Order"
        disabledSubmit={loadingItem}
      />
      {errorDialogElement}
      </>
    );
  }

  return (
    <>
    <div className="sales-list fade-in">
      <div className="flex-between mb-6">
        <h1>Sales Orders</h1>
        <button className="btn btn-primary" onClick={() => setView('create')}>
          <Plus size={20} /> New Sales Order
        </button>
      </div>
      {loading ? (
        <div className="card">
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading...</div>
          </div>
        </div>
      ) : salesOrders.length > 0 || listSearch.trim() ? (
        <div className="card">
          <div className="mb-4">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Search Sales Orders</label>
              <div style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by name or customer..."
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  style={{ paddingLeft: 40 }}
                />
              </div>
            </div>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingListSearch ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                      <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto', display: 'block' }} />
                      <span className="text-muted">Searching...</span>
                    </td>
                  </tr>
                ) : listToShow.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }} className="text-muted">
                      {isSearchingList ? 'No matching orders' : 'No sales orders yet'}
                    </td>
                  </tr>
                ) : (
                  listToShow
                    .slice()
                    .sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0))
                    .map((so) => (
                      <tr
                        key={so.name}
                        onClick={() => handleViewDetails(so)}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--gray-50)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="font-semibold">{so.name}</td>
                        <td>{formatDate(so.transaction_date)}</td>
                        <td>{so.customer_name || so.customer || '—'}</td>
                        <td className="font-semibold">
                          <SARSymbol size={16} /> {(so.grand_total || 0).toFixed(2)}
                        </td>
                        <td>
                          <span className="badge badge-primary">{so.status || (so.docstatus === 1 ? 'Submitted' : 'Draft')}</span>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No sales orders yet</div>
            <p>Create your first sales order</p>
            <button className="btn btn-primary mt-4" onClick={() => setView('create')}>
              <Plus size={20} /> New Sales Order
            </button>
          </div>
        </div>
      )}
    </div>
    {errorDialogElement}
    </>
  );
}

export default SalesOrderModule;
