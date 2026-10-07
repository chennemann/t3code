# Devin

Install [Devin CLI](https://docs.devin.ai/cli) on the machine running
your environment and run `devin auth login` there. Add Devin in **Settings > Providers**
and enable it. If T3 Code cannot find the CLI, set its binary path and refresh.

Devin works in your local project. Your browser or phone controls the CLI running
on the environment's machine. The provider uses your existing Devin CLI credentials;
instances share that login unless you configure separate credential environments.

Models come from your account's catalog. **Devin default** keeps the CLI's configured
model. Refresh provider status after changing your login or available models.

**Auto-accept edits** uses Devin's Code mode, **Auto** uses Smart mode, and **Full access**
uses Bypass mode. **Supervised** is unavailable because Devin's ACP interface does
not expose a mode that asks before every file edit. Plan mode is available from
the composer. Native Devin permission rules still apply.

Threads can resume after restarting T3 Code. `/compact` summarizes their context.
Devin does not support rewinding its conversation history through this integration.
