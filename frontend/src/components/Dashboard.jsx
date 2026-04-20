import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, TrendingUp, Wallet, CreditCard, Loader2 } from 'lucide-react';
import { getTodaySales, getTodayCollection, getTodayCashCollection, getTodayBankCollection } from '../services/api';
import SARSymbol from './SARSymbol';

function Dashboard({ sales, payments, customers, loadingSales, loadingPayments, loadingCustomers }) {
  const navigate = useNavigate();
  const [loadingStats, setLoadingStats] = useState(true);
  const [todaySalesData, setTodaySalesData] = useState({ total: 0, count: 0 });
  const [todayCollectionData, setTodayCollectionData] = useState({ total: 0, count: 0 });
  const [todayCashData, setTodayCashData] = useState({ total: 0, count: 0 });
  const [todayBankData, setTodayBankData] = useState({ total: 0, count: 0 });

  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        setLoadingStats(true);
        
        const [salesRes, collectionRes, cashRes, bankRes] = await Promise.all([
          getTodaySales().catch(() => ({ total: 0, count: 0 })),
          getTodayCollection().catch(() => ({ total: 0, count: 0 })),
          getTodayCashCollection().catch(() => ({ total: 0, count: 0 })),
          getTodayBankCollection().catch(() => ({ total: 0, count: 0 }))
        ]);

        // Handle different response structures
        setTodaySalesData({
          total: salesRes?.total || salesRes?.today_sales || salesRes?.amount || 0,
          count: salesRes?.count || salesRes?.invoice_count || salesRes?.invoices?.length || 0
        });

        setTodayCollectionData({
          total: collectionRes?.total || collectionRes?.today_collection || collectionRes?.amount || 0,
          count: collectionRes?.count || collectionRes?.payment_count || collectionRes?.payments?.length || 0
        });

        setTodayCashData({
          total: cashRes?.total || cashRes?.cash_collection || cashRes?.amount || 0,
          count: cashRes?.count || cashRes?.payment_count || cashRes?.payments?.length || 0
        });

        setTodayBankData({
          total: bankRes?.total || bankRes?.bank_collection || bankRes?.amount || 0,
          count: bankRes?.count || bankRes?.payment_count || bankRes?.payments?.length || 0
        });
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        // Set defaults on error
        setTodaySalesData({ total: 0, count: 0 });
        setTodayCollectionData({ total: 0, count: 0 });
        setTodayCashData({ total: 0, count: 0 });
        setTodayBankData({ total: 0, count: 0 });
      } finally {
        setLoadingStats(false);
      }
    };

    fetchDashboardStats();
  }, []);

  const recentSales = useMemo(() => (
    (sales || [])
      .slice()
      .sort((a, b) => new Date(b.date || b.posting_date || 0) - new Date(a.date || a.posting_date || 0))
      .slice(0, 5)
  ), [sales]);

  const recentPayments = useMemo(() => (
    (payments || [])
      .slice()
      .sort((a, b) => new Date(b.date || b.posting_date || 0) - new Date(a.date || a.posting_date || 0))
      .slice(0, 5)
  ), [payments]);

  const customerOverview = useMemo(() => {
    const list = customers || [];
    const withBalance = list.filter(c => c.balance > 0).length;
    const totalOutstanding = list.reduce((sum, c) => sum + (c.balance || 0), 0);
    return { total: list.length, withBalance, totalOutstanding };
  }, [customers]);

  const stats = [
    {
      label: 'Today Sales',
      value: loadingStats ? (
        <Loader2 size={18} className="animate-spin" />
      ) : (
        <><SARSymbol size={18} /> {todaySalesData.total.toFixed(2)}</>
      ),
      icon: TrendingUp,
      color: 'primary',
      count: loadingStats ? '...' : `${todaySalesData.count} invoices`
    },
    {
      label: 'Today Collection',
      value: loadingStats ? (
        <Loader2 size={18} className="animate-spin" />
      ) : (
        <><SARSymbol size={18} /> {todayCollectionData.total.toFixed(2)}</>
      ),
      icon: DollarSign,
      color: 'success',
      count: loadingStats ? '...' : `${todayCollectionData.count} payments`
    },
    {
      label: 'Cash Collection',
      value: loadingStats ? (
        <Loader2 size={18} className="animate-spin" />
      ) : (
        <><SARSymbol size={18} /> {todayCashData.total.toFixed(2)}</>
      ),
      icon: Wallet,
      color: 'warning',
      count: loadingStats ? '...' : `${todayCashData.count} payments`
    },
    {
      label: 'Bank Collection',
      value: loadingStats ? (
        <Loader2 size={18} className="animate-spin" />
      ) : (
        <><SARSymbol size={18} /> {todayBankData.total.toFixed(2)}</>
      ),
      icon: CreditCard,
      color: 'info',
      count: loadingStats ? '...' : `${todayBankData.count} payments`
    }
  ];

  return (
    <div className="dashboard fade-in">
      <h1 className="mb-6">Dashboard</h1>
      
      <div className="stats-grid">
        {stats.map((stat, index) => (
          <div key={index} className={`stat-card stat-card-${stat.color}`}>
            <div className="stat-card-header">
              <div className={`stat-icon-wrapper stat-icon-${stat.color}`}>
                <stat.icon size={20} />
              </div>
              <div className="stat-label">{stat.label}</div>
            </div>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-count">{stat.count}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Sales</h3>
          </div>
          {loadingSales ? (
            <div className="empty-state">
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
              <div className="empty-state-title mt-4">Loading sales...</div>
            </div>
          ) : sales.length > 0 ? (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map(sale => (
                      <tr 
                        key={sale.id}
                        onClick={() => navigate('/sales', { state: { saleId: sale.id } })}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="font-semibold">{sale.id}</td>
                        <td>{sale.customerName}</td>
                        <td><SARSymbol size={16} /> {sale.total.toFixed(2)}</td>
                        <td>
                          <span className="badge badge-primary">{sale.status}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📄</div>
              <div className="empty-state-title">No sales yet</div>
              <p>Start creating sales invoices</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Payments</h3>
          </div>
          {loadingPayments ? (
            <div className="empty-state">
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
              <div className="empty-state-title mt-4">Loading payments...</div>
            </div>
          ) : payments.length > 0 ? (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Payment ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map(payment => (
                      <tr 
                        key={payment.id}
                        onClick={() => navigate('/payments', { state: { paymentId: payment.id } })}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="font-semibold">{payment.id}</td>
                        <td>{payment.customerName}</td>
                        <td><SARSymbol size={16} /> {payment.amount.toFixed(2)}</td>
                        <td>
                          <span className="badge badge-success">{payment.paymentMethod}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">💰</div>
              <div className="empty-state-title">No payments yet</div>
              <p>Start collecting payments</p>
            </div>
          )}
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h3 className="card-title">Customer Overview</h3>
        </div>
        {loadingCustomers ? (
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading customers...</div>
          </div>
        ) : (
          <div className="grid grid-3">
            <div>
              <div className="text-xs text-gray-600 mb-1">Total Customers</div>
              <div className="font-bold text-2xl">{customerOverview.total}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600 mb-1">With Outstanding Balance</div>
              <div className="font-bold text-2xl">{customerOverview.withBalance}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600 mb-1">Total Outstanding</div>
              <div className="font-bold text-2xl">
                <SARSymbol size={18} /> {customerOverview.totalOutstanding.toFixed(2)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
