import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Search, Loader2, Check } from 'lucide-react';
import ErrorDialog from './ErrorDialog';
import ConfirmationDialog from './ConfirmationDialog';
import {
  getQuotationList,
  getQuotationDetails,
  createQuotation,
  updateQuotation,
  submitQuotation,
  cancelQuotation,
  amendQuotation,
  getLeadList,
  createLead,
  getItemDetails,
  searchItems,
  convertQuotationToSalesOrder,
} from '../services/api';
import SARSymbol from './SARSymbol';
import TransactionFormLayout from './TransactionFormLayout';
import TransactionDetailLayout from './TransactionDetailLayout';

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

function QuotationModule({ customers = [], items = [] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState('list');
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listSearch, setListSearch] = useState('');
  const [listSearchResults, setListSearchResults] = useState([]);
  const [loadingListSearch, setLoadingListSearch] = useState(false);
  const listSearchRef = useRef(null);

  const [quotationTo, setQuotationTo] = useState('Customer');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedLeadName, setSelectedLeadName] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [showPartyResults, setShowPartyResults] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [filteredLeads, setFilteredLeads] = useState([]);

  const [lineItems, setLineItems] = useState([]);
  const [itemSearch, setItemSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loadingItem, setLoadingItem] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('0');
  const itemDropdownRef = useRef(null);

  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [quotationDetail, setQuotationDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingQuotation, setSubmittingQuotation] = useState(false);
  const [convertingToSalesOrder, setConvertingToSalesOrder] = useState(false);
  const [cancellingQuotation, setCancellingQuotation] = useState(false);
  const [amendingQuotation, setAmendingQuotation] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState(null);
  const [showQuickLeadForm, setShowQuickLeadForm] = useState(false);
  const [quickLeadFormData, setQuickLeadFormData] = useState({
    first_name: '',
    company_name: '',
    email_id: '',
    mobile_no: '',
    source: 'Campaign',
  });
  const [submittingQuickLead, setSubmittingQuickLead] = useState(false);
  const [errorDialog, setErrorDialog] = useState({ isOpen: false, title: '', message: '' });
  const [confirmationDialog, setConfirmationDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null, onCancel: null });

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
  const to2 = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);
  const round2 = (v) => Math.round(Number(v) * 100) / 100;

  const calculateSubtotal = () =>
    lineItems.reduce((sum, item) => sum + getPriceValue(item.price) * getQuantityValue(item.quantity), 0);
  const calculateDiscount = () => getDiscountValue(discountAmount);
  const calculateTax = () => calculateSubtotal() * 0.15;
  const calculateTotal = () => Math.max(calculateSubtotal() + calculateTax() - calculateDiscount(), 0);

  const hasParty = quotationTo === 'Customer' ? !!selectedCustomer : !!selectedLeadName;
  const partyNameForApi =
    quotationTo === 'Customer'
      ? (customers.find((c) => c.id === selectedCustomer)?.name || '')
      : selectedLeadName;

  const fetchList = async () => {
    setLoading(true);
    try {
      const { quotations: list } = await getQuotationList({ limit: 100, offset: 0 });
      setQuotations(Array.isArray(list) ? list : []);
    } catch (e) {
      setQuotations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, []);

  // Handle name query parameter to show detail view
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nameParam = params.get('name');
    if (nameParam && nameParam !== selectedQuotation?.name) {
      setLoadingDetail(true);
      getQuotationDetails(nameParam)
        .then((result) => {
          const doc = result.quotation || result;
          setSelectedQuotation({ name: nameParam });
          setQuotationDetail(doc);
          setView('detail');
        })
        .catch(() => {
          // If error, stay on list view
        })
        .finally(() => setLoadingDetail(false));
    }
  }, [location.search]);

  useEffect(() => {
    if (quotationTo === 'Lead') {
      getLeadList({ limit: 200, offset: 0 })
        .then(({ leads: list }) => setLeads(Array.isArray(list) ? list : []))
        .catch(() => setLeads([]));
    }
  }, [quotationTo]);

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
      getQuotationList({ limit: 100, offset: 0, search: term })
        .then(({ quotations: list }) => setListSearchResults(Array.isArray(list) ? list : []))
        .catch(() => setListSearchResults([]))
        .finally(() => setLoadingListSearch(false));
    }, 350);
    return () => { if (listSearchRef.current) clearTimeout(listSearchRef.current); };
  }, [listSearch]);

  useEffect(() => {
    if (quotationTo === 'Customer') {
      if (partySearch.trim() && !selectedCustomer) {
        const filtered = (customers || []).filter(
          (c) =>
            (c.name || '').toLowerCase().includes(partySearch.toLowerCase()) ||
            (c.custom_customer_name_english || '').toLowerCase().includes(partySearch.toLowerCase()) ||
            (c.mobile || '').toLowerCase().includes(partySearch.toLowerCase()) ||
            (c.email || '').toLowerCase().includes(partySearch.toLowerCase())
        );
        setFilteredCustomers(filtered);
        setShowPartyResults(true);
      } else if (!partySearch.trim()) {
        setFilteredCustomers([]);
        if (!selectedCustomer) setShowPartyResults(false);
      }
    } else {
      if (partySearch.trim() && !selectedLeadName) {
        const filtered = leads.filter(
          (l) =>
            (l.lead_name || l.name || '').toLowerCase().includes(partySearch.toLowerCase()) ||
            (l.company_name || '').toLowerCase().includes(partySearch.toLowerCase()) ||
            (l.email_id || '').toLowerCase().includes(partySearch.toLowerCase()) ||
            (l.mobile_no || '').toLowerCase().includes(partySearch.toLowerCase())
        );
        setFilteredLeads(filtered);
        setShowPartyResults(true);
      } else if (!partySearch.trim()) {
        setFilteredLeads([]);
        if (!selectedLeadName) setShowPartyResults(false);
      }
    }
  }, [partySearch, customers, leads, quotationTo, selectedCustomer, selectedLeadName]);

  useEffect(() => {
    if (!hasParty) {
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
  }, [itemSearch, items, hasParty]);

  useEffect(() => {
    const handleClick = (e) => {
      if (showResults && itemDropdownRef.current && !itemDropdownRef.current.contains(e.target)) setShowResults(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showResults]);

  useEffect(() => {
    const handleClick = (e) => {
      if (showPartyResults && !e.target.closest('.party-search-container')) setShowPartyResults(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPartyResults]);

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
        const customerName = quotationTo === 'Customer' ? (customers.find((c) => c.id === selectedCustomer)?.name || null) : null;
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
          price_list_rate: Number(to2(priceListRate)),
          uom: defaultUOM || '',
          stock_uom: stockUOM || '',
          sales_uom: salesUOM || stockUOM || '',
          uom_conversions: uomConversions,
          quantity: '1',
          originalPrice: Number(to2(priceListRate)),
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
            price_list_rate: Number(to2(basePrice)),
            uom: defaultUOM || '',
            stock_uom: stockUOM || '',
            sales_uom: salesUOM || stockUOM || '',
            uom_conversions: uomConversions,
            quantity: '1',
            originalPrice: Number(to2(basePrice)),
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

  const handleViewDetails = async (q) => {
    setSelectedQuotation(q);
    setView('detail');
    setLoadingDetail(true);
    setQuotationDetail(null);
    try {
      const detail = await getQuotationDetails(q.name);
      setQuotationDetail(detail);
    } catch {
      setQuotationDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSubmitQuotation = async () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name) return;
    if (doc.docstatus === 1) return;
    setSubmittingQuotation(true);
    try {
      await submitQuotation(doc.name);
      const updated = await getQuotationDetails(doc.name);
      setQuotationDetail(updated);
      setSelectedQuotation(updated);
    } catch (err) {
      console.error('Error submitting quotation:', err);
      // Extract and clean error message
      let errorMsg = 'Failed to submit quotation';
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
        title: 'Error Submitting Quotation',
        message: errorMsg
      });
    } finally {
      setSubmittingQuotation(false);
    }
  };

  const handleEditQuotation = async () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'No quotation selected'
      });
      return;
    }
    if (doc.docstatus !== 0) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'Only Draft quotations can be edited'
      });
      return;
    }
    setLoadingDetail(true);
    try {
      const details = await getQuotationDetails(doc.name);
      const quotationDoc = details.quotation || details;
      
      // Map items into form structure; price to 2 decimal places
      // Fetch item details for each item to get uom_conversions and price_list_rate
      const partyName = quotationDoc.party_name || quotationDoc.customer_name || null;
      const customerName = quotationDoc.quotation_to === 'Customer' ? partyName : null;
      const itemsForForm = await Promise.all((quotationDoc.items || []).map(async (item) => {
        const itemCode = item.item_code || item.code;
        const currentPrice = item.rate ?? item.price ?? 0;
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
      
      // Set party selection
      setQuotationTo(quotationDoc.quotation_to || 'Customer');
      if (quotationDoc.quotation_to === 'Customer') {
        const foundCustomer = customers.find(c => c.name === quotationDoc.party_name || c.name === quotationDoc.customer_name);
        if (foundCustomer) {
          setSelectedCustomer(foundCustomer.id);
          setPartySearch(foundCustomer.custom_customer_name_english || foundCustomer.name);
        } else {
          setSelectedCustomer('');
          setPartySearch(quotationDoc.customer_name || quotationDoc.party_name || '');
        }
        setSelectedLeadName('');
      } else {
        setSelectedLeadName(quotationDoc.party_name || '');
        setPartySearch(quotationDoc.party_name || '');
        setSelectedCustomer('');
      }
      
      setLineItems(itemsForForm);
      setDiscountAmount((quotationDoc.discount_amount || 0).toString());
      
      setEditingQuotation(doc.name);
      setView('create');
    } catch (error) {
      console.error('Error loading quotation for editing:', error);
      setErrorDialog({
        isOpen: true,
        title: 'Error Loading Quotation',
        message: error.message || 'Unknown error'
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleConvertToSalesOrder = async () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name) return;
    if (doc.docstatus !== 1) {
      setErrorDialog({
        isOpen: true,
        title: 'Error',
        message: 'Only submitted quotations can be converted to Sales Order'
      });
      return;
    }
    setConvertingToSalesOrder(true);
    try {
      const result = await convertQuotationToSalesOrder(doc.name);
      const salesOrderName = result.name;
      if (salesOrderName) {
        // Navigate to Sales Order detail view
        navigate(`/sales-orders?name=${salesOrderName}`);
      } else {
        setErrorDialog({
          isOpen: true,
          title: 'Warning',
          message: 'Sales Order created but name not returned'
        });
      }
    } catch (err) {
      console.error('Error converting quotation to sales order:', err);
      // Extract and clean error message
      let errorMsg = 'Failed to convert quotation to sales order';
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
        title: 'Error Submitting Quotation',
        message: errorMsg
      });
    } finally {
      setConvertingToSalesOrder(false);
    }
  };

  const handleCancelQuotation = async () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name || doc.docstatus !== 1) return;
    setCancellingQuotation(true);
    try {
      await cancelQuotation(doc.name);
      const updated = await getQuotationDetails(doc.name);
      setQuotationDetail(updated);
      setSelectedQuotation(updated);
    } catch (err) {
      setErrorDialog({
        isOpen: true,
        title: 'Error Cancelling Quotation',
        message: err?.message || 'Failed to cancel quotation'
      });
    } finally {
      setCancellingQuotation(false);
    }
  };

  const handleAmendQuotation = async () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name || doc.docstatus !== 2) return;
    setAmendingQuotation(true);
    setLoadingDetail(true);
    try {
      const result = await amendQuotation(doc.name);
      const newName = result?.name;
      if (!newName) {
        setAmendingQuotation(false);
        setLoadingDetail(false);
        return;
      }
      const details = await getQuotationDetails(newName);
      const quotationDoc = details.quotation || details;
      const partyName = quotationDoc.party_name || quotationDoc.customer_name || null;
      const customerName = quotationDoc.quotation_to === 'Customer' ? partyName : null;
      const itemsForForm = await Promise.all((quotationDoc.items || []).map(async (item) => {
        const itemCode = item.item_code || item.code;
        const currentPrice = item.rate ?? item.price ?? 0;
        const currentUOM = item.uom || item.sales_uom || item.stock_uom || '';
        let itemDetails = null;
        try {
          itemDetails = await getItemDetails(itemCode, customerName);
        } catch (e) {
          console.warn(`Failed to fetch details for item ${itemCode}:`, e);
        }
        const stockUOM = itemDetails?.stock_uom || item.stock_uom || currentUOM;
        const uomConversions = itemDetails?.uom_conversions || item.uom_conversions || [];
        let priceListRate = itemDetails?.item_prices?.[0]?.price_list_rate || itemDetails?.price_list_rate || item.price_list_rate;
        if (!priceListRate && currentUOM !== stockUOM && currentPrice) {
          const currentConv = uomConversions.find(conv => conv.uom === currentUOM);
          priceListRate = currentConv?.conversion_factor ? currentPrice / currentConv.conversion_factor : currentPrice;
        } else if (!priceListRate) {
          priceListRate = currentPrice;
        }
        return {
          code: itemCode,
          name: item.item_name || item.name,
          price: to2(currentPrice),
          price_list_rate: Number(to2(priceListRate)),
          uom: currentUOM,
          stock_uom: stockUOM,
          sales_uom: itemDetails?.sales_uom || itemDetails?.stock_uom || item.sales_uom || item.stock_uom || stockUOM,
          uom_conversions: uomConversions,
          quantity: (item.qty || item.quantity || 1).toString(),
          originalPrice: Number(to2(priceListRate)),
        };
      }));
      setQuotationTo(quotationDoc.quotation_to || 'Customer');
      if (quotationDoc.quotation_to === 'Customer') {
        const foundCustomer = customers.find(c => c.name === quotationDoc.party_name || c.name === quotationDoc.customer_name);
        if (foundCustomer) {
          setSelectedCustomer(foundCustomer.id);
          setPartySearch(foundCustomer.custom_customer_name_english || foundCustomer.name);
        } else {
          setSelectedCustomer('');
          setPartySearch(quotationDoc.customer_name || quotationDoc.party_name || '');
        }
        setSelectedLeadName('');
      } else {
        setSelectedLeadName(quotationDoc.party_name || '');
        setPartySearch(quotationDoc.party_name || '');
        setSelectedCustomer('');
      }
      setLineItems(itemsForForm);
      setDiscountAmount((quotationDoc.discount_amount || 0).toString());
      setEditingQuotation(newName);
      setView('create');
    } catch (err) {
      setErrorDialog({
        isOpen: true,
        title: 'Error Amending Quotation',
        message: err?.message || 'Failed to amend quotation'
      });
    } finally {
      setAmendingQuotation(false);
      setLoadingDetail(false);
    }
  };

  const closeConfirmationDialog = () => setConfirmationDialog({ isOpen: false, title: '', message: '', onConfirm: null, onCancel: null });

  const openCancelQuotationDialog = () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name || doc.docstatus !== 1) return;
    setConfirmationDialog({
      isOpen: true,
      title: 'Cancel Quotation',
      message: 'Cancel this quotation? You can create an amended quotation from it after cancelling.',
      onConfirm: () => {
        closeConfirmationDialog();
        handleCancelQuotation();
      },
      onCancel: closeConfirmationDialog,
    });
  };

  const openAmendQuotationDialog = () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name || doc.docstatus !== 2) return;
    setConfirmationDialog({
      isOpen: true,
      title: 'Amend Quotation',
      message: 'Create an amended quotation from this cancelled one? A new draft will be created.',
      onConfirm: () => {
        closeConfirmationDialog();
        handleAmendQuotation();
      },
      onCancel: closeConfirmationDialog,
    });
  };

  const openConvertToSalesOrderDialog = () => {
    const doc = quotationDetail || selectedQuotation;
    if (!doc?.name || doc.docstatus !== 1) return;
    setConfirmationDialog({
      isOpen: true,
      title: 'Create Sales Order',
      message: 'Create a Sales Order from this Quotation?',
      onConfirm: () => {
        closeConfirmationDialog();
        handleConvertToSalesOrder();
      },
      onCancel: closeConfirmationDialog,
    });
  };

  const handleCreateQuickLead = async (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!quickLeadFormData.first_name && !quickLeadFormData.company_name) {
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: 'Please fill in First Name or Company Name'
      });
      return;
    }
    setSubmittingQuickLead(true);
    try {
      const result = await createLead({
        first_name: quickLeadFormData.first_name || quickLeadFormData.company_name || 'Lead',
        company_name: quickLeadFormData.company_name || undefined,
        email_id: quickLeadFormData.email_id || undefined,
        mobile_no: quickLeadFormData.mobile_no || undefined,
        source: quickLeadFormData.source,
      });
      const leadName = result.name;
      if (!leadName) throw new Error('Lead created but name not returned');
      await getLeadList({ limit: 200, offset: 0 }).then(({ leads: list }) => setLeads(Array.isArray(list) ? list : []));
      setSelectedLeadName(leadName);
      setPartySearch(quickLeadFormData.first_name || quickLeadFormData.company_name || leadName);
      setShowPartyResults(false);
      setShowQuickLeadForm(false);
      setQuickLeadFormData({ first_name: '', company_name: '', email_id: '', mobile_no: '', source: 'Campaign' });
      alert(`Lead "${leadName}" created and selected successfully!`);
    } catch (err) {
      setErrorDialog({
        isOpen: true,
        title: 'Error Creating Lead',
        message: err.message || 'Failed to create lead'
      });
    } finally {
      setSubmittingQuickLead(false);
    }
  };

  const handleSubmitCreate = async (e) => {
    e.preventDefault();
    if (!partyNameForApi.trim()) {
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: 'Please select a Customer or Lead'
      });
      return;
    }
    if (lineItems.length === 0) {
      setErrorDialog({
        isOpen: true,
        title: 'Validation Error',
        message: 'Please add at least one item'
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
      let quotationName;
      
      if (editingQuotation) {
        // Update existing quotation
        result = await updateQuotation({
          quotation_name: editingQuotation,
          quotation_to: quotationTo,
          party_name: partyNameForApi,
          items: formattedItems,
          discount_amount: getDiscountValue(discountAmount),
        });
        quotationName = editingQuotation;
      } else {
        // Create new quotation
        result = await createQuotation({
          quotation_to: quotationTo,
          party_name: partyNameForApi,
          items: formattedItems,
        });
        quotationName = result.name || result.message?.name;
      }
      
      if (quotationName) {
        // Fetch details and show detail view so user can submit and print
        const detail = await getQuotationDetails(quotationName);
        setSelectedQuotation({ name: quotationName });
        setQuotationDetail(detail);
        setView('detail');
      } else {
        // Fallback to list if name not returned
        setView('list');
        fetchList();
      }
      // Clear form after successful create/update
      setQuotationTo('Customer');
      setSelectedCustomer('');
      setSelectedLeadName('');
      setPartySearch('');
      setLineItems([]);
      setDiscountAmount('0');
      setEditingQuotation(null);
    } catch (err) {
      console.error('Error creating/updating quotation:', err);
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
        return 'Failed to create/update quotation. Please try again.';
      };
      
      const errorMsg = cleanErrorMessage(err);
      setErrorDialog({
        isOpen: true,
        title: 'Error Submitting Quotation',
        message: errorMsg
      });
    } finally {
      setSubmitting(false);
    }
  };

  const listToShow = listSearch.trim() ? listSearchResults : quotations;
  const isSearchingList = !!listSearch.trim();

  // Error Dialog - render at top level so it's always visible (including list view)
  const errorDialogElement = (
    <ErrorDialog
      isOpen={errorDialog.isOpen}
      onClose={() => setErrorDialog({ isOpen: false, title: '', message: '' })}
      title={errorDialog.title}
      message={errorDialog.message}
    />
  );

  const confirmationDialogElement = (
    <ConfirmationDialog
      isOpen={confirmationDialog.isOpen}
      onClose={closeConfirmationDialog}
      onConfirm={confirmationDialog.onConfirm}
      onCancel={confirmationDialog.onCancel}
      title={confirmationDialog.title}
      message={confirmationDialog.message}
    />
  );

  if (view === 'detail') {
    const doc = quotationDetail || selectedQuotation;
    const isDraft = doc?.docstatus === 0 || doc?.status === 'Draft' || !doc?.docstatus;
    const isSubmitted = doc?.docstatus === 1;
    const isCancelled = doc?.docstatus === 2;
    const extraActions = (
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isDraft && (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleEditQuotation}
              disabled={loadingDetail}
            >
              Edit Quotation
            </button>
            <button
              type="button"
              className="btn btn-success btn-sm"
              onClick={handleSubmitQuotation}
              disabled={submittingQuotation}
            >
              {submittingQuotation ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Submit Quotation
                </>
              )}
            </button>
          </>
        )}
        {isSubmitted && (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openConvertToSalesOrderDialog}
              disabled={convertingToSalesOrder}
            >
              {convertingToSalesOrder ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Converting...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Create Sales Order
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={openCancelQuotationDialog}
              disabled={cancellingQuotation}
              title="Cancel this quotation"
            >
              {cancellingQuotation ? <Loader2 size={16} className="animate-spin" /> : 'Cancel'}
            </button>
          </>
        )}
        {isCancelled && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleAmendQuotation}
            disabled={amendingQuotation}
            title="Create amended draft and open in edit form"
          >
            {amendingQuotation ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Amending...
              </>
            ) : (
              'Amend'
            )}
          </button>
        )}
      </div>
    );

    return (
      <>
      <TransactionDetailLayout
        title="Quotation Details"
        docName={doc?.name}
        status={doc?.status || (doc?.docstatus === 1 ? 'Submitted' : doc?.docstatus === 2 ? 'Cancelled' : 'Draft')}
        docstatus={doc?.docstatus}
        dateLabel="Date"
        dateValue={doc?.transaction_date}
        dueDateLabel="Valid Till"
        dueDateValue={doc?.valid_till}
        backLabel="Back to Quotations"
        onBack={() => setView('list')}
        partyLabel="Party Information"
        partyName={doc?.customer_name || doc?.party_name}
        items={doc?.items || []}
        subtotal={doc?.net_total}
        discount={doc?.discount_amount}
        tax={doc?.total_taxes_and_charges}
        total={doc?.grand_total}
        formatDate={formatDate}
        extraActions={extraActions}
        pdfUrl={doc?.pdf_url}
        printDoctype="Quotation"
        printDocName={doc?.name}
        printLetterhead={doc?.letter_head}
      />
      {errorDialogElement}
      {confirmationDialogElement}
      </>
    );
  }

  if (view === 'create') {
    const partySelection = (
      <div className="form-group party-search-container" style={{ position: 'relative' }}>
        <div className="flex-between mb-4">
          <label className="form-label" style={{ marginBottom: 0 }}>Quotation To</label>
          {quotationTo === 'Lead' && !showQuickLeadForm && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowQuickLeadForm(true)}
            >
              <Plus size={16} />
              Create New Lead
            </button>
          )}
        </div>
        <select
          className="form-input mb-4"
          value={quotationTo}
          onChange={(e) => {
            setQuotationTo(e.target.value);
            setSelectedCustomer('');
            setSelectedLeadName('');
            setPartySearch('');
            setShowPartyResults(false);
            setShowQuickLeadForm(false);
          }}
        >
          <option value="Customer">Customer</option>
          <option value="Lead">Lead</option>
        </select>
        {showQuickLeadForm && quotationTo === 'Lead' && (
          <div className="card mb-4" style={{ backgroundColor: 'var(--gray-50)', border: '1px solid var(--primary)' }}>
            <div className="flex-between mb-4">
              <h4 style={{ margin: 0, color: 'var(--primary)' }}>Quick Lead Creation</h4>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setShowQuickLeadForm(false);
                  setQuickLeadFormData({ first_name: '', company_name: '', email_id: '', mobile_no: '', source: 'Campaign' });
                }}
              >
                Cancel
              </button>
            </div>
            <div>
              <div className="grid grid-2 gap-4">
                <div className="form-group">
                  <label className="form-label">First Name *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={quickLeadFormData.first_name}
                    onChange={(e) => setQuickLeadFormData({ ...quickLeadFormData, first_name: e.target.value })}
                    placeholder="First name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Company Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={quickLeadFormData.company_name}
                    onChange={(e) => setQuickLeadFormData({ ...quickLeadFormData, company_name: e.target.value })}
                    placeholder="Company name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={quickLeadFormData.email_id}
                    onChange={(e) => setQuickLeadFormData({ ...quickLeadFormData, email_id: e.target.value })}
                    placeholder="email@example.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mobile</label>
                  <input
                    type="text"
                    className="form-input"
                    value={quickLeadFormData.mobile_no}
                    onChange={(e) => setQuickLeadFormData({ ...quickLeadFormData, mobile_no: e.target.value })}
                    placeholder="Mobile number"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Source</label>
                  <select
                    className="form-input"
                    value={quickLeadFormData.source}
                    onChange={(e) => setQuickLeadFormData({ ...quickLeadFormData, source: e.target.value })}
                  >
                    <option value="Campaign">Campaign</option>
                    <option value="Cold Calling">Cold Calling</option>
                    <option value="Existing Customer">Existing Customer</option>
                    <option value="Partner">Partner</option>
                    <option value="Website">Website</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={handleCreateQuickLead}
                  disabled={submittingQuickLead}
                >
                  {submittingQuickLead ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus size={16} />
                      Create Lead
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowQuickLeadForm(false);
                    setQuickLeadFormData({ first_name: '', company_name: '', email_id: '', mobile_no: '', source: 'Campaign' });
                  }}
                  disabled={submittingQuickLead}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        <label className="form-label">Select {quotationTo} *</label>
        <div className="text-xs text-gray-500 mb-1">
          {quotationTo === 'Customer' ? 'Showing customers assigned to you' : 'Showing leads assigned to you'}
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
          <input
            type="text"
            className="form-input"
            placeholder={quotationTo === 'Customer' ? 'Search customer by name, mobile, or email...' : 'Search lead by name, company, or email...'}
            value={partySearch}
            onChange={(e) => {
              setPartySearch(e.target.value);
              if (quotationTo === 'Customer') setSelectedCustomer('');
              else setSelectedLeadName('');
            }}
            onFocus={() => !hasParty && setShowPartyResults(true)}
            style={{ paddingLeft: 40 }}
            autoComplete="off"
          />
        </div>
        {showPartyResults && !hasParty && (partySearch || (quotationTo === 'Customer' ? filteredCustomers.length : filteredLeads.length) || (quotationTo === 'Customer' ? customers.length : leads.length)) && (
          <div
            className="card"
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 300, overflowY: 'auto', zIndex: 1000, boxShadow: 'var(--shadow-lg)', padding: 0 }}
          >
            {quotationTo === 'Customer'
              ? (filteredCustomers.length ? filteredCustomers : customers.slice(0, 10)).map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer(c.id);
                      setPartySearch(c.custom_customer_name_english || c.name);
                      setShowPartyResults(false);
                    }}
                    style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--gray-100)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-50)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontWeight: 600 }}>{c.custom_customer_name_english || c.name}</div>
                    {c.custom_customer_name_arabic && <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{c.custom_customer_name_arabic}</div>}
                  </div>
                ))
              : (filteredLeads.length ? filteredLeads : leads.slice(0, 10)).map((l) => (
                  <div
                    key={l.name}
                    onClick={() => {
                      setSelectedLeadName(l.name);
                      setPartySearch(l.lead_name || l.company_name || l.name);
                      setShowPartyResults(false);
                    }}
                    style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--gray-100)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-50)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontWeight: 600 }}>{l.lead_name || l.company_name || l.name}</div>
                    {l.company_name && l.lead_name && <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{l.company_name}</div>}
                  </div>
                ))}
          </div>
        )}
        {hasParty && (
          <div style={{ padding: '1rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-lg)', marginTop: '1rem' }}>
            {quotationTo === 'Customer' ? (
              (() => {
                const customer = customers.find((c) => c.id === selectedCustomer);
                return customer ? (
                  <>
                    <div className="font-semibold">{customer.custom_customer_name_english || customer.name}</div>
                    {customer.custom_customer_name_arabic && <div className="text-xs text-gray-500 mt-1">{customer.custom_customer_name_arabic}</div>}
                  </>
                ) : null;
              })()
            ) : (
              (() => {
                const lead = leads.find((l) => l.name === selectedLeadName);
                return lead ? (
                  <>
                    <div className="font-semibold">{lead.lead_name || lead.company_name || lead.name}</div>
                    {lead.company_name && <div className="text-xs text-gray-500 mt-1">{lead.company_name}</div>}
                  </>
                ) : null;
              })()
            )}
          </div>
        )}
      </div>
    );

    const addItemsSection = hasParty && (
      <div style={{ position: 'relative' }} ref={itemDropdownRef}>
        <label className="form-label">Search Item by Code or Name</label>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="form-input"
            value={itemSearch}
            onChange={(e) => { setItemSearch(e.target.value); setShowResults(true); }}
            onFocus={() => { setShowResults(true); if (!itemSearch.trim()) setSearchResults((items || []).slice(0, 20)); }}
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
          <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, maxHeight: 300, overflowY: 'auto', zIndex: 1000, boxShadow: 'var(--shadow-lg)' }}>
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
        title={editingQuotation ? `Edit Quotation ${editingQuotation}` : "New Quotation"}
        backLabel="Back to Quotations"
        onBack={() => { setView('list'); setLineItems([]); setSelectedCustomer(''); setSelectedLeadName(''); setPartySearch(''); setQuotationTo('Customer'); setDiscountAmount('0'); setEditingQuotation(null); }}
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
        submitLabel="Save Quotation"
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
        <h1>Quotations</h1>
        <button className="btn btn-primary" onClick={() => setView('create')}>
          <Plus size={20} /> New Quotation
        </button>
      </div>
      {loading ? (
        <div className="card">
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading...</div>
          </div>
        </div>
      ) : quotations.length > 0 || listSearch.trim() ? (
        <div className="card">
          <div className="mb-4">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Search Quotations</label>
              <div style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by name or party..."
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
                  <th>Quotation ID</th>
                  <th>Date</th>
                  <th>Party</th>
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
                      {isSearchingList ? 'No matching quotations' : 'No quotations yet'}
                    </td>
                  </tr>
                ) : (
                  listToShow
                    .slice()
                    .sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0))
                    .map((q) => (
                      <tr
                        key={q.name}
                        onClick={() => handleViewDetails(q)}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--gray-50)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="font-semibold">{q.name}</td>
                        <td>{formatDate(q.transaction_date)}</td>
                        <td>{q.party_name || q.customer_name || '—'}</td>
                        <td className="font-semibold">
                          <SARSymbol size={16} /> {(q.grand_total || 0).toFixed(2)}
                        </td>
                        <td>
                          <span className="badge badge-primary">{q.status || (q.docstatus === 1 ? 'Submitted' : 'Draft')}</span>
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
            <div className="empty-state-icon">📄</div>
            <div className="empty-state-title">No quotations yet</div>
            <p>Create your first quotation</p>
            <button className="btn btn-primary mt-4" onClick={() => setView('create')}>
              <Plus size={20} /> New Quotation
            </button>
          </div>
        </div>
      )}
    </div>
    {errorDialogElement}
    </>
  );
}

export default QuotationModule;
