import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Activity, Shield, Zap, ExternalLink, RefreshCw, Box } from "lucide-react";

export default function App() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error("Failed to fetch status:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/refresh-tools", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        await fetchStatus();
      } else {
        alert("Failed to refresh tools: " + data.error);
      }
    } catch (error) {
      console.error("Error refreshing tools:", error);
      alert("Error refreshing tools. Check console.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      <div className="max-w-4xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-8"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
                <Zap className="w-6 h-6 text-orange-500" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">altFINS MCP Proxy Bridge</h1>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh Tools'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <motion.div
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-[#141414] border border-white/5 rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/50 uppercase tracking-wider font-semibold">
                  <Activity className="w-4 h-4" />
                  System Status
                </div>
                {loading ? (
                  <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
                ) : (
                  <div className={`w-2 h-2 rounded-full ${status?.status === 'ok' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
                )}
              </div>
              <div className="text-3xl font-light">
                {status?.status === 'ok' ? 'Running' : 'Offline'}
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                The proxy server is active and listening for incoming tool requests.
              </p>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-[#141414] border border-white/5 rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/50 uppercase tracking-wider font-semibold">
                  <Shield className="w-4 h-4" />
                  altFINS
                </div>
                <div className="flex gap-1">
                  <div className={`w-2 h-2 rounded-full ${status?.connectedToAltfins ? 'bg-green-500' : 'bg-orange-500'}`} />
                  <div className={`w-2 h-2 rounded-full ${status?.apiKeySet ? 'bg-green-500' : 'bg-red-500'}`} />
                </div>
              </div>
              <div className="text-3xl font-light">
                {status?.connectedToAltfins ? 'Connected' : 'Disconnected'}
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                {status?.apiKeySet ? 'API Key is configured.' : 'API Key is MISSING in environment.'}
              </p>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-[#141414] border border-white/5 rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/50 uppercase tracking-wider font-semibold">
                  <Box className="w-4 h-4" />
                  Cached Tools
                </div>
                <div className="text-xs font-mono text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                  LIVE
                </div>
              </div>
              <div className="text-3xl font-light">
                {status?.toolsCount ?? 0}
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                Number of tools currently cached and available via the proxy.
              </p>
            </motion.div>
          </div>

          <div className="p-8 bg-[#141414] border border-white/5 rounded-2xl space-y-6">
            <h2 className="text-xl font-semibold">Connection Details</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-white/30 uppercase tracking-widest font-bold">MCP Endpoint (Streamable HTTP / SSE)</label>
                <div className="flex items-center gap-2 p-3 bg-black/40 rounded-lg border border-white/5 font-mono text-sm text-orange-400">
                  {window.location.origin}/mcp
                </div>
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                Use this URL in your AI client (Cursor, Perplexity, etc.). This endpoint supports both the modern Streamable HTTP transport and standard SSE.
              </p>
            </div>
            
            <div className="pt-4 flex items-center gap-4">
              <a 
                href="https://mcp.altfins.com" 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                altFINS Documentation <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
