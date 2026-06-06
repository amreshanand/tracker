"use client";

import { useState, useEffect, useCallback } from "react";
import { getPlatformLabel } from "@/lib/platform";

interface Stats {
  products: number;
  totalAlerts: number;
  activeAlerts: number;
  notifiedAlerts: number;
  availabilityChecks: number;
  notificationsSent: number;
}

interface Alert {
  id: number;
  userName: string;
  email: string;
  pincode: string;
  notified: boolean;
  active: boolean;
  createdAt: string;
  notifiedAt: string | null;
  productId: number;
  productName: string;
  productUrl: string;
  platform: string;
  productPrice: string | null;
}

interface NotificationLogEntry {
  id: number;
  email: string;
  subject: string;
  body: string;
  sentAt: string;
  status: string;
  productName: string;
  productUrl: string;
}

type DashboardTab = "overview" | "alerts" | "notifications";

export function DashboardContent() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLogEntry[]>([]);
  const [emailFilter, setEmailFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, alertsRes, logsRes] = await Promise.all([
        fetch("/api/stats"),
        fetch(`/api/alerts${emailFilter ? `?email=${encodeURIComponent(emailFilter)}` : ""}`),
        fetch("/api/notifications/log"),
      ]);

      const statsData = await statsRes.json();
      const alertsData = await alertsRes.json();
      const logsData = await logsRes.json();

      setStats(statsData.stats || null);
      setAlerts(alertsData.alerts || []);
      setNotificationLogs(logsData.logs || []);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, [emailFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const handleProcessNotifications = async () => {
    setProcessing(true);
    setProcessResult("");
    try {
      const res = await fetch("/api/notifications/process", { method: "POST" });
      const data = await res.json();
      setProcessResult(data.message || "Processing complete");
      // Refresh data
      fetchData();
    } catch {
      setProcessResult("Failed to process notifications");
    } finally {
      setProcessing(false);
    }
  };

  const handleDeactivateAlert = async (alertId: number) => {
    try {
      await fetch(`/api/alerts/${alertId}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Failed to deactivate alert:", error);
    }
  };

  const statCards = stats
    ? [
        {
          label: "Products Tracked",
          value: stats.products,
          icon: "📦",
          color: "from-blue-500 to-blue-600",
          bgColor: "bg-blue-50",
        },
        {
          label: "Active Alerts",
          value: stats.activeAlerts,
          icon: "🔔",
          color: "from-amber-500 to-orange-500",
          bgColor: "bg-amber-50",
        },
        {
          label: "Notifications Sent",
          value: stats.notificationsSent,
          icon: "✉️",
          color: "from-emerald-500 to-green-500",
          bgColor: "bg-emerald-50",
        },
        {
          label: "Total Alerts",
          value: stats.totalAlerts,
          icon: "📊",
          color: "from-purple-500 to-purple-600",
          bgColor: "bg-purple-50",
        },
        {
          label: "Users Notified",
          value: stats.notifiedAlerts,
          icon: "✅",
          color: "from-teal-500 to-teal-600",
          bgColor: "bg-teal-50",
        },
        {
          label: "Availability Checks",
          value: stats.availabilityChecks,
          icon: "🔍",
          color: "from-rose-500 to-pink-500",
          bgColor: "bg-rose-50",
        },
      ]
    : [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">
            Monitor alerts, notifications, and availability data
          </p>
        </div>
        <button
          onClick={handleProcessNotifications}
          disabled={processing}
          className="px-5 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 text-sm flex items-center gap-2"
        >
          {processing ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Processing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Run Notification Check
            </>
          )}
        </button>
      </div>

      {processResult && (
        <div className="mb-6 p-4 bg-primary-50 border border-primary-200 rounded-xl text-primary-700 text-sm font-medium">
          {processResult}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-8 bg-slate-200/70 p-1 rounded-xl w-fit">
        {(["overview", "alerts", "notifications"] as DashboardTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all capitalize ${
              activeTab === tab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 skeleton rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                {statCards.map((card) => (
                  <div
                    key={card.label}
                    className="bg-white rounded-2xl p-5 border border-slate-200 hover:shadow-lg transition-all group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-2xl">{card.icon}</span>
                      <div className={`w-8 h-8 bg-gradient-to-br ${card.color} rounded-lg opacity-20 group-hover:opacity-30 transition-opacity`} />
                    </div>
                    <p className="text-3xl font-extrabold text-slate-900">
                      {card.value}
                    </p>
                    <p className="text-xs font-medium text-slate-500 mt-1 uppercase tracking-wider">
                      {card.label}
                    </p>
                  </div>
                ))}
              </div>

              {/* Recent alerts preview */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                  <h3 className="font-bold text-slate-900">Recent Alerts</h3>
                </div>
                {alerts.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-slate-400 text-lg">No alerts yet</p>
                    <p className="text-slate-400 text-sm mt-1">
                      Alerts will appear here when users subscribe for notifications
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {alerts.slice(0, 5).map((alert) => (
                      <div key={alert.id} className="p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${alert.active && !alert.notified ? "bg-amber-400" : alert.notified ? "bg-green-400" : "bg-slate-300"}`} />
                            <div>
                              <p className="font-semibold text-slate-900 text-sm">
                                {alert.userName} • {alert.email}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {alert.productName} → Pincode {alert.pincode}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-1 text-xs font-bold rounded-full ${
                                alert.notified
                                  ? "bg-green-100 text-green-700"
                                  : alert.active
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {alert.notified ? "Notified" : alert.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Alerts Tab */}
          {activeTab === "alerts" && (
            <div>
              {/* Email filter */}
              <div className="mb-6 flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  value={emailFilter}
                  onChange={(e) => setEmailFilter(e.target.value)}
                  placeholder="Filter by email..."
                  className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm"
                />
                <button
                  onClick={fetchData}
                  className="px-5 py-2.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-all text-sm"
                >
                  Search
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {alerts.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-slate-400 text-lg">No alerts found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                            User
                          </th>
                          <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                            Product
                          </th>
                          <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                            Pincode
                          </th>
                          <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                            Platform
                          </th>
                          <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                            Status
                          </th>
                          <th className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider px-4 py-3">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {alerts.map((alert) => (
                          <tr key={alert.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-900 text-sm">
                                {alert.userName}
                              </p>
                              <p className="text-xs text-slate-500">
                                {alert.email}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900 text-sm max-w-xs truncate">
                                {alert.productName}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-mono text-sm text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                {alert.pincode}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs font-semibold text-primary-600 bg-primary-50 px-2 py-1 rounded-lg">
                                {getPlatformLabel(alert.platform)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full ${
                                  alert.notified
                                    ? "bg-green-100 text-green-700"
                                    : alert.active
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  alert.notified ? "bg-green-500" : alert.active ? "bg-amber-500" : "bg-slate-400"
                                }`} />
                                {alert.notified
                                  ? "Notified"
                                  : alert.active
                                  ? "Watching"
                                  : "Inactive"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {alert.active && !alert.notified && (
                                <button
                                  onClick={() => handleDeactivateAlert(alert.id)}
                                  className="text-xs text-danger-500 hover:text-danger-700 font-medium transition-colors"
                                >
                                  Deactivate
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === "notifications" && (
            <div className="space-y-4">
              {notificationLogs.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <p className="text-slate-400 text-lg">No notifications sent yet</p>
                  <p className="text-slate-400 text-sm mt-1">
                    Click &quot;Run Notification Check&quot; to process pending alerts
                  </p>
                </div>
              ) : (
                notificationLogs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-2 h-2 bg-green-400 rounded-full" />
                          <span className="text-xs font-bold text-green-600 uppercase">
                            {log.status}
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(log.sentAt).toLocaleString()}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-900 mb-1">
                          {log.subject}
                        </h4>
                        <p className="text-sm text-slate-500">
                          To: {log.email}
                        </p>
                        <div className="mt-3 p-4 bg-slate-50 rounded-xl">
                          <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans">
                            {log.body}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
