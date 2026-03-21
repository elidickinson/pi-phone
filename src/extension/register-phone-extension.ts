import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PhoneServerRuntime } from "./phone-server-runtime";

export default function registerPhoneExtension(pi: ExtensionAPI) {
  if (process.env.PI_PHONE_CHILD === "1") {
    return;
  }

  const runtime = new PhoneServerRuntime(pi);

  pi.registerCommand("phone-start", {
    description: "Start the phone web UI. Usage: /phone-start [port] [token] [--cwd path] [--host 127.0.0.1] [--idle-mins 20]",
    handler: async (args, ctx) => {
      await runtime.handlePhoneStart(args, ctx);
    },
  });

  pi.registerCommand("phone-stop", {
    description: "Stop the phone web UI server and remove the matching Tailscale Serve route",
    handler: async (_args, ctx) => {
      await runtime.handlePhoneStop(ctx);
    },
  });

  pi.registerCommand("phone-status", {
    description: "Show phone server and Tailscale Serve status",
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

  pi.on("input", async (event, ctx) => {
    return runtime.handleInput(event, ctx);
  });

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

  pi.on("session_before_compact", async (_event, ctx) => {
    runtime.handleParentCompactionStart(ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    runtime.handleParentCompactionEnd(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await runtime.handleSessionSwitch(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    runtime.handleParentAgentStart(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    runtime.handleParentAgentEnd(ctx);
  });

  pi.on("message_start", async (event, ctx) => {
    runtime.handleParentMessageStart(event, ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    runtime.handleParentMessageUpdate(event, ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    runtime.handleParentMessageEnd(event, ctx);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    runtime.handleParentToolExecutionStart(event, ctx);
  });

  pi.on("tool_execution_update", async (event, ctx) => {
    runtime.handleParentToolExecutionUpdate(event, ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    runtime.handleParentToolExecutionEnd(event, ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await runtime.handleSessionShutdown(ctx);
  });
}
