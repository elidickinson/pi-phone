import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PhoneServerRuntime } from "./phone-server-runtime";

export default function registerPhoneExtension(pi: ExtensionAPI) {
  const runtime = new PhoneServerRuntime(pi);

  pi.registerCommand("phone-start", {
    description: "Start the phone web UI. Usage: /phone-start [port] [token] [--local] [--cwd path] [--host 127.0.0.1] [--idle-mins 20]",
    handler: async (args, ctx) => {
      await runtime.handlePhoneStart(args, ctx);
    },
  });

  pi.registerCommand("phone-stop", {
    description: "Stop the phone web UI server and Cloudflare tunnel",
    handler: async (_args, ctx) => {
      await runtime.handlePhoneStop(ctx);
    },
  });

  pi.registerCommand("phone-status", {
    description: "Show phone server and tunnel status",
    handler: async (_args, ctx) => {
      await runtime.handlePhoneStatus(ctx);
    },
  });

  pi.registerCommand("phone-token", {
    description: "Show the current phone UI token",
    handler: async (_args, ctx) => {
      runtime.handlePhoneToken(ctx);
    },
  });

  pi.registerCommand("phone-pushover", {
    description: "Send Pi Phone URL and token to Pushover",
    handler: async (_args, ctx) => {
      await runtime.handlePhonePushover(ctx);
    },
  });

  // CLI input tracking
  pi.on("input", async (event, ctx) => {
    return runtime.handleInput(event, ctx);
  });

  // Session lifecycle → sync status UI + broadcast snapshot to phone
  pi.on("session_start", async (_event, ctx) => {
    await runtime.handleSessionStart(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("session_fork", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await runtime.handleSessionShutdown(ctx);
  });

  // Event bridge: forward CLI session events to phone UI via WebSocket
  pi.on("agent_start", (event, ctx) => {
    runtime.bridgeAgentStart(ctx);
  });

  pi.on("agent_end", (event, ctx) => {
    runtime.bridgeAgentEnd(ctx);
  });

  pi.on("message_update", (event, ctx) => {
    runtime.bridgeMessageUpdate(event, ctx);
  });

  pi.on("message_end", (event, ctx) => {
    runtime.bridgeMessageEnd(event, ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    runtime.bridgeToolExecutionStart(event, ctx);
  });

  pi.on("tool_execution_update", (event, ctx) => {
    runtime.bridgeToolExecutionUpdate(event, ctx);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    runtime.bridgeToolExecutionEnd(event, ctx);
  });
}
