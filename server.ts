import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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
  app.use(express.json());

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

  // Store SSE transports for session management
  const transports = new Map<string, SSEServerTransport>();

  let cachedTools: any[] = [];

  async function refreshTools() {
    try {
      console.log("Fetching tools from altFINS...");
      const result = await altfinsClient.request(
        { method: "tools/list" },
        ListToolsResultSchema
      );
      cachedTools = result.tools;
      console.log(`Cached ${cachedTools.length} tools.`);
      return cachedTools;
    } catch (error) {
      console.error("Failed to fetch tools:", error);
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
  app.get("/sse", async (req, res) => {
    console.log("New SSE connection request");
    const transport = new SSEServerTransport("/messages", res);
    
    await proxyServer.connect(transport);
    
    const sessionId = transport.sessionId;
    if (sessionId) {
      transports.set(sessionId, transport);
      console.log(`Session ${sessionId} connected`);
      
      req.on("close", () => {
        transports.delete(sessionId);
        console.log(`Session ${sessionId} disconnected`);
      });
    }
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);

    if (!transport) {
      console.error(`Session ${sessionId} not found`);
      res.status(404).send("Session not found");
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      connectedToAltfins: !!altfinsClient,
      toolsCount: cachedTools.length 
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

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`MCP Proxy Server listening on http://0.0.0.0:${PORT}`);
    await setupBridge();
  });
}

startServer();
