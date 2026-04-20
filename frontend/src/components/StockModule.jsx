
import * as React from 'react';
import { useState } from 'react';
import { Package, Loader2 } from 'lucide-react';
import SARSymbol from './SARSymbol';

function StockModule({ items, loadingItems }) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter items
  const filteredItems = items.filter(item => {
    const matchesSearch = 
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // Calculate totals (from API data only)
  const totalItems = filteredItems.length;
  const totalQuantity = filteredItems.reduce((sum, item) => sum + (item.stock || 0), 0);

  return (
    <div className="stock-module fade-in">
      <h1 className="mb-6">Stock Balance</h1>

      {/* Summary Cards */}
      <div className="grid grid-2 mb-6">
        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid var(--primary)' }}>
          <div className="text-xs text-gray-600 mb-1">Total Items</div>
          <div className="font-bold text-xl">{totalItems}</div>
          <div className="text-xs text-gray-500 mt-1">Unique SKUs</div>
        </div>

        <div className="card" style={{ padding: '1rem', borderLeft: '4px solid var(--secondary)' }}>
          <div className="text-xs text-gray-600 mb-1">Total Quantity</div>
          <div className="font-bold text-xl">{totalQuantity}</div>
          <div className="text-xs text-gray-500 mt-1">All units</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Search Items</label>
          <input
            type="text"
            className="form-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code or name..."
          />
        </div>
      </div>

      {/* Stock Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            <Package size={20} style={{ display: 'inline', marginRight: '0.5rem' }} />
            Stock Items
          </h3>
        </div>

        {loadingItems ? (
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading stock items...</div>
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>UOM</th>
                  <th>Warehouse</th>
                  <th>Stock Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => {
                  const stockQty = item.stock ?? 0;
                  const isOutOfStock = stockQty === 0;

                  return (
                    <tr key={item.code}>
                      <td className="font-semibold">{item.code}</td>
                      <td>{item.name}</td>
                      <td>{item.uom || '—'}</td>
                      <td>
                        <span className="badge badge-gray">{item.warehouse || '—'}</span>
                      </td>
                      <td className="font-semibold">{stockQty}</td>
                      <td>
                        {isOutOfStock ? (
                          <span className="badge badge-danger">Out of Stock</span>
                        ) : (
                          <span className="badge badge-success">In Stock</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--primary)', background: 'var(--gray-50)' }}>
                  <td colSpan="4" className="font-bold">TOTALS:</td>
                  <td className="font-bold">{totalQuantity}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-title">No items found</div>
            <p>Try adjusting your filters</p>
          </div>
        )}
      </div>

    </div>
  );
}

export default StockModule;
