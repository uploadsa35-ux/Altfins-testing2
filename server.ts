import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { 
  CallToolRequestSchema, 
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema
} from "@modelcontextprotocol/sdk/types.js";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  
  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // 1. Initialize MCP Client to connect to altFINS
  const altfinsApiKey = process.env.ALTFINS_API_KEY;
  if (!altfinsApiKey) {
    console.warn("WARNING: ALTFINS_API_KEY is not set in environment variables.");
  }

  const altfinsClient = new Client(
    {
      name: "altfins-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  // 2. Initialize MCP Server (the Proxy)
  const proxyServer = new Server(
    {
      name: "altfins-proxy-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // 3. Initialize Streamable HTTP Server Transport for the Proxy
  const transport = new StreamableHTTPServerTransport();

  // Connect the server to the transport immediately
  // This ensures the transport is ready to handle requests even if the bridge is still setting up
  proxyServer.connect(transport).catch(error => {
    console.error("Failed to connect proxy server to transport:", error);
  });

  // 4. MCP Route - MUST be before express.json() to handle raw streams if needed
  // and before any static/catch-all routes
  const mcpHandler = async (req: any, res: any) => {
    console.log(`[MCP] ${req.method} ${req.url} - Accept: ${req.headers.accept}`);
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Api-Key');
      res.status(204).end();
      return;
    }

    // Some clients might not send the correct Accept header for SSE
    // If it's a GET request, we assume they want SSE
    if (req.method === 'GET' && !req.headers.accept?.includes('text/event-stream')) {
      console.log("[MCP] GET request without text/event-stream Accept header. Forcing it for compatibility.");
      req.headers.accept = 'text/event-stream';
    }

    try {
      // Set a default content type to prevent HTML fallback
      const isSSE = req.headers.accept?.includes('text/event-stream');
      res.setHeader('Content-Type', isSSE ? 'text/event-stream' : 'application/json');
      
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[MCP] Error handling request:", error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Internal Server Error", 
          details: String(error),
          path: req.url
        });
      }
    }
  };

  // Modern endpoint
  app.all(["/mcp", "/mcp/"], mcpHandler);

  // Legacy redirects/aliases to prevent 404 -> HTML fallback
  app.all(["/sse", "/sse/"], (req, res) => {
    console.log("[MCP] Legacy /sse hit, redirecting to /mcp");
    res.redirect(307, "/mcp");
  });
  
  app.all(["/messages", "/messages/"], (req, res) => {
    console.log("[MCP] Legacy /messages hit, redirecting to /mcp");
    res.redirect(307, "/mcp");
  });

  app.use(express.json());

  let cachedTools: any[] = [];

  async function refreshTools() {
    try {
      console.log("Fetching tools from altFINS...");
      const result = await altfinsClient.request(
        { method: "tools/list" },
        ListToolsResultSchema
      );
      
      const tools = result.tools || [];
      const validTools = [];
      
      console.log(`Received ${tools.length} tools from altFINS. Validating...`);
      
      for (const tool of tools) {
        try {
          if (!tool.name) {
            throw new Error("Tool definition is missing a 'name' field.");
          }
          // Basic validation: ensure we have a name and it's a string
          if (typeof tool.name !== 'string') {
            throw new Error(`Tool name must be a string, received: ${typeof tool.name}`);
          }
          
          validTools.push(tool);
          console.log(`  [OK] Registered tool: ${tool.name}`);
        } catch (toolError: any) {
          console.error(`  [ERROR] Failed to register tool ${tool?.name || 'unknown'}:`, toolError.message);
          // Continue with the rest of the tools as requested
        }
      }
      
      cachedTools = validTools;
      console.log(`Successfully cached ${cachedTools.length} tools for proxying.`);
      return cachedTools;
    } catch (error) {
      console.error("Critical failure fetching tools from altFINS:", error);
      throw error;
    }
  }

  async function setupBridge() {
    try {
      // Connect to altFINS via Streamable HTTP if not already connected
      try {
        console.log("Connecting to altFINS MCP Server via Streamable HTTP...");
        const transport = new StreamableHTTPClientTransport(new URL("https://mcp.altfins.com/mcp"), {
          requestInit: {
            headers: {
              "X-Api-Key": altfinsApiKey || "",
            },
          },
        });

        await altfinsClient.connect(transport);
        console.log("Connected to altFINS MCP Server successfully.");
      } catch (connError: any) {
        if (connError.message?.includes("already connected")) {
          console.log("Already connected to altFINS.");
        } else {
          throw connError;
        }
      }

      await refreshTools();

      // Register each tool on the proxy server
      proxyServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: cachedTools };
      });

      proxyServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        console.log(`Proxying tool call: ${request.params.name}`);
        try {
          const result = await altfinsClient.request(
            {
              method: "tools/call",
              params: {
                name: request.params.name,
                arguments: request.params.arguments,
              },
            },
            CallToolResultSchema
          );
          return result;
        } catch (error) {
          console.error(`Error proxying tool call ${request.params.name}:`, error);
          throw error;
        }
      });

      console.log("Bridge setup complete.");
    } catch (error) {
      console.error("Failed to setup bridge:", error);
    }
  }

  // Routes for external AI clients
  // (Moved to top)

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      connectedToAltfins: !!altfinsClient,
      apiKeySet: !!altfinsApiKey,
      toolsCount: cachedTools.length,
      mcpEndpoint: "/mcp"
    });
  });

  app.post("/api/refresh-tools", async (req, res) => {
    try {
      await refreshTools();
      res.json({ success: true, toolsCount: cachedTools.length });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (typeof PORT === 'string' && (PORT.includes('/') || PORT.includes('\\'))) {
    // Unix socket or Windows named pipe
    app.listen(PORT, async () => {
      console.log(`MCP Proxy Server listening on socket: ${PORT}`);
      await setupBridge();
    });
  } else {
    // Network port
    const portNum = Number(PORT);
    app.listen(portNum, "0.0.0.0", async () => {
      console.log(`MCP Proxy Server listening on http://0.0.0.0:${portNum}`);
      await setupBridge();
    });
  }
}

startServer();
